use reqwest::{redirect::Policy, Client, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    net::Ipv4Addr,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, State,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use zeroize::Zeroizing;

#[derive(Clone, Deserialize, Serialize)]
struct AgentProfile {
    id: String,
    username: String,
    role: String,
    status: String,
    capabilities: Vec<String>,
}

#[derive(Deserialize)]
struct PairResponse {
    token: String,
    profile: AgentProfile,
}

#[derive(Serialize)]
struct AgentStatus {
    connected: bool,
    profile: Option<AgentProfile>,
}

#[derive(Deserialize, Serialize)]
struct ChatResponse {
    reply: String,
    model: String,
}

#[derive(Deserialize, Serialize)]
struct ModelList {
    models: Vec<String>,
}

struct Session {
    generation: u64,
    master_url: String,
    token: Zeroizing<String>,
    profile: AgentProfile,
}

struct SharedState {
    session: Arc<Mutex<Option<Session>>>,
    sequence: AtomicU64,
}

impl SharedState {
    fn new() -> Self {
        Self {
            session: Arc::new(Mutex::new(None)),
            sequence: AtomicU64::new(1),
        }
    }
}

fn master_origin(value: &str) -> Result<String, String> {
    let url = Url::parse(value.trim()).map_err(|_| "آدرس هستهٔ مرکزی معتبر نیست".to_string())?;
    let loopback = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    let private_lan = url
        .host_str()
        .and_then(|host| host.parse::<Ipv4Addr>().ok())
        .is_some_and(|ip| {
            let [a, b, ..] = ip.octets();
            a == 10 || (a == 172 && (16..=31).contains(&b)) || (a == 192 && b == 168)
        });
    if (url.scheme() != "https" && !(url.scheme() == "http" && (loopback || private_lan)))
        || url.username() != ""
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "آدرس هسته باید HTTPS باشد؛ HTTP فقط برای localhost یا نشانی خصوصی شبکهٔ داخلی مجاز است"
                .into(),
        );
    }
    Ok(url.as_str().trim_end_matches('/').to_owned())
}

fn device_id() -> Result<String, String> {
    let host =
        std::env::var("COMPUTERNAME").map_err(|_| "نام دستگاه ویندوز پیدا نشد".to_string())?;
    let user = std::env::var("USERNAME").map_err(|_| "کاربر فعلی ویندوز پیدا نشد".to_string())?;
    let digest = Sha256::digest(format!("{host}:{user}").as_bytes());
    Ok(format!("win-{}", &hex::encode(digest)[..24]))
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|_| "ایجاد ارتباط با هسته ممکن نشد".into())
}

#[tauri::command]
fn read_pairing_clipboard(app: AppHandle) -> Result<String, String> {
    let text = app
        .clipboard()
        .read_text()
        .map_err(|_| "خواندن حافظهٔ ویندوز ممکن نشد".to_string())?;
    if text.chars().count() > 64 {
        return Err("حافظه باید فقط یک کد اتصال شش‌رقمی داشته باشد".into());
    }
    Ok(text)
}

#[tauri::command]
async fn pair_agent(
    code: String,
    master_url: String,
    state: State<'_, SharedState>,
) -> Result<AgentStatus, String> {
    if code.len() != 6 || !code.bytes().all(|b| b.is_ascii_digit()) {
        return Err("کد اتصال باید دقیقاً شش رقم باشد".into());
    }
    let origin = master_origin(&master_url)?;
    let old = state
        .session
        .lock()
        .map_err(|_| "نشست فعلی در دسترس نیست".to_string())?
        .take();
    if let Some(previous) = old {
        if let Ok(client) = http_client() {
            let _ = client
                .post(format!("{}/api/agent/logout", previous.master_url))
                .bearer_auth(previous.token.as_str())
                .timeout(Duration::from_secs(2))
                .send()
                .await;
        }
    }
    let response = http_client()?
        .post(format!("{origin}/api/agent/redeem"))
        .json(&serde_json::json!({ "code": code, "device_id": device_id()? }))
        .send()
        .await
        .map_err(|_| "ارتباط با هسته برقرار نشد".to_string())?;
    if !response.status().is_success() {
        return Err("کد نامعتبر یا منقضی شده است؛ کد تازه‌ای بگیرید".into());
    }
    let paired: PairResponse = response
        .json()
        .await
        .map_err(|_| "پاسخ هسته معتبر نیست".to_string())?;
    let profile = paired.profile.clone();
    let generation = state.sequence.fetch_add(1, Ordering::Relaxed);
    let mut guard = state
        .session
        .lock()
        .map_err(|_| "نشست فعلی در دسترس نیست".to_string())?;
    *guard = Some(Session {
        generation,
        master_url: origin,
        token: Zeroizing::new(paired.token),
        profile,
    });
    Ok(AgentStatus {
        connected: true,
        profile: Some(paired.profile),
    })
}

#[tauri::command]
fn session_status(state: State<'_, SharedState>) -> Result<AgentStatus, String> {
    let guard = state
        .session
        .lock()
        .map_err(|_| "نشست فعلی در دسترس نیست".to_string())?;
    Ok(match guard.as_ref() {
        Some(session) => AgentStatus {
            connected: true,
            profile: Some(session.profile.clone()),
        },
        None => AgentStatus {
            connected: false,
            profile: None,
        },
    })
}

#[tauri::command]
async fn send_agent_chat(
    message: String,
    model: String,
    save_history: bool,
    state: State<'_, SharedState>,
) -> Result<ChatResponse, String> {
    if message.trim().is_empty() || message.chars().count() > 8000 {
        return Err("پیام باید بین ۱ تا ۸۰۰۰ نویسه باشد".into());
    }
    let (origin, token) = {
        let guard = state
            .session
            .lock()
            .map_err(|_| "نشست فعلی در دسترس نیست".to_string())?;
        let session = guard.as_ref().ok_or("ابتدا با کد اتصال وارد شوید")?;
        if !session.profile.capabilities.iter().any(|cap| cap == "chat") {
            return Err("پروفایل شما دسترسی گفتگو ندارد".into());
        }
        (session.master_url.clone(), session.token.clone())
    };
    let response = http_client()?
        .post(format!("{origin}/api/agent/chat"))
        .bearer_auth(token.as_str())
        .json(&serde_json::json!({ "message": message, "model": model, "save_history": save_history }))
        .send()
        .await
        .map_err(|_| "ارتباط با هسته قطع است".to_string())?;
    if !response.status().is_success() {
        return Err("گفتگو ممکن نشد؛ ارتباط یا مدل را بررسی کنید".into());
    }
    response
        .json::<ChatResponse>()
        .await
        .map_err(|_| "پاسخ گفتگو معتبر نیست".into())
}

async fn profile_call(
    state: State<'_, SharedState>,
    capability: &'static str,
    method: reqwest::Method,
    route: &str,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let (origin, token, generation) = {
        let guard = state.session.lock().map_err(|_| "Session unavailable")?;
        let session = guard.as_ref().ok_or("Sign in first")?;
        if !session
            .profile
            .capabilities
            .iter()
            .any(|cap| cap == capability)
        {
            return Err("Profile permission required".into());
        }
        (
            session.master_url.clone(),
            session.token.clone(),
            session.generation,
        )
    };
    let client = http_client()?;
    let mut request = client
        .request(method, format!("{origin}{route}"))
        .bearer_auth(token.as_str());
    if let Some(value) = body {
        request = request.json(&value);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "Master connection failed")?;
    if !response.status().is_success() {
        return Err(format!("Profile request failed ({})", response.status()));
    }
    let result = response
        .json::<serde_json::Value>()
        .await
        .map_err(|_| "Invalid profile response")?;
    let guard = state.session.lock().map_err(|_| "Session unavailable")?;
    if guard
        .as_ref()
        .is_none_or(|session| session.generation != generation)
    {
        return Err("Session ended".into());
    }
    Ok(result)
}

#[tauri::command]
async fn agent_history(state: State<'_, SharedState>) -> Result<serde_json::Value, String> {
    profile_call(
        state,
        "chat",
        reqwest::Method::GET,
        "/api/agent/history",
        None,
    )
    .await
}

#[tauri::command]
async fn agent_clear_history(state: State<'_, SharedState>) -> Result<serde_json::Value, String> {
    profile_call(
        state,
        "chat",
        reqwest::Method::POST,
        "/api/agent/history/clear",
        Some(serde_json::json!({})),
    )
    .await
}

#[tauri::command]
async fn agent_memory(state: State<'_, SharedState>) -> Result<serde_json::Value, String> {
    profile_call(
        state,
        "chat",
        reqwest::Method::GET,
        "/api/agent/memory",
        None,
    )
    .await
}

#[tauri::command]
async fn agent_add_memory(
    content: String,
    state: State<'_, SharedState>,
) -> Result<serde_json::Value, String> {
    profile_call(
        state,
        "chat",
        reqwest::Method::POST,
        "/api/agent/memory/add",
        Some(serde_json::json!({"content": content})),
    )
    .await
}

#[tauri::command]
async fn agent_remove_memory(
    id: String,
    state: State<'_, SharedState>,
) -> Result<serde_json::Value, String> {
    profile_call(
        state,
        "chat",
        reqwest::Method::POST,
        "/api/agent/memory/remove",
        Some(serde_json::json!({"id": id})),
    )
    .await
}

#[tauri::command]
async fn list_agent_projects(state: State<'_, SharedState>) -> Result<serde_json::Value, String> {
    profile_call(
        state,
        "chat",
        reqwest::Method::GET,
        "/api/agent/workspace/projects",
        None,
    )
    .await
}

#[tauri::command]
async fn create_agent_project(
    name: String,
    state: State<'_, SharedState>,
) -> Result<serde_json::Value, String> {
    profile_call(
        state,
        "chat",
        reqwest::Method::POST,
        "/api/agent/workspace/projects",
        Some(serde_json::json!({"name": name})),
    )
    .await
}

#[tauri::command]
async fn list_agent_attachments(
    project_id: String,
    state: State<'_, SharedState>,
) -> Result<serde_json::Value, String> {
    if project_id.len() != 32 || !project_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("شناسهٔ پروژه معتبر نیست".into());
    }
    let route = format!("/api/agent/workspace/attachments?project_id={project_id}");
    profile_call(
        state,
        "chat",
        reqwest::Method::GET,
        &route,
        None,
    )
    .await
}

#[tauri::command]
async fn add_agent_attachment(
    project_id: String,
    name: String,
    mime: String,
    content_base64: String,
    state: State<'_, SharedState>,
) -> Result<serde_json::Value, String> {
    profile_call(
        state,
        "chat",
        reqwest::Method::POST,
        "/api/agent/workspace/attachments",
        Some(serde_json::json!({"project_id": project_id, "name": name,
                                "mime": mime, "content_base64": content_base64})),
    )
    .await
}

#[tauri::command]
async fn remove_agent_attachment(
    id: String,
    state: State<'_, SharedState>,
) -> Result<serde_json::Value, String> {
    profile_call(
        state,
        "chat",
        reqwest::Method::POST,
        "/api/agent/workspace/attachments/remove",
        Some(serde_json::json!({"id": id})),
    )
    .await
}

#[tauri::command]
async fn list_agent_tasks(state: State<'_, SharedState>) -> Result<serde_json::Value, String> {
    profile_call(
        state,
        "action.request",
        reqwest::Method::GET,
        "/api/agent/workspace/tasks",
        None,
    )
    .await
}

#[tauri::command]
async fn create_agent_task(
    project_id: String,
    description: String,
    state: State<'_, SharedState>,
) -> Result<serde_json::Value, String> {
    profile_call(
        state,
        "action.request",
        reqwest::Method::POST,
        "/api/agent/workspace/tasks",
        Some(serde_json::json!({"project_id": project_id, "description": description})),
    )
    .await
}

#[tauri::command]
async fn cancel_agent_task(
    id: String,
    state: State<'_, SharedState>,
) -> Result<serde_json::Value, String> {
    profile_call(
        state,
        "action.request",
        reqwest::Method::POST,
        "/api/agent/workspace/tasks/cancel",
        Some(serde_json::json!({"id": id})),
    )
    .await
}

#[tauri::command]
async fn list_agent_models(state: State<'_, SharedState>) -> Result<ModelList, String> {
    let (origin, token) = {
        let guard = state.session.lock().map_err(|_| "نشست در دسترس نیست")?;
        let session = guard.as_ref().ok_or("ابتدا متصل شوید")?;
        if !session.profile.capabilities.iter().any(|cap| cap == "chat") {
            return Err("پروفایل شما دسترسی گفتگو ندارد".into());
        }
        (session.master_url.clone(), session.token.clone())
    };
    let response = http_client()?
        .get(format!("{origin}/api/agent/models"))
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|_| "دریافت فهرست مدل‌ها ممکن نشد".to_string())?;
    if !response.status().is_success() {
        return Err("فهرست مدل‌ها در دسترس نیست؛ اتصال Ollama را بررسی کنید".into());
    }
    response
        .json::<ModelList>()
        .await
        .map_err(|_| "پاسخ مدل‌ها معتبر نیست".into())
}

#[tauri::command]
async fn disconnect_agent(state: State<'_, SharedState>) -> Result<(), String> {
    let session = state
        .session
        .lock()
        .map_err(|_| "نشست فعلی در دسترس نیست".to_string())?
        .take();
    if let Some(session) = session {
        // Token aval az state hazf mishavad; revoke dar sorate dastresi be Master anjam mishavad.
        if let Ok(client) = http_client() {
            let _ = client
                .post(format!("{}/api/agent/logout", session.master_url))
                .bearer_auth(session.token.as_str())
                .timeout(Duration::from_secs(2))
                .send()
                .await;
        }
    }
    Ok(())
}

#[tauri::command]
fn hide_agent(app: AppHandle) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or_else(|| "پنجرهٔ ایجنت پیدا نشد".to_string())?
        .hide()
        .map_err(|_| "کوچک‌کردن ایجنت ممکن نشد".to_string())
}

#[tauri::command]
fn quit_agent(app: AppHandle) {
    revoke_on_exit(&app);
    app.exit(0);
}

#[tauri::command]
fn set_compact(app: AppHandle, compact: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("پنجرهٔ ایجنت پیدا نشد")?;
    let monitor = window.current_monitor().ok().flatten();
    let (width, height) = if compact {
        (320.0, 76.0)
    } else if let Some(ref monitor) = monitor {
        let scale = monitor.scale_factor();
        (
            560.0_f64
                .min(monitor.size().width as f64 / scale - 32.0)
                .max(350.0),
            640.0_f64
                .min(monitor.size().height as f64 / scale - 80.0)
                .max(480.0),
        )
    } else {
        (520.0, 600.0)
    };
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|_| "تغییر اندازهٔ پنجره ممکن نشد".to_string())?;
    if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let x = monitor.position().x + ((monitor.size().width as f64 - width * scale) / 2.0) as i32;
        let y = monitor.position().y + (if compact { 0.0 } else { 16.0 } * scale) as i32;
        window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|_| "جابه‌جایی پنجره ممکن نشد".to_string())?;
    }
    Ok(())
}

fn reveal_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn ask_before_exit(app: &AppHandle) {
    reveal_window(app);
    let _ = app.emit_to("main", "omniops-exit-request", ());
}

fn revoke_on_exit(app: &AppHandle) {
    let shared = app.state::<SharedState>();
    let session = shared
        .session
        .lock()
        .ok()
        .and_then(|mut guard| guard.take());
    if let Some(session) = session {
        // Dar khorooj-e kamel revoke talash mishavad; pinhan-sazi tooken ra negah midarad.
        if let Ok(client) = reqwest::blocking::Client::builder()
            .redirect(Policy::none())
            .timeout(Duration::from_secs(1))
            .build()
        {
            let _ = client
                .post(format!("{}/api/agent/logout", session.master_url))
                .bearer_auth(session.token.as_str())
                .send();
        }
    }
}

fn start_lease_monitor(sessions: Arc<Mutex<Option<Session>>>) {
    thread::spawn(move || {
        let client = reqwest::blocking::Client::builder()
            .redirect(Policy::none())
            .timeout(Duration::from_secs(4))
            .build()
            .ok();
        loop {
            thread::sleep(Duration::from_secs(15));
            let snapshot = sessions.lock().ok().and_then(|guard| {
                guard.as_ref().map(|session| {
                    (
                        session.generation,
                        session.master_url.clone(),
                        session.token.clone(),
                    )
                })
            });
            if let (Some(client), Some((generation, origin, token))) = (&client, snapshot) {
                let ok = client
                    .post(format!("{origin}/api/agent/heartbeat"))
                    .bearer_auth(token.as_str())
                    .send()
                    .map(|response| response.status().is_success())
                    .unwrap_or(false);
                if !ok {
                    if let Ok(mut guard) = sessions.lock() {
                        if guard
                            .as_ref()
                            .is_some_and(|session| session.generation == generation)
                        {
                            // Ertebate gomshode bayad be halate ghofl bargardad.
                            guard.take();
                        }
                    }
                }
            }
        }
    });
}

pub fn run() {
    let shared = SharedState::new();
    start_lease_monitor(shared.session.clone());
    let app = tauri::Builder::default()
        .manage(shared)
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            pair_agent,
            read_pairing_clipboard,
            session_status,
            send_agent_chat,
            agent_history,
            agent_clear_history,
            agent_memory,
            agent_add_memory,
            agent_remove_memory,
            list_agent_projects,
            create_agent_project,
            list_agent_attachments,
            add_agent_attachment,
            remove_agent_attachment,
            list_agent_tasks,
            create_agent_task,
            cancel_agent_task,
            list_agent_models,
            disconnect_agent,
            hide_agent,
            quit_agent,
            set_compact
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                ask_before_exit(&window.app_handle());
            }
        })
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "نمایش OmniOps", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "پنهان کردن", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "قطع ارتباط و خروج", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &hide, &quit])?;
            let icon = app
                .default_window_icon()
                .ok_or("آیکون OmniOps پیدا نشد")?
                .clone();
            TrayIconBuilder::with_id("omniops")
                .icon(icon)
                .tooltip("OmniOps · ایجنت ویندوز")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                reveal_window(app);
                            }
                        }
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => reveal_window(app),
                    "hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                    "quit" => {
                        ask_before_exit(app);
                    }
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("برنامهٔ OmniOps اجرا نشد");
    app.run(|handle, event| {
        if matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) {
            revoke_on_exit(handle);
        }
    });
}

#[cfg(test)]
mod url_tests {
    use super::master_origin;

    #[test]
    fn accepts_private_lan_and_secure_master_urls() {
        assert!(master_origin("http://172.19.30.10:9000").is_ok());
        assert!(master_origin("http://10.88.0.1:9000").is_ok());
        assert!(master_origin("https://edge.example.com").is_ok());
    }

    #[test]
    fn rejects_public_http_and_embedded_credentials() {
        for url in [
            "http://8.8.8.8:9000",
            "http://0.0.0.0:9000",
            "http://172.32.0.1:9000",
            "http://user:pass@10.0.0.1:9000",
            "http://10.0.0.1:9000/api",
            "http://10.0.0.1:9000/?key=1",
        ] {
            assert!(master_origin(url).is_err(), "{url}");
        }
    }
}

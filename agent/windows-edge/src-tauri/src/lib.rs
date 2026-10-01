use reqwest::{redirect::Policy, Client, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::State;
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
    if (url.scheme() != "https" && !(url.scheme() == "http" && loopback))
        || url.username() != ""
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("آدرس هسته باید HTTPS باشد؛ HTTP فقط برای localhost مجاز است".into());
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
        .json(&serde_json::json!({ "message": message }))
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
        .invoke_handler(tauri::generate_handler![
            pair_agent,
            session_status,
            send_agent_chat,
            disconnect_agent
        ])
        .build(tauri::generate_context!())
        .expect("برنامهٔ OmniOps اجرا نشد");
    app.run(|handle, event| {
        if matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) {
            use tauri::Manager;
            let shared = handle.state::<SharedState>();
            let session = shared
                .session
                .lock()
                .ok()
                .and_then(|mut guard| guard.take());
            if let Some(session) = session {
                // Dar exit-e adi revoke talash mishavad; dar logoff-e ejbari lease-e server monghazi mishavad.
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
    });
}

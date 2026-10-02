import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "motion/react";

type AgentProfile = { id: string; username: string; role: string; status: string; capabilities: string[] };
type AgentStatus = { connected: boolean; profile: AgentProfile | null };
type ChatReply = { reply: string; model: string };
type ModelList = { models: string[] };
type Line = { sender: "user" | "assistant"; text: string; model?: string };

function digits(value: string) {
  return value
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/\D/g, "").slice(0, 6);
}

function clipboardPin(value: string): string | null {
  const normalized = value.trim()
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
  return /^\d{6}$/.test(normalized) ? normalized : null;
}

export default function App() {
  const [masterUrl, setMasterUrl] = useState("");
  const [pin, setPin] = useState("");
  const [phase, setPhase] = useState<"locked" | "verifying" | "success" | "chat">("locked");
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [sending, setSending] = useState(false);
  const [compact, setCompact] = useState(false);
  const [pane, setPane] = useState<"overview" | "chat">("overview");
  const [exitDialog, setExitDialog] = useState(false);
  const [rememberHide, setRememberHide] = useState(false);
  const [hideWithoutPrompt, setHideWithoutPrompt] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("auto");
  const [modelError, setModelError] = useState("");
  const fields = useRef<Array<HTMLInputElement | null>>([]);
  const attempt = useRef("");
  const sessionGeneration = useRef(0);
  const connected = useRef(false);

  useEffect(() => {
    let active = true;
    const check = async () => {
      const generation = sessionGeneration.current;
      try {
        const status = await invoke<AgentStatus>("session_status");
        if (!active || generation !== sessionGeneration.current) return;
        if (status.connected) {
          connected.current = true;
          setProfile(status.profile);
          setPhase("chat");
        } else {
          if (connected.current) {
            connected.current = false;
            sessionGeneration.current += 1;
            setLines([]);
            setPrompt("");
            setSending(false);
          }
          setProfile(null);
          setPhase((current) => current === "chat" || current === "success" ? "locked" : current);
        }
      } catch {
        if (active && generation === sessionGeneration.current) setPhase("locked");
      }
    };
    void check();
    const timer = window.setInterval(check, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!/^\d{6}$/.test(pin) || phase !== "locked" || attempt.current === pin) return;
    attempt.current = pin;
    void verify(pin);
  }, [pin, phase]);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke("set_compact", { compact: phase === "chat" && compact }).catch(() => {
      setError("تغییر اندازهٔ پنجره ممکن نشد.");
    });
  }, [phase, compact]);

  useEffect(() => {
    if (phase !== "chat" || !profile?.capabilities.includes("chat")) return;
    let active = true;
    void invoke<ModelList>("list_agent_models").then((result) => {
      if (!active) return;
      setModels(result.models);
      setSelectedModel((current) => current === "auto" || result.models.includes(current) ? current : "auto");
      setModelError(result.models.length ? "" : "مدل محلی نصب نشده است.");
    }).catch(() => { if (active) { setModels([]); setModelError("فهرست مدل‌ها در دسترس نیست؛ اتصال Ollama را بررسی کنید."); } });
    return () => { active = false; };
  }, [phase, profile?.id]);

  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen("omniops-exit-request", () => {
      setCompact(false);
      setExitDialog(true);
    }).then((stop) => { if (active) unlisten = stop; else stop(); });
    return () => { active = false; unlisten?.(); };
  }, []);

  function requestExit() {
    if (hideWithoutPrompt) { void hideToTray(); return; }
    setCompact(false);
    setExitDialog(true);
  }

  async function chooseHide() {
    setHideWithoutPrompt(rememberHide);
    setExitDialog(false);
    await hideToTray();
  }

  async function hideToTray() {
    if (!isTauri()) return;
    try { await invoke("hide_agent"); }
    catch { setError("پنهان‌کردن برنامه ممکن نشد."); }
  }

  async function verify(code: string) {
    if (!masterUrl.trim()) {
      setError("ابتدا آدرس هستهٔ مرکزی را وارد کنید.");
      setPin("");
      attempt.current = "";
      fields.current[0]?.focus();
      return;
    }
    setError("");
    setPhase("verifying");
    try {
      const status = await invoke<AgentStatus>("pair_agent", { code, masterUrl: masterUrl.trim() });
      sessionGeneration.current += 1;
      connected.current = true;
      setPin("");
      setProfile(status.profile);
      setPane("overview");
      setCompact(false);
      setHideWithoutPrompt(false);
      setRememberHide(false);
      setModels([]);
      setSelectedModel("auto");
      setPhase("success");
      window.setTimeout(() => setPhase((current) => current === "success" ? "chat" : current), 1300);
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "اتصال برقرار نشد. کد تازه‌ای دریافت کنید.");
      setPin("");
      attempt.current = "";
      setPhase("locked");
      window.setTimeout(() => fields.current[0]?.focus(), 0);
    }
  }

  function setDigit(index: number, value: string) {
    const cleaned = digits(value);
    if (cleaned.length > 1) {
      setPin((before) => (before.slice(0, index) + cleaned + before.slice(index + cleaned.length)).slice(0, 6));
      fields.current[Math.min(index + cleaned.length, 5)]?.focus();
      return;
    }
    const next = pin.padEnd(6, " ").split("");
    next[index] = cleaned || " ";
    setPin(next.join("").trimEnd());
    if (cleaned && index < 5) fields.current[index + 1]?.focus();
  }

  function applyPastedCode(text: string) {
    const code = clipboardPin(text);
    if (!code) { setError("حافظه باید فقط یک کد شش‌رقمی داشته باشد."); return; }
    setError("");
    setPin(code);
    fields.current[5]?.focus();
  }

  function pasteCode(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    applyPastedCode(event.clipboardData.getData("text"));
  }

  async function pasteFromClipboard() {
    if (!isTauri()) { setError("جایگذاری با دکمه فقط در برنامهٔ نصب‌شدهٔ ویندوز فعال است."); return; }
    try { applyPastedCode(await invoke<string>("read_pairing_clipboard")); }
    catch (cause) { setError(typeof cause === "string" ? cause : "خواندن حافظه ممکن نشد."); }
  }

  async function disconnect() {
    sessionGeneration.current += 1;
    connected.current = false;
    setSending(false);
    try { await invoke("disconnect_agent"); }
    catch { /* Khoroje mahalli bayad hata ba khataye shabake anjam shavad. */ }
    setProfile(null);
    setLines([]);
    setPrompt("");
    setPin("");
    attempt.current = "";
    setPhase("locked");
    setCompact(false);
    setHideWithoutPrompt(false);
    setRememberHide(false);
    setModels([]);
    setSelectedModel("auto");
    setError("");
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || sending) return;
    const generation = sessionGeneration.current;
    setPrompt("");
    setError("");
    setLines((before) => [...before, { sender: "user", text }]);
    setSending(true);
    try {
      const result = await invoke<ChatReply>("send_agent_chat", { message: text, model: selectedModel });
      if (sessionGeneration.current === generation) {
        setLines((before) => [...before, { sender: "assistant", text: result.reply, model: result.model }]);
      }
    } catch (cause) {
      if (sessionGeneration.current === generation) {
        setError(typeof cause === "string" ? cause : "پاسخ دریافت نشد.");
      }
    } finally {
      if (sessionGeneration.current === generation) setSending(false);
    }
  }

  return (
    <main className={`agent-frame ${compact && phase === "chat" ? "agent-frame--compact" : ""}`} dir="rtl">
      {compact && phase === "chat" ? (
        <button className="compact-island" type="button" onClick={() => setCompact(false)} aria-label="باز کردن پنجرهٔ OmniOps">
          <motion.span className="compact-emblem" animate={{ scale: [1, 1.09, 1] }} transition={{ duration: 3, repeat: Infinity }} aria-hidden="true">✦</motion.span>
          <span className="compact-copy"><strong>OmniOps</strong><small>{profile?.username} · {profile?.capabilities.includes("chat") ? "گفت‌وگو آماده" : "متصل"}</small></span>
          <span className="compact-pulse" aria-hidden="true" /><span className="compact-open" aria-hidden="true">↗</span>
        </button>
      ) : <>
      <div className="agent-header" data-tauri-drag-region><div className="agent-heading" data-tauri-drag-region><div className="agent-orb" data-tauri-drag-region aria-hidden="true">✦</div><span data-tauri-drag-region><strong data-tauri-drag-region>OmniOps</strong><small data-tauri-drag-region>بازوی امن ویندوز</small></span></div><div className="agent-window-controls"><span className={`state-dot ${phase === "chat" ? "on" : ""}`} aria-label={phase === "chat" ? "متصل" : "قفل"} /><button className="agent-close" type="button" title="پنهان کردن کنار ساعت" aria-label="پنهان کردن کنار ساعت" disabled={!isTauri()} onClick={() => void hideToTray()}>−</button><button className="agent-close" type="button" title="انتخاب پنهان‌کردن یا خروج کامل" aria-label="انتخاب پنهان‌کردن یا خروج کامل" disabled={!isTauri()} onClick={requestExit}>×</button></div></div>
      <AnimatePresence mode="wait">
        {phase === "locked" || phase === "verifying" ? (
          <motion.section key="pin" className="pair-view" initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .95 }} transition={{ duration: .25 }}>
            <div className="shield" aria-hidden="true">⌁</div>
            <h1>اتصال امن به هسته</h1><p>کد شش‌رقمی موقت را از پنل سازمان دریافت کنید.</p>
            <label htmlFor="master-url" className="agent-label">آدرس هستهٔ مرکزی</label>
            <input id="master-url" className="agent-input" dir="ltr" type="url" placeholder="https://edge.example.com" autoComplete="off" spellCheck={false} value={masterUrl} onChange={(event) => setMasterUrl(event.target.value)} disabled={phase === "verifying"} />
            <span className="agent-url-hint">برای اتصال در شبکهٔ داخلی، آدرس کامل سرور مانند <bdi>http://192.168.1.10:9000</bdi> را وارد کنید.</span>
            <div className="pin-row" dir="ltr" aria-label="کد اتصال شش‌رقمی">
              {Array.from({ length: 6 }, (_, index) => (
                <input key={index} ref={(element) => { fields.current[index] = element; }} className="pin-cell" aria-label={`رقم ${index + 1}`} inputMode="numeric" pattern="[0-9]*" autoComplete={index === 0 ? "one-time-code" : "off"} maxLength={1} value={pin[index] || ""} disabled={phase === "verifying"} onChange={(event) => setDigit(index, event.target.value)} onPaste={pasteCode} onKeyDown={(event) => {
                  if (event.key === "Backspace" && !pin[index] && index > 0) fields.current[index - 1]?.focus();
                  if (event.key === "ArrowLeft" && index > 0) fields.current[index - 1]?.focus();
                  if (event.key === "ArrowRight" && index < 5) fields.current[index + 1]?.focus();
                }} />
              ))}
            </div>
            <button type="button" className="paste-pin" disabled={phase === "verifying"} onClick={() => void pasteFromClipboard()}>جایگذاری کد از حافظه</button>
            <p className="pin-help">با جایگذاری یا ورود رقم آخر، کد خودکار بررسی می‌شود. اعتبار کد: ۲ دقیقه.</p>
            {phase === "verifying" && <span className="progress">در حال تأیید…</span>}
            {error && <p className="agent-error" role="alert">{error}</p>}
          </motion.section>
        ) : phase === "success" ? (
          <motion.section key="success" className="success-view" initial={{ opacity: 0, scale: .75 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, y: -15 }} transition={{ type: "spring", stiffness: 210, damping: 18 }}>
            <motion.div className="success-tick" initial={{ rotate: -20 }} animate={{ rotate: 0 }}>✓</motion.div><h1>متصل شد</h1><p>فضای گفت‌وگو در حال آماده‌شدن است.</p>
          </motion.section>
        ) : (
          <motion.section key="chat" className="chat-view" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .3 }}>
            <div className="session-line"><div><strong>{profile?.username}</strong><small>{profile?.capabilities.includes("chat") ? "گفت‌وگو فعال" : "پروفایل بدون دسترسی چت"}</small></div><button className="logout-button" onClick={() => void disconnect()}>خروج و قطع ارتباط</button></div>
            <nav className="agent-tabs" aria-label="بخش‌های ایجنت"><button className={pane === "overview" ? "selected" : ""} onClick={() => setPane("overview")} aria-current={pane === "overview" ? "page" : undefined}>نمای کلی</button><button className={pane === "chat" ? "selected" : ""} onClick={() => setPane("chat")} aria-current={pane === "chat" ? "page" : undefined}>گفت‌وگو</button><button className="compact-action" onClick={() => setCompact(true)} aria-label="جمع کردن ایجنت">جمع کردن ↑</button></nav>
            {pane === "overview" ? <div className="overview-space"><div className="overview-symbol" aria-hidden="true">✦</div><h1>ایجنت آمادهٔ همکاری است</h1><p>نشست {profile?.username} برقرار است. پنجره را جمع کنید یا کنار ساعت پنهان کنید؛ ارتباط در حافظهٔ برنامه می‌ماند.</p><div className="overview-grid"><div className="overview-card"><span className="overview-led" />هستهٔ مرکزی<strong>متصل</strong></div><div className="overview-card"><span className="overview-led muted" />ابزارهای دستگاه<strong>در حال توسعه</strong></div></div><button className="overview-chat" onClick={() => setPane("chat")} disabled={!profile?.capabilities.includes("chat")}>رفتن به گفت‌وگو ←</button></div> : <><div className="model-row"><label htmlFor="agent-model">مدل</label><select id="agent-model" dir="ltr" value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} disabled={sending || !profile?.capabilities.includes("chat")}><option value="auto">خودکار (اولین مدل محلی)</option>{models.map((model) => <option key={model} value={model}>{model}</option>)}</select><button type="button" onClick={() => { void invoke<ModelList>("list_agent_models").then((result) => { setModels(result.models); setSelectedModel((current) => current === "auto" || result.models.includes(current) ? current : "auto"); setModelError(result.models.length ? "" : "مدل محلی نصب نشده است."); }).catch(() => setModelError("فهرست مدل‌ها در دسترس نیست.")); }} aria-label="به‌روزرسانی فهرست مدل‌ها">↻</button></div>{modelError && <p className="model-error">{modelError}</p>}<div className="chat-lines" aria-live="polite">{lines.length === 0 && <p className="empty-chat">با هسته گفتگو کنید.<br />برای پاسخ هوشمند، یک مدل Ollama باید روی سرور فعال باشد.</p>}{lines.map((line, index) => <div key={index} className={`chat-bubble ${line.sender}`}><p>{line.text}</p>{line.model && <small dir="ltr">{line.model}</small>}</div>)}</div><form className="chat-composer" onSubmit={send}><input aria-label="پیام" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="پیام خود را بنویسید…" disabled={!profile?.capabilities.includes("chat") || sending} /><button disabled={sending || !profile?.capabilities.includes("chat")}>{sending ? "…" : "↵"}</button></form></>}
            {error && <p className="agent-error" role="alert">{error}</p>}
          </motion.section>
        )}
      </AnimatePresence>
      <div className="agent-footer">نشست فقط در حافظهٔ موقت · وضعیت اتصال با هسته بررسی می‌شود</div>
      </>}
      {exitDialog && <div className="exit-backdrop" role="presentation"><section className="exit-dialog" role="dialog" aria-modal="true" aria-labelledby="exit-title"><h2 id="exit-title">با ایجنت چه کنیم؟</h2><p>با پنهان‌کردن، نشست در حافظه می‌ماند. خروج کامل نشست را قطع می‌کند و اتصال بعدی به کد تازه نیاز دارد.</p><label className="exit-remember"><input type="checkbox" checked={rememberHide} onChange={(event) => setRememberHide(event.target.checked)} />تا اتصال بعدی، ضربدر بدون پرسیدن کنار ساعت پنهان کند</label><div className="exit-actions"><button type="button" onClick={() => void chooseHide()}>پنهان‌کردن کنار ساعت</button><button type="button" className="exit-danger" onClick={() => void invoke("quit_agent")}>خروج کامل</button><button type="button" onClick={() => setExitDialog(false)}>انصراف</button></div></section></div>}
    </main>
  );
}

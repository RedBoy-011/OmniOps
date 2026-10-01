import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "motion/react";

type AgentProfile = { id: string; username: string; role: string; status: string; capabilities: string[] };
type AgentStatus = { connected: boolean; profile: AgentProfile | null };
type ChatReply = { reply: string; model: string };
type Line = { sender: "user" | "assistant"; text: string; model?: string };

function digits(value: string) {
  return value
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/\D/g, "").slice(0, 6);
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

  function pasteCode(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const pasted = digits(event.clipboardData.getData("text"));
    setPin(pasted);
    fields.current[Math.min(pasted.length, 5)]?.focus();
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
      const result = await invoke<ChatReply>("send_agent_chat", { message: text });
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
    <main className="agent-frame" dir="rtl">
      <div className="agent-header" data-tauri-drag-region><div className="agent-heading" data-tauri-drag-region><div className="agent-orb" data-tauri-drag-region aria-hidden="true">✦</div><span data-tauri-drag-region><strong data-tauri-drag-region>OmniOps</strong><small data-tauri-drag-region>بازوی امن ویندوز</small></span></div><span className={`state-dot ${phase === "chat" ? "on" : ""}`} data-tauri-drag-region aria-label={phase === "chat" ? "متصل" : "قفل"} /></div>
      <AnimatePresence mode="wait">
        {phase === "locked" || phase === "verifying" ? (
          <motion.section key="pin" className="pair-view" initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .95 }} transition={{ duration: .25 }}>
            <div className="shield" aria-hidden="true">⌁</div>
            <h1>اتصال امن به هسته</h1><p>کد شش‌رقمی موقت را از پنل سازمان دریافت کنید.</p>
            <label htmlFor="master-url" className="agent-label">آدرس هستهٔ مرکزی</label>
            <input id="master-url" className="agent-input" dir="ltr" type="url" placeholder="https://master.example.com" autoComplete="off" spellCheck={false} value={masterUrl} onChange={(event) => setMasterUrl(event.target.value)} disabled={phase === "verifying"} />
            <div className="pin-row" dir="ltr" aria-label="کد اتصال شش‌رقمی">
              {Array.from({ length: 6 }, (_, index) => (
                <input key={index} ref={(element) => { fields.current[index] = element; }} className="pin-cell" aria-label={`رقم ${index + 1}`} inputMode="numeric" pattern="[0-9]*" autoComplete={index === 0 ? "one-time-code" : "off"} maxLength={1} value={pin[index] || ""} disabled={phase === "verifying"} onChange={(event) => setDigit(index, event.target.value)} onPaste={pasteCode} onKeyDown={(event) => {
                  if (event.key === "Backspace" && !pin[index] && index > 0) fields.current[index - 1]?.focus();
                  if (event.key === "ArrowLeft" && index > 0) fields.current[index - 1]?.focus();
                  if (event.key === "ArrowRight" && index < 5) fields.current[index + 1]?.focus();
                }} />
              ))}
            </div>
            <p className="pin-help">با ورود رقم آخر، کد خودکار بررسی می‌شود. اعتبار کد: ۲ دقیقه.</p>
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
            <div className="chat-lines" aria-live="polite">{lines.length === 0 && <p className="empty-chat">یک سؤال دربارهٔ دستگاه یا زیرساخت بپرسید.<br />فرمان سیستمی فقط با مجوز و تأیید مستقل قابل اجراست.</p>}{lines.map((line, index) => <div key={index} className={`chat-bubble ${line.sender}`}><p>{line.text}</p>{line.model && <small dir="ltr">{line.model}</small>}</div>)}</div>
            <form className="chat-composer" onSubmit={send}><input aria-label="پیام" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="پیام خود را بنویسید…" disabled={!profile?.capabilities.includes("chat") || sending} /><button disabled={sending || !profile?.capabilities.includes("chat")}>{sending ? "…" : "↵"}</button></form>
            {error && <p className="agent-error" role="alert">{error}</p>}
          </motion.section>
        )}
      </AnimatePresence>
      <div className="agent-footer">نشست فقط در حافظهٔ موقت · وضعیت اتصال با هسته بررسی می‌شود</div>
    </main>
  );
}

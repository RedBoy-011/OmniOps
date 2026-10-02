import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, type Operations, type PendingUser, type Profile } from "./api";

const choices = [
  ["chat", "گفت‌وگو"], ["skill.use", "مهارت‌ها"], ["tool.read", "مشاهدهٔ ابزار"],
  ["action.request", "درخواست اقدام"], ["action.approve", "تأیید اقدام"], ["agent.pair", "اتصال ایجنت"],
] as const;

type Props = { user: Profile; initialPending: number; onLogout: () => void };

export function AdminPanel({ user, initialPending, onLogout }: Props) {
  const [pending, setPending] = useState<PendingUser[]>([]);
  const [count, setCount] = useState(initialPending);
  const [toast, setToast] = useState(initialPending > 0 && user.role === "superadmin");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [pair, setPair] = useState<{ code: string; expires_at: number } | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [copyStatus, setCopyStatus] = useState("");
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [operations, setOperations] = useState<Operations | null>(null);
  const [operationsError, setOperationsError] = useState("");
  const [workerUrl, setWorkerUrl] = useState("");
  const [workerBusy, setWorkerBusy] = useState(false);
  const [workerMessage, setWorkerMessage] = useState("");

  useEffect(() => {
    if (user.role !== "superadmin") return;
    void refresh();
    void refreshOperations();
  }, [user.role]);

  async function refreshOperations() {
    try { const result = await api.operations(); setOperations(result); setWorkerUrl(result.ollama.url); setOperationsError(""); }
    catch { setOperationsError("دریافت وضعیت عملیاتی ممکن نشد."); }
  }

  async function saveWorker(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (workerBusy) return;
    setWorkerBusy(true);
    setWorkerMessage("در حال آزمون اتصال به Worker…");
    try {
      await api.saveOllamaEndpoint(workerUrl.trim());
      await refreshOperations();
      setWorkerMessage("اتصال Worker آزمایش و ذخیره شد.");
    } catch (cause) {
      setWorkerMessage(cause instanceof Error ? cause.message : "اتصال به Worker برقرار نشد؛ نشانی قبلی حفظ شد.");
    } finally { setWorkerBusy(false); }
  }

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(false), 6500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!pair) return;
    const update = () => {
      const remaining = Math.max(0, pair.expires_at - Math.floor(Date.now() / 1000));
      setSeconds(remaining);
      if (remaining === 0) { setPair(null); setCopyStatus(""); }
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [pair]);

  async function refresh() {
    try {
      const result = await api.pending();
      setPending(result.users);
      setCount(result.users.length);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "فهرست درخواست‌ها دریافت نشد.");
    }
  }

  async function decide(id: string, approve: boolean) {
    if (loading) return;
    setLoading(true);
    setMessage("");
    try {
      if (approve) await api.approve(id, selected[id] || ["chat"]);
      else await api.reject(id);
      await refresh();
      setMessage(approve ? "کاربر تأیید شد." : "درخواست رد شد.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "تغییر وضعیت ممکن نشد.");
    } finally {
      setLoading(false);
    }
  }

  function toggle(userId: string, capability: string) {
    setSelected((before) => {
      const current = before[userId] || ["chat"];
      const next = current.includes(capability) ? current.filter((item) => item !== capability) : [...current, capability];
      return { ...before, [userId]: next };
    });
  }

  async function createPair() {
    setMessage("");
    setCopyStatus("");
    try { setPair(await api.issuePairing()); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "کد اتصال صادر نشد."); }
  }

  async function copyPair() {
    if (!pair || seconds <= 0) return;
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(pair.code);
        copied = true;
      }
    } catch { /* Dar HTTP-e LAN az copy-e qadimi estefade mikonim. */ }
    if (!copied) {
      const field = document.createElement("textarea");
      field.value = pair.code;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      field.select();
      try { copied = document.execCommand("copy"); } catch { /* Matn-e code ghabele entekhab ast. */ }
      field.remove();
      focused?.focus();
    }
    setCopyStatus(copied ? "کد کپی شد؛ در ایجنت روی «جایگذاری کد» بزنید." : "کپی ممکن نشد؛ کد را انتخاب و کپی کنید.");
  }

  return (
    <main className="admin-scene" dir="rtl">
      <div className="tech-grid" aria-hidden="true" />
      <AnimatePresence>{toast && (
        <motion.div className="pending-toast" initial={{ opacity: 0, y: -30, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -20 }} role="status">
          <span className="toast-icon">✦</span><span>شما <strong>{count.toLocaleString("fa-IR")}</strong> درخواست ثبت‌نام در انتظار تأیید دارید.</span>
          <button onClick={() => setToast(false)} aria-label="بستن اعلان">×</button>
        </motion.div>
      )}</AnimatePresence>
      <div className="admin-wrap">
        <header className="admin-header glass"><div className="flex items-center gap-3"><span className="brand-mark">✦</span><strong>OmniOps</strong><span className="text-white/45 text-xs">/ فضای مدیریت سازمان</span></div><div className="flex items-center gap-4"><span className="text-sm text-white/65">{user.username}</span><button className="quiet-button" onClick={onLogout}>خروج امن</button></div></header>
        <div className="admin-hero"><span className="form-eyebrow">CONTROL PLANE / ACCESS</span><h1>مدیریت دسترسی و ایجنت‌ها</h1><p>هر قابلیت بر اساس پروفایل کاربر فعال می‌شود. تأیید ثبت‌نام به‌تنهایی اجازهٔ اجرای ابزار نمی‌دهد.</p></div>
        <div className="admin-grid">
          <section className="glass admin-card"><div className="card-title"><div><h2>درخواست‌های ثبت‌نام</h2><p>نام کاربری و موبایل پس از درخواست مدیر نمایش داده می‌شوند.</p></div><span className="count-pill">{count.toLocaleString("fa-IR")} در انتظار</span></div>
            {user.role !== "superadmin" ? <p className="empty-note">این بخش تنها برای مدیر کل با مجوز تأیید نمایش داده می‌شود.</p> : pending.length === 0 ? <p className="empty-note">درخواستی در انتظار تأیید نیست.</p> : (
              <div className="pending-list">{pending.map((person) => (
                <article className="pending-user" key={person.id}>
                  <div className="pending-title"><div><strong>{person.username}</strong><span dir="ltr">{person.mobile}</span></div><time>{new Date(person.created_at * 1000).toLocaleString("fa-IR")}</time></div>
                  <div className="capabilities" aria-label={`مجوزهای ${person.username}`}>
                    {choices.map(([value, title]) => <label key={value} className="capability"><input type="checkbox" checked={(selected[person.id] || ["chat"]).includes(value)} onChange={() => toggle(person.id, value)} />{title}</label>)}
                  </div>
                  <div className="pending-actions"><button disabled={loading} className="submit-button" onClick={() => decide(person.id, true)}>تأیید با این مجوزها</button><button disabled={loading} className="quiet-button danger" onClick={() => decide(person.id, false)}>رد درخواست</button></div>
                </article>
              ))}</div>
            )}
          </section>
          <section className="glass admin-card"><div className="card-title"><div><h2>اتصال موقت ایجنت ویندوز</h2><p>کد یک‌بارمصرف ۶ رقمی فقط ۲ دقیقه اعتبار دارد.</p></div></div>
            {!user.capabilities.includes("agent.pair") ? <p className="empty-note">پروفایل شما مجوز اتصال ایجنت ندارد.</p> : <>
              <button className="submit-button" onClick={createPair}>صدور کد اتصال تازه</button>
              <AnimatePresence mode="wait">{pair && <motion.div key={pair.code} className="pair-result" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
                <p>این کد را در پنجرهٔ ایجنت وارد کنید:</p><strong dir="ltr">{pair.code}</strong><button type="button" className="quiet-button pair-copy" onClick={() => void copyPair()}>کپی کد</button><small>{seconds.toLocaleString("fa-IR")} ثانیه باقی‌مانده · پس از استفاده باطل می‌شود</small>{copyStatus && <span className="pair-copy-status" role="status" aria-live="polite">{copyStatus}</span>}
              </motion.div>}</AnimatePresence>
              <p className="safety-note">توکن اتصال فقط در حافظهٔ فرایند ایجنت می‌ماند و با خروج یا قطع heartbeat از اعتبار می‌افتد.</p>
            </>}
          </section>
        </div>
        {user.role === "superadmin" && <section className="glass admin-card operations-card"><form className="worker-form" onSubmit={(event) => void saveWorker(event)}><label htmlFor="worker-url">نشانی خصوصی Ollama روی Worker</label><div className="worker-controls"><input id="worker-url" dir="ltr" type="url" required value={workerUrl} onChange={(event) => setWorkerUrl(event.target.value)} placeholder="http://worker-private-ip:11434" /><button className="submit-button" disabled={workerBusy} type="submit">{workerBusy ? "در حال آزمون…" : "تست و ذخیره"}</button></div><small>فقط نشانی شبکهٔ خصوصی یا localhost پذیرفته می‌شود. مدل باید روی Worker نصب و در دسترس Master باشد.</small>{workerMessage && <p className="admin-message" role="status">{workerMessage}</p>}</form><div className="card-title"><div><h2>وضعیت هسته و مدل‌های محلی</h2><p>این وضعیت مستقیماً از هسته و Ollama دریافت می‌شود.</p></div><button className="quiet-button" onClick={() => void refreshOperations()}>به‌روزرسانی</button></div>{operationsError ? <p className="admin-message" role="alert">{operationsError}</p> : operations ? <div className="operations-summary"><p>هستهٔ مرکزی: <strong>فعال</strong></p><p>نشانی فعال: <code dir="ltr">{operations.ollama.url}</code></p><p>Ollama: <strong>{operations.ollama.status === "up" ? "در دسترس" : "در دسترس نیست"}</strong></p><p>مدل‌ها: {operations.ollama.models.length.toLocaleString("fa-IR")}</p>{operations.ollama.models.length > 0 && <ul>{operations.ollama.models.map((model) => <li key={model.id} dir="ltr">{model.id}</li>)}</ul>}</div> : <p className="empty-note">در حال بررسی وضعیت…</p>}</section>}
        {message && <p className="admin-message" role="status" aria-live="polite">{message}</p>}
      </div>
    </main>
  );
}

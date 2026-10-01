import { useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, type LoginResult } from "./api";

type AuthPageProps = { onLogin: (result: LoginResult) => void };

export function AuthPage({ onLogin }: AuthPageProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mobile, setMobile] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState("");

  function changeMode(next: "login" | "register") {
    setMode(next);
    setError("");
    setCompleted("");
    setPassword("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setCompleted("");
    try {
      if (mode === "login") {
        onLogin(await api.login(username.trim(), password));
      } else {
        const result = await api.register(username.trim(), password, mobile.trim());
        setCompleted(result.message);
        setPassword("");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "درخواست با خطا روبه‌رو شد.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-scene" dir="rtl">
      <div className="tech-grid" aria-hidden="true" />
      <span className="ambient ambient-one" aria-hidden="true" />
      <span className="ambient ambient-two" aria-hidden="true" />
      <div className="auth-shell">
        <div className="auth-topline"><span className="brand-mark">✦</span><strong>OmniOps</strong><span className="text-white/40 text-xs">درگاه سازمانی</span></div>
        <div className="auth-panels">
          <section className="auth-form" data-active={mode === "login"} aria-label="فرم ورود">
            <AnimatePresence mode="wait">
              {mode === "login" && (
                <motion.div key="login" initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 18 }} transition={{ duration: 0.22 }}>
                  <p className="form-eyebrow">خوش آمدید</p><h1>ورود به هستهٔ مرکزی</h1><p className="form-intro">دسترسی شما بر اساس پروفایل سازمان تعیین می‌شود.</p>
                  <form onSubmit={submit} className="space-y-4">
                    <label className="form-label" htmlFor="login-username">نام کاربری</label>
                    <input id="login-username" className="form-input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
                    <label className="form-label" htmlFor="login-password">رمز عبور</label>
                    <input id="login-password" className="form-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                    <button className="submit-button" disabled={busy}>{busy ? "در حال بررسی…" : "ورود امن"}</button>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
          <section className="auth-form" data-active={mode === "register"} aria-label="فرم ثبت‌نام">
            <AnimatePresence mode="wait">
              {mode === "register" && (
                <motion.div key="register" initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -18 }} transition={{ duration: 0.22 }}>
                  <p className="form-eyebrow">عضویت سازمانی</p><h1>درخواست دسترسی</h1><p className="form-intro">پس از ثبت، حساب شما تا تأیید مدیر سیستم فعال نمی‌شود.</p>
                  <form onSubmit={submit} className="space-y-4">
                    <label className="form-label" htmlFor="register-username">نام کاربری</label>
                    <input id="register-username" className="form-input" autoComplete="username" minLength={3} maxLength={32} value={username} onChange={(e) => setUsername(e.target.value)} required />
                    <label className="form-label" htmlFor="register-mobile">شماره موبایل</label>
                    <input id="register-mobile" className="form-input phone-input" type="tel" inputMode="tel" autoComplete="tel" placeholder="0912… یا ‎+98912…" value={mobile} onChange={(e) => setMobile(e.target.value)} required />
                    <label className="form-label" htmlFor="register-password">رمز عبور (حداقل ۱۲ نویسه)</label>
                    <input id="register-password" className="form-input" type="password" autoComplete="new-password" minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} required />
                    <button className="submit-button" disabled={busy}>{busy ? "در حال ثبت…" : "ثبت درخواست"}</button>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>
          </section>
          <motion.aside className="sliding-panel" animate={{ x: mode === "login" ? "0%" : "100%" }} transition={{ type: "spring", stiffness: 170, damping: 24 }}>
            <div className="panel-orbit"><span>◈</span></div>
            <span className="panel-caption">SECURE CONTROL PLANE</span>
            <h2>{mode === "login" ? "هوشمندی در خدمت کنترل" : "فضای کاری سازمان شما"}</h2>
            <p>{mode === "login" ? "دستگاه‌ها، مدل‌ها و تصمیم‌ها را از یک نقطه مدیریت کنید." : "درخواست عضویت شما تنها پس از بررسی مدیر کل فعال می‌شود."}</p>
            <button className="outline-button" type="button" onClick={() => changeMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "ایجاد حساب جدید" : "بازگشت به ورود"}</button>
          </motion.aside>
        </div>
        <div className="mobile-switch"><button onClick={() => changeMode("login")} aria-pressed={mode === "login"}>ورود</button><button onClick={() => changeMode("register")} aria-pressed={mode === "register"}>ثبت‌نام</button></div>
        <div className="auth-feedback" role="status" aria-live="polite">
          <AnimatePresence mode="wait">
            {error ? <motion.p key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="error-note">{error}</motion.p>
              : completed ? <motion.p key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="success-note">{completed}</motion.p> : null}
          </AnimatePresence>
        </div>
      </div>
      <p className="auth-footer">هستهٔ مستقل · دسترسی مبتنی بر پروفایل · OmniOps</p>
    </main>
  );
}

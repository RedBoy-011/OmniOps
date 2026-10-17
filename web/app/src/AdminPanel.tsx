import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, type NodePingResult, type Operations, type PendingUser, type Profile } from "./api";
import { NodeManager } from "./NodeManager";
import { ProviderManager } from "./ProviderManager";
import { SystemHealthCard } from "./components/SystemHealthCard";
import { DatabaseBackupCard } from "./components/DatabaseBackupCard";
import { SystemUpdateCenterCard } from "./components/SystemUpdateCenterCard";
import { UserManagementCard } from "./components/UserManagementCard";
import { UserProfileModal } from "./components/UserProfileModal";
import { SecurityAuditCard } from "./components/SecurityAuditCard";
import { LiveLogViewer } from "./components/LiveLogViewer";
import { VoiceNotePlayer } from "./components/VoiceNotePlayer";
import { AdminAgentGovernanceCard } from "./components/AdminAgentGovernanceCard";
import { ThemePaletteSelector } from "./components/ThemePaletteSelector";

const choices = [
  ["chat", "گفت‌وگو"],
  ["provider.use", "مدل API بیرونی"],
  ["skill.use", "مهارت‌ها"],
  ["tool.read", "مشاهدهٔ ابزار"],
  ["action.request", "درخواست اقدام"],
  ["action.approve", "تأیید اقدام"],
  ["agent.pair", "اتصال ایجنت"],
] as const;

type AdminTab = "dashboard" | "nodes" | "providers" | "governance";
type GovernanceSubTab = "users" | "pending" | "audit" | "agents" | "profile" | "pairing" | "backup";

type Props = {
  user: Profile;
  initialPending: number;
  onLogout: () => void;
  onSwitchToWorkspace?: () => void;
};

export function AdminPanel({ user, initialPending, onLogout, onSwitchToWorkspace }: Props) {
  const [currentUser, setCurrentUser] = useState<Profile>(user);
  const [showProfile, setShowProfile] = useState(false);
  const [adminTab, setAdminTab] = useState<AdminTab>("dashboard");
  const [govSubTab, setGovSubTab] = useState<GovernanceSubTab>("users");

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
  const [pingResult, setPingResult] = useState<NodePingResult | null>(null);
  const [pingLoading, setPingLoading] = useState(false);

  async function handlePingNode() {
    setPingLoading(true);
    try {
      const res = await api.pingNode();
      setPingResult(res);
    } catch {
      // Handled silently or via toast
    } finally {
      setPingLoading(false);
    }
  }

  useEffect(() => {
    if (user.role !== "superadmin") return;
    void refresh();
    void refreshOperations();
    const timer = window.setInterval(() => void refreshOperations(), 15000);
    return () => window.clearInterval(timer);
  }, [user.role]);

  async function refreshOperations() {
    try {
      const result = await api.operations();
      setOperations(result);
    } catch {
      setOperations(null);
    }
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
      if (remaining === 0) {
        setPair(null);
        setCopyStatus("");
      }
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
      const next = current.includes(capability)
        ? current.filter((item) => item !== capability)
        : [...current, capability];
      return { ...before, [userId]: next };
    });
  }

  async function createPair() {
    setMessage("");
    setCopyStatus("");
    try {
      setPair(await api.issuePairing());
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "کد اتصال صادر نشد.");
    }
  }

  async function copyPair() {
    if (!pair || seconds <= 0) return;
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(pair.code);
        copied = true;
      }
    } catch {
      // fallback
    }
    if (!copied) {
      const field = document.createElement("textarea");
      field.value = pair.code;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      try {
        copied = document.execCommand("copy");
      } catch {}
      field.remove();
    }
    setCopyStatus(copied ? "کد کپی شد؛ در برنامه روی جایگذاری بزنید." : "کپی ممکن نشد؛ کد را دستی کپی کنید.");
  }

  return (
    <main className="admin-scene admin-console-scene" dir="rtl">
      <div className="tech-grid" aria-hidden="true" />

      {/* اعلان وجود درخواست‌های ثبت‌نام در انتظار */}
      <AnimatePresence>
        {toast && (
          <motion.div
            className="pending-toast"
            initial={{ opacity: 0, y: -30, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20 }}
            role="status"
            style={{ cursor: "pointer" }}
            onClick={() => {
              setAdminTab("governance");
              setGovSubTab("pending");
              setToast(false);
            }}
            title="کلیک برای باز کردن تب درخواست‌های ثبت‌نام"
          >
            <span className="toast-icon">✦</span>
            <span>
              شما <strong>{count.toLocaleString("fa-IR")}</strong> درخواست عضویت جدید در انتظار بررسی دارید (کلیک جهت بررسی).
            </span>
            <button onClick={(e) => { e.stopPropagation(); setToast(false); }} aria-label="بستن اعلان">
              ×
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="admin-wrap">
        {/* هدر فلت، مدرن و رسپانسیو کنسول مدیریت هسته و زیرساخت */}
        <header className="admin-header admin-flat-header">
          {/* سمت راست: هویت برند و عنوان ماژول */}
          <div className="admin-header-brand">
            <span className="brand-mark">✦</span>
            <strong className="brand-title">OmniOps</strong>
            <span className="admin-badge-tag hidden lg:inline-flex">کنسول مدیریت هسته و زیرساخت</span>
          </div>

          {/* سمت چپ: کنترل‌های سراسری، تم، سوییچ، پروفایل و خروج */}
          <div className="admin-header-actions">
            {/* انتخابگر فشرده طیف رنگ سراسری سیستم (مرحله ۲) */}
            <ThemePaletteSelector compact isSuperadmin={currentUser.role === "superadmin"} />

            {/* کلید سوئیچ فوری به فضای کاربری هوش مصنوعی */}
            {onSwitchToWorkspace && (
              <button
                type="button"
                className="workspace-switch-pill"
                onClick={onSwitchToWorkspace}
                title="سوییچ به فضای کاربری هوش مصنوعی، چت و اسناد"
              >
                <span className="switch-icon">💬</span>
                <span className="hidden sm:inline">ورود به فضای کار</span>
                <span className="sm:hidden">کاربری</span>
              </button>
            )}

            <button
              type="button"
              className="profile-pill-button"
              onClick={() => {
                setAdminTab("governance");
                setGovSubTab("profile");
              }}
              title="مشاهده پروفایل، آمار عملکرد و تغییر رمز"
            >
              <span className="profile-pill-icon">👑</span>
              <span className="profile-name-text max-w-[70px] sm:max-w-none truncate">{currentUser.username}</span>
            </button>

            <button className="quiet-button logout-button" onClick={onLogout} title="خروج امن از سیستم">
              <span className="logout-icon">🚪</span>
              <span className="hidden sm:inline">خروج امن</span>
            </button>
          </div>
        </header>

        {/* هدر معرفی کنسول مدیریت */}
        <div className="admin-hero">
          <span className="form-eyebrow">MISSION CONTROL / INFRASTRUCTURE</span>
          <h1>کنسول فرماندهی و مدیریت هوشمند سرورها</h1>
          <p>مدیریت جامع خوشه‌های پردازشی Worker، تأمین‌کنندگان مدل‌ها، کاربران سازمان و پایش لحظه‌ای زیرساخت.</p>
        </div>

        {/* منوی ناوبری ۵ گانهٔ بازطراحی‌شده تب‌های کنسول مدیریت (فلت و رسپانسیو) */}
        <div className="admin-nav-tabs-container">
          <div className="admin-nav-tabs" role="tablist" aria-label="بخش‌های کنسول مدیریت">
            <button
              type="button"
              role="tab"
              aria-selected={adminTab === "dashboard"}
              className={`admin-nav-tab ${adminTab === "dashboard" ? "active" : ""}`}
              onClick={() => setAdminTab("dashboard")}
            >
              <span className="tab-icon">📊</span>
              <span className="tab-title-full hidden md:inline">داشبورد و پایش زیرساخت</span>
              <span className="tab-title-short md:hidden">داشبورد</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={adminTab === "nodes"}
              className={`admin-nav-tab ${adminTab === "nodes" ? "active" : ""}`}
              onClick={() => setAdminTab("nodes")}
            >
              <span className="tab-icon">🖥️</span>
              <span className="tab-title-full hidden md:inline">سرورها و مدل‌های محلی</span>
              <span className="tab-title-short md:hidden">سرورها</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={adminTab === "providers"}
              className={`admin-nav-tab ${adminTab === "providers" ? "active" : ""}`}
              onClick={() => setAdminTab("providers")}
            >
              <span className="tab-icon">🌐</span>
              <span className="tab-title-full hidden md:inline">تأمین‌کنندگان و پراکسی SOCKS</span>
              <span className="tab-title-short md:hidden">تأمین‌کنندگان</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={adminTab === "governance"}
              className={`admin-nav-tab ${adminTab === "governance" ? "active" : ""}`}
              onClick={() => setAdminTab("governance")}
            >
              <span className="tab-icon">🛡️</span>
              <span className="tab-title-full hidden md:inline">امنیت، کاربران و حاکمیت</span>
              <span className="tab-title-short md:hidden">حاکمیت</span>
              {count > 0 && <span className="tab-counter-badge">{count.toLocaleString("fa-IR")}</span>}
            </button>
          </div>
        </div>

        {/* ۱. تب بازطراحی‌شده داشبورد و پایش زیرساخت (مرحله ۴: سلسله‌مراتبی و کم‌حجم) */}
        {adminTab === "dashboard" && (
          <div className="dashboard-view" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* نوار کارت‌های شاخص‌های کلیدی (Executive High-Density KPI Strip) */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
              <div className="glass admin-card" style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <span style={{ fontSize: "11px", color: "#94a3b8", display: "block" }}>هسته مرکزی عملیات (Master)</span>
                  <strong style={{ fontSize: "13px", color: "#f1f5f9", display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
                    ۱۷۲.۱۹.۳۰.۹۴ (فعال)
                  </strong>
                </div>
                <span style={{ fontSize: "20px" }}>🏢</span>
              </div>

              <div className="glass admin-card" style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <span style={{ fontSize: "11px", color: "#94a3b8", display: "block" }}>گره Worker پردازش محلی</span>
                  <strong style={{ fontSize: "13px", color: "#f1f5f9", display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: pingResult?.status === "up" ? "#10b981" : "#06b6d4", display: "inline-block" }} />
                    ۱۷۲.۱۹.۳۰.۹۹ {pingResult ? `(${pingResult.latency_ms} ms)` : ""}
                  </strong>
                </div>
                <span style={{ fontSize: "20px" }}>⚡</span>
              </div>

              <div className="glass admin-card" style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <span style={{ fontSize: "11px", color: "#94a3b8", display: "block" }}>مدل‌های هوش مصنوعی مستقر</span>
                  <strong style={{ fontSize: "13px", color: "#f1f5f9", display: "block", marginTop: "2px" }}>
                    {(pingResult?.model_count ?? operations?.nodes.reduce((acc, n) => acc + (n.models?.length || 0), 0) ?? 8).toLocaleString("fa-IR")} مدل آماده
                  </strong>
                </div>
                <span style={{ fontSize: "20px" }}>🧠</span>
              </div>

              <div className="glass admin-card" style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <span style={{ fontSize: "11px", color: "#94a3b8", display: "block" }}>درخواست‌های عضویت در انتظار</span>
                  <strong style={{ fontSize: "13px", display: "block", marginTop: "2px", color: count > 0 ? "#f43f5e" : "#10b981" }}>
                    {count > 0 ? `${count.toLocaleString("fa-IR")} درخواست جدید` : "تماماً بررسی‌شده"}
                  </strong>
                </div>
                <span style={{ fontSize: "20px" }}>👥</span>
              </div>
            </div>

            {/* نوار ابزار اقدامات سریع و فرماندهی لحظه‌ای */}
            <div className="glass admin-card" style={{ padding: "12px 16px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "12px", color: "#94a3b8", fontWeight: 600 }}>اقدامات سریع:</span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: "12px", padding: "6px 14px" }}
                  disabled={pingLoading}
                  onClick={() => void handlePingNode()}
                >
                  {pingLoading ? "⏱️ در حال آزمون…" : "📡 تست پینگ Worker (۱۷۲.۱۹.۳۰.۹۹)"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: "12px", padding: "6px 14px" }}
                  onClick={() => void refreshOperations()}
                >
                  🔄 استعلام وضعیت سرورها
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: "12px", padding: "6px 14px", borderColor: "#0891b2", color: "#67e8f9" }}
                  onClick={() => {
                    const el = document.querySelector(".system-update-center-card");
                    if (el) el.scrollIntoView({ behavior: "smooth" });
                  }}
                >
                  🚀 مرکز به‌روزرسانی
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="submit-button"
                  style={{ fontSize: "12px", padding: "6px 14px", margin: 0 }}
                  onClick={() => {
                    setAdminTab("governance");
                    setGovSubTab("pairing");
                  }}
                >
                  🔑 صدور کد اتصال ایجنت
                </button>
              </div>
            </div>

            {/* مرکز مستقل و یکپارچه به‌روزرسانی سامانه (هسته + برنامه‌ها + فرانت‌اند) */}
            <SystemUpdateCenterCard />

            {/* نتایج زنده تست پینگ در صورت وجود */}
            {pingResult && (
              <section className="glass admin-card node-ping-card">
                <div className="card-title">
                  <div>
                    <h2>⚡ گزارش پینگ زنده گره Ollama Worker</h2>
                    <p>پایش تأخیر شبکه RTT و وضعیت ارتباط مستقیم با سرور ۱۷۲.۱۹.۳۰.۹۹</p>
                  </div>
                  <span className={`ping-latency-badge ${pingResult.latency_ms < 50 ? "good" : pingResult.latency_ms < 200 ? "moderate" : "slow"}`}>
                    ⚡ {pingResult.latency_ms.toLocaleString("fa-IR")} ms
                    <small>{pingResult.latency_ms < 50 ? " (عالی)" : " (مطلوب)"}</small>
                  </span>
                </div>
                <div className="node-ping-results-grid">
                  <div className="ping-stat-item">
                    <span className="stat-label">وضعیت سرویس:</span>
                    <span className="node-badge node-up">🟢 آنلاین و آماده</span>
                  </div>
                  <div className="ping-stat-item">
                    <span className="stat-label">نسخه سرویس:</span>
                    <span className="ping-code-pill" dir="ltr">Ollama {pingResult.version}</span>
                  </div>
                  <div className="ping-stat-item">
                    <span className="stat-label">تعداد مدل‌ها:</span>
                    <strong className="ping-count-val">{pingResult.model_count.toLocaleString("fa-IR")} مدل</strong>
                  </div>
                  <div className="ping-stat-item">
                    <span className="stat-label">آدرس اندپوینت:</span>
                    <code className="ping-endpoint-code" dir="ltr">{pingResult.base_url}</code>
                  </div>
                </div>
              </section>
            )}

            {/* کارت جامع سلامت سیستم و پایش تله‌متری */}
            <SystemHealthCard />
          </div>
        )}

        {/* ۲. تب سرورها و مدل‌های محلی */}
        {adminTab === "nodes" && (
          <div className="nodes-view" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <NodeManager />
          </div>
        )}

        {/* ۳. تب تأمین‌کنندگان و پراکسی SOCKS */}
        {adminTab === "providers" && (
          <div className="providers-view">
            <ProviderManager />
          </div>
        )}

        {/* ۴. تب یکپارچه امنیت، کاربران و حاکمیت */}
        {adminTab === "governance" && (
          <div className="governance-view" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* هدر یکپارچه و معرفی ماژول */}
            <div className="user-hub-hero">
              <div className="user-hub-hero-inner">
                <div className="user-hub-title">
                  <span className="user-hub-icon">🛡️</span>
                  <div>
                    <h2 className="text-base md:text-lg font-bold text-cyan-400">مرکز جامع امنیت، کاربران، ممیزی و حاکمیت ایجنت‌ها</h2>
                    <p className="text-xs text-gray-300 mt-1 leading-relaxed">
                      کنترل یکپارچه اعضای سازمان، بررسی درخواست‌های ثبت‌نام، رصد وقایع امنیتی، حاکمیت بر ایجنت‌ها و جفت‌سازی کلاینت‌ها.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] bg-slate-900/90 text-cyan-300 border border-cyan-800/60 px-3 py-1 rounded-full font-mono">
                    نقش شما: {currentUser.role === "superadmin" ? "مدیر ارشد کل" : "کاربر سازمان"}
                  </span>
                  {count > 0 && (
                    <span className="text-[11px] bg-rose-950/80 text-rose-300 border border-rose-800 px-3 py-1 rounded-full animate-pulse">
                      {count.toLocaleString("fa-IR")} درخواست جدید در انتظار
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* نوار زیرتب‌های منسجم و منطقی حاکمیت */}
            <div className="user-subtabs-nav" role="tablist" aria-label="بخش‌های امنیت و کاربران">
              <button
                type="button"
                role="tab"
                aria-selected={govSubTab === "users"}
                className={`user-subtab-btn ${govSubTab === "users" ? "active" : ""}`}
                onClick={() => setGovSubTab("users")}
              >
                <span>👥</span>
                <span className="hidden md:inline">مدیریت کاربران و دسترسی‌ها</span>
                <span className="md:hidden">کاربران</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={govSubTab === "pending"}
                className={`user-subtab-btn ${govSubTab === "pending" ? "active" : ""}`}
                onClick={() => setGovSubTab("pending")}
              >
                <span>📋</span>
                <span className="hidden md:inline">درخواست‌های ثبت‌نام</span>
                <span className="md:hidden">درخواست‌ها</span>
                {count > 0 && <span className="tab-counter-badge">{count.toLocaleString("fa-IR")}</span>}
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={govSubTab === "audit"}
                className={`user-subtab-btn ${govSubTab === "audit" ? "active" : ""}`}
                onClick={() => setGovSubTab("audit")}
              >
                <span>🛡️</span>
                <span className="hidden md:inline">دفترچه ممیزی امنیت</span>
                <span className="md:hidden">ممیزی</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={govSubTab === "agents"}
                className={`user-subtab-btn ${govSubTab === "agents" ? "active" : ""}`}
                onClick={() => setGovSubTab("agents")}
              >
                <span>🤖</span>
                <span className="hidden md:inline">حاکمیت بر ایجنت‌ها</span>
                <span className="md:hidden">ایجنت‌ها</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={govSubTab === "profile"}
                className={`user-subtab-btn ${govSubTab === "profile" ? "active" : ""}`}
                onClick={() => setGovSubTab("profile")}
              >
                <span>👤</span>
                <span className="hidden md:inline">پروفایل و امنیت حساب</span>
                <span className="md:hidden">پروفایل</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={govSubTab === "pairing"}
                className={`user-subtab-btn ${govSubTab === "pairing" ? "active" : ""}`}
                onClick={() => setGovSubTab("pairing")}
              >
                <span>🔑</span>
                <span className="hidden md:inline">اتصال موقت ایجنت</span>
                <span className="md:hidden">اتصال</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={govSubTab === "backup"}
                className={`user-subtab-btn ${govSubTab === "backup" ? "active" : ""}`}
                onClick={() => setGovSubTab("backup")}
              >
                <span>💾</span>
                <span className="hidden md:inline">پشتیبان‌گیری پایگاه داده</span>
                <span className="md:hidden">پشتیبان‌گیری</span>
              </button>
            </div>

            {/* زیرتب ۱: مدیریت کاربران */}
            {govSubTab === "users" && <UserManagementCard />}

            {/* زیرتب ۲: درخواست‌های ثبت‌نام */}
            {govSubTab === "pending" && (
              <section className="glass admin-card">
                <div className="card-title">
                  <div>
                    <h2>درخواست‌های ثبت‌نام جدید در انتظار تأیید</h2>
                    <p>تعیین و تخصیص مجوزهای اولیه همزمان با تأیید دسترسی کاربر.</p>
                  </div>
                  <span className="count-pill">{count.toLocaleString("fa-IR")} در انتظار</span>
                </div>

                {pending.length === 0 ? (
                  <div className="empty-note-box" style={{ textAlign: "center", padding: "36px 16px" }}>
                    <span style={{ fontSize: "36px", display: "block", marginBottom: "8px" }}>✅</span>
                    <strong style={{ display: "block", fontSize: "14px", color: "#34d399", marginBottom: "6px" }}>
                      تمامی درخواست‌های ثبت‌نام بررسی شده‌اند
                    </strong>
                    <p className="empty-note" style={{ margin: 0 }}>
                      در حال حاضر هیچ کاربر جدیدی در صف انتظار تأیید عضویت نیست.
                    </p>
                  </div>
                ) : (
                  <div className="pending-list">
                    {pending.map((person) => (
                      <article className="pending-user" key={person.id}>
                        <div className="pending-title">
                          <div>
                            <strong>{person.username}</strong>
                            <span dir="ltr">{person.mobile}</span>
                          </div>
                          <time>{new Date(person.created_at * 1000).toLocaleString("fa-IR")}</time>
                        </div>

                        <div className="capabilities" aria-label={`مجوزهای ${person.username}`}>
                          {choices.map(([value, title]) => (
                            <label key={value} className="capability">
                              <input
                                type="checkbox"
                                checked={(selected[person.id] || ["chat"]).includes(value)}
                                onChange={() => toggle(person.id, value)}
                              />
                              {title}
                            </label>
                          ))}
                        </div>

                        <div className="pending-actions">
                          <button disabled={loading} className="submit-button" onClick={() => decide(person.id, true)}>
                            تأیید با این مجوزها
                          </button>
                          <button disabled={loading} className="quiet-button danger" onClick={() => decide(person.id, false)}>
                            رد درخواست
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* زیرتب ۳: ممیزی امنیتی، پایشگر زنده هسته (Live Log Viewer) و پیام‌های صوتی و رونوشت STT */}
            {govSubTab === "audit" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                <LiveLogViewer />
                <VoiceNotePlayer />
                <SecurityAuditCard />
              </div>
            )}

            {/* زیرتب ۴: حاکمیت ایجنت‌ها */}
            {govSubTab === "agents" && <AdminAgentGovernanceCard />}

            {/* زیرتب ۵: پروفایل ادمین */}
            {govSubTab === "profile" && (
              <UserProfileModal
                embedded
                currentUser={currentUser}
                onProfileUpdated={(updated) => setCurrentUser(updated)}
              />
            )}

            {/* زیرتب ۶: اتصال موقت ایجنت */}
            {govSubTab === "pairing" && (
              <section className="glass admin-card">
                <div className="card-title">
                  <div>
                    <h2>اتصال موقت ایجنت ویندوز</h2>
                    <p>کد یک‌بارمصرف ۶ رقمی با اعتبار ۲ دقیقه جهت جفت‌سازی کلاینت.</p>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", marginBottom: "16px" }}>
                  <button className="submit-button" onClick={createPair} style={{ margin: 0 }}>
                    {pair ? "🔄 صدور مجدد کد اتصال (تغییر فوری کد)" : "🔑 صدور کد اتصال تازه"}
                  </button>
                  <button
                    type="button"
                    className="quiet-button"
                    style={{ margin: 0, padding: "8px 14px" }}
                    onClick={() => {
                      if (navigator.clipboard?.writeText) {
                        void navigator.clipboard.writeText(window.location.origin);
                        setMessage("نشانی سرور در کلیپ‌بورد کپی شد.");
                        setTimeout(() => setMessage(""), 3000);
                      }
                    }}
                  >
                    📋 کپی نشانی سرور ({typeof window !== "undefined" ? window.location.host : ""})
                  </button>
                </div>

                <AnimatePresence mode="wait">
                  {pair && (
                    <motion.div
                      key={pair.code}
                      className="pair-result"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                    >
                      <p>این کد را در برنامه وارد کنید:</p>
                      <strong dir="ltr">{pair.code}</strong>
                      <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap", marginTop: "10px" }}>
                        <button type="button" className="quiet-button pair-copy" onClick={() => void copyPair()} style={{ margin: 0 }}>
                          📋 کپی کد
                        </button>
                        <button
                          type="button"
                          className="submit-button"
                          style={{ padding: "6px 14px", fontSize: "12px", margin: 0, background: "linear-gradient(135deg, #0284c7, #2563eb)" }}
                          onClick={() => void createPair()}
                          title="دریافت فوری کد جدید و ابطال کد قبلی بدون نیاز به صبر کردن"
                        >
                          🔄 تغییر کد اتصال (دریافت کد جدید)
                        </button>
                      </div>
                      <small style={{ marginTop: "10px", display: "block" }}>{seconds.toLocaleString("fa-IR")} ثانیه باقی‌مانده · امکان دریافت کد جدید در هر لحظه</small>
                      {copyStatus && <span className="pair-copy-status" role="status">{copyStatus}</span>}
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>
            )}

            {/* زیرتب ۷: پشتیبان‌گیری پایگاه داده */}
            {govSubTab === "backup" && <DatabaseBackupCard />}
          </div>
        )}

        {message && <p className="admin-message" role="status" aria-live="polite">{message}</p>}
      </div>

      {showProfile && (
        <UserProfileModal
          currentUser={currentUser}
          onClose={() => setShowProfile(false)}
          onProfileUpdated={(updated) => setCurrentUser(updated)}
        />
      )}
    </main>
  );
}

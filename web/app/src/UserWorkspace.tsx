import { useState } from "react";
import { type Profile, api } from "./api";
import { ClientDownloadsCard } from "./components/ClientDownloadsCard";
import { UserProfileModal } from "./components/UserProfileModal";

type Props = {
  user: Profile;
  onLogout: () => void;
  onSwitchToAdmin?: () => void;
};

export function UserWorkspace({ user, onLogout, onSwitchToAdmin }: Props) {
  const [currentUser, setCurrentUser] = useState<Profile>(user);
  const [showProfile, setShowProfile] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<"downloads" | "profile">("downloads");

  // Pair state for downloads / pairing
  const [pair, setPair] = useState<{ code: string; expires_at: number } | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [copyStatus, setCopyStatus] = useState("");
  const [, setMessage] = useState("");

  async function createPair() {
    setMessage("");
    setCopyStatus("");
    try {
      const res = await api.issuePairing();
      setPair(res);
      setSeconds(120);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "کد اتصال صادر نشد.");
    }
  }

  async function copyPair() {
    if (!pair || seconds <= 0) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(pair.code);
        setCopyStatus("کد کپی شد؛ در برنامه روی جایگذاری بزنید.");
        setTimeout(() => setCopyStatus(""), 3500);
      }
    } catch {
      setCopyStatus("متن کد را دستی کپی کنید.");
    }
  }

  return (
    <main className="admin-scene user-workspace-scene" dir="rtl">
      <div className="tech-grid" aria-hidden="true" />

      <div className="admin-wrap">
        {/* هدر اختصاصی فضای کاربری سازمانی */}
        <header className="admin-header admin-flat-header user-workspace-header">
          <div className="admin-header-brand">
            <span className="brand-mark">✦</span>
            <strong className="brand-title">OmniOps</strong>
            <span className="workspace-badge-tag hidden lg:inline-flex">فضای کاربری هوش مصنوعی</span>
          </div>

          <div className="admin-header-actions">
            {/* کلید بازگشت به کنسول مدیریت برای سوپرادمین‌ها */}
            {currentUser.role === "superadmin" && onSwitchToAdmin && (
              <button
                type="button"
                className="admin-switch-pill"
                onClick={onSwitchToAdmin}
                title="سوییچ به کنسول مدیریت زیرساخت و سرورها"
              >
                <span className="switch-icon">👑</span>
                <span className="hidden sm:inline">کنسول مدیریت</span>
                <span className="sm:hidden">مدیریت</span>
              </button>
            )}

            <button
              type="button"
              className="download-hub-pill"
              onClick={() => setWorkspaceMode("downloads")}
              title="دانلود برنامه‌های ویندوز و اندروید"
            >
              <span>📥</span>
              <span className="hidden sm:inline">دریافت برنامه‌ها</span>
            </button>

            <button
              type="button"
              className="profile-pill-button"
              onClick={() => setWorkspaceMode("profile")}
              title="مشاهده پروفایل، آمار عملکرد و تغییر رمز عبور"
            >
              <span className="profile-pill-icon">{currentUser.role === "superadmin" ? "👑" : "👤"}</span>
              <span className="max-w-[70px] sm:max-w-none truncate">{currentUser.username}</span>
            </button>

            <button className="quiet-button logout-button" onClick={onLogout} title="خروج امن از سیستم">
              <span>🚪</span>
              <span className="hidden sm:inline">خروج امن</span>
            </button>
          </div>
        </header>

        {/* بنر درگاه احراز هویت و اتصال به ایجنت‌های سازمانی */}
        <div className="user-hero-card glass">
          <div className="user-hero-info">
            <span className="user-hero-eyebrow">OMNIOPS / CLIENT & PAIRING GATEWAY</span>
            <h1>سلام، {currentUser.username}؛ به درگاه ارتباط و جفت‌سازی ایجنت‌ها خوش آمدید</h1>
            <p>
              از طریق این درگاه می‌توانید برنامه‌های کلاینت ویندوز (مرکز اصلی اجرای وظایف) و همراه اندروید (کنترلر از راه دور) را دریافت نمایید،
              کدهای ۶ رقمی موقت جهت اتصال امن صادر کرده و حساب کاربری خود را مدیریت کنید.
            </p>
          </div>

          <div className="user-hero-meta">
            <div className="user-role-badge">
              <span>سطح دسترسی: </span>
              <strong>{currentUser.role === "superadmin" ? "مدیر کل سامانه" : "کاربر سازمان"}</strong>
            </div>
            <div className="user-caps-summary">
              {currentUser.capabilities.includes("agent.pair") && <span className="cap-mini-tag">جفت‌سازی ایجنت</span>}
              <span className="cap-mini-tag">کلاینت ویندوز</span>
              <span className="cap-mini-tag">همراه اندروید</span>
            </div>
          </div>
        </div>

        {/* ناوبری فضای کاربری (فلت و رسپانسیو) */}
        <div className="admin-nav-tabs-container">
          <div className="workspace-switch" role="tablist" aria-label="حالت فضای کاری">
            <button
              type="button"
              role="tab"
              aria-selected={workspaceMode === "downloads"}
              className={workspaceMode === "downloads" ? "active" : ""}
              onClick={() => setWorkspaceMode("downloads")}
            >
              <span>📥</span>
              <span className="hidden md:inline">دریافت برنامه‌ها و جفت‌سازی دستگاه‌ها</span>
              <span className="md:hidden">کلاینت‌ها و پین</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={workspaceMode === "profile"}
              className={workspaceMode === "profile" ? "active" : ""}
              onClick={() => setWorkspaceMode("profile")}
            >
              <span>👤</span>
              <span className="hidden md:inline">پروفایل و امنیت حساب</span>
              <span className="md:hidden">پروفایل</span>
            </button>
          </div>
        </div>

        {/* محتوای تب‌های فعال */}
        <div hidden={workspaceMode !== "downloads"}>
          <ClientDownloadsCard
            pair={pair}
            seconds={seconds}
            copyStatus={copyStatus}
            onGeneratePair={createPair}
            onCopyPair={() => void copyPair()}
          />
        </div>

        <div hidden={workspaceMode !== "profile"}>
          <UserProfileModal
            embedded
            currentUser={currentUser}
            onProfileUpdated={(updated) => setCurrentUser(updated)}
          />
        </div>
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

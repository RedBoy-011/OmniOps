import { useState } from "react";
import { type Profile, api } from "./api";
import { ChatRoom } from "./ChatRoom";
import { WorkspaceTasks } from "./WorkspaceTasks";
import { CustomizationsPanel } from "./CustomizationsPanel";
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
  const [workspaceMode, setWorkspaceMode] = useState<"chat" | "task" | "customizations" | "downloads">("chat");

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
        <header className="admin-header glass user-header">
          <div className="flex items-center gap-3">
            <span className="brand-mark">✦</span>
            <strong>OmniOps</strong>
            <span className="workspace-badge-tag">فضای کاربری هوش مصنوعی</span>
          </div>

          <div className="flex items-center gap-3">
            {/* کلید بازگشت به کنسول مدیریت برای سوپرادمین‌ها */}
            {currentUser.role === "superadmin" && onSwitchToAdmin && (
              <button
                type="button"
                className="admin-switch-pill"
                onClick={onSwitchToAdmin}
                title="سوییچ به کنسول مدیریت زیرساخت و سرورها"
              >
                👑 ورود به کنسول مدیریت
              </button>
            )}

            <button
              type="button"
              className="download-hub-pill"
              onClick={() => setWorkspaceMode("downloads")}
              title="دانلود برنامه‌های ویندوز و اندروید"
            >
              📥 دریافت برنامه‌ها
            </button>

            <button
              type="button"
              className="profile-pill-button"
              onClick={() => setShowProfile(true)}
              title="مشاهده پروفایل، آمار عملکرد و تغییر رمز عبور"
            >
              <span className="profile-pill-icon">{currentUser.role === "superadmin" ? "👑" : "👤"}</span>
              <span>{currentUser.username}</span>
            </button>

            <button className="quiet-button" onClick={onLogout}>
              خروج امن
            </button>
          </div>
        </header>

        {/* بنر خوش‌آمدگویی و معرفی فضای کاربری */}
        <div className="user-hero-card glass">
          <div className="user-hero-info">
            <span className="user-hero-eyebrow">WORKSPACE / AI ASSISTANT</span>
            <h1>سلام، {currentUser.username}؛ به فضای کاری هوش مصنوعی خوش آمدید</h1>
            <p>
              از طریق این درگاه می‌توانید با مدل‌های مجاز سازمان گفت‌وگو کنید، اسناد و فایل‌های کاری را تحلیل نمایید
              و به کلاینت‌های دسکتاپ و همراه متصل شوید.
            </p>
          </div>

          <div className="user-hero-meta">
            <div className="user-role-badge">
              <span>سطح دسترسی: </span>
              <strong>{currentUser.role === "superadmin" ? "مدیر کل سامانه" : "کاربر سازمان"}</strong>
            </div>
            <div className="user-caps-summary">
              {currentUser.capabilities.includes("chat") && <span className="cap-mini-tag">چت هوشمند</span>}
              {currentUser.capabilities.includes("provider.use") && <span className="cap-mini-tag">مدل‌های آنلاین</span>}
              {currentUser.capabilities.includes("agent.pair") && <span className="cap-mini-tag">اتصال دستگاه</span>}
            </div>
          </div>
        </div>

        {/* ناوبری اصلی فضای کاری */}
        <div className="workspace-switch" role="tablist" aria-label="حالت فضای کاری">
          {currentUser.capabilities.includes("chat") && (
            <>
              <button
                type="button"
                role="tab"
                aria-selected={workspaceMode === "chat"}
                className={workspaceMode === "chat" ? "active" : ""}
                onClick={() => setWorkspaceMode("chat")}
              >
                💬 گفت‌وگو با هوش مصنوعی
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={workspaceMode === "task"}
                className={workspaceMode === "task" ? "active" : ""}
                onClick={() => setWorkspaceMode("task")}
              >
                📋 پروژه‌ها و وظایف
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={workspaceMode === "customizations"}
                className={workspaceMode === "customizations" ? "active" : ""}
                onClick={() => setWorkspaceMode("customizations")}
              >
                📦 مهارت‌ها و دستیارها
              </button>
            </>
          )}

          <button
            type="button"
            role="tab"
            aria-selected={workspaceMode === "downloads"}
            className={workspaceMode === "downloads" ? "active" : ""}
            onClick={() => setWorkspaceMode("downloads")}
          >
            📥 دریافت برنامه‌ها (ویندوز / اندروید)
          </button>
        </div>

        {/* محتوای تب‌های انتخابی کاربر */}
        {currentUser.capabilities.includes("chat") && (
          <>
            <div hidden={workspaceMode !== "chat"}>
              <ChatRoom />
            </div>

            <div hidden={workspaceMode !== "task"}>
              <WorkspaceTasks canRequest={currentUser.capabilities.includes("action.request")} />
            </div>

            <div hidden={workspaceMode !== "customizations"}>
              <CustomizationsPanel onSelectSkill={() => setWorkspaceMode("chat")} />
            </div>
          </>
        )}

        <div hidden={workspaceMode !== "downloads"}>
          <ClientDownloadsCard
            pair={pair}
            seconds={seconds}
            copyStatus={copyStatus}
            onGeneratePair={createPair}
            onCopyPair={() => void copyPair()}
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

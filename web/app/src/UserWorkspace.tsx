import { useState } from "react";
import { type Profile } from "./api";
import { ChatRoom } from "./ChatRoom";
import { UserProfileModal } from "./components/UserProfileModal";
import { ThemePaletteSelector } from "./components/ThemePaletteSelector";

type Props = {
  user: Profile;
  onLogout: () => void;
  onSwitchToAdmin?: () => void;
};

export function UserWorkspace({ user, onLogout, onSwitchToAdmin }: Props) {
  const [currentUser, setCurrentUser] = useState<Profile>(user);
  const [showProfile, setShowProfile] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<"chat" | "profile">("chat");

  return (
    <main className="admin-scene user-workspace-scene" dir="rtl">
      <div className="tech-grid" aria-hidden="true" />

      <div className="admin-wrap" style={{ maxWidth: "100%", width: "100%", padding: "10px 14px" }}>
        {/* هدر استودیو هوش مصنوعی و چت‌بات سازمانی */}
        <header className="admin-header admin-flat-header user-workspace-header" style={{ marginBottom: "10px" }}>
          <div className="admin-header-brand">
            <span className="brand-mark">✦</span>
            <strong className="brand-title">OmniOps</strong>
            <span className="workspace-badge-tag hidden sm:inline-flex">استودیو هوش مصنوعی و چت‌بات سازمانی</span>
          </div>

          <div className="admin-header-actions">
            {/* انتخابگر فشرده طیف رنگ سراسری سیستم */}
            <ThemePaletteSelector compact isSuperadmin={currentUser.role === "superadmin"} />

            {/* سوییچ به حالت گفتگو */}
            <button
              type="button"
              className={`workspace-tab-pill ${workspaceMode === "chat" ? "active" : ""}`}
              onClick={() => setWorkspaceMode("chat")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 14px",
                borderRadius: "10px",
                fontSize: "12px",
                fontWeight: "bold",
                background: workspaceMode === "chat" ? "var(--primary, #f43f5e)" : "rgba(255,255,255,0.06)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.1)",
                cursor: "pointer",
                transition: "all 0.2s"
              }}
            >
              <span>💬</span>
              <span className="hidden sm:inline">چت‌بات هوشمند</span>
            </button>

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
              className="profile-pill-button"
              onClick={() => setWorkspaceMode("profile")}
              title="مشاهده پروفایل و امنیت حساب"
            >
              <span className="profile-pill-icon">{currentUser.role === "superadmin" ? "👑" : "👤"}</span>
              <span className="max-w-[80px] sm:max-w-none truncate">{currentUser.username}</span>
            </button>

            <button className="quiet-button logout-button" onClick={onLogout} title="خروج امن از سیستم">
              <span>🚪</span>
              <span className="hidden sm:inline">خروج امن</span>
            </button>
          </div>
        </header>

        {/* محتوای فعال فضای کاربری */}
        {workspaceMode === "chat" ? (
          <div className="user-chat-container" style={{ width: "100%", height: "calc(100vh - 85px)", minHeight: "580px" }}>
            <ChatRoom />
          </div>
        ) : (
          <div className="user-profile-container" style={{ maxWidth: "800px", margin: "20px auto" }}>
            <UserProfileModal
              embedded
              currentUser={currentUser}
              onProfileUpdated={(updated) => setCurrentUser(updated)}
            />
          </div>
        )}
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

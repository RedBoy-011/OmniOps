import { useState, useEffect, useRef } from "react";
import { api, type Profile } from "./api";
import { UserProfileModal } from "./components/UserProfileModal";
import { ThemePaletteSelector } from "./components/ThemePaletteSelector";
import { AgenticChatbot } from "./components/AgenticChatbot";
import { ClientDownloadsCard } from "./components/ClientDownloadsCard";

type Props = {
  user: Profile;
  onLogout: () => void;
  onSwitchToAdmin?: () => void;
};

export function UserWorkspace({ user, onLogout, onSwitchToAdmin }: Props) {
  const [currentUser, setCurrentUser] = useState<Profile>(user);
  const [activeTab, setActiveTab] = useState<"chat" | "client" | "profile">("chat");
  const [copiedServer, setCopiedServer] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const [pair, setPair] = useState<{ code: string; expires_at: number } | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [copyStatus, setCopyStatus] = useState("");

  const serverUrl = typeof window !== "undefined" ? window.location.origin : "http://172.19.30.94:9000";
  const userToken = typeof localStorage !== "undefined" ? localStorage.getItem("omniops_token") || "" : "";

  // Close user dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Timer for temporary pairing PIN
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

  async function createPair() {
    try {
      const res = await api.issuePairing();
      setPair(res);
      setSeconds(Math.max(0, res.expires_at - Math.floor(Date.now() / 1000)));
    } catch {}
  }

  async function copyPair() {
    if (!pair) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(pair.code);
        setCopyStatus("کپی شد ✓");
        setTimeout(() => setCopyStatus(""), 2500);
      }
    } catch {}
  }

  async function copyToClipboard(text: string, setCopied: (v: boolean) => void) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    } catch {}
  }

  return (
    <main className="admin-scene user-workspace-scene" dir="rtl">
      <div className="tech-grid" aria-hidden="true" />

      <div className="admin-wrap" style={{ maxWidth: "1150px", width: "100%", margin: "0 auto", padding: "16px 20px" }}>
        {/* هدر بازطراحی‌شده، خلوت و مدرن پورتال کاربری */}
        <header className="admin-header admin-flat-header user-workspace-header" style={{ marginBottom: "20px" }}>
          <div className="admin-header-brand">
            <span className="brand-mark">✦</span>
            <div>
              <strong className="brand-title">OmniOps</strong>
              <span className="workspace-badge-tag hidden sm:inline-flex" style={{ marginRight: "8px" }}>
                فضای کاربری و کلاینت‌ها
              </span>
            </div>
          </div>

          <div className="admin-header-actions" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {/* تب‌های وظیفه‌محور و خلوت اصلی */}
            <div className="workspace-nav-pills" style={{ display: "flex", gap: "6px" }}>
              <button
                type="button"
                className={`workspace-tab-pill ${activeTab === "chat" ? "active" : ""}`}
                onClick={() => setActiveTab("chat")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "7px 16px",
                  borderRadius: "10px",
                  fontSize: "12px",
                  fontWeight: "bold",
                  background: activeTab === "chat" ? "var(--primary, #3b82f6)" : "rgba(255,255,255,0.06)",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.1)",
                  cursor: "pointer",
                }}
              >
                <span>💬</span>
                <span>دستیار هوشمند</span>
              </button>

              <button
                type="button"
                className={`workspace-tab-pill ${activeTab === "client" ? "active" : ""}`}
                onClick={() => setActiveTab("client")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "7px 16px",
                  borderRadius: "10px",
                  fontSize: "12px",
                  fontWeight: "bold",
                  background: activeTab === "client" ? "var(--primary, #3b82f6)" : "rgba(255,255,255,0.06)",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.1)",
                  cursor: "pointer",
                }}
              >
                <span>📱</span>
                <span>دانلود کلاینت‌ها</span>
              </button>
            </div>

            {currentUser.role === "superadmin" && onSwitchToAdmin && (
              <button
                type="button"
                className="admin-switch-pill"
                onClick={onSwitchToAdmin}
                title="سوییچ به کنسول مدیریت سرور و زیرساخت"
                style={{ padding: "7px 14px" }}
              >
                <span className="switch-icon">👑</span>
                <span className="hidden sm:inline">کنسول مدیریت</span>
              </button>
            )}

            {/* منوی تعاملی و شناور آواتار کاربر (User Avatar Dropdown) */}
            <div className="relative" ref={userMenuRef} style={{ position: "relative" }}>
              <button
                type="button"
                className="profile-pill-button"
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "5px 12px",
                  borderRadius: "20px",
                  background: "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  color: "#f1f5f9",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: 600,
                }}
                title="منوی حساب کاربری، سهمیه ابری و تنظیمات تم"
              >
                <span>{currentUser.role === "superadmin" ? "👑" : "👤"}</span>
                <span className="max-w-[80px] sm:max-w-none truncate">{currentUser.username}</span>
                <span style={{ fontSize: "10px", opacity: 0.7 }}>{userMenuOpen ? "▴" : "▾"}</span>
              </button>

              {userMenuOpen && (
                <div
                  className="user-avatar-dropdown-card glass"
                  style={{
                    position: "absolute",
                    left: 0,
                    top: "calc(100% + 8px)",
                    minWidth: "240px",
                    background: "rgba(15, 23, 42, 0.95)",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                    borderRadius: "14px",
                    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)",
                    padding: "12px",
                    zIndex: 1000,
                    backdropFilter: "blur(16px)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  <div style={{ paddingBottom: "8px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <strong style={{ fontSize: "13px", color: "#f8fafc" }}>{currentUser.username}</strong>
                      <span className="omni-cost-badge free" style={{ fontSize: "10px" }}>
                        {currentUser.role === "superadmin" ? "مدیر کل سیستم" : "کاربر سازمانی"}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "6px", fontSize: "11px", color: "#94a3b8" }}>
                      <span>☁️ سهمیه دیسک ابری:</span>
                      <strong style={{ color: "#38bdf8" }}>۲ گیگابایت (آزاد)</strong>
                    </div>
                  </div>

                  {/* کلید باز کردن مشخصات پروفایل */}
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab("profile");
                      setUserMenuOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "8px",
                      background: "rgba(255,255,255,0.04)",
                      border: "none",
                      color: "#e2e8f0",
                      fontSize: "12px",
                      cursor: "pointer",
                      textAlign: "right",
                    }}
                  >
                    <span>👤</span>
                    <span>مشخصات حساب و امنیت</span>
                  </button>

                  {/* پالت رنگ تم داخل منوی پروفایل */}
                  <div style={{ padding: "6px 8px", background: "rgba(255,255,255,0.02)", borderRadius: "8px" }}>
                    <div style={{ fontSize: "11px", color: "#94a3b8", marginBottom: "4px" }}>🎨 تم و طیف رنگی:</div>
                    <ThemePaletteSelector compact isSuperadmin={currentUser.role === "superadmin"} />
                  </div>

                  <hr style={{ borderColor: "rgba(255,255,255,0.08)", margin: "4px 0" }} />

                  {/* خروج امن */}
                  <button
                    type="button"
                    onClick={() => {
                      setUserMenuOpen(false);
                      onLogout();
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "8px",
                      background: "rgba(239, 68, 68, 0.12)",
                      border: "1px solid rgba(239, 68, 68, 0.2)",
                      color: "#f87171",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                      textAlign: "right",
                    }}
                  >
                    <span>🚪</span>
                    <span>خروج امن از سیستم</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {activeTab === "chat" ? (
          <AgenticChatbot />
        ) : activeTab === "client" ? (
          <div className="client-connection-portal" style={{ display: "grid", gap: "24px" }}>
            {/* مرکز استقرار و دانلود کلاینت‌های دوقلو (ویندوز + اندروید با QR Code) */}
            <ClientDownloadsCard
              pair={pair}
              seconds={seconds}
              copyStatus={copyStatus}
              onGeneratePair={createPair}
              onCopyPair={() => void copyPair()}
            />

            {/* بخش مشخصات اتصال و توکن کاربر */}
            <div className="glass admin-card" style={{ padding: "24px", borderRadius: "16px" }}>

              {/* بخش اعتبارسنجی و مشخصات اتصال */}
              <h3 style={{ fontSize: "14px", color: "#e2e8f0", marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
                <span>🔑</span>
                <span>مشخصات اتصال به هسته سرور</span>
              </h3>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px" }}>
                {/* فیلد آدرس سرور */}
                <div style={{ background: "rgba(0,0,0,0.25)", padding: "14px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                    <span style={{ fontSize: "11px", color: "#94a3b8" }}>آدرس سرور مرکزی (Server Host / URL):</span>
                    <button
                      type="button"
                      className="quiet-button"
                      onClick={() => void copyToClipboard(serverUrl, setCopiedServer)}
                      style={{ fontSize: "11px", padding: "2px 8px" }}
                    >
                      {copiedServer ? "کپی شد ✓" : "📋 کپی آدرس"}
                    </button>
                  </div>
                  <code style={{ display: "block", direction: "ltr", textAlign: "left", fontSize: "13px", color: "#38bdf8", padding: "6px 8px", background: "rgba(0,0,0,0.3)", borderRadius: "6px" }}>
                    {serverUrl}
                  </code>
                  <small style={{ color: "#64748b", fontSize: "10px", marginTop: "4px", display: "block" }}>
                    در نرم‌افزار ویندوز کافیست آدرس بالا یا صرفاً IP سرور را وارد کنید؛ پروتکل و پورت به طور خودکار شناسایی می‌شوند.
                  </small>
                </div>

                {/* فیلد توکن امن کاربر */}
                <div style={{ background: "rgba(0,0,0,0.25)", padding: "14px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "11px", color: "#94a3b8" }}>توکن امن دسترسی حساب (Personal Access Token):</span>
                      <button
                        type="button"
                        onClick={() => setShowToken(!showToken)}
                        style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "12px" }}
                        title={showToken ? "مخفی کردن" : "نمایش توکن"}
                      >
                        {showToken ? "👁️" : "🙈"}
                      </button>
                    </div>
                    <button
                      type="button"
                      className="quiet-button"
                      onClick={() => void copyToClipboard(userToken, setCopiedToken)}
                      style={{ fontSize: "11px", padding: "2px 8px" }}
                    >
                      {copiedToken ? "کپی شد ✓" : "📋 کپی توکن"}
                    </button>
                  </div>
                  <code style={{ display: "block", direction: "ltr", textAlign: "left", fontSize: "12px", color: "#a5b4fc", padding: "6px 8px", background: "rgba(0,0,0,0.3)", borderRadius: "6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {showToken ? (userToken || "(توکن فعال در دسترس نیست؛ لطفاً مجدداً وارد شوید)") : "••••••••••••••••••••••••••••••••••••••••••••••••"}
                  </code>
                  <small style={{ color: "#64748b", fontSize: "10px", marginTop: "4px", display: "block" }}>
                    از این توکن اختصاصی برای لاگین آنی و سریع در نرم‌افزار دسکتاپ بدون نیاز به تایپ رمز عبور استفاده نمایید.
                  </small>
                </div>
              </div>

              {/* راهنمای ۳ گام شروع به کار */}
              <div style={{ marginTop: "24px", background: "rgba(59, 130, 246, 0.06)", border: "1px solid rgba(59, 130, 246, 0.2)", borderRadius: "12px", padding: "16px 20px" }}>
                <strong style={{ display: "block", fontSize: "13px", color: "#60a5fa", marginBottom: "8px" }}>
                  🚀 راهنمای سریع اتصال در ۳ مرحله:
                </strong>
                <ol style={{ margin: 0, paddingRight: "20px", color: "#cbd5e1", fontSize: "12px", lineHeight: "1.8" }}>
                  <li>فایل نصاب اپلیکیشن ویندوز را از دکمه بالا دانلود و روی ویندوز نصب کنید.</li>
                  <li>در صفحه نخست اپلیکیشن، آدرس سرور (<bdi dir="ltr">{serverUrl}</bdi>) را وارد نمایید.</li>
                  <li>با نام کاربری و رمز عبور خود یا با کپی توکن امن بالا، به سیستم متصل شده و از دستیار هوشمند استفاده کنید.</li>
                </ol>
              </div>
            </div>
          </div>
        ) : (
          <div className="user-profile-container" style={{ maxWidth: "800px", margin: "0 auto" }}>
            <UserProfileModal
              embedded
              currentUser={currentUser}
              onProfileUpdated={(updated) => setCurrentUser(updated)}
            />
          </div>
        )}
      </div>
    </main>
  );
}

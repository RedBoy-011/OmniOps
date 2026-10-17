import { useState } from "react";
import { type Profile } from "./api";
import { UserProfileModal } from "./components/UserProfileModal";
import { ThemePaletteSelector } from "./components/ThemePaletteSelector";

type Props = {
  user: Profile;
  onLogout: () => void;
  onSwitchToAdmin?: () => void;
};

export function UserWorkspace({ user, onLogout, onSwitchToAdmin }: Props) {
  const [currentUser, setCurrentUser] = useState<Profile>(user);
  const [activeTab, setActiveTab] = useState<"client" | "profile">("client");
  const [copiedServer, setCopiedServer] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [showToken, setShowToken] = useState(false);

  const serverUrl = typeof window !== "undefined" ? window.location.origin : "http://172.19.30.94:9000";
  const userToken = typeof localStorage !== "undefined" ? localStorage.getItem("omniops_token") || "" : "";

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

      <div className="admin-wrap" style={{ maxWidth: "1100px", width: "100%", margin: "0 auto", padding: "16px 20px" }}>
        {/* هدر پورتال کاربری */}
        <header className="admin-header admin-flat-header user-workspace-header" style={{ marginBottom: "20px" }}>
          <div className="admin-header-brand">
            <span className="brand-mark">✦</span>
            <div>
              <strong className="brand-title">OmniOps</strong>
              <span className="workspace-badge-tag hidden sm:inline-flex" style={{ marginRight: "8px" }}>
                پورتال کاربری و کلاینت‌ها
              </span>
            </div>
          </div>

          <div className="admin-header-actions">
            <ThemePaletteSelector compact isSuperadmin={currentUser.role === "superadmin"} />

            <div className="workspace-nav-pills" style={{ display: "flex", gap: "6px" }}>
              <button
                type="button"
                className={`workspace-tab-pill ${activeTab === "client" ? "active" : ""}`}
                onClick={() => setActiveTab("client")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 14px",
                  borderRadius: "10px",
                  fontSize: "12px",
                  fontWeight: "bold",
                  background: activeTab === "client" ? "var(--primary, #3b82f6)" : "rgba(255,255,255,0.06)",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.1)",
                  cursor: "pointer",
                }}
              >
                <span>🖥️</span>
                <span>کلاینت ویندوز</span>
              </button>
              <button
                type="button"
                className={`workspace-tab-pill ${activeTab === "profile" ? "active" : ""}`}
                onClick={() => setActiveTab("profile")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 14px",
                  borderRadius: "10px",
                  fontSize: "12px",
                  fontWeight: "bold",
                  background: activeTab === "profile" ? "var(--primary, #3b82f6)" : "rgba(255,255,255,0.06)",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.1)",
                  cursor: "pointer",
                }}
              >
                <span>👤</span>
                <span>پروفایل و امنیت</span>
              </button>
            </div>

            {currentUser.role === "superadmin" && onSwitchToAdmin && (
              <button
                type="button"
                className="admin-switch-pill"
                onClick={onSwitchToAdmin}
                title="سوییچ به کنسول مدیریت سرور و زیرساخت"
              >
                <span className="switch-icon">👑</span>
                <span className="hidden sm:inline">کنسول مدیریت</span>
              </button>
            )}

            <button className="quiet-button logout-button" onClick={onLogout} title="خروج امن از سیستم">
              <span>🚪</span>
              <span className="hidden sm:inline">خروج</span>
            </button>
          </div>
        </header>

        {activeTab === "client" ? (
          <div className="client-connection-portal" style={{ display: "grid", gap: "20px" }}>
            {/* کارت معرفی استودیو دسکتاپ ویندوز */}
            <div className="glass admin-card" style={{ padding: "24px", borderRadius: "16px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "16px" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                    <span style={{ fontSize: "24px" }}>💻</span>
                    <h2 style={{ margin: 0, fontSize: "18px", color: "#f8fafc" }}>نرم‌افزار دسکتاپ ویندوز (OmniOps Studio)</h2>
                    <span className="omni-cost-badge free" style={{ fontSize: "11px" }}>نسخه فوق‌مدرن بومی</span>
                  </div>
                  <p style={{ margin: 0, color: "#94a3b8", fontSize: "13px", lineHeight: "1.7", maxWidth: "680px" }}>
                    محیط گفت‌وگو و دستیار کدنویسی عامل‌محور به اپلیکیشن ویندوزی منتقل شده است تا بالاترین سرعت، استریمینگ بلادرنگ، رندرینگ حرفه‌ای کدها، مدیریت پایگاه دانش پروژه و اتصال مستقیم به سرورهای محلی و ابری را بدون محدودیت مرورگر تجربه کنید.
                  </p>
                </div>
                <div style={{ display: "flex", gap: "10px" }}>
                  <a
                    href="/downloads/OmniOps-Setup.exe"
                    className="submit-button"
                    style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "8px", padding: "10px 18px", borderRadius: "10px" }}
                  >
                    <span>📥</span>
                    <span>دانلود کلاینت ویندوز (.exe)</span>
                  </a>
                </div>
              </div>

              <hr style={{ borderColor: "rgba(255,255,255,0.08)", margin: "20px 0" }} />

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

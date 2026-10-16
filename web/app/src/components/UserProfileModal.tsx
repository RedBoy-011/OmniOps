import { useEffect, useState } from "react";
import { api, type Profile, type UserProfileReport } from "../api";

export interface UserProfileModalProps {
  currentUser: Profile;
  onClose?: () => void;
  onProfileUpdated: (user: Profile) => void;
  embedded?: boolean;
}

type TabType = "report" | "edit" | "password";

export function UserProfileModal({ currentUser, onClose, onProfileUpdated, embedded }: UserProfileModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>("report");
  const [report, setReport] = useState<UserProfileReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Edit profile form
  const [username, setUsername] = useState(currentUser.username);
  const [mobile, setMobile] = useState(currentUser.mobile || "");
  const [editBusy, setEditBusy] = useState(false);

  // Change password form
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passBusy, setPassBusy] = useState(false);

  // Server URL copy
  const [originUrl, setOriginUrl] = useState("");
  const [copiedUrl, setCopiedUrl] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOriginUrl(window.location.origin);
    }
  }, []);

  const handleCopyOriginUrl = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(originUrl);
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2500);
      }
    } catch {}
  };

  async function loadProfile() {
    setLoading(true);
    setError("");
    try {
      const data = await api.userProfile();
      setReport(data);
      setUsername(data.user.username);
      setMobile(data.user.mobile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در دریافت اطلاعات کاربری");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProfile();
  }, []);

  async function handleUpdateProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !mobile.trim()) {
      setError("نام کاربری و شماره موبایل الزامی هستند.");
      return;
    }
    setEditBusy(true);
    setError("");
    setSuccess("");
    try {
      const res = await api.updateProfile({ username: username.trim(), mobile: mobile.trim() });
      setSuccess("مشخصات کاربری با موفقیت به‌روزرسانی شد.");
      onProfileUpdated({
        id: res.user.id,
        username: res.user.username,
        mobile: res.user.mobile,
        role: res.user.role,
        status: res.user.status,
        capabilities: res.user.capabilities,
        created_at: res.user.created_at,
      });
      await loadProfile();
      setTimeout(() => setSuccess(""), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در ویرایش مشخصات");
    } finally {
      setEditBusy(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!oldPassword) {
      setError("وارد کردن رمز عبور فعلی الزامی است.");
      return;
    }
    if (newPassword.length < 4) {
      setError("رمز عبور جدید باید حداقل ۴ کاراکتر داشته باشد.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("رمز عبور جدید با تکرار آن یکسان نیست.");
      return;
    }

    setPassBusy(true);
    setError("");
    setSuccess("");
    try {
      const res = await api.changePassword(oldPassword, newPassword);
      setSuccess(res.message || "رمز عبور با موفقیت به‌روزرسانی شد.");
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setSuccess(""), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در تغییر رمز عبور");
    } finally {
      setPassBusy(false);
    }
  }

  const innerModal = (
    <div
      className={embedded ? "profile-embedded-wrap" : "glass update-modal profile-modal"}
      onClick={embedded ? undefined : (e) => e.stopPropagation()}
      role={embedded ? undefined : "dialog"}
      aria-modal={embedded ? undefined : "true"}
    >
      <div className="update-modal-header">
        <div className="profile-header-meta">
          <span className="profile-avatar-large">
            {currentUser.role === "superadmin" ? "👑" : "👤"}
          </span>
          <div>
            <h3>پروفایل و گزارش عملکرد کاربری</h3>
            <p className="profile-sub-title">
              {currentUser.username} · {currentUser.role === "superadmin" ? "مدیر ارشد سازمان" : "کاربر سازمانی"}
            </p>
          </div>
        </div>
        {!embedded && onClose && (
          <button
            type="button"
            className="update-dismiss-btn"
            onClick={onClose}
            aria-label="بستن پنجره"
          >
            ✕
          </button>
        )}
      </div>

        <div className="profile-tabs-nav" role="tablist">
          <button
            type="button"
            className={activeTab === "report" ? "active" : ""}
            onClick={() => { setActiveTab("report"); setError(""); setSuccess(""); }}
          >
            📊 گزارش و آمار عملکرد
          </button>
          <button
            type="button"
            className={activeTab === "edit" ? "active" : ""}
            onClick={() => { setActiveTab("edit"); setError(""); setSuccess(""); }}
          >
            ✏️ ویرایش مشخصات
          </button>
          <button
            type="button"
            className={activeTab === "password" ? "active" : ""}
            onClick={() => { setActiveTab("password"); setError(""); setSuccess(""); }}
          >
            🔒 تغییر رمز عبور
          </button>
        </div>

        <div className="profile-modal-content">
          {error && <p className="admin-message" style={{ color: "#f87171" }} role="alert">{error}</p>}
          {success && <p className="admin-message" style={{ color: "#34d399" }} role="status">{success}</p>}

          {activeTab === "report" && (
            <div className="profile-tab-report">
              {loading && <p className="empty-note">در حال دریافت داده‌های گزارش…</p>}
              {report && (
                <>
                  <div className="profile-stats-grid">
                    <div className="stat-card">
                      <span className="stat-icon">💬</span>
                      <div className="stat-val">{report.stats.total_sessions.toLocaleString("fa-IR")}</div>
                      <div className="stat-label">تاپیک‌های گفت‌وگو</div>
                    </div>
                    <div className="stat-card">
                      <span className="stat-icon">✉️</span>
                      <div className="stat-val">{report.stats.total_messages.toLocaleString("fa-IR")}</div>
                      <div className="stat-label">پیام‌های ارسال‌شده</div>
                    </div>
                    <div className="stat-card">
                      <span className="stat-icon">🌐</span>
                      <div className="stat-val">{report.stats.active_web_sessions.toLocaleString("fa-IR")}</div>
                      <div className="stat-label">نشست‌های فعال وب</div>
                    </div>
                    <div className="stat-card">
                      <span className="stat-icon">🤖</span>
                      <div className="stat-val">{report.stats.active_agent_sessions.toLocaleString("fa-IR")}</div>
                      <div className="stat-label">دستگاه‌های ایجنت</div>
                    </div>
                    {report.chat_quota && (
                      <div className="stat-card quota-stat-card">
                        <span className="stat-icon">⚡</span>
                        <div className="stat-val">
                          {report.chat_quota.unlimited
                            ? "نامحدود"
                            : `${report.chat_quota.used.toLocaleString("fa-IR")} / ۶۰`}
                        </div>
                        <div className="stat-label">
                          {report.chat_quota.unlimited ? "سهمیه سازمانی (مدیر کل)" : "مصرف چت ساعت جاری"}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="profile-info-summary">
                    <div className="info-row">
                      <span>شناسه یکتا (ID):</span>
                      <code dir="ltr">{report.user.id}</code>
                    </div>
                    <div className="info-row">
                      <span>شماره تماس:</span>
                      <strong dir="ltr">{report.user.mobile}</strong>
                    </div>
                    <div className="info-row">
                      <span>وضعیت دسترسی:</span>
                      <span className={`status-pill status-${report.user.status}`}>
                        {report.user.status === "active" ? "فعال و تأییدشده" : report.user.status}
                      </span>
                    </div>
                    <div className="info-row">
                      <span>تاریخ ثبت‌نام:</span>
                      <span>
                        {new Date(report.user.created_at * 1000).toLocaleString("fa-IR")}
                      </span>
                    </div>
                    <div className="info-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", paddingTop: "8px", borderTop: "1px dashed rgba(255,255,255,0.1)" }}>
                      <span style={{ fontWeight: 600, color: "#94a3b8" }}>نشانی اتصال کلاینت‌ها (سرور):</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <code dir="ltr" style={{ color: "#38bdf8", fontWeight: "bold", background: "rgba(15, 23, 42, 0.7)", padding: "4px 8px", borderRadius: "6px" }}>
                          {originUrl}
                        </code>
                        <button
                          type="button"
                          className="quiet-button"
                          style={{ padding: "4px 10px", fontSize: "11px", margin: 0, borderColor: copiedUrl ? "#10b981" : "#0284c7" }}
                          onClick={() => void handleCopyOriginUrl()}
                        >
                          {copiedUrl ? "✓ کپی شد" : "📋 کپی نشانی"}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="profile-caps-box">
                    <strong>مجوزها و توانمندی‌های فعال:</strong>
                    <div className="active-caps-list">
                      {report.user.capabilities.map((cap) => (
                        <span key={cap} className="cap-tag" dir="ltr">
                          ✓ {cap}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === "edit" && (
            <form className="profile-form" onSubmit={(e) => void handleUpdateProfile(e)}>
              <div className="form-group">
                <label htmlFor="prof-username">نام کاربری (۳ تا ۳۲ حرف و عدد انگلیسی)</label>
                <input
                  id="prof-username"
                  dir="ltr"
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="username"
                />
              </div>

              <div className="form-group">
                <label htmlFor="prof-mobile">شماره موبایل (فرمت ۰۹... یا ۹۸+)</label>
                <input
                  id="prof-mobile"
                  dir="ltr"
                  type="tel"
                  required
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder="09121234567"
                />
              </div>

              <div className="profile-modal-actions">
                <button
                  type="submit"
                  className="submit-button"
                  disabled={editBusy}
                >
                  {editBusy ? "در حال ذخیره مشخصات…" : "ذخیره تغییرات مشخصات"}
                </button>
              </div>
            </form>
          )}

          {activeTab === "password" && (
            <form className="profile-form" onSubmit={(e) => void handleChangePassword(e)}>
              <div className="form-group">
                <label htmlFor="old-pass">رمز عبور فعلی</label>
                <input
                  id="old-pass"
                  type="password"
                  required
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder="••••••••••••"
                />
              </div>

              <div className="form-group">
                <label htmlFor="new-pass">رمز عبور جدید (حداقل ۴ نویسه)</label>
                <input
                  id="new-pass"
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="حداقل ۴ نویسه امن"
                />
              </div>

              <div className="form-group">
                <label htmlFor="confirm-pass">تکرار رمز عبور جدید</label>
                <input
                  id="confirm-pass"
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="تکرار رمز عبور جدید"
                />
              </div>

              <p className="safety-note" style={{ fontSize: "0.82rem" }}>
                🛡️ توجه امنیتی: پس از تغییر رمز، به منظور حفاظت از حساب کاربری، سایر نشست‌های فعال شما روی سیستم‌های دیگر باطل شده و سشن فعلی شما معتبر باقی خواهد ماند.
              </p>

              <div className="profile-modal-actions">
                <button
                  type="submit"
                  className="submit-button"
                  disabled={passBusy}
                >
                  {passBusy ? "در حال تغییر رمز…" : "تغییر و ثبت رمز جدید"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );

  if (embedded) {
    return <section className="glass admin-card user-profile-card-section" dir="rtl">{innerModal}</section>;
  }

  return (
    <div className="update-modal-backdrop" onClick={onClose} dir="rtl">
      {innerModal}
    </div>
  );
}

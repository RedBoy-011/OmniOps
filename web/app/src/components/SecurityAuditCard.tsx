import { useEffect, useState } from "react";
import { api, type AuditLog } from "../api";

const EVENT_LABELS: Record<string, { label: string; badgeClass: string; icon: string }> = {
  login: { label: "ورود موفق به سامانه", badgeClass: "badge-login", icon: "🔑" },
  register_pending: { label: "ثبت‌نام کاربر جدید (در انتظار)", badgeClass: "badge-user", icon: "📝" },
  approve_user: { label: "تأیید دسترسی کاربر", badgeClass: "badge-success", icon: "✅" },
  reject_user: { label: "رد درخواست کاربر", badgeClass: "badge-danger", icon: "❌" },
  user_access_updated: { label: "ویرایش نقش و مجوزهای کاربر", badgeClass: "badge-warning", icon: "🛡️" },
  profile_updated: { label: "ویرایش مشخصات فردی", badgeClass: "badge-info", icon: "👤" },
  password_changed: { label: "تغییر رمز عبور", badgeClass: "badge-warning", icon: "🔒" },
  pair_code_issued: { label: "صدور کد اتصال ایجنت", badgeClass: "badge-info", icon: "⚡" },
  agent_paired: { label: "اتصال موفق ایجنت ویندوز", badgeClass: "badge-success", icon: "💻" },
  session_revoked: { label: "خروج و ابطال سشن", badgeClass: "badge-neutral", icon: "🚪" },
  backup_created: { label: "تهیه نسخه پشتیبان دیتابیس", badgeClass: "badge-purple", icon: "💾" },
  ollama_endpoint_changed: { label: "تغییر آدرس سرور Ollama", badgeClass: "badge-warning", icon: "⚙️" },
  model_pull_queued: { label: "افزودن مدل به صف دانلود", badgeClass: "badge-info", icon: "⬇️" },
  model_pull_completed: { label: "تکمیل موفق دانلود مدل", badgeClass: "badge-success", icon: "✅" },
  model_pull_failed: { label: "شکست دانلود مدل", badgeClass: "badge-danger", icon: "⚠️" },
  model_pull_dismissed: { label: "حذف گزارش وضعیت دانلود", badgeClass: "badge-neutral", icon: "🗑️" },
  model_delete_queued: { label: "درخواست حذف مدل از Worker", badgeClass: "badge-danger", icon: "🗑️" },
  model_delete_completed: { label: "حذف کامل مدل از دیسک", badgeClass: "badge-neutral", icon: "✓" },
  node_enrolled: { label: "ثبت و اتصال سرور/گره جدید", badgeClass: "badge-success", icon: "🤖" },
  node_revoked: { label: "ابطال دسترسی سرور/گره", badgeClass: "badge-danger", icon: "🚫" },
  node_deleted: { label: "حذف کامل سرور از سیستم", badgeClass: "badge-danger", icon: "🗑️" },
  bootstrap_admin: { label: "راه‌اندازی اولیه کاربر مدیر کل", badgeClass: "badge-purple", icon: "👑" },
  admin_reset: { label: "بازنشانی گذرواژه مدیر", badgeClass: "badge-warning", icon: "🔄" },
};

export function SecurityAuditCard() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | "auth" | "users" | "models" | "system">("all");

  async function loadLogs() {
    setLoading(true);
    setError("");
    try {
      const res = await api.auditLogs(150);
      setLogs(res.logs);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "دریافت لاگ‌های امنیتی ممیزی با خطا مواجه شد.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLogs();
  }, []);

  const filteredLogs = logs.filter((log) => {
    // Category filter
    if (categoryFilter === "auth") {
      if (!["login", "session_revoked", "register_pending"].includes(log.event)) return false;
    } else if (categoryFilter === "users") {
      if (!["approve_user", "reject_user", "user_access_updated", "password_changed", "profile_updated"].includes(log.event)) return false;
    } else if (categoryFilter === "models") {
      if (!["model_pull_queued", "model_pull_completed", "model_pull_failed", "model_pull_dismissed", "model_delete_queued", "model_delete_completed", "ollama_endpoint_changed", "node_enrolled", "node_revoked", "node_deleted"].includes(log.event)) return false;
    } else if (categoryFilter === "system") {
      if (!["backup_created", "bootstrap_admin", "admin_reset", "pair_code_issued", "agent_paired"].includes(log.event)) return false;
    }

    // Text search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const eventLabel = (EVENT_LABELS[log.event]?.label || log.event).toLowerCase();
      const actor = (log.actor_name || log.actor_id || "").toLowerCase();
      const subject = (log.subject_id || "").toLowerCase();
      return eventLabel.includes(q) || actor.includes(q) || subject.includes(q) || log.event.toLowerCase().includes(q);
    }

    return true;
  });

  return (
    <section className="glass admin-card audit-log-card" aria-label="دفترچه ممیزی امنیتی و لاگ رویدادها">
      <div className="card-title">
        <div>
          <h2>🛡️ دفترچه ممیزی امنیتی و ثبت رویدادها (Security Audit Trail)</h2>
          <p>ردگیری اتمیک تمامی رویدادهای حساس، تغییرات دسترسی، ورودها، اقدامات مدل‌ها و تهیه نسخه‌های پشتیبان.</p>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <span className="count-pill">{filteredLogs.length.toLocaleString("fa-IR")} رویداد</span>
          <button
            type="button"
            className="quiet-button"
            disabled={loading}
            onClick={() => void loadLogs()}
            title="بروزرسانی لاگ‌ها"
          >
            {loading ? "در حال دریافت…" : "🔄 بروزرسانی"}
          </button>
        </div>
      </div>

      {/* نوار فیلتر و جستجو */}
      <div className="audit-filters-bar">
        <div className="audit-search-box">
          <input
            type="text"
            className="form-input audit-search-input"
            placeholder="🔍 جستجو در رویدادها، نام کاربر، شناسه..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button type="button" className="clear-search-btn" onClick={() => setSearch("")} title="پاک کردن جستجو">
              ✕
            </button>
          )}
        </div>

        <div className="audit-category-chips">
          <button
            type="button"
            className={`audit-filter-chip ${categoryFilter === "all" ? "active" : ""}`}
            onClick={() => setCategoryFilter("all")}
          >
            همه رویدادها
          </button>
          <button
            type="button"
            className={`audit-filter-chip ${categoryFilter === "auth" ? "active" : ""}`}
            onClick={() => setCategoryFilter("auth")}
          >
            🔑 احراز هویت و ورود
          </button>
          <button
            type="button"
            className={`audit-filter-chip ${categoryFilter === "users" ? "active" : ""}`}
            onClick={() => setCategoryFilter("users")}
          >
            👥 کاربران و دسترسی‌ها
          </button>
          <button
            type="button"
            className={`audit-filter-chip ${categoryFilter === "models" ? "active" : ""}`}
            onClick={() => setCategoryFilter("models")}
          >
            🤖 سرورها و مدل‌ها
          </button>
          <button
            type="button"
            className={`audit-filter-chip ${categoryFilter === "system" ? "active" : ""}`}
            onClick={() => setCategoryFilter("system")}
          >
            💾 سیستم و بکاپ
          </button>
        </div>
      </div>

      {error && <p className="admin-message error-note">{error}</p>}

      {/* جدول رویدادهای ممیزی */}
      {filteredLogs.length === 0 ? (
        <p className="empty-note">هیچ رویدادی مطابق با فیلتر انتخابی یافت نشد.</p>
      ) : (
        <div className="audit-table-wrapper">
          <table className="audit-table">
            <thead>
              <tr>
                <th>زمان و تاریخ</th>
                <th>نوع رویداد</th>
                <th>اقدام‌کننده (Actor)</th>
                <th>هدف / جزئیات (Subject)</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log) => {
                const info = EVENT_LABELS[log.event] || { label: log.event, badgeClass: "badge-neutral", icon: "📌" };
                const timeStr = new Date(log.created_at * 1000).toLocaleString("fa-IR");

                return (
                  <tr key={log.id}>
                    <td className="audit-col-time">
                      <time dir="ltr">{timeStr}</time>
                    </td>
                    <td className="audit-col-event">
                      <span className={`audit-event-badge ${info.badgeClass}`}>
                        <span>{info.icon}</span>
                        <span>{info.label}</span>
                      </span>
                    </td>
                    <td className="audit-col-actor">
                      <strong>{log.actor_name || (log.actor_id ? "کاربر " + log.actor_id.slice(0, 8) + "…" : "سیستم هسته")}</strong>
                    </td>
                    <td className="audit-col-subject">
                      {log.subject_id ? (
                        <bdi dir="ltr" className="audit-subject-tag">{log.subject_id}</bdi>
                      ) : (
                        <span className="text-white/30">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

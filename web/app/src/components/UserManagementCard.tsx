import { useEffect, useState } from "react";
import { api, type ManagedUser } from "../api";

const ALL_CAPABILITIES: [string, string][] = [
  ["chat", "گفت‌وگو با مدل‌ها"],
  ["skill.use", "استفاده از مهارت‌ها"],
  ["tool.read", "خواندن ابزارها"],
  ["action.request", "ثبت درخواست وظیفه"],
  ["action.approve", "تأیید اجرای وظایف"],
  ["agent.pair", "اتصال ایجنت ویندوز"],
  ["user.approve", "تأیید و مدیریت کاربران"],
  ["profile.manage", "مدیریت پروفایل‌ها"],
  ["provider.manage", "تنظیمات ارائه‌دهندگان ابری"],
  ["provider.use", "استفاده از ارائه‌دهندگان ابری"],
];

type FilterType = "all" | "active" | "pending" | "rejected" | "superadmin";

export function UserManagementCard() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Draft edits per user: id -> { role, status, capabilities }
  const [drafts, setDrafts] = useState<Record<string, { role: string; status: string; capabilities: string[] }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  async function loadUsers() {
    setLoading(true);
    setError("");
    try {
      const data = await api.adminUsers();
      setUsers(data.users);
      // Initialize drafts
      const initialDrafts: Record<string, { role: string; status: string; capabilities: string[] }> = {};
      data.users.forEach((u) => {
        initialDrafts[u.id] = {
          role: u.role,
          status: u.status,
          capabilities: [...u.capabilities],
        };
      });
      setDrafts(initialDrafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در دریافت فهرست کاربران");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  function handleDraftChange(userId: string, key: "role" | "status", value: string) {
    setDrafts((prev) => ({
      ...prev,
      [userId]: {
        ...(prev[userId] || { role: "member", status: "active", capabilities: ["chat"] }),
        [key]: value,
      },
    }));
  }

  function handleCapabilityToggle(userId: string, cap: string) {
    setDrafts((prev) => {
      const current = prev[userId] || { role: "member", status: "active", capabilities: ["chat"] };
      const hasCap = current.capabilities.includes(cap);
      const nextCaps = hasCap
        ? current.capabilities.filter((c) => c !== cap)
        : [...current.capabilities, cap];
      return {
        ...prev,
        [userId]: {
          ...current,
          capabilities: nextCaps,
        },
      };
    });
  }

  async function handleSaveUser(userId: string) {
    const draft = drafts[userId];
    if (!draft) return;
    setSavingId(userId);
    setError("");
    setSuccess("");
    try {
      const res = await api.updateUserAccess({
        user_id: userId,
        role: draft.role,
        status: draft.status,
        capabilities: draft.capabilities,
      });
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, ...res.user } : u)));
      setSuccess(`دسترسی‌های کاربر ${res.user.username} با موفقیت به‌روزرسانی شد.`);
      setTimeout(() => setSuccess(""), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در ذخیره تغییرات کاربر");
    } finally {
      setSavingId(null);
    }
  }

  const filteredUsers = users.filter((u) => {
    if (filter === "active" && u.status !== "active") return false;
    if (filter === "pending" && u.status !== "pending") return false;
    if (filter === "rejected" && u.status !== "rejected") return false;
    if (filter === "superadmin" && u.role !== "superadmin") return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const matchName = u.username.toLowerCase().includes(q);
      const matchMobile = u.mobile.includes(q);
      if (!matchName && !matchMobile) return false;
    }
    return true;
  });

  return (
    <section className="glass admin-card user-management-card" dir="rtl">
      <div className="card-title">
        <div>
          <h2>مدیریت کاربران و کنترل دسترسی</h2>
          <p>مشاهده تمام کاربران، تغییر نقش سازمانی، کنترل وضعیت و دسترسی‌های مجاز سیستم.</p>
        </div>
        <button
          type="button"
          className="quiet-button"
          onClick={() => void loadUsers()}
          disabled={loading}
        >
          {loading ? "در حال دریافت…" : "🔄 تازه‌سازی لیست"}
        </button>
      </div>

      {error && <p className="admin-message" style={{ color: "#f87171" }} role="alert">{error}</p>}
      {success && <p className="admin-message" style={{ color: "#34d399" }} role="status">{success}</p>}

      <div className="user-filters-bar">
        <div className="user-filter-pills" role="tablist">
          <button
            type="button"
            className={filter === "all" ? "active" : ""}
            onClick={() => setFilter("all")}
          >
            همه ({users.length.toLocaleString("fa-IR")})
          </button>
          <button
            type="button"
            className={filter === "active" ? "active" : ""}
            onClick={() => setFilter("active")}
          >
            فعال ({users.filter((u) => u.status === "active").length.toLocaleString("fa-IR")})
          </button>
          <button
            type="button"
            className={filter === "pending" ? "active" : ""}
            onClick={() => setFilter("pending")}
          >
            در انتظار ({users.filter((u) => u.status === "pending").length.toLocaleString("fa-IR")})
          </button>
          <button
            type="button"
            className={filter === "superadmin" ? "active" : ""}
            onClick={() => setFilter("superadmin")}
          >
            مدیران ارشد ({users.filter((u) => u.role === "superadmin").length.toLocaleString("fa-IR")})
          </button>
        </div>

        <div className="user-search-box">
          <input
            type="text"
            placeholder="🔍 جستجوی نام کاربری یا شماره موبایل..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {filteredUsers.length === 0 ? (
        <p className="empty-note">هیچ کاربری با فیلتر انتخابی یافت نشد.</p>
      ) : (
        <div className="user-cards-grid">
          {filteredUsers.map((u) => {
            const draft = drafts[u.id] || { role: u.role, status: u.status, capabilities: u.capabilities };
            const isExpanded = expandedId === u.id;
            const isSaving = savingId === u.id;
            const hasChanged =
              draft.role !== u.role ||
              draft.status !== u.status ||
              JSON.stringify(draft.capabilities.sort()) !== JSON.stringify([...u.capabilities].sort());

            return (
              <article key={u.id} className={`managed-user-tile ${isExpanded ? "expanded" : ""}`}>
                <div className="managed-user-header">
                  <div className="user-avatar-wrap">
                    <span className="user-avatar-icon">
                      {u.role === "superadmin" ? "👑" : "👤"}
                    </span>
                    <div>
                      <div className="user-names-row">
                        <strong>{u.username}</strong>
                        <span className={`role-pill role-${draft.role}`}>
                          {draft.role === "superadmin" ? "مدیر کل" : "کاربر عادی"}
                        </span>
                        <span className={`status-pill status-${draft.status}`}>
                          {draft.status === "active" ? "فعال" : draft.status === "pending" ? "در انتظار" : "معلق / رد شده"}
                        </span>
                      </div>
                      <div className="user-sub-details">
                        <span dir="ltr" className="user-mobile-text">{u.mobile}</span>
                        <span className="bullet">·</span>
                        <time className="user-date-text">
                          {new Date(u.created_at * 1000).toLocaleDateString("fa-IR")}
                        </time>
                      </div>
                    </div>
                  </div>

                  <div className="managed-user-actions">
                    <button
                      type="button"
                      className="quiet-button small"
                      onClick={() => setExpandedId(isExpanded ? null : u.id)}
                    >
                      {isExpanded ? "بستن دسترسی‌ها ▲" : "تنظیم دسترسی‌ها ▼"}
                    </button>
                  </div>
                </div>

                <div className="user-quick-controls">
                  <div className="control-group">
                    <label>نقش سازمانی:</label>
                    <select
                      value={draft.role}
                      onChange={(e) => handleDraftChange(u.id, "role", e.target.value)}
                    >
                      <option value="member">کاربر عادی (Member)</option>
                      <option value="superadmin">مدیر ارشد (SuperAdmin)</option>
                    </select>
                  </div>

                  <div className="control-group">
                    <label>وضعیت حساب:</label>
                    <select
                      value={draft.status}
                      onChange={(e) => handleDraftChange(u.id, "status", e.target.value)}
                    >
                      <option value="active">فعال (Active)</option>
                      <option value="pending">در انتظار بررسی (Pending)</option>
                      <option value="rejected">مسدود / رد شده (Rejected)</option>
                    </select>
                  </div>

                  {hasChanged && (
                    <button
                      type="button"
                      className="submit-button small"
                      onClick={() => void handleSaveUser(u.id)}
                      disabled={isSaving}
                    >
                      {isSaving ? "در حال ذخیره…" : "ذخیره تغییرات ✓"}
                    </button>
                  )}
                </div>

                {isExpanded && (
                  <div className="capabilities-expanded-box">
                    <div className="capabilities-title">
                      <span>مجوزها و توانمندی‌های دسترسی کاربر:</span>
                      <small>
                        ({draft.capabilities.length} از {ALL_CAPABILITIES.length} فعال)
                      </small>
                    </div>
                    <div className="capabilities-grid">
                      {ALL_CAPABILITIES.map(([cap, title]) => (
                        <label key={cap} className="capability-check-pill">
                          <input
                            type="checkbox"
                            checked={draft.capabilities.includes(cap)}
                            onChange={() => handleCapabilityToggle(u.id, cap)}
                          />
                          <span>{title}</span>
                          <code dir="ltr">{cap}</code>
                        </label>
                      ))}
                    </div>
                    {hasChanged && (
                      <div className="expanded-save-row">
                        <button
                          type="button"
                          className="submit-button"
                          onClick={() => void handleSaveUser(u.id)}
                          disabled={isSaving}
                        >
                          {isSaving ? "در حال ذخیره…" : "ذخیره دسترسی‌ها"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

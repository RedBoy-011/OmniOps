import { useEffect, useState } from "react";
import { api, type DatabaseBackup } from "../api";

export function DatabaseBackupCard() {
  const [backups, setBackups] = useState<DatabaseBackup[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function fetchBackups() {
    setLoading(true);
    setError("");
    try {
      const data = await api.databaseBackups();
      setBackups(data.backups);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در بارگذاری فهرست پشتیبان‌ها");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateBackup() {
    setCreating(true);
    setError("");
    setSuccess("");
    try {
      const res = await api.createDatabaseBackup();
      setSuccess(`نسخه پشتیبان با موفقیت ایجاد شد: ${res.filename} (${(res.size_bytes / 1024).toFixed(1)} کیلوبایت)`);
      await fetchBackups();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در ایجاد نسخه پشتیبان");
    } finally {
      setCreating(false);
    }
  }

  useEffect(() => {
    void fetchBackups();
  }, []);

  return (
    <section className="glass admin-card database-backup-card" dir="rtl" aria-label="مدیریت پشتیبان‌های دیتابیس">
      <div className="card-title">
        <div>
          <h2>💾 پشتیبان‌گیری از دیتابیس (Online SQLite Backups)</h2>
          <p>
            پشتیبان‌گیری آنلاین و اتمیک از حساب‌ها، سشن‌ها، کلیدها و تاریخچه بدون قطعی سرور با قابلیت دانلود مستقیم
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button
            type="button"
            className="quiet-button"
            onClick={() => void fetchBackups()}
            disabled={loading || creating}
            title="به‌روزرسانی فهرست"
          >
            {loading ? "در حال دریافت…" : "🔄 رفرش"}
          </button>
          <button
            type="button"
            className="submit-button"
            onClick={() => void handleCreateBackup()}
            disabled={creating}
          >
            {creating ? "در حال ایجاد پشتیبان…" : "💾 ایجاد پشتیبان جدید"}
          </button>
        </div>
      </div>

      {error && <p className="admin-message" role="alert" style={{ color: "#f87171" }}>{error}</p>}
      {success && <p className="admin-message" role="status" style={{ color: "#34d399" }}>{success}</p>}

      <div className="backup-list-container" style={{ marginTop: "14px" }}>
        {backups.length === 0 ? (
          <p className="empty-note" style={{ textAlign: "center", color: "#9ca3af", padding: "16px 0" }}>
            {loading ? "در حال بارگذاری پشتیبان‌ها…" : "هنوز هیچ نسخه پشتیبانی ثبت نشده است. برای ایمنی داده‌ها یک پشتیبان تهیه کنید."}
          </p>
        ) : (
          <div className="backup-table-wrapper" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", textAlign: "right" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.1)", color: "#cbd5e1" }}>
                  <th style={{ padding: "8px 10px" }}>نام فایل پشتیبان</th>
                  <th style={{ padding: "8px 10px" }}>تاریخ ایجاد</th>
                  <th style={{ padding: "8px 10px" }}>حجم فایل</th>
                  <th style={{ padding: "8px 10px", textAlign: "left" }}>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr
                    key={b.filename}
                    style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.05)", color: "#f1f5f9" }}
                  >
                    <td style={{ padding: "10px", fontFamily: "monospace", direction: "ltr", textAlign: "right" }}>
                      📁 {b.filename}
                    </td>
                    <td style={{ padding: "10px", color: "#94a3b8" }}>
                      {new Date(b.created_at * 1000).toLocaleString("fa-IR")}
                    </td>
                    <td style={{ padding: "10px", color: "#38bdf8" }}>
                      {(b.size_bytes / 1024).toFixed(1)} KB
                    </td>
                    <td style={{ padding: "10px", textAlign: "left" }}>
                      <a
                        href={api.downloadBackupUrl(b.filename)}
                        download={b.filename}
                        className="quiet-button"
                        style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "4px 10px", fontSize: "11px", textDecoration: "none" }}
                      >
                        <span>⬇️</span>
                        <span>دانلود دیتابیس</span>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

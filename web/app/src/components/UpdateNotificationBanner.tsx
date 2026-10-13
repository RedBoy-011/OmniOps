import { useEffect, useState } from "react";
import { api, type UpdateStatus, type UpdateResult } from "../api";

export function UpdateNotificationBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [updating, setUpdating] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [error, setError] = useState("");
  const [dismissed, setDismissed] = useState(false);

  async function checkUpdates(force = false) {
    setError("");
    try {
      const data = await api.updateStatus(force);
      setStatus(data);
    } catch (err) {
      // Ignore network errors on background poll
      if (force) {
        setError(err instanceof Error ? err.message : "خطا در بررسی به‌روزرسانی گیت‌هاب");
      }
    }
  }

  async function handleApplyUpdate() {
    setUpdating(true);
    setError("");
    setShowConfirm(false);
    try {
      const res = await api.applyUpdate();
      setResult(res);
      if (res.status === "error") {
        setError(res.message);
      } else {
        await checkUpdates(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در اجرای فرآیند به‌روزرسانی");
    } finally {
      setUpdating(false);
    }
  }

  useEffect(() => {
    void checkUpdates();
    const interval = window.setInterval(() => {
      void checkUpdates();
    }, 180000); // 3 minutes poll
    return () => window.clearInterval(interval);
  }, []);

  if (result && result.status === "updated") {
    return (
      <div className="update-banner update-success-banner" dir="rtl" role="status">
        <div className="update-banner-content">
          <span className="update-banner-icon">✓</span>
          <div>
            <strong>سرور با موفقیت به‌روزرسانی شد!</strong>
            <p>
              ارتقا از کامیت <code>{result.previous_commit}</code> به <code>{result.new_commit}</code> انجام شد.
              {result.rebuilt_frontend && " فرانت‌اند وب با موفقیت بازسازی شد."}
            </p>
          </div>
        </div>
        <div className="update-banner-actions">
          <button
            type="button"
            className="submit-button"
            onClick={() => window.location.reload()}
          >
            بارگذاری مجدد صفحه
          </button>
        </div>
      </div>
    );
  }

  if (!status || !status.update_available || dismissed) {
    return null;
  }

  return (
    <>
      <div className="update-banner update-alert-banner" dir="rtl" role="alert">
        <div className="update-banner-content">
          <span className="update-banner-icon">🔔</span>
          <div>
            <strong>نسخه جدیدی از OmniOps در گیت‌هاب منتشر شده است!</strong>
            <p>
              نسخه فعلی شما: <code>{status.current_commit}</code> · نسخه جدید در گیت‌هاب: <code>{status.latest_commit}</code>
            </p>
          </div>
        </div>
        <div className="update-banner-actions">
          <button
            type="button"
            className="update-action-btn"
            onClick={() => setShowConfirm(true)}
            disabled={updating}
          >
            {updating ? "در حال دریافت تغییرات…" : "🚀 دریافت و اعمال آپدیت"}
          </button>
          <button
            type="button"
            className="update-dismiss-btn"
            onClick={() => setDismissed(true)}
            title="بستن اعلان"
            aria-label="بستن اعلان"
          >
            ✕
          </button>
        </div>
      </div>

      {showConfirm && (
        <div className="update-modal-backdrop" onClick={() => setShowConfirm(false)}>
          <div
            className="glass update-modal"
            dir="rtl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="update-modal-header">
              <span className="modal-icon">⚠️</span>
              <h3>تأیید به‌روزرسانی سامانه از گیت‌هاب</h3>
            </div>
            <div className="update-modal-body">
              <p>
                آیا از دریافت آخرین نسخه از شاخه <code>main</code> مخزن رسمی گیت‌هاب اطمینان دارید؟
              </p>
              <ul>
                <li>✓ فرآیند <code>git pull</code> به‌طور خودکار اجرا می‌شود.</li>
                <li>✓ فایل‌های کلاینت وب بازسازی (rebuild) خواهند شد.</li>
                <li>✓ داده‌های کاربران، پایگاه‌داده و سشن‌ها دست‌نخورده و ایمن باقی می‌مانند.</li>
              </ul>
              {error && <p className="admin-message" style={{ color: "#f87171" }}>{error}</p>}
            </div>
            <div className="update-modal-footer">
              <button
                type="button"
                className="quiet-button"
                onClick={() => setShowConfirm(false)}
                disabled={updating}
              >
                انصراف
              </button>
              <button
                type="button"
                className="submit-button"
                onClick={() => void handleApplyUpdate()}
                disabled={updating}
              >
                {updating ? "در حال به‌روزرسانی و ساخت فرانت‌اند…" : "بله، شروع به‌روزرسانی"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

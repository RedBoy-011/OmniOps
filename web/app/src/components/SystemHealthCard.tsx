import { useEffect, useState } from "react";
import { api, type SystemMetrics } from "../api";

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  const parts: string[] = [];
  if (d > 0) parts.push(`${d.toLocaleString("fa-IR")} روز`);
  if (h > 0) parts.push(`${h.toLocaleString("fa-IR")} ساعت`);
  if (m > 0) parts.push(`${m.toLocaleString("fa-IR")} دقیقه`);
  if (parts.length === 0) parts.push(`${s.toLocaleString("fa-IR")} ثانیه`);
  return parts.join(" و ");
}

function getBarColor(percent: number): string {
  if (percent >= 85) return "linear-gradient(90deg, #ff4d6d, #e63946)";
  if (percent >= 65) return "linear-gradient(90deg, #f39c12, #e67e22)";
  return "linear-gradient(90deg, #2ec4b6, #20bf6b)";
}

export function SystemHealthCard() {
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  async function fetchMetrics(silent = false) {
    if (!silent) setLoading(true);
    setError("");
    try {
      const data = await api.systemMetrics();
      setMetrics(data);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در دریافت تله‌متری سیستم");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void fetchMetrics();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = window.setInterval(() => {
      void fetchMetrics(true);
    }, 10000);
    return () => window.clearInterval(interval);
  }, [autoRefresh]);

  return (
    <section className="glass admin-card system-health-section" dir="rtl">
      <div className="card-title">
        <div>
          <h2>📊 وضعیت بلادرنگ سخت‌افزار و سلامت سیستم (Hardware Telemetry)</h2>
          <p>
            پایش لحظه‌ای مصرف پردازنده، حافظه، دیسک، شتاب‌دهنده گرافیکی (GPU/VRAM) و گارد همزمانی مدل‌ها.
          </p>
        </div>
        <div className="health-header-actions">
          <label className="auto-refresh-toggle" title="دریافت خودکار وضعیت هر ۱۰ ثانیه">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span>بروزرسانی زنده (۱۰ ثانیه)</span>
          </label>
          <button
            type="button"
            className="quiet-button refresh-telemetry-btn"
            disabled={loading}
            onClick={() => void fetchMetrics()}
            title="بررسی دستی وضعیت"
          >
            {loading ? "در حال دریافت…" : "🔄 بروزرسانی"}
          </button>
        </div>
      </div>

      {lastUpdated && (
        <div className="telemetry-meta-bar">
          <span className="telemetry-time-badge">
            ⏱️ آخرین بروزرسانی: {lastUpdated.toLocaleTimeString("fa-IR")}
          </span>
          {metrics && (
            <span className="telemetry-uptime-badge">
              ⏳ پایداری سرور (Uptime): {formatUptime(metrics.uptime_seconds)}
            </span>
          )}
          {metrics && (
            <span className="telemetry-platform-badge" dir="ltr">
              🖥️ {metrics.runtime.platform_string}
            </span>
          )}
        </div>
      )}

      {error && <p className="admin-message" role="alert">{error}</p>}

      {!metrics && !error && (
        <p className="empty-note">در حال سنجش منابع سخت‌افزاری سرور…</p>
      )}

      {metrics && (
        <div className="health-grid">
          {/* ⚡ CPU Card */}
          <div className="health-card">
            <div className="health-card-header">
              <span className="health-icon">⚡</span>
              <div>
                <strong>پردازنده مرکزی (CPU)</strong>
                <small>{metrics.cpu.cores.toLocaleString("fa-IR")} هسته پردازشی</small>
              </div>
              <span
                className="health-value-badge"
                style={{
                  color: metrics.cpu.percent >= 85 ? "#ff4d6d" : metrics.cpu.percent >= 65 ? "#f39c12" : "#20bf6b",
                }}
              >
                {metrics.cpu.percent.toLocaleString("fa-IR")}%
              </span>
            </div>
            <div className="health-progress-track">
              <div
                className="health-progress-fill"
                style={{
                  width: `${Math.min(100, metrics.cpu.percent)}%`,
                  background: getBarColor(metrics.cpu.percent),
                }}
              />
            </div>
            <div className="health-details-row">
              <span>بار کاری: {metrics.cpu.percent < 50 ? "طبیعی و آزاد" : metrics.cpu.percent < 80 ? "معمولی" : "بالا"}</span>
              {metrics.cpu.load_avg && (
                <span dir="ltr" title="میانگین بار کاری در ۱، ۵ و ۱۵ دقیقه گذشته">
                  Load: {metrics.cpu.load_avg.join(" · ")}
                </span>
              )}
            </div>
          </div>

          {/* 🧠 RAM Card */}
          <div className="health-card">
            <div className="health-card-header">
              <span className="health-icon">🧠</span>
              <div>
                <strong>حافظه موقت (RAM)</strong>
                <small>
                  {metrics.ram.used_gb.toLocaleString("fa-IR")} از {metrics.ram.total_gb.toLocaleString("fa-IR")} گیگابایت
                </small>
              </div>
              <span
                className="health-value-badge"
                style={{
                  color: metrics.ram.percent >= 85 ? "#ff4d6d" : metrics.ram.percent >= 65 ? "#f39c12" : "#20bf6b",
                }}
              >
                {metrics.ram.percent.toLocaleString("fa-IR")}%
              </span>
            </div>
            <div className="health-progress-track">
              <div
                className="health-progress-fill"
                style={{
                  width: `${Math.min(100, metrics.ram.percent)}%`,
                  background: getBarColor(metrics.ram.percent),
                }}
              />
            </div>
            <div className="health-details-row">
              <span>فضای آزاد: {metrics.ram.free_gb.toLocaleString("fa-IR")} گیگابایت</span>
              <span className={metrics.ram.percent > 90 ? "text-danger" : ""}>
                {metrics.ram.percent > 90 ? "⚠️ حافظه نزدیک به اشباع" : "پایدار"}
              </span>
            </div>
          </div>

          {/* 💾 Disk Card */}
          <div className="health-card">
            <div className="health-card-header">
              <span className="health-icon">💾</span>
              <div>
                <strong>فضای ذخیره‌سازی دیسک</strong>
                <small>
                  {metrics.disk.used_gb.toLocaleString("fa-IR")} از {metrics.disk.total_gb.toLocaleString("fa-IR")} گیگابایت
                </small>
              </div>
              <span
                className="health-value-badge"
                style={{
                  color: metrics.disk.percent >= 90 ? "#ff4d6d" : "#20bf6b",
                }}
              >
                {metrics.disk.percent.toLocaleString("fa-IR")}%
              </span>
            </div>
            <div className="health-progress-track">
              <div
                className="health-progress-fill"
                style={{
                  width: `${Math.min(100, metrics.disk.percent)}%`,
                  background: getBarColor(metrics.disk.percent),
                }}
              />
            </div>
            <div className="health-details-row">
              <span>فضای خالی: {metrics.disk.free_gb.toLocaleString("fa-IR")} گیگابایت</span>
              <span dir="ltr" style={{ fontSize: "11px", opacity: 0.7 }} title={metrics.disk.path}>
                {metrics.disk.path.length > 25 ? "…" + metrics.disk.path.slice(-22) : metrics.disk.path}
              </span>
            </div>
          </div>

          {/* 🎮 GPU / VRAM Card */}
          <div className={`health-card ${metrics.gpu.available ? "gpu-active" : "gpu-cpu-only"}`}>
            <div className="health-card-header">
              <span className="health-icon">🎮</span>
              <div>
                <strong>شتاب‌دهنده گرافیکی (GPU / VRAM)</strong>
                <small className="gpu-model-name">
                  {metrics.gpu.available ? metrics.gpu.name : "پردازش روی CPU"}
                </small>
              </div>
              {metrics.gpu.available && metrics.gpu.vram_percent != null && (
                <span className="health-value-badge">
                  {metrics.gpu.vram_percent.toLocaleString("fa-IR")}%
                </span>
              )}
            </div>

            {metrics.gpu.available && metrics.gpu.vram_percent != null ? (
              <>
                <div className="health-progress-track">
                  <div
                    className="health-progress-fill"
                    style={{
                      width: `${Math.min(100, metrics.gpu.vram_percent)}%`,
                      background: getBarColor(metrics.gpu.vram_percent),
                    }}
                  />
                </div>
                <div className="health-details-row">
                  <span>
                    VRAM: {(metrics.gpu.vram_used_mb ?? 0).toLocaleString("fa-IR")} / {(metrics.gpu.vram_total_mb ?? 0).toLocaleString("fa-IR")} MB
                  </span>
                  <span>
                    {metrics.gpu.temperature_c != null && `🌡️ ${metrics.gpu.temperature_c.toLocaleString("fa-IR")}°C`}
                    {metrics.gpu.gpu_utilization_percent != null && ` · بار: ${metrics.gpu.gpu_utilization_percent.toLocaleString("fa-IR")}%`}
                  </span>
                </div>
              </>
            ) : (
              <div className="cpu-only-note">
                <p>کارت گرافیک اختصاصی انویدیا یافت نشد.</p>
                <small>مدل‌های هوش مصنوعی با بهره‌گیری از هسته‌های پردازنده (CPU) و رم سیستم اجرا می‌شوند.</small>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 🛡️ Concurrency Guard & Runtime Summary */}
      {metrics && (
        <div className="health-runtime-footer">
          <div className="runtime-stat-pill">
            <span className="pill-dot" style={{ background: metrics.runtime.active_inferences > 0 ? "#2ec4b6" : "#6c757d" }} />
            <span>گارد همزمانی مدل:</span>
            <strong>
              {metrics.runtime.active_inferences.toLocaleString("fa-IR")} از {metrics.runtime.max_inferences.toLocaleString("fa-IR")} استنتاج همزمان
            </strong>
          </div>

          <div className="runtime-stat-pill">
            <span>وضعیت سرویس Ollama:</span>
            <strong className={`status-${metrics.runtime.ollama_status}`}>
              {metrics.runtime.ollama_status === "up" ? "آماده و متصل" : metrics.runtime.ollama_status === "no_models" ? "بدون مدل" : "قطع / آفلاین"}
            </strong>
            <small>({metrics.runtime.ollama_model_count.toLocaleString("fa-IR")} مدل محلی)</small>
          </div>

          <div className="runtime-stat-pill">
            <span>گره‌های ورکر متصل:</span>
            <strong>{metrics.runtime.worker_nodes_count.toLocaleString("fa-IR")} گره</strong>
          </div>

          <div className="runtime-stat-pill" dir="ltr">
            <span>Python:</span>
            <strong>v{metrics.runtime.python_version}</strong>
          </div>
        </div>
      )}
    </section>
  );
}

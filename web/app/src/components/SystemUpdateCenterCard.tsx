import React, { useEffect, useState, useRef } from "react";
import { api, type UpdateStatus, type UpdateResult } from "../api";

export const SystemUpdateCenterCard: React.FC = () => {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [updating, setUpdating] = useState<boolean>(false);
  const [activeStep, setActiveStep] = useState<number>(0);
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [error, setError] = useState<string>("");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const countdownIntervalRef = useRef<number | null>(null);

  // Check for updates from server/GitHub
  const fetchStatus = async (force = false) => {
    setLoading(true);
    setError("");
    try {
      const data = await api.updateStatus(force);
      setStatus(data);
    } catch (err) {
      if (force) {
        setError(err instanceof Error ? err.message : "خطا در بررسی وضعیت به‌روزرسانی از گیت‌هاب");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchStatus(false);
    // Poll every 3 minutes
    const interval = window.setInterval(() => {
      void fetchStatus(false);
    }, 180000);
    return () => {
      window.clearInterval(interval);
      if (countdownIntervalRef.current) {
        window.clearInterval(countdownIntervalRef.current);
      }
    };
  }, []);

  // Trigger automated update pipeline
  const handleExecuteUpdate = async () => {
    setShowConfirmModal(false);
    setUpdating(true);
    setActiveStep(1); // Step 1: Git fetch & pull
    setError("");
    setResult(null);

    // Simulated visual step progression
    const stepTimer1 = window.setTimeout(() => setActiveStep(2), 2500); // Step 2: Build web
    const stepTimer2 = window.setTimeout(() => setActiveStep(3), 6000); // Step 3: Sync binaries

    try {
      const res = await api.applyUpdate();
      window.clearTimeout(stepTimer1);
      window.clearTimeout(stepTimer2);
      setActiveStep(4); // Step 4: Complete & restart
      setResult(res);

      if (res.status === "error") {
        setError(res.message || "خطا در فرآیند به‌روزرسانی سامانه");
        setUpdating(false);
        return;
      }

      // Start automatic reload countdown
      let remaining = res.reload_delay ?? 3;
      setCountdown(remaining);

      countdownIntervalRef.current = window.setInterval(() => {
        remaining -= 1;
        setCountdown(remaining);
        if (remaining <= 0) {
          if (countdownIntervalRef.current) {
            window.clearInterval(countdownIntervalRef.current);
          }
          window.location.reload();
        }
      }, 1000);
    } catch (err) {
      window.clearTimeout(stepTimer1);
      window.clearTimeout(stepTimer2);
      setError(err instanceof Error ? err.message : "ارتباط با سرور در حین به‌روزرسانی قطع شد");
      setUpdating(false);
    }
  };

  const hasUpdate = Boolean(status?.update_available);

  return (
    <section
      className="glass admin-card system-update-center-card border border-cyan-800/40 bg-[#0d121c]/95 rounded-2xl p-5 md:p-6 text-white shadow-2xl relative overflow-hidden"
      dir="rtl"
    >
      {/* Decorative background glow */}
      <div className="absolute -top-24 -left-24 w-64 h-64 bg-cyan-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* ۱. هدر کارت مرکز به‌روزرسانی یکپارچه */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#222c3d]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-xl shadow-lg shadow-cyan-500/20">
            🔄
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base md:text-lg font-bold text-white tracking-wide">
                مرکز به‌روزرسانی یکپارچه سامانه OmniOps
              </h2>
              {hasUpdate && (
                <span className="bg-amber-500/20 border border-amber-500/50 text-amber-300 text-[11px] px-2.5 py-0.5 rounded-full font-bold animate-pulse flex items-center gap-1">
                  <span>🔔</span>
                  <span>نسخه جدید موجود است</span>
                </span>
              )}
              {!hasUpdate && status && !status.error && (
                <span className="bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 text-[11px] px-2.5 py-0.5 rounded-full font-medium flex items-center gap-1">
                  <span>✓</span>
                  <span>هسته به‌روز است</span>
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1 leading-relaxed">
              مرجع مستقل و واحد ارتقای نرم‌افزار: همگام‌سازی هسته از گیت‌هاب، بازسازی فرانت‌اند و به‌روزرسانی خودکار فایل‌های نصب کلاینت‌ها (ویندوز و اندروید).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <a
            href="https://github.com/RedBoy-011/OmniOps/commits/main"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] bg-[#161f2e] hover:bg-[#1e2a3e] text-cyan-300 border border-cyan-800/60 px-3 py-1.5 rounded-xl transition flex items-center gap-1.5"
          >
            <span>🌿 تاریخچه کامیت‌ها</span>
          </a>
          <button
            type="button"
            onClick={() => void fetchStatus(true)}
            disabled={loading || updating}
            className="text-[11px] bg-[#161f2e] hover:bg-[#1e2a3e] text-gray-200 border border-slate-700 px-3 py-1.5 rounded-xl transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="بررسی دستی آخرین کامیت‌های گیت‌هاب"
          >
            <span className={loading ? "animate-spin" : ""}>🔄</span>
            <span>{loading ? "در حال استعلام…" : "بررسی مجدد گیت‌هاب"}</span>
          </button>
        </div>
      </div>

      {/* ۲. ردیف اطلاعات نسخه و وضعیت کامیت‌ها */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 py-4 text-xs border-b border-[#222c3d]">
        <div className="bg-[#121824] p-3 rounded-xl border border-slate-800/80">
          <span className="text-gray-400 block text-[11px] mb-1">نسخه فعلی مستقر روی سرور:</span>
          <div className="flex items-center gap-1.5 font-mono font-bold text-cyan-300">
            <span>🏷️</span>
            <span>{status?.current_commit || "در حال دریافت…"}</span>
          </div>
        </div>

        <div className="bg-[#121824] p-3 rounded-xl border border-slate-800/80">
          <span className="text-gray-400 block text-[11px] mb-1">آخرین نسخه در مخزن گیت‌هاب:</span>
          <div className="flex items-center gap-1.5 font-mono font-bold text-emerald-300">
            <span>🚀</span>
            <span>{status?.latest_commit || "در حال دریافت…"}</span>
          </div>
        </div>

        <div className="bg-[#121824] p-3 rounded-xl border border-slate-800/80">
          <span className="text-gray-400 block text-[11px] mb-1">شاخه رهگیری کد:</span>
          <div className="flex items-center gap-1.5 font-mono font-bold text-gray-200">
            <span>🌿</span>
            <span>{status?.branch || "main"}</span>
          </div>
        </div>

        <div className="bg-[#121824] p-3 rounded-xl border border-slate-800/80">
          <span className="text-gray-400 block text-[11px] mb-1">وضعیت ارتباط با گیت‌هاب:</span>
          <div className="flex items-center gap-1.5 font-bold">
            {status?.error ? (
              <span className="text-rose-400 flex items-center gap-1 truncate" title={status.error}>
                ⚠️ خطا در اتصال
              </span>
            ) : (
              <span className="text-emerald-400 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span>
                برخط و همگام
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ۳. کادر اعلان زنده در صورت وجود نسخه جدید */}
      {hasUpdate && !updating && !result && (
        <div className="my-4 p-4 rounded-xl bg-gradient-to-r from-amber-950/40 via-amber-900/20 to-transparent border border-amber-500/40 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl mt-0.5">🔔</span>
            <div>
              <strong className="text-amber-200 text-sm font-bold block">
                تغییرات جدیدی در گیت‌هاب شناسایی شد!
              </strong>
              <p className="text-xs text-amber-300/80 mt-1 leading-relaxed">
                کامیت <code>{status?.latest_commit}</code> در گیت‌هاب قرار دارد در حالی که نسخهٔ سرور شما <code>{status?.current_commit}</code> است. با کلیک بر روی دکمه زیر، تمام اجزای سیستم به‌روزرسانی شده و فایل‌های نصبی کلاینت‌ها جایگزین خواهند شد.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowConfirmModal(true)}
            className="whitespace-nowrap px-5 py-2.5 rounded-xl font-bold text-xs bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 shadow-lg shadow-amber-500/20 transition cursor-pointer"
          >
            🚀 به‌روزرسانی فوری سامانه
          </button>
        </div>
      )}

      {/* ۴. استپر پیشرفت فرآیند به‌روزرسانی (Step Pipeline) */}
      {updating && (
        <div className="my-5 p-5 bg-[#101622] border border-cyan-900/50 rounded-xl space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-cyan-300 flex items-center gap-2">
              <span className="animate-spin text-sm">🔄</span>
              <span>در حال اجرای فرآیند زنجیره‌ای به‌روزرسانی خودکار…</span>
            </span>
            <span className="text-[11px] text-gray-400 font-mono">گام {activeStep} از ۴</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
            <div
              className={`p-2.5 rounded-lg border text-center transition ${
                activeStep >= 1
                  ? "bg-cyan-950/60 border-cyan-600 text-cyan-200 font-bold"
                  : "bg-slate-900/40 border-slate-800 text-gray-500"
              }`}
            >
              <div className="text-sm mb-1">{activeStep > 1 ? "✓" : activeStep === 1 ? "⏳" : "۱"}</div>
              <span>۱. دریافت کد از گیت‌هاب</span>
            </div>

            <div
              className={`p-2.5 rounded-lg border text-center transition ${
                activeStep >= 2
                  ? "bg-cyan-950/60 border-cyan-600 text-cyan-200 font-bold"
                  : "bg-slate-900/40 border-slate-800 text-gray-500"
              }`}
            >
              <div className="text-sm mb-1">{activeStep > 2 ? "✓" : activeStep === 2 ? "⏳" : "۲"}</div>
              <span>۲. بازسازی فرانت‌اند وب</span>
            </div>

            <div
              className={`p-2.5 rounded-lg border text-center transition ${
                activeStep >= 3
                  ? "bg-cyan-950/60 border-cyan-600 text-cyan-200 font-bold"
                  : "bg-slate-900/40 border-slate-800 text-gray-500"
              }`}
            >
              <div className="text-sm mb-1">{activeStep > 3 ? "✓" : activeStep === 3 ? "⏳" : "۳"}</div>
              <span>۳. همگام‌سازی APK و EXE</span>
            </div>

            <div
              className={`p-2.5 rounded-lg border text-center transition ${
                activeStep >= 4
                  ? "bg-emerald-950/60 border-emerald-600 text-emerald-200 font-bold"
                  : "bg-slate-900/40 border-slate-800 text-gray-500"
              }`}
            >
              <div className="text-sm mb-1">{activeStep === 4 ? "✓" : "۴"}</div>
              <span>۴. راه‌اندازی و بارگذاری مجدد</span>
            </div>
          </div>
        </div>
      )}

      {/* ۵. نتیجهٔ موفقیت‌آمیز و شمارش معکوس رفرش */}
      {result && result.status !== "error" && (
        <div className="my-4 p-5 rounded-xl bg-gradient-to-r from-emerald-950/50 via-[#0b1c16] to-[#0d141e] border border-emerald-500/50 space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl text-emerald-400">✓</span>
            <div>
              <strong className="text-emerald-300 text-sm block">
                {result.message}
              </strong>
              <p className="text-xs text-gray-300 mt-1">
                نسخه سرور: <code>{result.previous_commit}</code> ➔ <code>{result.new_commit}</code>
                {result.rebuilt_frontend && " · فرانت‌اند وب کامپایل و مستقر شد."}
              </p>
            </div>
          </div>

          {result.synced_files && result.synced_files.length > 0 && (
            <div className="bg-[#0b151e] p-3 rounded-lg border border-emerald-900/60 text-[11px] text-gray-300 space-y-1">
              <span className="font-bold text-emerald-400 block">فایل‌های کلاینت همگام‌شده در هسته:</span>
              <ul className="list-disc list-inside space-y-0.5">
                {result.synced_files.map((file, idx) => (
                  <li key={idx} className="font-mono">{file}</li>
                ))}
              </ul>
            </div>
          )}

          {countdown !== null && (
            <div className="flex items-center justify-between p-3 bg-emerald-900/30 rounded-lg border border-emerald-700/50 text-xs">
              <div className="flex items-center gap-2 text-emerald-200">
                <span className="animate-spin">🔄</span>
                <span>سرویس در حال راه‌اندازی مجدد است؛ صفحه به صورت خودکار رفرش می‌شود…</span>
              </div>
              <div className="text-sm font-bold font-mono text-emerald-300 bg-emerald-950 px-3 py-1 rounded-md border border-emerald-600">
                {countdown} ثانیه
              </div>
            </div>
          )}
        </div>
      )}

      {/* ۶. نمایش خطا در صورت بروز */}
      {error && (
        <div className="my-4 p-4 rounded-xl bg-rose-950/50 border border-rose-800 text-rose-200 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚠️</span>
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => void fetchStatus(true)}
            className="text-[11px] bg-rose-900/80 hover:bg-rose-800 text-white px-3 py-1 rounded-lg transition"
          >
            تلاش مجدد
          </button>
        </div>
      )}

      {/* ۷. بخش اصلی دکمه اقدام یکپارچه */}
      <div className="pt-4 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="text-xs text-gray-400">
          با زدن این دکمه، کل زنجیره ارتقا (Pull گیت‌هاب + Build فرانت‌اند + همگام‌سازی APK اندروید و EXE ویندوز + Restart هسته) به صورت اتوماتیک اجرا می‌گردد.
        </div>

        <button
          type="button"
          onClick={() => setShowConfirmModal(true)}
          disabled={updating}
          className={`w-full sm:w-auto px-6 py-3 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition shadow-xl cursor-pointer disabled:opacity-50 ${
            hasUpdate
              ? "bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-cyan-500/25"
              : "bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700"
          }`}
        >
          <span>🚀</span>
          <span>
            {updating
              ? "فرآیند به‌روزرسانی در حال اجراست…"
              : hasUpdate
              ? "به‌روزرسانی یکپارچه سامانه به آخرین نسخه گیت‌هاب"
              : "همگام‌سازی و ارتقای اجباری سامانه (هسته + برنامه‌ها)"}
          </span>
        </button>
      </div>

      {/* مدال تایید به‌روزرسانی */}
      {showConfirmModal && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setShowConfirmModal(false)}
        >
          <div
            className="bg-[#121824] border border-cyan-800/80 rounded-2xl max-w-md w-full p-6 text-white shadow-2xl space-y-4"
            dir="rtl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 text-cyan-400 border-b border-slate-800 pb-3">
              <span className="text-2xl">⚡</span>
              <h3 className="font-bold text-base text-white">تأیید اجرای به‌روزرسانی خودکار</h3>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed">
              عملیات زیر به ترتیب و بدون نیاز به دخالت دستی انجام خواهند شد:
            </p>

            <ul className="text-xs text-gray-400 space-y-2 pr-2">
              <li className="flex items-center gap-2">
                <span className="text-cyan-400">۱.</span>
                <span>دریافت آخرین کدها از مخزن گیت‌هاب (<code>git pull origin main</code>)</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="text-cyan-400">۲.</span>
                <span>کامپایل و بازسازی فرانت‌اند وب با آخرین تغییرات (<code>npm run build</code>)</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="text-cyan-400">۳.</span>
                <span>دریافت و جایگزینی باینری‌های جدید کلاینت اندروید و ویندوز در هسته</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="text-cyan-400">۴.</span>
                <span>راه‌اندازی مجدد سرویس و بارگذاری خودکار صفحه مرورگر پس از ۳ ثانیه</span>
              </li>
            </ul>

            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 rounded-xl text-xs text-gray-400 hover:text-white hover:bg-slate-800 transition"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={() => void handleExecuteUpdate()}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-lg shadow-cyan-500/25 transition cursor-pointer"
              >
                شروع به‌روزرسانی
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

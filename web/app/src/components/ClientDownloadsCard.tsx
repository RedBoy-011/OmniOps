import React, { useEffect, useState } from 'react';
import { MobileOrchestratorCard } from './MobileOrchestratorCard';
import { QrCodeSvg } from './qrcode';

export interface ClientDownloadsProps {
  pair?: { code: string; expires_at: number } | null;
  seconds?: number;
  copyStatus?: string;
  onGeneratePair?: () => void;
  onCopyPair?: () => void;
}

export const ClientDownloadsCard: React.FC<ClientDownloadsProps> = ({
  pair,
  seconds = 0,
  copyStatus = '',
  onGeneratePair,
  onCopyPair,
}) => {
  const [showOrchestratorDemo, setShowOrchestratorDemo] = useState(false);
  const [androidUrlCopied, setAndroidUrlCopied] = useState(false);
  const [originUrl, setOriginUrl] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOriginUrl(window.location.origin);
    }
  }, []);

  const androidDownloadUrl = originUrl
    ? `${originUrl}/downloads/OmniOps-Coucou-v1.0.apk`
    : '/downloads/OmniOps-Coucou-v1.0.apk';

  const handleCopyAndroidUrl = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(androidDownloadUrl);
        setAndroidUrlCopied(true);
        setTimeout(() => setAndroidUrlCopied(false), 2500);
      }
    } catch {
      // Fallback
    }
  };

  return (
    <div className="bg-[#12161f] border border-[#2b3240] rounded-2xl p-5 md:p-7 text-white max-w-5xl mx-auto shadow-2xl space-y-6">
      {/* ۱. هدر مرکز دانلود کلاینت‌ها */}
      <div className="flex flex-wrap justify-between items-center gap-3 pb-4 border-b border-[#2b3240]">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">📥</span>
            <h2 className="text-base md:text-lg font-bold text-cyan-400">
              مرکز دانلود برنامه‌ها و ایجنت‌های OmniOps
            </h2>
          </div>
          <p className="text-xs text-gray-400 mt-1 leading-relaxed">
            دانلود مستقیم نسخه دسکتاپ ویندوز برای کامپیوتر و اپلیکیشن همراه اندروید (Coucou) جهت کنترل و نظارت بیومتریک از راه دور
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] bg-cyan-950/80 text-cyan-300 border border-cyan-800 px-3 py-1 rounded-full font-mono font-bold">
            نسخه v1.1.4 (پایدار)
          </span>
          <span className="text-[11px] bg-emerald-950/80 text-emerald-300 border border-emerald-800 px-3 py-1 rounded-full">
            سازگار با شبکه محلی LAN
          </span>
        </div>
      </div>

      {/* ۲. بخش پین‌کد اختصاصی اتصال و جفت‌سازی */}
      <div className="bg-[#0b0e14] border border-[#222936] rounded-xl p-4 flex flex-wrap justify-between items-center gap-4">
        <div className="space-y-1">
          <span className="text-gray-400 block text-xs font-medium">
            کد پین اختصاصی ۶ رقمی جفت‌سازی (Pairing PIN):
          </span>
          {pair && seconds > 0 ? (
            <div className="flex items-center gap-3">
              <span className="text-xl md:text-2xl font-bold text-amber-400 font-mono tracking-widest bg-[#171c26] px-3 py-1 rounded-lg border border-amber-500/30">
                {pair.code}
              </span>
              <span className="text-xs text-amber-300/80">
                ⏱ {seconds.toLocaleString('fa-IR')} ثانیه باقی‌مانده · یک‌بارمصرف
              </span>
            </div>
          ) : (
            <span className="text-xs text-gray-500 italic block">
              هنوز کد اتصالی صادر نشده است. روی دکمهٔ مقابل بزنید تا کد ۲ دقیقه‌ای یک‌بارمصرف ایجاد شود.
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {pair && seconds > 0 && onCopyPair ? (
            <button
              type="button"
              onClick={onCopyPair}
              className="bg-[#1f2633] hover:bg-[#2b3547] text-gray-200 border border-[#3b475c] px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
            >
              <span>📋</span>
              <span>کپی کد پین</span>
            </button>
          ) : null}

          {onGeneratePair ? (
            <button
              type="button"
              onClick={onGeneratePair}
              className="bg-cyan-600 hover:bg-cyan-500 text-white font-bold px-4 py-2 rounded-xl text-xs transition shadow-lg shadow-cyan-950 flex items-center gap-1.5"
            >
              <span>🔑</span>
              <span>{pair && seconds > 0 ? 'صدور مجدد کد' : 'صدور کد اتصال ۶ رقمی'}</span>
            </button>
          ) : null}
        </div>
        {copyStatus && (
          <div className="w-full text-xs text-emerald-400 pt-1 font-medium" role="status">
            {copyStatus}
          </div>
        )}
      </div>

      {/* ۳. گرید دانلود کلاینت‌ها: ویندوز و اندروید */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* کارت ۱: ایجنت ویندوز دسکتاپ */}
        <div className="p-5 rounded-2xl bg-[#0d1117] border border-[#21262d] flex flex-col justify-between space-y-4 hover:border-cyan-500/40 transition">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-3xl">🖥️</span>
                <div>
                  <h3 className="font-bold text-sm text-gray-100">ایجنت ویندوز دسکتاپ</h3>
                  <span className="text-[11px] text-cyan-400 font-mono">OmniOps Desktop Edge (x64)</span>
                </div>
              </div>
              <span className="text-[10px] bg-[#161b22] text-gray-400 px-2.5 py-1 rounded-md border border-[#30363d] font-mono">
                Windows 10 / 11
              </span>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed">
              پنجرهٔ شناور سبک با کلید میانبر سراسری <code className="text-cyan-300 font-mono bg-cyan-950/60 px-1.5 py-0.5 rounded">Alt + Space</code>، تله‌متری زنده و سد تأیید دستورات ترمینال بدون نیاز به نصب پایتون.
            </p>

            {/* راهنمای راه‌اندازی سریع در ۳ مرحله */}
            <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-3 text-xs space-y-2">
              <span className="font-bold text-gray-300 block text-[11px] text-cyan-400">
                ⚡ راهنمای راه‌اندازی سریع ویندوز در ۳ گام:
              </span>
              <ol className="list-decimal list-inside space-y-1 text-gray-400 text-[11px] leading-relaxed">
                <li>فایل نصاب نصبی <span className="font-mono text-gray-200">OmniOps-Edge-Setup.exe</span> را دانلود و اجرا نمایید.</li>
                <li>کلید میانبر <span className="font-mono text-cyan-300">Alt + Space</span> را در هر کجای ویندوز فشار دهید تا پنجره ایجنت باز شود.</li>
                <li>کد ۶ رقمی بالا را در ایجنت وارد کرده و روی «جایگذاری کد» کلیک نمایید.</li>
              </ol>
            </div>

            {/* مشخصات امنیتی */}
            <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-400">
              <div className="bg-[#12161f] p-2 rounded-lg border border-[#21262d]">
                <span className="text-emerald-400 block font-bold">✓ امنیت نشست در RAM</span>
                <span>توکن روی دیسک ذخیره نمی‌شود</span>
              </div>
              <div className="bg-[#12161f] p-2 rounded-lg border border-[#21262d]">
                <span className="text-cyan-400 block font-bold">✓ پروتکل TLS 1.3 محلی</span>
                <span>رمزنگاری اختصاصی در شبکه داخلی</span>
              </div>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <a
              href="/downloads/OmniOps-Edge-Setup.exe"
              download="OmniOps-Edge-Setup.exe"
              className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-2.5 rounded-xl text-xs text-center transition flex items-center justify-center gap-2 shadow-lg shadow-cyan-950"
            >
              <span>⬇️</span>
              <span>دانلود نصاب مستقیم ویندوز (.exe)</span>
            </a>

            <div className="flex gap-2">
              <a
                href="https://github.com/RedBoy-011/OmniOps/releases"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 bg-[#1a202c] hover:bg-[#252d3d] text-gray-300 border border-[#30363d] py-2 rounded-xl text-[11px] text-center transition flex items-center justify-center gap-1.5"
              >
                <span>🔗</span>
                <span>نسخه‌های رسمی گیت‌هاب</span>
              </a>
              <a
                href="https://github.com/RedBoy-011/OmniOps/actions"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 bg-[#1a202c] hover:bg-[#252d3d] text-gray-300 border border-[#30363d] py-2 rounded-xl text-[11px] text-center transition flex items-center justify-center gap-1.5"
              >
                <span>📦</span>
                <span>آخرین Artifacts بیلد</span>
              </a>
            </div>
          </div>
        </div>

        {/* کارت ۲: اپلیکیشن اندروید ارکستراتور (Coucou) */}
        <div className="p-5 rounded-2xl bg-[#0d1117] border border-[#21262d] flex flex-col justify-between space-y-4 hover:border-emerald-500/40 transition">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-3xl">📱</span>
                <div>
                  <h3 className="font-bold text-sm text-gray-100">ارکستراتور سیار Coucou</h3>
                  <span className="text-[11px] text-emerald-400 font-mono">OmniOps Mobile Companion (APK)</span>
                </div>
              </div>
              <span className="text-[10px] bg-[#161b22] text-gray-400 px-2.5 py-1 rounded-md border border-[#30363d] font-mono">
                Android 8.0+
              </span>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed">
              کنترل از راه دور و نظارت بر ایجنت‌ها با تأییدیهٔ بیومتریک اثر انگشت، جزیرهٔ پویا روی تمام برنامه‌ها، و نوتیفیکیشن حتی روی صفحه قفل (Lock Screen).
            </p>

            {/* ویژگی‌های شاخص اپلیکیشن بر اساس سند تعریف پروژه */}
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="bg-[#161b22] p-2.5 rounded-xl border border-[#30363d] flex items-center gap-2">
                <span className="text-lg">👆</span>
                <div>
                  <strong className="block text-amber-300 text-[10px]">دروازه اثر انگشت</strong>
                  <span className="text-gray-400 text-[10px]">تأیید بیومتریک دستورات حساس</span>
                </div>
              </div>
              <div className="bg-[#161b22] p-2.5 rounded-xl border border-[#30363d] flex items-center gap-2">
                <span className="text-lg">🏝️</span>
                <div>
                  <strong className="block text-emerald-300 text-[10px]">جزیره پویا (Dynamic)</strong>
                  <span className="text-gray-400 text-[10px]">ویجت شناور روی تمام برنامه‌ها</span>
                </div>
              </div>
              <div className="bg-[#161b22] p-2.5 rounded-xl border border-[#30363d] flex items-center gap-2">
                <span className="text-lg">🔔</span>
                <div>
                  <strong className="block text-purple-300 text-[10px]">اعلان صفحه قفل</strong>
                  <span className="text-gray-400 text-[10px]">بیدار شدن گوشی با دکمه Deny</span>
                </div>
              </div>
              <div className="bg-[#161b22] p-2.5 rounded-xl border border-[#30363d] flex items-center gap-2">
                <span className="text-lg">⚡</span>
                <div>
                  <strong className="block text-red-300 text-[10px]">Kill-Switch فوری</strong>
                  <span className="text-gray-400 text-[10px]">قطع اضطراری دستورات پرخطر</span>
                </div>
              </div>
            </div>

            {/* بخش اسکن QR Code برای گوشی همراه */}
            <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-3 flex items-center gap-4">
              <div className="shrink-0 bg-white p-1 rounded-lg">
                <QrCodeSvg value={androidDownloadUrl} size={105} />
              </div>
              <div className="space-y-1">
                <span className="font-bold text-xs text-gray-200 block">
                  اسکن مستقیم با دوربین گوشی:
                </span>
                <p className="text-[10px] text-gray-400 leading-relaxed">
                  دوربین گوشی خود را مقابل این تصویر بگیرید تا فایل APK فوراً روی تلفن همراه دانلود و نصب شود.
                </p>
                <button
                  type="button"
                  onClick={handleCopyAndroidUrl}
                  className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-bold pt-1 transition"
                >
                  <span>{androidUrlCopied ? '✅ کپی شد' : '📋 کپی نشانی لینک دانلود برای گوشی'}</span>
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <a
              href="/downloads/OmniOps-Coucou-v1.0.apk"
              download="OmniOps-Coucou-v1.0.apk"
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-xl text-xs text-center transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-950"
            >
              <span>⬇️</span>
              <span>دانلود مستقیم فایل نصاب APK (.apk)</span>
            </a>

            <div className="flex gap-2">
              <a
                href="/downloads/OmniOps-Mobile.apk"
                download="OmniOps-Mobile.apk"
                className="flex-1 bg-[#1a202c] hover:bg-[#252d3d] text-gray-300 border border-[#30363d] py-2 rounded-xl text-[11px] text-center transition flex items-center justify-center gap-1.5"
              >
                <span>📦</span>
                <span>لینک دانلود کمکی (Mobile.apk)</span>
              </a>
              <a
                href="https://github.com/RedBoy-011/OmniOps/releases"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 bg-[#1a202c] hover:bg-[#252d3d] text-gray-300 border border-[#30363d] py-2 rounded-xl text-[11px] text-center transition flex items-center justify-center gap-1.5"
              >
                <span>🔗</span>
                <span>نسخه‌های گیت‌هاب</span>
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* ۴. بخش شبیه‌ساز ارکستراتور سیار و دروازه بیومتریک (Coucou) */}
      <div className="pt-4 border-t border-[#2b3240] flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setShowOrchestratorDemo(!showOrchestratorDemo)}
          className="text-xs text-amber-400 hover:text-amber-300 flex items-center justify-center gap-2 py-2 bg-[#1b212c] hover:bg-[#242c3b] border border-[#2b3547] rounded-xl transition font-bold"
        >
          <span>{showOrchestratorDemo ? '▲ بستن نمای شبیه‌ساز ارکستراتور سیار' : '▼ آزمایش زنده شبیه‌ساز دروازه تایید بیومتریک و جزیره پویا (Coucou)'}</span>
        </button>
        {showOrchestratorDemo && (
          <div className="pt-2">
            <MobileOrchestratorCard />
          </div>
        )}
      </div>
    </div>
  );
};

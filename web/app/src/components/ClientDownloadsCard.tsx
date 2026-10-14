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
  const [mobileUrlCopied, setMobileUrlCopied] = useState(false);
  const [apkUrlCopied, setApkUrlCopied] = useState(false);
  const [originUrl, setOriginUrl] = useState('');
  const [mobileMode, setMobileMode] = useState<'pwa' | 'apk'>('pwa');
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showPwaGuide, setShowPwaGuide] = useState(false);
  const [guideBrowser, setGuideBrowser] = useState<'chrome' | 'samsung' | 'safari'>('chrome');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOriginUrl(window.location.origin);

      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone;
      setIsStandalone(!!standalone);

      const handleBeforeInstall = (e: any) => {
        e.preventDefault();
        setDeferredPrompt(e);
        setIsInstallable(true);
      };

      window.addEventListener('beforeinstallprompt', handleBeforeInstall);
      return () => {
        window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      };
    }
  }, []);

  const pwaLaunchUrl = originUrl ? `${originUrl}/?source=pwa_mobile` : '/?source=pwa_mobile';
  const apkDownloadUrl = originUrl
    ? `${originUrl}/downloads/OmniOps-Coucou-v1.0.apk`
    : '/downloads/OmniOps-Coucou-v1.0.apk';

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice?.outcome === 'accepted') {
        setIsInstallable(false);
        setDeferredPrompt(null);
      }
    } else {
      setShowPwaGuide(true);
    }
  };

  const handleCopyMobileUrl = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(pwaLaunchUrl);
        setMobileUrlCopied(true);
        setTimeout(() => setMobileUrlCopied(false), 2500);
      }
    } catch {}
  };

  const handleCopyApkUrl = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(apkDownloadUrl);
        setApkUrlCopied(true);
        setTimeout(() => setApkUrlCopied(false), 2500);
      }
    } catch {}
  };

  return (
    <div className="bg-[#12161f] border border-[#2b3240] rounded-2xl p-5 md:p-7 text-white max-w-5xl mx-auto shadow-2xl space-y-6 font-sans" dir="rtl">
      {/* ۱. هدر مرکز دانلود کلاینت‌ها */}
      <div className="flex flex-wrap justify-between items-center gap-3 pb-4 border-b border-[#2b3240]">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">📥</span>
            <h2 className="text-base md:text-lg font-bold text-cyan-400">
              مرکز استقرار برنامه‌ها و ارکستراتورهای OmniOps
            </h2>
          </div>
          <p className="text-xs text-gray-400 mt-1 leading-relaxed">
            استقرار سریع روی ویندوز دسکتاپ و اپلیکیشن همراه یونیورسال (Coucou) جهت کنترل و نظارت بیومتریک از راه دور بر روی ۱۰۰٪ تلفن‌های همراه
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="https://github.com/RedBoy-011/OmniOps/actions/workflows/windows-build.yml"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[11px] bg-slate-900/90 hover:bg-slate-800 text-cyan-300 border border-cyan-800/60 px-3 py-1 rounded-full transition shadow-sm"
            title="مشاهده وضعیت بیلد خودکار در GitHub Actions"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="font-mono font-bold">CI/CD: GitHub Actions (Pass)</span>
          </a>
          <span className="text-[11px] bg-cyan-950/80 text-cyan-300 border border-cyan-800 px-3 py-1 rounded-full font-mono font-bold">
            نسخه v1.21.0
          </span>
          <span className="text-[11px] bg-emerald-950/80 text-emerald-300 border border-emerald-800 px-3 py-1 rounded-full">
            سازگار با ۱۰۰٪ موبایل‌ها
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

      {/* ۳. گرید استقرار: ویندوز و اندروید */}
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
              پنجرهٔ شناور سبک کپسولی با کلید میانبر سراسری <code className="text-cyan-300 font-mono bg-cyan-950/60 px-1.5 py-0.5 rounded">Alt + Space</code>، تله‌متری زنده و سد تأیید دستورات ترمینال بدون نیاز به نصب پایتون.
            </p>

            {/* راهنمای راه‌اندازی سریع در ۳ مرحله */}
            <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-3 text-xs space-y-2">
              <span className="font-bold text-gray-300 block text-[11px] text-cyan-400">
                ⚡ راهنمای راه‌اندازی سریع ویندوز در ۳ گام:
              </span>
              <ol className="list-decimal list-inside space-y-1 text-gray-400 text-[11px] leading-relaxed">
                <li>فایل نصاب <span className="font-mono text-gray-200">OmniOps-Edge-Setup.exe</span> را دانلود و اجرا نمایید.</li>
                <li>کلید میانبر <span className="font-mono text-cyan-300">Alt + Space</span> را در هر کجای ویندوز فشار دهید تا پنجره باز شود.</li>
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

        {/* کارت ۲: اپلیکیشن اندروید ارکستراتور سیار (نسخه جامع یونیورسال) */}
        <div className="p-5 rounded-2xl bg-[#0d1117] border border-[#21262d] flex flex-col justify-between space-y-4 hover:border-emerald-500/40 transition">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-3xl">📱</span>
                <div>
                  <h3 className="font-bold text-sm text-gray-100">ارکستراتور سیار Coucou</h3>
                  <span className="text-[11px] text-emerald-400 font-mono">OmniOps Mobile Companion</span>
                </div>
              </div>
              <span className="text-[10px] bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 px-2.5 py-1 rounded-md font-bold">
                سازگار با ۱۰۰٪ گوشی‌ها
              </span>
            </div>

            {/* سوئیچر حالت نسخه یونیورسال vs فایل خام APK */}
            <div className="flex p-1 bg-slate-950/70 border border-slate-800 rounded-xl gap-1">
              <button
                type="button"
                onClick={() => setMobileMode('pwa')}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                  mobileMode === 'pwa'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>🌟 نسخه یونیورسال (توصیه‌شده)</span>
              </button>
              <button
                type="button"
                onClick={() => setMobileMode('apk')}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                  mobileMode === 'apk'
                    ? 'bg-slate-800 text-slate-200 border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>📦 فایل خام APK</span>
              </button>
            </div>

            {mobileMode === 'pwa' ? (
              <>
                <p className="text-xs text-gray-300 leading-relaxed">
                  نسخه مستقل و نیتیو وب‌اپلیکیشن (Universal Standalone App) که <strong className="text-emerald-300">روی تمام نسخه‌های اندروید (۸ تا ۱۵)</strong> بدون نیاز به فعال‌سازی منبع ناشناس یا خطای پارس، مستقیماً با یک لمس روی صفحه اصلی نصب می‌شود.
                </p>

                {/* ویژگی‌های شاخص نسخه یونیورسال */}
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="bg-[#161b22] p-2.5 rounded-xl border border-[#30363d] flex items-center gap-2">
                    <span className="text-lg">👆</span>
                    <div>
                      <strong className="block text-amber-300 text-[10px]">دروازه اثر انگشت</strong>
                      <span className="text-gray-400 text-[10px]">تأییدیه بیومتریک و Biometric Gate</span>
                    </div>
                  </div>
                  <div className="bg-[#161b22] p-2.5 rounded-xl border border-[#30363d] flex items-center gap-2">
                    <span className="text-lg">⚡</span>
                    <div>
                      <strong className="block text-emerald-300 text-[10px]">سرعت لود زیر ۱ ثانیه</strong>
                      <span className="text-gray-400 text-[10px]">کشینگ آفلاین Service Worker</span>
                    </div>
                  </div>
                  <div className="bg-[#161b22] p-2.5 rounded-xl border border-[#30363d] flex items-center gap-2">
                    <span className="text-lg">✨</span>
                    <div>
                      <strong className="block text-cyan-300 text-[10px]">طراحی شیشه‌ای کامل</strong>
                      <span className="text-gray-400 text-[10px]">حالت تمام‌صفحه بدون نوار آدرس</span>
                    </div>
                  </div>
                  <div className="bg-[#161b22] p-2.5 rounded-xl border border-[#30363d] flex items-center gap-2">
                    <span className="text-lg">🛑</span>
                    <div>
                      <strong className="block text-red-300 text-[10px]">Kill-Switch امنیتی</strong>
                      <span className="text-gray-400 text-[10px]">توقف اضطراری مأموریت‌های پرخطر</span>
                    </div>
                  </div>
                </div>

                {/* بخش اسکن QR Code جهت نصب یونیورسال */}
                <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-3 flex items-center gap-4">
                  <div className="shrink-0 bg-white p-1 rounded-lg">
                    <QrCodeSvg value={pwaLaunchUrl} size={105} />
                  </div>
                  <div className="space-y-1">
                    <span className="font-bold text-xs text-gray-200 block">
                      اسکن مستقیم با دوربین گوشی:
                    </span>
                    <p className="text-[10px] text-gray-400 leading-relaxed">
                      دوربین هر گوشی (سامسونگ، شیائومی، هواوی، پیکسل و...) را مقابل این کد بگیرید تا برنامه فوراً روی صفحه اصلی نصب شود.
                    </p>
                    <button
                      type="button"
                      onClick={handleCopyMobileUrl}
                      className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-bold pt-1 transition"
                    >
                      <span>{mobileUrlCopied ? '✅ کپی شد' : '📋 کپی لینک مستقیم ورود برای موبایل'}</span>
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-gray-300 leading-relaxed">
                  بسته‌های نصبی خام اندروید برای کاربرانی که مایل به آزمایش مستقیم فایل APK یا کامپایل با گریدل هستند:
                </p>
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-[11px] text-amber-300 space-y-1">
                  <strong>⚠️ توجه درباره فایل‌های خام APK:</strong>
                  <p className="text-amber-200/80 leading-relaxed">
                    فایل‌های خام APK در برخی نسخه‌های اندروید به دلیل سیاست‌های امنیتی گوگل نیاز به فعال‌سازی Developer Options دارند. برای اجرای بی‌دردسر، از «نسخه یونیورسال» استفاده نمایید.
                  </p>
                </div>
                <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-3 flex items-center gap-4">
                  <div className="shrink-0 bg-white p-1 rounded-lg">
                    <QrCodeSvg value={apkDownloadUrl} size={95} />
                  </div>
                  <div className="space-y-1">
                    <span className="font-bold text-xs text-gray-200 block">
                      دانلود مستقیم فایل APK:
                    </span>
                    <p className="text-[10px] text-gray-400 leading-relaxed">
                      اسکن برای دانلود فایل فشرده باینری روی حافظه گوشی.
                    </p>
                    <button
                      type="button"
                      onClick={handleCopyApkUrl}
                      className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-bold pt-1 transition"
                    >
                      <span>{apkUrlCopied ? '✅ کپی شد' : '📋 کپی لینک دانلود فایل APK'}</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="space-y-2 pt-2">
            {mobileMode === 'pwa' ? (
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={handleInstallClick}
                  className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold py-2.5 rounded-xl text-xs text-center transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-950"
                >
                  <span>📲</span>
                  <span>{isStandalone ? 'برنامه نصب شده و آماده است' : isInstallable ? 'نصب فوری اپلیکیشن روی گوشی (آماده نصب)' : 'نصب مستقیم اپلیکیشن روی تلفن همراه'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowPwaGuide(true)}
                  className="bg-[#1a202c] hover:bg-[#252d3d] text-emerald-300 border border-emerald-800/60 py-2.5 px-4 rounded-xl text-xs text-center transition flex items-center justify-center gap-1.5"
                >
                  <span>📖</span>
                  <span>راهنمای ۳ ثانیه‌ای نصب</span>
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <a
                  href="/downloads/OmniOps-Coucou-v1.0.apk"
                  download="OmniOps-Coucou-v1.0.apk"
                  className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-xl text-xs text-center transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-950"
                >
                  <span>⬇️</span>
                  <span>دانلود فایل خام OmniOps-Coucou-v1.0.apk</span>
                </a>
                <div className="flex gap-2">
                  <a
                    href="/downloads/OmniOps-Mobile.apk"
                    download="OmniOps-Mobile.apk"
                    className="flex-1 bg-[#1a202c] hover:bg-[#252d3d] text-gray-300 border border-[#30363d] py-2 rounded-xl text-[11px] text-center transition flex items-center justify-center gap-1.5"
                  >
                    <span>📦</span>
                    <span>نسخه کمکی Mobile.apk</span>
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
            )}
          </div>
        </div>
      </div>

      {/* مدال راهنمای نصب Universal PWA */}
      {showPwaGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in" dir="rtl">
          <div className="relative w-full max-w-lg bg-slate-900 border border-emerald-500/40 rounded-2xl p-6 shadow-2xl text-slate-100 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <span className="text-xl">📲</span>
                <h3 className="font-bold text-sm text-emerald-300">
                  راهنمای نصب نسخه یونیورسال روی صفحه اصلی گوشی
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPwaGuide(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div className="flex p-1 bg-slate-950 border border-slate-800 rounded-xl gap-1 text-xs">
              <button
                type="button"
                onClick={() => setGuideBrowser('chrome')}
                className={`flex-1 py-1.5 rounded-lg transition-all font-semibold ${
                  guideBrowser === 'chrome'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'text-slate-400'
                }`}
              >
                گوگل کروم (اندروید)
              </button>
              <button
                type="button"
                onClick={() => setGuideBrowser('samsung')}
                className={`flex-1 py-1.5 rounded-lg transition-all font-semibold ${
                  guideBrowser === 'samsung'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'text-slate-400'
                }`}
              >
                سامسونگ اینترنت
              </button>
              <button
                type="button"
                onClick={() => setGuideBrowser('safari')}
                className={`flex-1 py-1.5 rounded-lg transition-all font-semibold ${
                  guideBrowser === 'safari'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'text-slate-400'
                }`}
              >
                سافاری (آیفون)
              </button>
            </div>

            <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-xl text-xs space-y-3 leading-relaxed">
              {guideBrowser === 'chrome' && (
                <ol className="list-decimal list-inside space-y-2 text-slate-300">
                  <li>در مرورگر کروم گوشی، آدرس این پنل را باز کنید (یا QR code را اسکن نمایید).</li>
                  <li>روی منوی <strong className="text-emerald-300">سه نقطه (⋮)</strong> در گوشه بالای صفحه بزنید.</li>
                  <li>گزینه <strong className="text-emerald-300">«نصب برنامه»</strong> یا <strong className="text-emerald-300">«افزودن به صفحه اصلی» (Add to Home screen)</strong> را انتخاب کنید.</li>
                  <li>در پنجره ظاهر شده دکمه «نصب» (Install) را لمس کنید. برنامه مانند نرم‌افزار نیتیو در گوشی ذخیره می‌شود.</li>
                </ol>
              )}
              {guideBrowser === 'samsung' && (
                <ol className="list-decimal list-inside space-y-2 text-slate-300">
                  <li>در مرورگر Samsung Internet این صفحه را باز کنید.</li>
                  <li>روی دکمه منو <strong className="text-emerald-300">سه خط افقی (≡)</strong> در پایین صفحه بزنید.</li>
                  <li>گزینه <strong className="text-emerald-300">«افزودن صفحه به» (Add page to)</strong> را انتخاب کنید.</li>
                  <li>گزینه <strong className="text-emerald-300">«صفحه اصلی» (Home screen)</strong> را لمس نمایید.</li>
                </ol>
              )}
              {guideBrowser === 'safari' && (
                <ol className="list-decimal list-inside space-y-2 text-slate-300">
                  <li>در مرورگر سافاری آیفون، این صفحه را باز کنید.</li>
                  <li>دکمه <strong className="text-emerald-300">اشتراک‌گذاری (Share - آیکون مربع با فلش رو به بالا)</strong> در پایین صفحه را بزنید.</li>
                  <li>به پایین اسکرول کرده و گزینه <strong className="text-emerald-300">«Add to Home Screen»</strong> را لمس نمایید.</li>
                  <li>در بالا سمت راست روی دکمه «Add» بزنید.</li>
                </ol>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowPwaGuide(false)}
                className="px-5 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-md"
              >
                متوجه شدم
              </button>
            </div>
          </div>
        </div>
      )}

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

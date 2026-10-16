import React, { useEffect, useState } from 'react';
import { MobileOrchestratorCard } from './MobileOrchestratorCard';
import { QrCodeSvg } from './qrcode';
import { api, type CoreDownloadFile, type DownloadsInfoResponse } from '../api';

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
  const [apkUrlCopied, setApkUrlCopied] = useState(false);
  const [originUrl, setOriginUrl] = useState('');
  const [downloadsInfo, setDownloadsInfo] = useState<DownloadsInfoResponse | null>(null);
  const [copiedChecksum, setCopiedChecksum] = useState<string | null>(null);

  useEffect(() => {
    void api.downloadsInfo().then(setDownloadsInfo).catch(() => {});
  }, []);

  const handleCopyChecksum = async (sha256: string, id: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(sha256);
        setCopiedChecksum(id);
        setTimeout(() => setCopiedChecksum(null), 2500);
      }
    } catch {}
  };

  const getFile = (filename: string): CoreDownloadFile | undefined => {
    return downloadsInfo?.files.find(f => f.filename.toLowerCase() === filename.toLowerCase());
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOriginUrl(window.location.origin);
    }
  }, []);

  const apkFile = getFile('OmniOps-Mobile.apk');
  const edgeFile = getFile('OmniOps-Edge-Setup.exe') || getFile('omniops-agent-setup.exe');

  const apkCacheBust = apkFile?.sha256 ? `?v=${apkFile.sha256.slice(0, 8)}` : '';
  const edgeCacheBust = edgeFile?.sha256 ? `?v=${edgeFile.sha256.slice(0, 8)}` : '';

  const apkDownloadUrl = originUrl
    ? `${originUrl}/downloads/OmniOps-Mobile.apk${apkCacheBust}`
    : `/downloads/OmniOps-Mobile.apk${apkCacheBust}`;

  const edgeDownloadUrl = originUrl
    ? `${originUrl}/downloads/OmniOps-Edge-Setup.exe${edgeCacheBust}`
    : `/downloads/OmniOps-Edge-Setup.exe${edgeCacheBust}`;

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
            استقرار مستقیم ایجنت تمام‌عیار ویندوز (مرکز اصلی اجرا) و اپلیکیشن همراه اندروید (کنترل و هدایت از راه دور با PIN)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="https://github.com/RedBoy-011/OmniOps/actions/workflows/windows-build.yml"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[11px] bg-slate-900/90 hover:bg-slate-800 text-cyan-300 border border-cyan-800/60 px-3 py-1 rounded-full transition shadow-sm"
          >
            <span>⚡ بیلد ویندوز (GitHub Actions)</span>
          </a>
          <a
            href="https://github.com/RedBoy-011/OmniOps/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[11px] bg-slate-900/90 hover:bg-slate-800 text-emerald-300 border border-emerald-800/60 px-3 py-1 rounded-full transition shadow-sm"
          >
            <span>📦 انتشارها (Releases)</span>
          </a>
        </div>
      </div>

      {/* ۲. کد پین موقت اتصال دوطرفه (Direct Pairing Gateway) */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-[#171e29] to-[#131922] border border-[#2d3748] flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="space-y-1 text-center md:text-right">
          <div className="flex items-center justify-center md:justify-start gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span>
            <span className="font-bold text-sm text-gray-200">کد موقت اتصال ایجنت ویندوز و اپلیکیشن اندروید (Pairing PIN)</span>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed max-w-xl">
            برای اتصال ایمن و احراز هویت ایجنت ویندوز یا اپلیکیشن اندروید، این کد یک‌بارمصرف ۶ رقمی را درون کلاینت وارد کنید. توکن اختصاصی در RAM مستقر شده و روی دیسک ذخیره نمی‌شود.
          </p>
        </div>

        <div className="flex flex-col items-center gap-2">
          {pair ? (
            <div className="flex flex-col items-center gap-1">
              <div className="flex items-center gap-2 bg-[#0b0e14] border border-[#3b4556] px-4 py-2 rounded-xl">
                <span className="font-mono text-2xl font-bold tracking-widest text-emerald-400 select-all">
                  {pair.code}
                </span>
                <button
                  type="button"
                  onClick={onCopyPair}
                  className="text-xs bg-[#222b3a] hover:bg-[#2d374a] text-cyan-300 px-2.5 py-1.5 rounded-lg transition font-medium"
                >
                  {copyStatus || 'کپی'}
                </button>
                <button
                  type="button"
                  onClick={onGeneratePair}
                  className="text-xs bg-[#1e293b] hover:bg-[#334155] text-amber-300 border border-amber-500/40 px-2.5 py-1.5 rounded-lg transition font-medium flex items-center gap-1"
                  title="دریافت فوری کد جدید و ابطال کد فعلی بدون نیاز به صبر کردن"
                >
                  <span>🔄</span>
                  <span>کد جدید</span>
                </button>
              </div>
              <span className="text-[11px] text-gray-400">
                اعتبار تا: <strong className="text-amber-400 font-mono">{seconds}</strong> ثانیه دیگر · امکان دریافت کد جدید در هر لحظه
              </span>
            </div>
          ) : (
            <button
              type="button"
              onClick={onGeneratePair}
              className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold px-5 py-2.5 rounded-xl text-xs transition shadow-lg shadow-cyan-950 flex items-center gap-2"
            >
              <span>🔑</span>
              <span>تولید کد موقت اتصال کلاینت‌ها</span>
            </button>
          )}
        </div>
      </div>

      {/* ۳. شبکه دانلود کلاینت‌ها (۲ ستونه: ویندوز و اندروید) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* کارت ۱: ایجنت قدرتمند ویندوز */}
        <div className="p-5 rounded-2xl bg-[#0d1117] border border-[#21262d] flex flex-col justify-between space-y-4 hover:border-cyan-500/40 transition">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-3xl">🖥️</span>
                <div>
                  <h3 className="font-bold text-sm text-gray-100">ایجنت ویندوز (مرکز اجرای پروژه‌ها)</h3>
                  <span className="text-[11px] text-cyan-400 font-mono">OmniOps Windows Native Agent</span>
                </div>
              </div>
              <span className="text-[10px] bg-cyan-950/80 text-cyan-300 border border-cyan-800/80 px-2.5 py-1 rounded-md font-bold">
                نسخه رسمی نصاب x64
              </span>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed">
              مرکز اجرای اصلی وظایف و کارهای لوکال. کلاینت بومی ویندوز که با کلید میانبر <strong className="text-cyan-300">Alt + Space</strong> فراخوانی می‌شود و دارای قابلیت اجرای دستورات شل، مرورگر امن، ترمینال و مدیریت تسک‌هاست.
            </p>

            {/* راهنمای ۳ مرحله‌ای */}
            <div className="bg-[#161b22] p-3 rounded-xl border border-[#30363d] space-y-1.5">
              <span className="text-xs font-bold text-gray-200 block">
                مراحل اتصال ۳۰ ثانیه‌ای:
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
            {(() => {
              const edgeFile = getFile('OmniOps-Edge-Setup.exe') || getFile('omniops-agent-setup.exe');
              return (
                <>
                  <div className="flex items-center justify-between text-[11px] pb-1">
                    <span className="text-cyan-400 font-bold flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${edgeFile?.available_locally ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
                      {edgeFile?.available_locally ? '🟢 موجود در هسته سرور (دانلود مستقیم)' : '🟡 هدایت به گیت‌هاب (Fallback)'}
                    </span>
                    <span className="text-gray-400 font-mono text-[10px]">
                      نسخه: {edgeFile?.version || downloadsInfo?.version || 'v1.25.0'} {edgeFile?.size_formatted ? `· ${edgeFile.size_formatted}` : ''}
                    </span>
                  </div>

                  {edgeFile?.sha256 && (
                    <div className="bg-[#12161f] border border-[#2b3547] rounded-xl p-2.5 text-[11px] space-y-1">
                      <div className="flex items-center justify-between text-gray-400">
                        <span className="font-mono text-cyan-400 font-bold">SHA-256 Checksum:</span>
                        <button
                          type="button"
                          onClick={() => handleCopyChecksum(edgeFile.sha256, 'edge')}
                          className="text-cyan-300 hover:text-cyan-200 transition text-[10px] flex items-center gap-1 cursor-pointer"
                        >
                          <span>{copiedChecksum === 'edge' ? '✅ کپی شد' : '📋 کپی Checksum'}</span>
                        </button>
                      </div>
                      <div className="font-mono text-[10px] text-cyan-200/90 truncate bg-black/50 p-1.5 rounded select-all" dir="ltr">
                        {edgeFile.sha256}
                      </div>
                    </div>
                  )}

                  <a
                    href={edgeDownloadUrl}
                    download="OmniOps-Edge-Setup.exe"
                    target="_self"
                    className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-2.5 rounded-xl text-xs text-center transition flex items-center justify-center gap-2 shadow-lg shadow-cyan-950"
                  >
                    <span>⬇️</span>
                    <span>دانلود مستقیم نصاب ویندوز از سرور محلی ({edgeFile?.size_formatted || '3.3 MB'})</span>
                  </a>

                  <div className="flex gap-2">
                    <a
                      href="https://github.com/RedBoy-011/OmniOps/releases/latest/download/OmniOps-Edge-Setup.exe"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 bg-[#1a202c] hover:bg-[#252d3d] text-gray-300 border border-[#30363d] py-2 rounded-xl text-[11px] text-center transition flex items-center justify-center gap-1.5"
                      title="دانلود پشتیبان از مخزن گیت‌هاب در صورت در دسترس نبودن فایل محلی"
                    >
                      <span>🔗</span>
                      <span>دانلود پشتیبان از گیت‌هاب (Fallback)</span>
                    </a>
                    <a
                      href="https://github.com/RedBoy-011/OmniOps/releases"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-[#1a202c] hover:bg-[#252d3d] text-gray-400 border border-[#30363d] px-3 py-2 rounded-xl text-[11px] text-center transition flex items-center justify-center gap-1"
                      title="مشاهده تمام نسخه‌های منتشر شده"
                    >
                      <span>📦</span>
                      <span>Releases</span>
                    </a>
                  </div>
                </>
              );
            })()}
          </div>
        </div>

        {/* کارت ۲: اپلیکیشن بومی اندروید (APK اختصاصی - کاملاً نیتیو بدون PWA) */}
        <div className="p-5 rounded-2xl bg-[#0d1117] border border-[#21262d] flex flex-col justify-between space-y-4 hover:border-emerald-500/40 transition">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-3xl">📱</span>
                <div>
                  <h3 className="font-bold text-sm text-gray-100">اپلیکیشن اندروید (کنترلر و ارکستراتور همراه)</h3>
                  <span className="text-[11px] text-emerald-400 font-mono">OmniOps Android Native Companion</span>
                </div>
              </div>
              <span className="text-[10px] bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 px-2.5 py-1 rounded-md font-bold">
                پکیج رسمی نصاب APK
              </span>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed">
              اپلیکیشن نیتیو اندروید به عنوان کنترل‌کننده از راه دور ایجنت ویندوز عمل می‌کند. فقط در صورت آنلاین بودن ایجنت ویندوز، فرآیندها و مأموریت‌ها در گوشی نمایش یافته و امکان هدایت یا توقف اضطراری (Kill-Switch) فراهم است.
            </p>

            {/* ویژگی‌های کلیدی اپ اندروید */}
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="bg-[#161b22] p-2.5 rounded-xl border border-[#30363d] flex items-center gap-2">
                <span className="text-lg">🔐</span>
                <div>
                  <strong className="block text-emerald-300 text-[10px]">اتصال امن با PIN موقت</strong>
                  <span className="text-gray-400 text-[10px]">همگام‌سازی بدون نیاز به رمز دائمی</span>
                </div>
              </div>
              <div className="bg-[#161b22] p-2.5 rounded-xl border border-[#30363d] flex items-center gap-2">
                <span className="text-lg">⚡</span>
                <div>
                  <strong className="block text-cyan-300 text-[10px]">پایش وضعیت ایجنت</strong>
                  <span className="text-gray-400 text-[10px]">در دسترس / مشغول / غیرفعال</span>
                </div>
              </div>
              <div className="bg-[#161b22] p-2.5 rounded-xl border border-[#30363d] flex items-center gap-2">
                <span className="text-lg">🛑</span>
                <div>
                  <strong className="block text-red-300 text-[10px]">کلید Kill-Switch</strong>
                  <span className="text-gray-400 text-[10px]">توقف اضطراری مأموریت‌های حساس</span>
                </div>
              </div>
              <div className="bg-[#161b22] p-2.5 rounded-xl border border-[#30363d] flex items-center gap-2">
                <span className="text-lg">🚀</span>
                <div>
                  <strong className="block text-amber-300 text-[10px]">تایید دو‌مرحله‌ای فرآیندها</strong>
                  <span className="text-gray-400 text-[10px]">تاییدیه اجرای دستورات از راه دور</span>
                </div>
              </div>
            </div>

            {/* بخش اسکن QR Code برای دانلود مستقیم APK */}
            <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-3 flex items-center gap-4">
              <div className="shrink-0 bg-white p-1 rounded-lg">
                <QrCodeSvg value={apkDownloadUrl} size={95} />
              </div>
              <div className="space-y-1">
                <span className="font-bold text-xs text-gray-200 block">
                  دانلود مستقیم با دوربین گوشی:
                </span>
                <p className="text-[10px] text-gray-400 leading-relaxed">
                  دوربین گوشی را مقابل این بارکد بگیرید تا فایل نصاب APK مستقیماً در حافظه دستگاه شما ذخیره شود.
                </p>
                <button
                  type="button"
                  onClick={handleCopyApkUrl}
                  className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-bold pt-1 transition cursor-pointer"
                >
                  <span>{apkUrlCopied ? '✅ کپی شد' : '📋 کپی لینک مستقیم دانلود APK'}</span>
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            {(() => {
              const activeFile = getFile('OmniOps-Mobile.apk');
              return (
                <>
                  <div className="flex items-center justify-between text-[11px] pb-1">
                    <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${activeFile?.available_locally ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
                      {activeFile?.available_locally ? '🟢 موجود در هسته سرور (دانلود مستقیم محلی)' : '🟡 هدایت به گیت‌هاب (Fallback)'}
                    </span>
                    <span className="text-gray-400 font-mono text-[10px]">
                      نسخه: {activeFile?.version || downloadsInfo?.version || 'v1.25.0'} {activeFile?.size_formatted ? `· ${activeFile.size_formatted}` : ''}
                    </span>
                  </div>

                  {activeFile?.sha256 && (
                    <div className="bg-[#12161f] border border-[#2b3547] rounded-xl p-2.5 text-[11px] space-y-1">
                      <div className="flex items-center justify-between text-gray-400">
                        <span className="font-mono text-emerald-400 font-bold">SHA-256 Checksum:</span>
                        <button
                          type="button"
                          onClick={() => handleCopyChecksum(activeFile.sha256, 'apk')}
                          className="text-emerald-300 hover:text-emerald-200 transition text-[10px] flex items-center gap-1 cursor-pointer"
                        >
                          <span>{copiedChecksum === 'apk' ? '✅ کپی شد' : '📋 کپی Checksum'}</span>
                        </button>
                      </div>
                      <div className="font-mono text-[10px] text-emerald-200/90 truncate bg-black/50 p-1.5 rounded select-all" dir="ltr">
                        {activeFile.sha256}
                      </div>
                    </div>
                  )}

                  <a
                    href={apkDownloadUrl}
                    download="OmniOps-Mobile.apk"
                    target="_self"
                    className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2.5 rounded-xl text-xs text-center transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-950"
                  >
                    <span>⬇️</span>
                    <span>دانلود مستقیم فایل نصاب OmniOps-Mobile.apk از سرور محلی ({activeFile?.size_formatted || '5.9 MB'})</span>
                  </a>

                  <a
                    href="https://github.com/RedBoy-011/OmniOps/releases/latest/download/OmniOps-Mobile.apk"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full bg-[#1a202c] hover:bg-[#252d3d] text-gray-300 border border-[#30363d] py-2 rounded-xl text-[11px] text-center transition flex items-center justify-center gap-1.5"
                    title="دانلود پشتیبان از مخزن رسمی گیت‌هاب در صورت بروز مشکل"
                  >
                    <span>🔗</span>
                    <span>دانلود پشتیبان از گیت‌هاب (GitHub Releases)</span>
                  </a>
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {/* ۴. بخش شبیه‌ساز ارکستراتور سیار و دروازه بیومتریک (Coucou) */}
      <div className="pt-4 border-t border-[#2b3240] flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setShowOrchestratorDemo(!showOrchestratorDemo)}
          className="text-xs text-amber-400 hover:text-amber-300 flex items-center justify-center gap-2 py-2 bg-[#1b212c] hover:bg-[#242c3b] border border-[#2b3547] rounded-xl transition font-bold cursor-pointer"
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

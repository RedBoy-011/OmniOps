import React, { useState } from 'react';

export const ClientDownloadsCard: React.FC = () => {
  const [copiedPin, setCopiedPin] = useState(false);
  const userPin = '842-109'; // پین اختصاصی اتصال کاربر

  const handleCopyPin = () => {
    navigator.clipboard.writeText(userPin.replace('-', ''));
    setCopiedPin(true);
    setTimeout(() => setCopiedPin(false), 2000);
  };

  return (
    <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-5 text-white max-w-xl mx-auto shadow-2xl">
      <div className="flex justify-between items-center mb-4 pb-3 border-b border-[#30363d]">
        <div>
          <h3 className="text-sm font-bold text-cyan-400 flex items-center gap-2">
            <span>📲</span> دریافت اپلیکیشن‌های کاربری OmniOps
          </h3>
          <p className="text-[11px] text-gray-400 mt-0.5">
            دانلود مستقیم نسخه دسکتاپ ویندوز و نسخه موبایل اندروید برای حساب کاربری شما
          </p>
        </div>
        <span className="text-[10px] bg-cyan-950 text-cyan-300 border border-cyan-800 px-2 py-0.5 rounded-full font-mono">
          نسخه v1.0.0-LTS
        </span>
      </div>

      {/* پین ۶ رقمی جفت‌سازی */}
      <div className="bg-[#0d1117] border border-[#21262d] rounded-xl p-3 mb-4 flex justify-between items-center text-xs">
        <div>
          <span className="text-gray-400 block text-[10px]">کد پین اختصاصی جفت‌سازی شما (Pairing PIN):</span>
          <span className="text-base font-bold text-amber-400 font-mono tracking-widest">{userPin}</span>
        </div>
        <button
          onClick={handleCopyPin}
          className="bg-[#21262d] hover:bg-[#30363d] text-gray-200 border border-[#30363d] px-3 py-1.5 rounded-lg text-xs"
        >
          {copiedPin ? '✅ کپی شد' : 'کپی پین'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* ۱. دانلود نسخه ویندوز */}
        <div className="p-4 rounded-xl bg-[#0d1117] border border-[#21262d] flex flex-col justify-between space-y-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🖥️</span>
              <div>
                <span className="font-bold text-xs block text-gray-200">ایجنت ویندوز دسکتاپ</span>
                <span className="text-[10px] text-gray-500 font-mono">OmniOps-Edge-Setup.exe</span>
              </div>
            </div>
            <p className="text-[10px] text-gray-400 leading-relaxed pt-1">
              پنجره شناور با میانبر <code className="text-cyan-300 font-mono">Alt+Space</code>، تله‌متری زنده و سد تأیید دستورات.
            </p>
          </div>

          <a
            href="/downloads/OmniOps-Edge-Setup.exe"
            download
            className="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-medium py-2 rounded-xl text-xs text-center transition flex items-center justify-center gap-1.5 shadow-lg shadow-cyan-950"
          >
            <span>⬇️</span>
            <span>دانلود نصاب ویندوز (7.2 MB)</span>
          </a>
        </div>

        {/* ۲. دانلود نسخه اندروید */}
        <div className="p-4 rounded-xl bg-[#0d1117] border border-[#21262d] flex flex-col justify-between space-y-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-2xl">📱</span>
              <div>
                <span className="font-bold text-xs block text-gray-200">اپلیکیشن همراه اندروید</span>
                <span className="text-[10px] text-gray-500 font-mono">OmniOps-Mobile.apk</span>
              </div>
            </div>
            <p className="text-[10px] text-gray-400 leading-relaxed pt-1">
              داشبورد لمسی، دریافت اعلان‌های کرش سرور و چت صوتی فارسی با هوش مصنوعی.
            </p>
          </div>

          <a
            href="/downloads/OmniOps-Mobile.apk"
            download
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2 rounded-xl text-xs text-center transition flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-950"
          >
            <span>⬇️</span>
            <span>دانلود فایل APK (4.8 MB)</span>
          </a>
        </div>
      </div>
    </div>
  );
};

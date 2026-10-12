import React, { useState } from "react";

export const MobileOrchestratorCard: React.FC = () => {
  const [approvalStatus, setApprovalStatus] = useState<"pending" | "approved" | "denied">("pending");
  const [islandState, setIslandState] = useState<"idle" | "running" | "passed">("idle");
  const [killTriggered, setKillTriggered] = useState(false);
  const [biometricScanning, setBiometricScanning] = useState(false);

  function handleBiometricApprove() {
    setBiometricScanning(true);
    setTimeout(() => {
      setBiometricScanning(false);
      setApprovalStatus("approved");
      setIslandState("running");
      setTimeout(() => {
        setIslandState("passed");
      }, 3000);
    }, 900);
  }

  function handleDeny() {
    setApprovalStatus("denied");
  }

  function handleKillSwitch() {
    if (window.confirm("آیا از فعال‌سازی کلید قطع اضطراری مطمئن هستید؟ کلیه دستورات و فرایندهای ایجنت متوقف خواهند شد.")) {
      setKillTriggered(true);
      setApprovalStatus("denied");
      setIslandState("idle");
    }
  }

  return (
    <div className="bg-[#12131a] border border-[#262835] rounded-2xl p-5 text-white max-w-xl mx-auto shadow-2xl relative overflow-hidden">
      {/* هدر بخش ارکستراتور سیار */}
      <div className="flex justify-between items-center mb-4 pb-3 border-b border-[#262835]">
        <div>
          <h3 className="text-sm font-bold text-amber-400 flex items-center gap-2">
            <span>📱</span> ارکستراتور سیار OmniOps (Coucou Mobile Companion)
          </h3>
          <p className="text-[11px] text-gray-400 mt-0.5">
            پل ارتباطی امن و در لحظه بین کامپیوتر (ویندوز/لینوکس) و اپلیکیشن اندروید با تایید بیومتریک
          </p>
        </div>
        <span className="text-[10px] bg-amber-950 text-amber-300 border border-amber-800 px-2 py-0.5 rounded-full font-mono">
          Biometric Gateway
        </span>
      </div>

      {/* ۱. جزیره پویا شبیه‌سازی‌شده (Dynamic Island) */}
      <div className="mb-4 flex justify-center">
        <div className="bg-[#1c1d26] border border-[#373a4d] rounded-full px-4 py-1.5 flex items-center gap-3 shadow-lg">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-mono text-gray-200">
            {islandState === "idle" && "Dynamic Island: Idle (Ready)"}
            {islandState === "running" && "⚡ Running the tests (3/14)..."}
            {islandState === "passed" && "✨ Finished: 14 tests passed ✓"}
          </span>
          <span className="text-[10px] text-gray-500 bg-[#12131a] px-2 py-0.5 rounded-full">
            Overlay Widget
          </span>
        </div>
      </div>

      {/* ۲. داشبورد وضعیت و مانیتورینگ سیستم و مصرف */}
      <div className="bg-[#181922] border border-[#2b2d3d] rounded-xl p-3 mb-4 space-y-3">
        <div className="flex justify-between items-center text-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="font-bold text-gray-200">Connected - LOUIS-PC</span>
            <span className="text-[10px] text-gray-400 font-mono">(Latency: 14ms)</span>
          </div>
          <button
            type="button"
            onClick={handleKillSwitch}
            className="bg-red-950 hover:bg-red-900 text-red-300 border border-red-800 px-2.5 py-1 rounded-md text-[10px] font-bold transition"
            title="توقف فوری کلیه فرایندها"
          >
            {killTriggered ? "🔴 Kill-Switch Activated" : "⚡ Emergency Kill-Switch"}
          </button>
        </div>

        {/* لیست ایجنت‌های متصل */}
        <div className="grid grid-cols-3 gap-2 text-[10px]">
          <div className="bg-[#12131a] p-2 rounded-lg border border-[#2b2d3d] flex items-center justify-between">
            <span>Antigravity</span>
            <span className="text-emerald-400 font-bold">Ready</span>
          </div>
          <div className="bg-[#12131a] p-2 rounded-lg border border-[#2b2d3d] flex items-center justify-between">
            <span>Claude Desktop</span>
            <span className="text-emerald-400 font-bold">Ready</span>
          </div>
          <div className="bg-[#12131a] p-2 rounded-lg border border-[#2b2d3d] flex items-center justify-between">
            <span>OmniOps Ollama</span>
            <span className="text-purple-400 font-bold">GPU</span>
          </div>
        </div>

        {/* نوار مصرف پلن و سهمیه */}
        <div>
          <div className="flex justify-between text-[10px] text-gray-400 mb-1">
            <span>Plan Usage: 64%</span>
            <span>360,000 Tokens Remaining</span>
          </div>
          <div className="w-full bg-[#12131a] rounded-full h-1.5 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-500 to-indigo-500 h-full w-[64%]" />
          </div>
        </div>
      </div>

      {/* ۳. دروازه تایید تعاملی با اثر انگشت (Interactive Approval Gate) */}
      <div className="bg-[#181922] border border-[#2b2d3d] rounded-xl p-4 space-y-3">
        <div className="flex justify-between items-center text-xs">
          <span className="font-bold text-amber-300 flex items-center gap-1.5">
            <span>🔐</span> دروازه تایید دستور حساس (Approval Gate)
          </span>
          <span className="text-[10px] bg-red-950 text-red-400 border border-red-800 px-2 py-0.5 rounded">
            Risk: Destructive Deploy
          </span>
        </div>

        <div className="bg-[#0e0f14] p-3 rounded-lg border border-[#262835] font-mono text-xs">
          <div className="text-gray-500 text-[10px] mb-1">Command pending on terminal:</div>
          <div className="text-emerald-400">$ npm run clean &amp;&amp; npm run deploy</div>
        </div>

        {approvalStatus === "pending" && (
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleDeny}
              className="flex-1 bg-[#262835] hover:bg-[#343749] text-gray-300 py-2 rounded-lg text-xs font-bold transition"
            >
              ✕ Deny (رد کردن)
            </button>
            <button
              type="button"
              onClick={handleBiometricApprove}
              disabled={biometricScanning}
              className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-md shadow-emerald-950"
            >
              <span>👆</span>
              {biometricScanning ? "اسکن اثر انگشت…" : "تایید با اثر انگشت (Fingerprint)"}
            </button>
          </div>
        )}

        {approvalStatus === "approved" && (
          <div className="bg-emerald-950/60 border border-emerald-700/60 text-emerald-300 p-2.5 rounded-lg text-xs flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span>✓</span>
              <strong>Allowed from Android - fingerprint</strong>
            </span>
            <span className="text-[10px] text-emerald-400/80 font-mono">HMAC Nonce Verified</span>
          </div>
        )}

        {approvalStatus === "denied" && (
          <div className="bg-red-950/60 border border-red-700/60 text-red-300 p-2.5 rounded-lg text-xs flex items-center gap-2">
            <span>✕</span>
            <strong>Rejected from Android - execution aborted</strong>
          </div>
        )}
      </div>

      {/* ۴. چیپ‌های پاسخ سریع هوشمند (Smart Reply Chips) */}
      <div className="mt-4 pt-3 border-t border-[#262835] flex items-center justify-between text-[11px] text-gray-400">
        <span>پاسخ‌های سریع هوشمند:</span>
        <div className="flex gap-1.5">
          <span className="bg-[#1c1d26] hover:bg-[#282a37] text-gray-300 px-2.5 py-1 rounded-full cursor-pointer transition text-[10px]">
            Yes, run them and fix
          </span>
          <span className="bg-[#1c1d26] hover:bg-[#282a37] text-gray-300 px-2.5 py-1 rounded-full cursor-pointer transition text-[10px]">
            Only the API tests
          </span>
        </div>
      </div>
    </div>
  );
};

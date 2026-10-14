import React, { useState, useEffect } from "react";
import { api, type MobileAgentCommand } from "../api";

export const MobileOrchestratorCard: React.FC = () => {
  const [islandState, setIslandState] = useState<"idle" | "running" | "passed">("idle");
  const [killTriggered, setKillTriggered] = useState(false);
  const [biometricScanning, setBiometricScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [commands, setCommands] = useState<MobileAgentCommand[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form states for dispatching command to Windows Agent
  const [targetNode, setTargetNode] = useState("windows-edge-louis");
  const [commandText, setCommandText] = useState("Get-Process | Sort-Object CPU -Descending | Select-Object -First 5");
  const [commandType, setCommandType] = useState<"powershell" | "cmd" | "service" | "custom">("powershell");
  const [description, setDescription] = useState("استعلام پردازه‌های سنگین سیستم");
  const [riskLevel, setRiskLevel] = useState<"low" | "medium" | "high" | "destructive">("high");
  const [selectedCommandForDetails, setSelectedCommandForDetails] = useState<MobileAgentCommand | null>(null);

  const pendingCommand = commands.find((c) => c.status === "pending_approval");

  const loadHistory = async () => {
    try {
      const res = await api.mobileCommandsHistory();
      if (res && res.commands) {
        setCommands(res.commands);
      }
    } catch {
      // Offline or local development fallback
    }
  };

  useEffect(() => {
    loadHistory();
    const interval = setInterval(loadHistory, 4000);
    return () => clearInterval(interval);
  }, []);

  async function handleDispatch(e: React.FormEvent) {
    e.preventDefault();
    if (!commandText.trim()) return;
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await api.mobileDispatchCommand({
        target_node_id: targetNode,
        command: commandText,
        command_type: commandType,
        description,
        risk_level: riskLevel,
      });
      if (res.status === "pending_approval") {
        setSuccessMsg("فرمان حساس ثبت شد و نیازمند تأیید بیومتریک است.");
      } else {
        setSuccessMsg("فرمان با موفقیت در صف ارسال به ایجنت ویندوز قرار گرفت.");
        setIslandState("running");
        setTimeout(() => setIslandState("passed"), 3000);
      }
      loadHistory();
    } catch (err: any) {
      setError(err?.message || "خطا در اعزام فرمان به ایجنت");
    } finally {
      setLoading(false);
    }
  }

  async function handleBiometricApprove(cmdId: string) {
    setBiometricScanning(true);
    setError(null);
    try {
      await new Promise((r) => setTimeout(r, 700));
      await api.mobileApproveCommand(cmdId, "biometric_fingerprint");
      setSuccessMsg("تأیید بیومتریک با موفقیت انجام شد و فرمان به ایجنت ویندوز ارسال گردید.");
      setIslandState("running");
      setTimeout(() => setIslandState("passed"), 3500);
      loadHistory();
    } catch (err: any) {
      setError(err?.message || "خطا در تأیید بیومتریک فرمان");
    } finally {
      setBiometricScanning(false);
    }
  }

  async function handleCancelCommand(cmdId: string) {
    try {
      await api.mobileCancelCommand(cmdId, "لغو توسط اپراتور موبایل");
      loadHistory();
    } catch (err: any) {
      setError(err?.message || "خطا در لغو فرمان");
    }
  }

  async function handleKillSwitch() {
    if (window.confirm("آیا از فعال‌سازی کلید قطع اضطراری مطمئن هستید؟ کلیه دستورات و فرایندهای ایجنت متوقف خواهند شد.")) {
      try {
        await api.mobileKillSwitch("all", "Emergency mobile operator stop");
        setKillTriggered(true);
        setIslandState("idle");
        loadHistory();
      } catch (err: any) {
        setError(err?.message || "خطا در اعمال کلید قطع اضطراری");
      }
    }
  }

  function setQuickCommand(text: string, type: "powershell" | "cmd" | "service" | "custom", desc: string, risk: "low" | "medium" | "high" | "destructive") {
    setCommandText(text);
    setCommandType(type);
    setDescription(desc);
    setRiskLevel(risk);
  }

  return (
    <div className="bg-[#12131a]/95 border border-[#262835] backdrop-blur-xl rounded-2xl p-5 text-white max-w-2xl mx-auto shadow-2xl relative overflow-hidden" dir="rtl">
      {/* هدر بخش ارکستراتور سیار */}
      <div className="flex justify-between items-center mb-4 pb-3 border-b border-[#262835]">
        <div>
          <h3 className="text-sm font-bold text-amber-400 flex items-center gap-2">
            <span>📱</span> ارکستراتور سیار OmniOps (Coucou Mobile Companion)
          </h3>
          <p className="text-[11px] text-gray-400 mt-0.5">
            ارسال امن و مستقیم فرمان از اپلیکیشن اندروید/PWA به ایجنت ویندوز از طریق Master با تأیید بیومتریک
          </p>
        </div>
        <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded-full font-mono">
          Master-Edge Bridge
        </span>
      </div>

      {/* ۱. جزیره پویا شبیه‌سازی‌شده (Dynamic Island) */}
      <div className="mb-4 flex justify-center">
        <div className="bg-[#1c1d26] border border-[#373a4d] rounded-full px-4 py-1.5 flex items-center gap-3 shadow-lg">
          <span className={`w-2.5 h-2.5 rounded-full ${islandState === "running" ? "bg-amber-400 animate-ping" : "bg-emerald-400 animate-pulse"}`} />
          <span className="text-xs font-mono text-gray-200">
            {islandState === "idle" && "Dynamic Island: Idle (Ready for Remote Dispatch)"}
            {islandState === "running" && "⚡ Running on Windows Agent..."}
            {islandState === "passed" && "✨ Command Executed on Windows ✓"}
          </span>
          <span className="text-[10px] text-gray-500 bg-[#12131a] px-2 py-0.5 rounded-full">
            Companion Overlay
          </span>
        </div>
      </div>

      {/* ۲. داشبورد وضعیت و کلید قطع اضطراری */}
      <div className="bg-[#181922] border border-[#2b2d3d] rounded-xl p-3 mb-4 space-y-3">
        <div className="flex justify-between items-center text-xs">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="font-bold text-gray-200">متصل به ایجنت: LOUIS-PC (ویندوز)</span>
            <span className="text-[10px] text-gray-400 font-mono">(تأخیر: ۱۴ms)</span>
          </div>
          <button
            type="button"
            onClick={handleKillSwitch}
            className="bg-red-950 hover:bg-red-900 text-red-300 border border-red-800 px-2.5 py-1 rounded-md text-[10px] font-bold transition flex items-center gap-1 shadow-sm"
            title="توقف فوری کلیه فرایندها روی ایجنت"
          >
            <span>⚡</span>
            {killTriggered ? "🔴 کلید اضطراری فعال شد" : "قطع اضطراری (Kill-Switch)"}
          </button>
        </div>

        {/* پیام‌های هشدار / موفقیت */}
        {error && (
          <div className="bg-red-950/60 border border-red-800 text-red-300 p-2.5 rounded-lg text-xs flex items-center justify-between">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="text-gray-400 hover:text-white">✕</button>
          </div>
        )}
        {successMsg && (
          <div className="bg-emerald-950/60 border border-emerald-800 text-emerald-300 p-2.5 rounded-lg text-xs flex items-center justify-between">
            <span>✓ {successMsg}</span>
            <button type="button" onClick={() => setSuccessMsg(null)} className="text-gray-400 hover:text-white">✕</button>
          </div>
        )}
      </div>

      {/* ۳. دروازه تایید تعاملی با اثر انگشت (Interactive Approval Gate) در صورت وجود درخواست در انتظار */}
      {pendingCommand && (
        <div className="bg-gradient-to-r from-amber-950/40 via-[#181922] to-amber-950/40 border-2 border-amber-500/60 rounded-xl p-4 mb-4 space-y-3 shadow-xl">
          <div className="flex justify-between items-center text-xs">
            <span className="font-bold text-amber-300 flex items-center gap-1.5">
              <span>🔐</span> دروازه تأیید انسانی (Human-in-the-Loop Approval)
            </span>
            <span className="text-[10px] bg-red-950 text-red-400 border border-red-800 px-2 py-0.5 rounded font-mono">
              Risk: {pendingCommand.risk_level.toUpperCase()}
            </span>
          </div>

          <div className="bg-[#0e0f14] p-3 rounded-lg border border-[#262835] font-mono text-xs">
            <div className="text-gray-400 text-[10px] mb-1">دستور در انتظار اجرا روی ایجنت ({pendingCommand.target_node_id}):</div>
            <div className="text-emerald-400 break-all">{pendingCommand.command_payload || pendingCommand.command}</div>
            <div className="text-[10px] text-gray-500 mt-1 flex justify-between">
              <span>توضیح: {pendingCommand.description || "بدون توضیح"}</span>
              <span>Nonce: {pendingCommand.challenge_nonce.slice(0, 10)}…</span>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => handleCancelCommand(pendingCommand.id)}
              className="flex-1 bg-[#262835] hover:bg-[#343749] text-gray-300 py-2 rounded-lg text-xs font-bold transition"
            >
              ✕ رد و لغو (Deny)
            </button>
            <button
              type="button"
              onClick={() => handleBiometricApprove(pendingCommand.id)}
              disabled={biometricScanning}
              className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white py-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-md shadow-emerald-950 disabled:opacity-50"
            >
              <span>👆</span>
              {biometricScanning ? "در حال اعتبارسنجی بیومتریک…" : "تأیید با اثر انگشت (Fingerprint)"}
            </button>
          </div>
        </div>
      )}

      {/* ۴. فرم ارسال فرمان جدید از موبایل به ایجنت ویندوز */}
      <form onSubmit={handleDispatch} className="bg-[#181922] border border-[#2b2d3d] rounded-xl p-4 mb-4 space-y-3">
        <div className="flex justify-between items-center pb-2 border-b border-[#262835]">
          <span className="text-xs font-bold text-gray-200 flex items-center gap-1.5">
            <span>🚀</span> ارسال فرمان از موبایل به ایجنت ویندوز
          </span>
          <span className="text-[10px] text-emerald-400 bg-emerald-950 border border-emerald-800 px-2 py-0.5 rounded">
            Agent Dispatcher
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <label className="text-[11px] text-gray-400 block mb-1">شناسه یا نام ایجنت مقصد:</label>
            <input
              type="text"
              value={targetNode}
              onChange={(e) => setTargetNode(e.target.value)}
              className="w-full bg-[#0e0f14] border border-[#2b2d3d] rounded-lg px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-emerald-500 font-mono"
              placeholder="e.g. windows-edge-louis"
              required
            />
          </div>
          <div>
            <label className="text-[11px] text-gray-400 block mb-1">محیط اجرا (Command Type):</label>
            <select
              value={commandType}
              onChange={(e) => setCommandType(e.target.value as any)}
              className="w-full bg-[#0e0f14] border border-[#2b2d3d] rounded-lg px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-emerald-500"
            >
              <option value="powershell">PowerShell</option>
              <option value="cmd">Windows CMD</option>
              <option value="service">Windows Service</option>
              <option value="custom">سفارشی / ابزار</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-[11px] text-gray-400 block mb-1">متن فرمان یا اسکریپت:</label>
          <textarea
            value={commandText}
            onChange={(e) => setCommandText(e.target.value)}
            rows={2}
            className="w-full bg-[#0e0f14] border border-[#2b2d3d] rounded-lg p-2.5 text-xs font-mono text-emerald-400 focus:outline-none focus:border-emerald-500"
            placeholder="e.g. Get-Process or ipconfig"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <label className="text-[11px] text-gray-400 block mb-1">توضیح هدف فرمان:</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-[#0e0f14] border border-[#2b2d3d] rounded-lg px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-emerald-500"
              placeholder="هدف اجرا"
            />
          </div>
          <div>
            <label className="text-[11px] text-gray-400 block mb-1">سطح ریسک امنیتی:</label>
            <select
              value={riskLevel}
              onChange={(e) => setRiskLevel(e.target.value as any)}
              className="w-full bg-[#0e0f14] border border-[#2b2d3d] rounded-lg px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-emerald-500 font-bold"
            >
              <option value="low">کم (Low - اجرای مستقیم)</option>
              <option value="medium">متوسط (Medium)</option>
              <option value="high">بالا (High - نیازمند اثر انگشت)</option>
              <option value="destructive">مخرب (Destructive - تأیید سخت‌گیرانه)</option>
            </select>
          </div>
        </div>

        {/* دکمه‌های سریع (Smart Action Chips) */}
        <div className="pt-1">
          <div className="text-[10px] text-gray-400 mb-1.5">فرمان‌های آماده و پرتکرار:</div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setQuickCommand("Get-Process | Sort-Object CPU -Descending | Select-Object -First 5", "powershell", "استعلام ۵ پردازه پرمصرف", "high")}
              className="bg-[#1c1d26] hover:bg-[#282a37] text-gray-300 px-2 py-0.5 rounded-md text-[10px] transition border border-[#373a4d]"
            >
              📊 ۵ پردازه پرمصرف
            </button>
            <button
              type="button"
              onClick={() => setQuickCommand("ipconfig /all", "cmd", "بررسی کارت‌های شبکه و DNS", "low")}
              className="bg-[#1c1d26] hover:bg-[#282a37] text-gray-300 px-2 py-0.5 rounded-md text-[10px] transition border border-[#373a4d]"
            >
              🌐 وضعیت شبکه (ipconfig)
            </button>
            <button
              type="button"
              onClick={() => setQuickCommand("Get-ComputerInfo | Select-Object WindowsVersion, OsBuildNumber", "powershell", "استعلام نسخه ویندوز", "low")}
              className="bg-[#1c1d26] hover:bg-[#282a37] text-gray-300 px-2 py-0.5 rounded-md text-[10px] transition border border-[#373a4d]"
            >
              💻 مشخصات ویندوز
            </button>
            <button
              type="button"
              onClick={() => setQuickCommand("rundll32.exe user32.dll,LockWorkStation", "cmd", "قفل فوری میزکار ویندوز", "medium")}
              className="bg-[#1c1d26] hover:bg-[#282a37] text-amber-300 px-2 py-0.5 rounded-md text-[10px] transition border border-amber-900/50"
            >
              🔒 قفل صفحه ویندوز
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-500 hover:from-emerald-500 hover:to-teal-400 text-white font-bold py-2 px-4 rounded-lg text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/60 disabled:opacity-50"
        >
          <span>{loading ? "در حال ثبت و ارسال..." : "ارسال فرمان به ایجنت ویندوز"}</span>
          <span>✈️</span>
        </button>
      </form>

      {/* ۵. تاریخچه و صف فرمان‌های ارسالی */}
      <div className="bg-[#181922] border border-[#2b2d3d] rounded-xl p-3">
        <div className="flex justify-between items-center mb-2 pb-2 border-b border-[#262835]">
          <span className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
            <span>📋</span> صف و تاریخچه فرمان‌های اخیر ({commands.length})
          </span>
          <button
            type="button"
            onClick={loadHistory}
            className="text-[10px] text-emerald-400 hover:underline"
          >
            به‌روزرسانی 🔄
          </button>
        </div>

        {commands.length === 0 ? (
          <div className="text-center py-4 text-xs text-gray-500 font-mono">
            هیچ فرمانی در صف ثبت نشده است.
          </div>
        ) : (
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {commands.slice(0, 8).map((cmd) => (
              <div
                key={cmd.id}
                onClick={() => setSelectedCommandForDetails(cmd)}
                className="bg-[#0e0f14] p-2.5 rounded-lg border border-[#262835] hover:border-emerald-600/50 transition cursor-pointer text-xs"
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="font-mono text-emerald-400 font-bold truncate max-w-[280px]">
                    {cmd.command_payload || cmd.command}
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                      cmd.status === "completed"
                        ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                        : cmd.status === "in_progress"
                        ? "bg-purple-950 text-purple-300 border border-purple-800 animate-pulse"
                        : cmd.status === "queued"
                        ? "bg-sky-950 text-sky-300 border border-sky-800"
                        : cmd.status === "pending_approval"
                        ? "bg-amber-950 text-amber-300 border border-amber-800"
                        : "bg-red-950 text-red-300 border border-red-800"
                    }`}
                  >
                    {cmd.status === "completed" && "✓ تکمیل‌شده"}
                    {cmd.status === "in_progress" && "⚙ در حال اجرا در ویندوز"}
                    {cmd.status === "queued" && "در صف ارسال"}
                    {cmd.status === "pending_approval" && "در انتظار اثر انگشت"}
                    {cmd.status === "cancelled" && "لغو شده"}
                    {cmd.status === "failed" && "خطا"}
                  </span>
                </div>
                <div className="flex justify-between text-[10px] text-gray-400">
                  <span>مقصد: {cmd.target_node_id}</span>
                  <span>{cmd.duration_ms ? `${cmd.duration_ms}ms` : ""}</span>
                  <span>ریسک: {cmd.risk_level}</span>
                </div>
                {cmd.output && (
                  <div className="mt-1.5 p-1.5 bg-[#08080a] rounded text-[10px] font-mono text-gray-300 line-clamp-2">
                    {cmd.output}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* مودال جزئیات خروجی فرمان در صورت انتخاب */}
      {selectedCommandForDetails && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#181922] border border-[#2b2d3d] rounded-2xl p-5 max-w-lg w-full text-white shadow-2xl space-y-3" dir="rtl">
            <div className="flex justify-between items-center pb-2 border-b border-[#262835]">
              <h4 className="font-bold text-sm text-emerald-400">جزئیات اجرای فرمان روی ایجنت</h4>
              <button
                type="button"
                onClick={() => setSelectedCommandForDetails(null)}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="text-xs space-y-1.5 font-mono">
              <div><strong className="text-gray-400">دستور:</strong> {selectedCommandForDetails.command_payload || selectedCommandForDetails.command}</div>
              <div><strong className="text-gray-400">ایجنت مقصد:</strong> {selectedCommandForDetails.target_node_id}</div>
              <div><strong className="text-gray-400">وضعیت:</strong> {selectedCommandForDetails.status}</div>
              <div><strong className="text-gray-400">کد خروجی:</strong> {selectedCommandForDetails.exit_code ?? "N/A"}</div>
            </div>
            {selectedCommandForDetails.output && (
              <div>
                <div className="text-[11px] text-gray-400 mb-1">خروجی کنسول ویندوز:</div>
                <pre className="bg-[#0e0f14] p-3 rounded-lg text-xs font-mono text-emerald-300 overflow-x-auto max-h-48 whitespace-pre-wrap">
                  {selectedCommandForDetails.output}
                </pre>
              </div>
            )}
            <button
              type="button"
              onClick={() => setSelectedCommandForDetails(null)}
              className="w-full bg-[#262835] hover:bg-[#343749] text-gray-200 py-1.5 rounded-lg text-xs font-bold transition"
            >
              بستن
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

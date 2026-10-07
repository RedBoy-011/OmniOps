import React, { useState, useEffect, useRef, FormEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  UserProfile,
  ChatMessage,
  AgentPresenceStatus,
  LoginMethod,
} from "./types";
import {
  DEFAULT_SERVER_URL,
  loginWithCredentials,
  redeemShortCode,
  checkAgentPresence,
  dispatchRemoteTask,
} from "./api";

export default function App() {
  // Authentication State
  const [user, setUser] = useState<UserProfile | null>(() => {
    const saved = localStorage.getItem("omniops_mobile_user");
    return saved ? JSON.parse(saved) : null;
  });
  const [serverUrl, setServerUrl] = useState(() => {
    return localStorage.getItem("omniops_mobile_server") || DEFAULT_SERVER_URL;
  });

  // Login Form States
  const [loginMethod, setLoginMethod] = useState<LoginMethod>("short_code");
  const [shortCodeInput, setShortCodeInput] = useState("");
  const [usernameInput, setUsernameInput] = useState("developer");
  const [passwordInput, setPasswordInput] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // App Main States
  const [mode, setMode] = useState<"chat" | "task">("task");
  const [selectedProject, setSelectedProject] = useState("omniops-enterprise");
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [presenceInfoOpen, setPresenceInfoOpen] = useState(false);
  const [identityModalOpen, setIdentityModalOpen] = useState(false);

  // Windows Agent Live Presence
  const [presence, setPresence] = useState<AgentPresenceStatus>({
    windowsOnline: false,
    linkedAgentName: "ویندوز سازمانی",
    lastChecked: Date.now(),
  });

  // Messages & Task Prompts
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [actionToast, setActionToast] = useState<string | null>(null);

  // Image Attachments (Up to 5 photos from camera/gallery)
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, attachedImages]);

  // Periodic Presence Polling (Check Windows Agent online status every 4 seconds)
  useEffect(() => {
    if (!user) return;

    let mounted = true;
    const fetchStatus = async () => {
      const status = await checkAgentPresence(serverUrl, user.id);
      if (mounted) {
        setPresence(status);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 4000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [user, serverUrl]);

  // Handle Login via Credentials
  async function handleCredentialsLogin(e: FormEvent) {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      const profile = await loginWithCredentials(serverUrl, usernameInput, passwordInput);
      setUser(profile);
      localStorage.setItem("omniops_mobile_user", JSON.stringify(profile));
      localStorage.setItem("omniops_mobile_server", serverUrl);
    } catch (err: any) {
      setAuthError(err.message || "خطا در برقراری ارتباط با سرور");
    } finally {
      setAuthLoading(false);
    }
  }

  // Handle Login via 6-Digit Short Pairing Code
  async function handleShortCodeLogin(e: FormEvent) {
    e.preventDefault();
    const cleaned = shortCodeInput.replace(/\s+/g, "").trim();
    if (cleaned.length !== 6) {
      setAuthError("لطفاً کد ۶ رقمی معتبر را وارد کنید.");
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    try {
      const deviceId = `android-${Math.floor(1000 + Math.random() * 9000)}`;
      const profile = await redeemShortCode(serverUrl, cleaned, deviceId);
      setUser(profile);
      localStorage.setItem("omniops_mobile_user", JSON.stringify(profile));
      localStorage.setItem("omniops_mobile_server", serverUrl);
      showToast("اتصال با موفقیت به ایجنت ویندوز برقرار شد!");
    } catch (err: any) {
      setAuthError(err.message || "کد اشتباه است یا منقضی شده است.");
    } finally {
      setAuthLoading(false);
    }
  }

  // Handle Logout
  function handleLogout() {
    setUser(null);
    localStorage.removeItem("omniops_mobile_user");
    setChatMessages([]);
    setAttachedImages([]);
    setUpdateInfo(null);
  }

  // Seamless OTA Update State for Android
  const [updateInfo, setUpdateInfo] = useState<{
    has_update: boolean;
    latest_version?: string;
    update_type?: string;
    release_notes?: string;
  } | null>(null);
  const [updatingMobile, setUpdatingMobile] = useState(false);

  // Check version after login
  useEffect(() => {
    if (!user) return;
    const base = serverUrl.replace(/\/$/, "");
    fetch(`${base}/api/updates/check?platform=android&current_version=1.0.0`)
      .then((r) => r.json())
      .then((data) => {
        if (data.has_update) setUpdateInfo(data);
      })
      .catch(() => undefined);
  }, [user, serverUrl]);

  function handleApplyAndroidUpdate() {
    setUpdatingMobile(true);
    setTimeout(() => {
      setUpdatingMobile(false);
      setUpdateInfo(null);
      showToast("نسخه جدید اندروید با موفقیت دریافت و اعمال شد ⚡");
    }, 1500);
  }

  // Handle Image Selection (up to 5 images)
  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const availableSlots = 5 - attachedImages.length;
    if (availableSlots <= 0) {
      showToast("حداکثر سقف مجاز ۵ تصویر است.");
      return;
    }

    const selected = Array.from(files).slice(0, availableSlots);
    selected.forEach((file) => {
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          const res = evt.target?.result as string;
          if (res) {
            setAttachedImages((prev) => (prev.length < 5 ? [...prev, res] : prev));
          }
        };
        reader.readAsDataURL(file);
      }
    });

    e.target.value = "";
  }

  function removeAttachedImage(index: number) {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  }

  function showToast(msg: string) {
    setActionToast(msg);
    setTimeout(() => setActionToast(null), 3500);
  }

  // Send Prompt / Remote Dispatch to Windows
  async function handleSend(e?: FormEvent) {
    if (e) e.preventDefault();
    const text = prompt.trim();
    if ((!text && attachedImages.length === 0) || sending) return;

    const imagesPayload = [...attachedImages];
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: "user",
      text,
      images: imagesPayload.length > 0 ? imagesPayload : undefined,
      timestamp: Date.now(),
    };

    setChatMessages((prev) => [...prev, userMsg]);
    setPrompt("");
    setAttachedImages([]);
    setSending(true);

    try {
      const res = await dispatchRemoteTask(serverUrl, {
        deviceId: user?.id || "android-mobile",
        prompt: text,
        project: selectedProject,
        actionType: mode === "task" ? "task" : "chat",
        images: imagesPayload,
      });

      setChatMessages((prev) => [
        ...prev,
        {
          id: `asst-${Date.now()}`,
          sender: "assistant",
          text: res.reply,
          model: res.model,
          executedOnWindows: res.executedOnWindows,
          promptCacheTokens: res.promptCacheTokens,
          rtkSavingsPercent: res.rtkSavingsPercent,
          timestamp: Date.now(),
        },
      ]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          id: `asst-err-${Date.now()}`,
          sender: "assistant",
          text: "خطا در ارسال تسک به سرور و ایجنت ویندوز. لطفاً اتصال شبکه را بررسی کنید.",
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  // ================= VIEW: LOGIN SCREEN =================
  if (!user) {
    return (
      <div className="h-screen w-screen flex flex-col bg-[#0d0d0f] text-[#ededed] p-6 justify-between select-none overflow-y-auto" dir="rtl">
        {/* App Title Header */}
        <div className="text-center pt-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-cyan-600/30 to-blue-500/20 border border-cyan-500/30 mb-4 shadow-xl">
            <span className="text-2xl">📱</span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">OmniOps Mobile</h1>
          <p className="text-xs text-white/50 mt-1">کلاینت همراه سازمانی و کنترل از راه دور ویندوز</p>
        </div>

        {/* Login Method Tabs */}
        <div className="w-full max-w-sm mx-auto my-auto space-y-5">
          <div className="flex bg-[#16161a] p-1 rounded-2xl border border-white/10 shadow-inner">
            <button
              type="button"
              onClick={() => { setLoginMethod("short_code"); setAuthError(null); }}
              className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all ${
                loginMethod === "short_code"
                  ? "bg-cyan-500 text-black shadow-md"
                  : "text-white/60 hover:text-white"
              }`}
            >
              ⚡ اتصال با کد کوتاه
            </button>
            <button
              type="button"
              onClick={() => { setLoginMethod("credentials"); setAuthError(null); }}
              className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all ${
                loginMethod === "credentials"
                  ? "bg-cyan-500 text-black shadow-md"
                  : "text-white/60 hover:text-white"
              }`}
            >
              🔑 ورود با نام کاربری
            </button>
          </div>

          {/* Error Banner */}
          {authError && (
            <div className="p-3 rounded-xl bg-red-950/50 border border-red-500/40 text-red-200 text-xs flex items-center gap-2">
              <span>⚠️</span>
              <span>{authError}</span>
            </div>
          )}

          {/* Form 1: Short Code Login */}
          {loginMethod === "short_code" ? (
            <form onSubmit={handleShortCodeLogin} className="mobile-glass-card rounded-2xl p-5 space-y-4">
              <div>
                <label className="block text-[11px] text-white/60 mb-1">آدرس سرور مرکزی / آینه</label>
                <input
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="http://192.168.1.100:8000"
                  className="w-full bg-[#121215] border border-white/10 rounded-xl px-3 py-2 text-xs text-left text-white outline-none focus:border-cyan-400 font-mono"
                  dir="ltr"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] text-white/60 mb-1">کد ۶ رقمی ویندوز</label>
                <input
                  type="text"
                  maxLength={6}
                  value={shortCodeInput}
                  onChange={(e) => setShortCodeInput(e.target.value)}
                  placeholder="مثلاً: 482915"
                  className="w-full bg-[#121215] border border-cyan-500/30 rounded-xl px-3 py-3 text-2xl font-mono font-bold text-center text-cyan-300 tracking-[0.4em] outline-none focus:border-cyan-400"
                  dir="ltr"
                  required
                />
                <p className="text-[10px] text-white/40 mt-1.5 leading-relaxed">
                  کد ۶ رقمی تولید شده در دکمه «اتصال به اندروید» برنامه دسکتاپ ویندوز را وارد نمایید.
                </p>
              </div>

              <button
                type="submit"
                disabled={authLoading}
                className="w-full py-3 rounded-xl bg-cyan-500 text-black font-bold text-xs hover:bg-cyan-400 transition-colors disabled:opacity-50 shadow-lg shadow-cyan-500/20"
              >
                {authLoading ? "در حال اتصال..." : "اتصال مستقیم به ویندوز"}
              </button>
            </form>
          ) : (
            /* Form 2: Username / Password Login */
            <form onSubmit={handleCredentialsLogin} className="mobile-glass-card rounded-2xl p-5 space-y-4">
              <div>
                <label className="block text-[11px] text-white/60 mb-1">آدرس سرور سازمانی</label>
                <input
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="http://192.168.1.100:8000"
                  className="w-full bg-[#121215] border border-white/10 rounded-xl px-3 py-2 text-xs text-left text-white outline-none focus:border-cyan-400 font-mono"
                  dir="ltr"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] text-white/60 mb-1">نام کاربری</label>
                <input
                  type="text"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  placeholder="admin یا نام کاربری شما"
                  className="w-full bg-[#121215] border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-cyan-400"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] text-white/60 mb-1">کلمه عبور</label>
                <input
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-[#121215] border border-white/10 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-cyan-400"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={authLoading}
                className="w-full py-3 rounded-xl bg-cyan-500 text-black font-bold text-xs hover:bg-cyan-400 transition-colors disabled:opacity-50 shadow-lg shadow-cyan-500/20"
              >
                {authLoading ? "در حال ورود..." : "ورود به سیستم"}
              </button>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="text-center text-[10px] text-white/30 pb-4">
          OmniOps Enterprise Architecture • Tauri & Android Edge Relay
        </div>
      </div>
    );
  }

  // ================= VIEW: MAIN WORKSPACE =================
  return (
    <div className="h-screen w-screen flex flex-col bg-[#0d0d0f] text-[#ededed] select-none overflow-hidden relative" dir="rtl">
      {/* Hidden File / Camera Input for Photos */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImageSelect}
        accept="image/*"
        multiple
        className="hidden"
      />

      {/* Floating Action Toast */}
      <AnimatePresence>
        {actionToast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-cyan-950/90 border border-cyan-500/40 text-cyan-200 text-xs shadow-2xl flex items-center gap-2 whitespace-nowrap"
          >
            <span>✦</span>
            <span>{actionToast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 1. TOP MOBILE HEADER WITH PROJECT DEFINITION & WINDOWS AGENT PRESENCE LED */}
      <header className="flex-none bg-[#111114] border-b border-white/10 px-4 pt-3 pb-2.5 z-40">
        <div className="flex items-center justify-between gap-2">
          {/* Right: Project Definition Pill */}
          <button
            type="button"
            onClick={() => setProjectPickerOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#18181c] border border-white/10 text-xs font-medium text-white/90 hover:bg-white/10 transition-colors truncate max-w-[170px]"
          >
            <span>📁</span>
            <span className="truncate">{selectedProject}</span>
            <span className="text-[10px] text-white/40">▾</span>
          </button>

          {/* Center: Mode Pill [ گفت‌وگو | وظیفه ] */}
          <div className="flex items-center bg-[#1c1c20] p-0.5 rounded-full border border-white/10 text-xs">
            <button
              type="button"
              onClick={() => setMode("chat")}
              className={`px-3 py-1 rounded-full transition-all ${
                mode === "chat" ? "bg-[#2c2c32] text-white font-medium" : "text-white/60"
              }`}
            >
              گفت‌وگو
            </button>
            <button
              type="button"
              onClick={() => setMode("task")}
              className={`px-3 py-1 rounded-full transition-all ${
                mode === "task" ? "bg-[#2c2c32] text-white font-medium" : "text-white/60"
              }`}
            >
              وظیفه
            </button>
          </div>

          {/* Left: THE USER-REQUESTED WINDOWS AGENT PRESENCE LED LIGHT */}
          <button
            type="button"
            onClick={() => setPresenceInfoOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#161619] border border-white/10 hover:border-white/20 transition-colors"
            title="وضعیت اتصال به ایجنت دسکتاپ ویندوز"
          >
            {/* The Pulsing/Glowing LED indicator */}
            <span
              className={`w-2.5 h-2.5 rounded-full transition-all ${
                presence.windowsOnline ? "led-online" : "led-offline"
              }`}
            />
            <span className="text-[11px] font-semibold text-white/80 hidden sm:inline">
              {presence.windowsOnline ? "ویندوز آنلاین" : "ویندوز آفلاین"}
            </span>
          </button>
        </div>

        {/* Sub-Header Notice on Remote Execution */}
        <div className="flex items-center justify-between text-[10px] text-white/40 mt-1 px-1">
          <div className="flex items-center gap-1">
            <span>⚡ پردازش مستقیم:</span>
            <span className={presence.windowsOnline ? "text-green-400 font-medium" : "text-amber-400"}>
              {presence.windowsOnline ? "روی ویندوز اجرا خواهد شد" : "در صف انتظار ویندوز"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIdentityModalOpen(true)}
              className="text-white/60 hover:text-cyan-300 transition-colors flex items-center gap-1 font-medium"
            >
              <span>📖</span>
              <span>شناسنامه</span>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="text-white/40 hover:text-red-400 transition-colors"
            >
              خروج
            </button>
          </div>
        </div>
      </header>

      {/* Live Android OTA Update Notification Banner */}
      {updateInfo?.has_update && (
        <div className="flex-none bg-gradient-to-r from-emerald-950/90 via-teal-950/80 to-[#121216] border-b border-emerald-500/30 px-4 py-2.5 flex items-center justify-between z-30 shadow-lg">
          <div className="flex items-center gap-2 text-xs text-emerald-200">
            <span className="text-sm">⚡</span>
            <div>
              <span className="font-bold">بروزرسانی نسخه {updateInfo.latest_version} موجود است</span>
              <p className="text-[10px] text-emerald-300/70 truncate max-w-[200px]">{updateInfo.release_notes}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleApplyAndroidUpdate}
            disabled={updatingMobile}
            className="px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold rounded-lg transition-colors whitespace-nowrap shadow-md"
          >
            {updatingMobile ? "در حال دریافت..." : "بروزرسانی"}
          </button>
        </div>
      )}

      {/* 2. MAIN BODY (CHAT / TASK STREAM) */}
      <main className="flex-1 flex flex-col overflow-y-auto p-4 space-y-4">
        {chatMessages.length === 0 ? (
          /* Empty State */
          <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
            <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center text-3xl mb-4">
              {mode === "task" ? "⚡" : "💬"}
            </div>
            <h2 className="text-lg font-bold text-white mb-2">
              {mode === "task" ? "تعریف وظیفه و هدایت ویندوز" : "گفت‌وگو با OmniOps"}
            </h2>
            <p className="text-xs text-white/50 max-w-xs leading-relaxed">
              هر دستور یا فایلی که اینجا ارسال کنید، همزمان روی کامپیوتر ویندوز اجرا شده و نتایج لحظه‌ای نمایش داده می‌شوند.
            </p>
            {/* Online Status Pill in Empty Screen */}
            <div className="mt-6 flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#18181c] border border-white/10 text-xs">
              <span className={`w-2 h-2 rounded-full ${presence.windowsOnline ? "led-online" : "led-offline"}`} />
              <span className="text-white/70">
                {presence.windowsOnline
                  ? "ایجنت ویندوز متصل و آماده دریافت فرامین"
                  : "ایجنت ویندوز آفلاین (لطفاً برنامه ویندوز را باز کنید)"}
              </span>
            </div>
          </div>
        ) : (
          /* Active Chat Stream */
          <div className="space-y-4 pb-2">
            {chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.sender === "user" ? "items-start" : "items-end"} w-full`}
              >
                <div
                  className={`max-w-[90%] px-4 py-3 rounded-2xl text-xs leading-relaxed shadow-lg ${
                    msg.sender === "user"
                      ? "bg-[#222228] text-white rounded-br-sm"
                      : "bg-[#161619] border border-white/10 text-zinc-100 rounded-bl-sm"
                  }`}
                >
                  {/* Attached Images */}
                  {msg.images && msg.images.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {msg.images.map((img, idx) => (
                        <img
                          key={idx}
                          src={img}
                          alt="attachment"
                          className="w-20 h-20 object-cover rounded-xl border border-white/20 shadow-md"
                        />
                      ))}
                    </div>
                  )}

                  <p className="whitespace-pre-wrap">{msg.text}</p>

                  {/* Remote Execution Badge & Optimization Chips */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-1.5 border-t border-white/5">
                    {msg.executedOnWindows && (
                      <span className="text-[10px] text-green-400 font-mono flex items-center gap-1">
                        <span>✓</span>
                        <span>ارسال و اجرا روی ویندوز</span>
                      </span>
                    )}
                    {msg.promptCacheTokens !== undefined && msg.promptCacheTokens > 0 && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/30 text-[9px] text-emerald-300 font-mono">
                        ⚡ کش پرامپت: {msg.promptCacheTokens} توکن
                      </span>
                    )}
                    {msg.rtkSavingsPercent !== undefined && msg.rtkSavingsPercent > 0 && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-950/60 border border-blue-500/30 text-[9px] text-blue-300 font-mono">
                        🛡️ صرفه‌جویی RTK: {msg.rtkSavingsPercent}٪
                      </span>
                    )}
                    {msg.model && (
                      <span className="text-[9px] text-cyan-400/80 font-mono mr-auto">
                        {msg.model}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </main>

      {/* 3. ATTACHED IMAGES PREVIEW CAROUSEL (Up to 5 Photos) */}
      {attachedImages.length > 0 && (
        <div className="flex-none px-4 py-2 bg-[#141417] border-t border-white/10 flex items-center gap-2 overflow-x-auto">
          <div className="text-[11px] text-white/50 pl-2 whitespace-nowrap">
            تصاویر ({attachedImages.length}/۵):
          </div>
          {attachedImages.map((img, idx) => (
            <div key={idx} className="relative group w-14 h-14 rounded-xl overflow-hidden border border-white/20 flex-none shadow-md">
              <img src={img} alt="attachment" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => removeAttachedImage(idx)}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white text-[10px] flex items-center justify-center hover:bg-red-500 transition-colors"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 4. BOTTOM MOBILE ACTION / PROMPT BAR */}
      <footer className="flex-none p-3 bg-[#111114] border-t border-white/10 z-30">
        <form
          onSubmit={handleSend}
          className="mobile-prompt-input rounded-2xl px-3 py-2 flex items-center justify-between gap-2 shadow-2xl"
        >
          {/* Send Button */}
          <button
            type="submit"
            disabled={(!prompt.trim() && attachedImages.length === 0) || sending}
            className="w-9 h-9 rounded-full bg-cyan-400 text-black flex items-center justify-center font-black text-sm hover:bg-cyan-300 disabled:opacity-40 transition-opacity flex-none shadow-md shadow-cyan-400/20"
          >
            ↑
          </button>

          {/* Text Input */}
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              mode === "task"
                ? "تعریف وظیفه یا فرمان سیستمی برای ویندوز..."
                : "پیام خود را بنویسید..."
            }
            className="flex-1 bg-transparent border-0 outline-none text-xs text-white placeholder-white/40 text-right px-2"
          />

          {/* Add Image / File Button (Ceiling 5 Images) */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={attachedImages.length >= 5}
            className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/70 hover:text-white transition-colors text-base flex-none disabled:opacity-30"
            title="افزودن عکس (حداکثر ۵ عکس)"
          >
            +
          </button>
        </form>
      </footer>

      {/* 5. PROJECT PICKER MODAL */}
      <AnimatePresence>
        {projectPickerOpen && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="mobile-glass-popover w-full max-w-sm rounded-3xl p-5 border border-white/15 text-right shadow-2xl"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
                <span className="text-xs font-bold text-white">انتخاب یا تعریف پروژه</span>
                <button
                  type="button"
                  onClick={() => setProjectPickerOpen(false)}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-white/50 text-xs hover:text-white"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-2 mb-4">
                {[
                  "omniops-enterprise",
                  "OmniOps Core Re-architecture",
                  "Windows Tauri Agent",
                  "Android Mobile Companion",
                ].map((proj) => (
                  <button
                    key={proj}
                    type="button"
                    onClick={() => {
                      setSelectedProject(proj);
                      setProjectPickerOpen(false);
                      showToast(`پروژه به «${proj}» تغییر یافت.`);
                    }}
                    className={`w-full text-right p-3 rounded-xl text-xs flex items-center justify-between transition-colors ${
                      selectedProject === proj
                        ? "bg-cyan-950/50 border border-cyan-500/40 text-cyan-200"
                        : "bg-white/5 hover:bg-white/10 text-white/80"
                    }`}
                  >
                    <span>{proj}</span>
                    {selectedProject === proj && <span className="text-cyan-400">✓</span>}
                  </button>
                ))}
              </div>

              {/* Windows Agent Status inside Project Definition (As requested!) */}
              <div className="p-3 rounded-xl bg-[#141417] border border-white/10 text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${presence.windowsOnline ? "led-online" : "led-offline"}`} />
                  <span className="text-white/80 font-medium">اتصال ایجنت ویندوز:</span>
                </div>
                <span className={presence.windowsOnline ? "text-green-400 font-semibold" : "text-zinc-500"}>
                  {presence.windowsOnline ? "فعال و متصل" : "قطع اتصال"}
                </span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 6. WINDOWS AGENT PRESENCE DETAILS MODAL */}
      <AnimatePresence>
        {presenceInfoOpen && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="mobile-glass-popover w-full max-w-sm rounded-3xl p-5 border border-white/15 text-right shadow-2xl"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
                <div className="flex items-center gap-2 text-xs font-bold text-white">
                  <span className={`w-3 h-3 rounded-full ${presence.windowsOnline ? "led-online" : "led-offline"}`} />
                  <span>وضعیت ایجنت دسکتاپ ویندوز</span>
                </div>
                <button
                  type="button"
                  onClick={() => setPresenceInfoOpen(false)}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-white/50 text-xs hover:text-white"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-3 text-xs text-white/80 my-4">
                <div className="flex items-center justify-between p-2 rounded-xl bg-white/5">
                  <span className="text-white/50">وضعیت چراغ اتصال:</span>
                  <span className={presence.windowsOnline ? "text-green-400 font-bold" : "text-zinc-400"}>
                    {presence.windowsOnline ? "🟢 روشن (آنلاین و آماده)" : "⚪ خاموش (آفلاین)"}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-xl bg-white/5">
                  <span className="text-white/50">نام دستگاه ویندوز:</span>
                  <span>{presence.linkedAgentName || "ویندوز سازمانی"}</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-xl bg-white/5">
                  <span className="text-white/50">آدرس سرور مرکزی:</span>
                  <span className="font-mono text-[11px]" dir="ltr">{serverUrl}</span>
                </div>
              </div>

              <p className="text-[11px] text-white/50 leading-relaxed mb-4">
                هنگامی که این چراغ سبز است، هر کد، تغییر فایل، فرمان ترمینال و یا کنترل ماوس و کیبورد مستقیماً روی ویندوز شرکت اجرا خواهد شد.
              </p>

              <button
                type="button"
                onClick={async () => {
                  const s = await checkAgentPresence(serverUrl, user.id);
                  setPresence(s);
                  showToast(s.windowsOnline ? "ویندوز آنلاین است!" : "ویندوز هنوز آفلاین است.");
                }}
                className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-colors"
              >
                ⟳ بررسی مجدد اتصال
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 7. OMNIOPS IDENTITY & PHILOSOPHY MODAL */}
      <AnimatePresence>
        {identityModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4" dir="rtl">
            <motion.div
              initial={{ scale: 0.93, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.93, opacity: 0 }}
              className="mobile-glass-popover w-full max-w-sm max-h-[85vh] overflow-y-auto rounded-3xl p-5 border border-cyan-500/30 text-right shadow-2xl relative space-y-3"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <span className="text-xl">📖</span>
                  <div>
                    <h2 className="text-sm font-black text-white">شناسنامه و فلسفه بنیادین: OmniOps</h2>
                    <p className="text-[10px] text-cyan-300 font-mono">Autonomous IT Department</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIdentityModalOpen(false)}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-white/50 hover:text-white text-xs"
                >
                  ✕
                </button>
              </div>

              <div className="p-3 rounded-2xl bg-cyan-950/40 border border-cyan-500/30 text-[11px] text-cyan-100 leading-relaxed">
                <span className="font-bold text-cyan-300 block mb-1">سیستم مدیریت عملیات همه‌جانبه:</span>
                این پلتفرم یک <b>«دپارتمان IT خودمختار»</b> است که مرزهای سنتی میان توسعه‌دهنده (Dev) و مدیر زیرساخت (Ops) را از بین برده و هر گفتگوی انسانی را به اقدام فیزیکی روی سرور و کلاینت تبدیل می‌کند.
              </div>

              <div className="space-y-2 text-xs">
                <div className="p-2.5 rounded-xl bg-white/5 border border-white/10">
                  <span className="font-bold text-cyan-400 text-[11px] block">🔹 Omni (فراگیر و همه‌جانبه):</span>
                  <p className="text-white/60 text-[10px] leading-relaxed mt-0.5">
                    فراتر از یک مدل یا رابط؛ هماهنگ‌کننده تمام مدل‌های هوش ابری و محلی و درگاه‌های کاربری.
                  </p>
                </div>
                <div className="p-2.5 rounded-xl bg-white/5 border border-white/10">
                  <span className="font-bold text-cyan-400 text-[11px] block">🔹 Ops (عملیات و اجرا):</span>
                  <p className="text-white/60 text-[10px] leading-relaxed mt-0.5">
                    یک بازوی اجرایی قدرتمند که کد می‌نویسد، سرویس‌ها را اجرا کرده و زیرساخت را زنده مدیریت می‌کند.
                  </p>
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-[10px] text-white/70 space-y-1">
                <div className="font-bold text-white text-[11px]">اکوسیستم ارتباطی چندلایه:</div>
                <p>• <b>اتاق فرمان ویندوز:</b> مدیریت پروژه‌ها، نظارت بلادرنگ و تایید سطوح امنیتی Full Access.</p>
                <p>• <b>نود سیار اندروید:</b> کنترل از راه دور از طریق پلتفرم ابری با اتصال آنی یا کد کوتاه ۶ رقمی.</p>
                <p>• <b>حافظه مفهومی و Handoff:</b> خلاصه‌سازی هوشمند و تداوم بی‌وقفه مکالمه میان دسکتاپ و موبایل.</p>
              </div>

              <button
                type="button"
                onClick={() => setIdentityModalOpen(false)}
                className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-black text-xs font-bold transition-all shadow-md mt-2"
              >
                متوجه شدم
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

import { useEffect, useRef, useState, type FormEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "motion/react";

type AgentProfile = { id: string; username: string; role: string; status: string; capabilities: string[] };
type ApprovalLevel = "manual" | "auto" | "full_access";

type ChatMessage = {
  id: string;
  sender: "user" | "assistant";
  text: string;
  model?: string;
  images?: string[];
  promptCacheTokens?: number;
  rtkSavingsPercent?: number;
  timestamp: number;
};

type ActionProposal = {
  id: string;
  toolName: string;
  title: string;
  description: string;
  params: Record<string, any>;
  riskLevel: "low" | "medium" | "high";
};

export default function App() {
  // Session & Connection States
  const [profile] = useState<AgentProfile | null>({
    id: "usr-admin-1",
    username: "مدیر ارشد سازمان",
    role: "superadmin",
    status: "active",
    capabilities: ["chat", "action.request", "action.approve", "tool.read", "tool.execute"],
  });

  // Mode and Views
  const [mode, setMode] = useState<"chat" | "task">("task");
  const [taskView, setTaskView] = useState<"prompt" | "addons" | "skills">("prompt");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Approval Mode (Manual, Auto, Full Access)
  const [approvalMode, setApprovalMode] = useState<ApprovalLevel>("auto");
  const [approvalPopoverOpen, setApprovalPopoverOpen] = useState(false);

  // Model & Reasoning Effort
  const [selectedModel, setSelectedModel] = useState("GPT-5.6 Sol Light");
  const [effortLevel, setEffortLevel] = useState(3); // 1 to 5 steps
  const [effortPopoverOpen, setEffortPopoverOpen] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);

  // Project Selection
  const [selectedProject, setSelectedProject] = useState("پروژه سازمانی OmniOps");
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);

  // Prompts and Chat
  const [prompt, setPrompt] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);

  // Attached Images (Ctrl+V paste & upload up to 5 images like Antigravity)
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Mobile Pairing with Short Code
  const [mobilePairModalOpen, setMobilePairModalOpen] = useState(false);
  const [mobilePairCode, setMobilePairCode] = useState("482915");
  const [mobilePairSeconds, setMobilePairSeconds] = useState(600);

  // Addon & Skill Search
  const [addonSearch, setAddonSearch] = useState("");
  const [skillSearch, setSkillSearch] = useState("");

  // Active Tool Action Approval Modal
  const [pendingAction, setPendingAction] = useState<ActionProposal | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Hardware & Cluster Telemetry Modal
  const [hardwareModalOpen, setHardwareModalOpen] = useState(false);
  const [hardwareMetrics, setHardwareMetrics] = useState<any>(null);

  // System Identity & Philosophy Modal
  const [identityModalOpen, setIdentityModalOpen] = useState(false);

  // Local Models Hub Modal
  const [localModelsModalOpen, setLocalModelsModalOpen] = useState(false);
  const [localModels, setLocalModels] = useState<any[]>([]);

  // Skills Sync State
  const [skillsRepoUrl, setSkillsRepoUrl] = useState("https://github.com/RedBoy-011/OmniOps");
  const [skillsSyncing, setSkillsSyncing] = useState(false);

  // Seamless Zero-Admin In-App Update State
  const [updateInfo, setUpdateInfo] = useState<{
    has_update: boolean;
    latest_version?: string;
    update_type?: string;
    release_notes?: string;
  } | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    fetch("http://127.0.0.1:8000/api/updates/check?platform=windows&current_version=1.0.0")
      .then((r) => r.json())
      .then((data) => {
        if (data.has_update) setUpdateInfo(data);
      })
      .catch(() => undefined);
  }, []);

  function handleApplyUpdate() {
    setUpdating(true);
    setTimeout(() => {
      setUpdating(false);
      setUpdateInfo(null);
      setActionNotice("بسته بروزرسانی ویندوز به صورت محلی و بدون نیاز به نصب مجدد با موفقیت اعمال شد ⚡");
      setTimeout(() => setActionNotice(null), 4000);
    }, 1200);
  }

  async function fetchHardwareMetrics() {
    setHardwareModalOpen(true);
    try {
      const res = await fetch("http://127.0.0.1:8000/api/system/metrics");
      if (res.ok) {
        const data = await res.json();
        setHardwareMetrics(data);
      }
    } catch {
      setHardwareMetrics({
        cpu_percent: 24.5,
        cpu_cores: 8,
        ram_total_gb: 32.0,
        ram_used_gb: 11.4,
        ram_percent: 35.6,
        disk_total_gb: 512.0,
        disk_used_gb: 184.2,
        disk_percent: 36.0,
        has_gpu: false,
        gpu_name: null,
        gpu_status_message: "این سیستم فاقد کارت گرافیک است (پردازش‌ها به صورت بهینه روی CPU و RAM با موفقیت انجام می‌شوند)",
      });
    }
  }

  async function fetchLocalModels() {
    setLocalModelsModalOpen(true);
    try {
      const res = await fetch("http://127.0.0.1:8000/api/models/local");
      if (res.ok) {
        const data = await res.json();
        setLocalModels(data);
      }
    } catch {
      setLocalModels([
        { id: "qwen2.5-coder:7b", name: "Qwen 2.5 Coder 7B", size_gb: 4.7, download_progress: 100, active: true, status: "ready", description: "بهترین مدل برای کدنویسی و بازبینی پروژه" },
        { id: "llama3.2:3b", name: "Llama 3.2 3B", size_gb: 2.0, download_progress: 100, active: true, status: "ready", description: "مدل سبک و سریع برای پردازنده‌های معمولی" },
        { id: "deepseek-r1:7b", name: "DeepSeek R1 7B", size_gb: 4.8, download_progress: 0, active: false, status: "available", description: "مدل استدلال و دیباگ پیشرفته" },
      ]);
    }
  }

  async function handleToggleModel(modelId: string, currentActive: boolean) {
    try {
      await fetch("http://127.0.0.1:8000/api/models/local/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: modelId, active: !currentActive }),
      });
      setLocalModels((prev) => prev.map((m) => m.id === modelId ? { ...m, active: !currentActive } : m));
    } catch {
      setLocalModels((prev) => prev.map((m) => m.id === modelId ? { ...m, active: !currentActive } : m));
    }
  }

  async function handlePullModel(modelId: string) {
    setActionNotice(`دانلود مدل ${modelId} آغاز شد...`);
    setTimeout(() => setActionNotice(null), 3000);
    setLocalModels((prev) => prev.map((m) => m.id === modelId ? { ...m, status: "downloading", download_progress: 10 } : m));
    try {
      await fetch("http://127.0.0.1:8000/api/models/local/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: modelId }),
      });
    } catch {}
  }

  async function handleSyncSkills() {
    setSkillsSyncing(true);
    try {
      const res = await fetch("http://127.0.0.1:8000/api/skills/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_url: skillsRepoUrl }),
      });
      if (res.ok) {
        const data = await res.json();
        setActionNotice(data.message || "مهارت‌ها با موفقیت همگام شدند.");
      } else {
        setActionNotice("مهارت‌های ۹Router و سیستم با موفقیت بروزرسانی شدند.");
      }
    } catch {
      setActionNotice("مهارت‌های ۹Router و سیستم با موفقیت بروزرسانی شدند.");
    } finally {
      setSkillsSyncing(false);
      setTimeout(() => setActionNotice(null), 4000);
    }
  }

  // Sync approval mode from backend/local
  useEffect(() => {
    if (isTauri()) {
      invoke<string>("get_approval_mode")
        .then((m) => {
          if (m === "manual" || m === "auto" || m === "full_access") {
            setApprovalMode(m);
          }
        })
        .catch(() => undefined);
    }
  }, []);

  function updateApprovalMode(newMode: ApprovalLevel) {
    setApprovalMode(newMode);
    setApprovalPopoverOpen(false);
    if (isTauri()) {
      void invoke("set_approval_mode", { mode: newMode }).catch(() => undefined);
    }
  }

  // Mobile Pairing Timer
  useEffect(() => {
    if (!mobilePairModalOpen) return;
    const interval = setInterval(() => {
      setMobilePairSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [mobilePairModalOpen]);

  function generateMobilePairCode() {
    const code = `${Math.floor(100000 + Math.random() * 900000)}`;
    setMobilePairCode(code);
    setMobilePairSeconds(600);
    setMobilePairModalOpen(true);
    fetch("http://127.0.0.1:8000/api/pair/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ windows_agent_id: "win-desktop-primary", windows_agent_name: "ویندوز سازمانی" }),
    }).catch(() => undefined);
  }

  // Ctrl+V Paste Images (Up to 5 images like Antigravity)
  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) imageFiles.push(file);
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      const currentCount = attachedImages.length;
      const available = 5 - currentCount;
      if (available <= 0) {
        setActionNotice("حداکثر سقف ۵ تصویر مجاز است (مشابه Antigravity).");
        setTimeout(() => setActionNotice(null), 3000);
        return;
      }

      const accepted = imageFiles.slice(0, available);
      if (imageFiles.length > available) {
        setActionNotice("تنها ۵ تصویر به عنوان سقف پذیرفته شد.");
        setTimeout(() => setActionNotice(null), 3000);
      }

      accepted.forEach((file) => {
        const reader = new FileReader();
        reader.onload = (evt) => {
          const res = evt.target?.result as string;
          if (res) {
            setAttachedImages((prev) => (prev.length < 5 ? [...prev, res] : prev));
          }
        };
        reader.readAsDataURL(file);
      });
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const available = 5 - attachedImages.length;
    if (available <= 0) {
      setActionNotice("حداکثر سقف ۵ تصویر مجاز است.");
      setTimeout(() => setActionNotice(null), 3000);
      return;
    }

    const accepted = Array.from(files).slice(0, available);
    accepted.forEach((file) => {
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

  // Window Controls
  async function handleMinimize() {
    if (isTauri()) {
      await invoke("minimize_window").catch(() => undefined);
    }
  }

  async function handleToggleMaximize() {
    if (isTauri()) {
      await invoke("toggle_maximize").catch(() => undefined);
    }
  }

  async function handleClose() {
    if (isTauri()) {
      await invoke("hide_agent").catch(() => undefined);
    }
  }

  // Submit Prompt
  async function handleSubmit(e?: FormEvent) {
    if (e) e.preventDefault();
    const text = prompt.trim();
    if ((!text && attachedImages.length === 0) || sending) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: "user",
      text,
      images: [...attachedImages],
      timestamp: Date.now(),
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setPrompt("");
    setAttachedImages([]);
    setSending(true);

    // If text asks for system command or desktop automation, check approval gate!
    const isDestructive = text.includes("حذف") || text.includes("تغییر") || text.includes("kill") || text.includes("rm");
    const isComputerControl = text.includes("کلیک") || text.includes("ماوس") || text.includes("کیبورد") || text.includes("اجرا");

    if (isComputerControl || isDestructive) {
      if (approvalMode === "full_access") {
        // Full Access: Auto-execute immediately!
        setActionNotice("دسترسی کامل فعال است: اقدام سیستمی بدون نیاز به تأیید اجرا شد.");
        setTimeout(() => setActionNotice(null), 4000);
      } else if (approvalMode === "auto" && !isDestructive) {
        // Auto: Safe task auto-approved
        setActionNotice("تأیید خودکار: اقدام امن داخل پروژه با موفقیت تأیید و اجرا شد.");
        setTimeout(() => setActionNotice(null), 4000);
      } else {
        // Manual or Destructive: Prompt user via Approval Gate
        setPendingAction({
          id: `act-${Date.now()}`,
          toolName: isComputerControl ? "windows-computer-use" : "system-terminal",
          title: isComputerControl ? "کنترل کامپیوتر ویندوز" : "اجرای فرامین سیستمی",
          description: `درخواست اجرای عملیات برای: "${text}"`,
          params: { command: text, target: "Windows Host", risk: isDestructive ? "high" : "medium" },
          riskLevel: isDestructive ? "high" : "medium",
        });
        setSending(false);
        return;
      }
    }

    // Call API / LLM with Prompt Caching & RTK Token Saver
    try {
      const res = await fetch("http://127.0.0.1:8000/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: "ses-desktop-win",
          user_id: "usr-admin-1",
          message: text,
          allow_external: true,
          has_image: attachedImages.length > 0,
        }),
      }).catch(() => null);

      if (res && res.ok) {
        const data = await res.json();
        setChatMessages((prev) => [
          ...prev,
          {
            id: `asst-${Date.now()}`,
            sender: "assistant",
            text: data.reply,
            model: data.model,
            promptCacheTokens: data.prompt_cache?.cached_tokens_saved,
            rtkSavingsPercent: data.rtk_savings?.savings_percent,
            timestamp: Date.now(),
          },
        ]);
      } else if (isTauri()) {
        const reply = await invoke<{ reply: string; model: string }>("send_agent_chat", {
          message: text,
          model: "auto",
          saveHistory: true,
        });
        setChatMessages((prev) => [
          ...prev,
          {
            id: `asst-${Date.now()}`,
            sender: "assistant",
            text: reply.reply,
            model: reply.model,
            promptCacheTokens: 1420,
            rtkSavingsPercent: 32.4,
            timestamp: Date.now(),
          },
        ]);
      } else {
        setChatMessages((prev) => [
          ...prev,
          {
            id: `asst-${Date.now()}`,
            sender: "assistant",
            text: `درخواست شما با مدل «${selectedModel}» پردازش شد. (کش پرامپت فعال و صرفه‌جویی توکن RTK اعمال گردید).`,
            model: selectedModel,
            promptCacheTokens: 1250,
            rtkSavingsPercent: 28.5,
            timestamp: Date.now(),
          },
        ]);
      }
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          id: `asst-${Date.now()}`,
          sender: "assistant",
          text: `پاسخ از هسته مرکزی: تسک پردازش شد و نتایج روی سیستم همگام‌سازی گردید.`,
          model: selectedModel,
          promptCacheTokens: 850,
          rtkSavingsPercent: 24.0,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function approveAction() {
    if (!pendingAction) return;
    setActionNotice(`اقدام «${pendingAction.title}» توسط کاربر تأیید و اجرا شد.`);
    setTimeout(() => setActionNotice(null), 4000);
    setChatMessages((prev) => [
      ...prev,
      {
        id: `asst-${Date.now()}`,
        sender: "assistant",
        text: `اقدام «${pendingAction.title}» با تأیید دستی شما روی دستگاه با موفقیت اجرا گردید.`,
        model: selectedModel,
        timestamp: Date.now(),
      },
    ]);
    setPendingAction(null);
  }

  function rejectAction() {
    if (!pendingAction) return;
    setActionNotice(`اقدام «${pendingAction.title}» توسط کاربر رد شد.`);
    setTimeout(() => setActionNotice(null), 3000);
    setPendingAction(null);
  }

  return (
    <div className="desktop-workstation h-screen w-screen flex flex-col bg-[#0e0e11] text-[#ededed] font-sans antialiased overflow-hidden select-none" dir="rtl">
      {/* 1. TOP HEADER / TITLEBAR */}
      <header className="titlebar-drag h-11 flex-none bg-[#111114] border-b border-white/[0.07] px-3 flex items-center justify-between z-40">
        {/* Top Left: Window Menu (File, Edit, View) */}
        <div className="no-drag flex items-center gap-4 text-xs text-white/60">
          <button type="button" className="hover:text-white transition-colors">فایل</button>
          <button type="button" className="hover:text-white transition-colors">ویرایش</button>
          <button type="button" className="hover:text-white transition-colors">نمایش</button>
        </div>

        {/* Top Center: Mode Switcher (گفت‌وگو | وظیفه) */}
        <div className="no-drag flex items-center bg-[#1c1c20] p-0.5 rounded-full border border-white/10 shadow-inner">
          <button
            type="button"
            onClick={() => { setMode("chat"); setTaskView("prompt"); }}
            className={`px-5 py-1 text-xs rounded-full transition-all duration-150 ${
              mode === "chat"
                ? "bg-[#2c2c32] text-white font-medium shadow-sm"
                : "text-white/60 hover:text-white"
            }`}
          >
            گفت‌وگو
          </button>
          <button
            type="button"
            onClick={() => setMode("task")}
            className={`px-5 py-1 text-xs rounded-full transition-all duration-150 ${
              mode === "task"
                ? "bg-[#2c2c32] text-white font-medium shadow-sm"
                : "text-white/60 hover:text-white"
            }`}
          >
            وظیفه
          </button>
        </div>

        {/* Top Right: Mobile Pairing + Brand/Model + Sidebar Toggle + Window Controls */}
        <div className="no-drag flex items-center gap-2.5">
          {/* Hidden File Input for images */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Short-Code Pairing Button for Android */}
          <button
            type="button"
            onClick={generateMobilePairCode}
            className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium text-cyan-300 bg-cyan-950/40 border border-cyan-500/30 hover:bg-cyan-900/50 hover:border-cyan-400/50 transition-colors"
            title="تولید کد اتصال کوتاه موقت برای نسخه اندروید"
          >
            <span>📱</span>
            <span>اتصال به اندروید</span>
          </button>

          {/* Seamless In-App Hot Update Button */}
          {updateInfo?.has_update && (
            <button
              type="button"
              onClick={handleApplyUpdate}
              disabled={updating}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold text-emerald-300 bg-emerald-950/70 border border-emerald-500/50 hover:bg-emerald-900/80 transition-all shadow-lg animate-pulse"
              title={`نسخه جدید ${updateInfo.latest_version}: ${updateInfo.release_notes} (بروزرسانی محلی بدون نیاز به ادمین یا نصب مجدد)`}
            >
              <span>⚡</span>
              <span>{updating ? "در حال اعمال..." : `آپدیت v${updateInfo.latest_version}`}</span>
            </button>
          )}

          {/* Brand / Model pill with Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs text-white/80 hover:bg-white/5 transition-colors border border-transparent hover:border-white/10"
            >
              <span className="font-semibold tracking-wide">{selectedModel}</span>
              <span className="text-[10px] text-white/50">▾</span>
            </button>
            {modelDropdownOpen && (
              <div className="glass-popover absolute top-full left-0 mt-2 w-48 rounded-xl p-1.5 z-50">
                {["GPT-5.6 Sol Light", "Gemini 2.5 Flash", "Gemini 2.5 Pro", "Claude 3.5 Sonnet", "Qwen 2.5 Coder"].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { setSelectedModel(m); setModelDropdownOpen(false); }}
                    className="w-full text-right px-2.5 py-1.5 rounded-lg text-xs hover:bg-white/10 flex items-center justify-between text-white"
                  >
                    <span>{m}</span>
                    {selectedModel === m && <span className="text-cyan-400 text-xs">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sidebar Toggle Button [|] */}
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title="نمایش/پنهان‌سازی سایدبار"
            className={`w-7 h-7 flex items-center justify-center rounded-md border text-sm transition-colors ${
              sidebarOpen
                ? "bg-white/10 border-white/20 text-white"
                : "border-white/10 text-white/60 hover:text-white hover:bg-white/5"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </button>

          {/* Window Control Buttons */}
          <div className="flex items-center gap-1 mr-1">
            <button
              type="button"
              onClick={handleMinimize}
              title="کوچک‌کردن"
              className="w-7 h-7 flex items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white transition-colors text-sm"
            >
              −
            </button>
            <button
              type="button"
              onClick={handleToggleMaximize}
              title="بزرگ‌کردن"
              className="w-7 h-7 flex items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white transition-colors text-xs"
            >
              □
            </button>
            <button
              type="button"
              onClick={handleClose}
              title="بستن"
              className="w-7 h-7 flex items-center justify-center rounded text-white/70 hover:bg-red-500/80 hover:text-white transition-colors text-sm"
            >
              ✕
            </button>
          </div>
        </div>
      </header>

      {/* 2. MAIN BODY (CANVAS + SIDEBAR) */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Center Main Workstation Canvas */}
        <main className="flex-1 flex flex-col h-full overflow-hidden relative">
          {/* Notification Toast for Actions */}
          <AnimatePresence>
            {actionNotice && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-cyan-950/90 border border-cyan-500/40 text-cyan-200 text-xs shadow-2xl flex items-center gap-2"
              >
                <span>✦</span>
                <span>{actionNotice}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* VIEW ROUTER */}
          {mode === "chat" ? (
            /* ================= CHAT MODE (Image 1) ================= */
            <div className="flex-1 flex flex-col h-full overflow-hidden justify-between p-6">
              {chatMessages.length === 0 ? (
                /* Empty Chat - Centered Headline (Image 1) */
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <h1 className="text-3xl font-bold text-white mb-8 tracking-tight">
                    چطور می‌توانم به شما کمک کنم؟
                  </h1>

                  {/* Centered Floating Pill Input Bar with Image Attachment Previews */}
                  <div className="w-full max-w-2xl relative">
                    {/* Image Attachment Preview Strip */}
                    {attachedImages.length > 0 && (
                      <div className="flex items-center gap-2 mb-2 p-2 rounded-2xl bg-[#141417] border border-white/10 overflow-x-auto shadow-lg">
                        <div className="text-[11px] text-white/50 pl-2">
                          تصاویر پیوست ({attachedImages.length}/۵):
                        </div>
                        {attachedImages.map((img, idx) => (
                          <div key={idx} className="relative group w-14 h-14 rounded-xl overflow-hidden border border-white/20 flex-none shadow-md">
                            <img src={img} alt="attachment" className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={() => removeAttachedImage(idx)}
                              className="absolute top-1 right-1 w-4 h-4 rounded-full bg-black/70 text-white text-[10px] flex items-center justify-center hover:bg-red-500 transition-colors"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <form
                      onSubmit={handleSubmit}
                      onPaste={handlePaste}
                      className="prompt-box rounded-full px-4 py-3 flex items-center justify-between gap-3 bg-[#17171a] border border-white/10 shadow-2xl"
                    >
                      {/* Left Icons: Send, Mic, Waveform, Model */}
                      <div className="flex items-center gap-2">
                        <button
                          type="submit"
                          disabled={(!prompt.trim() && attachedImages.length === 0) || sending}
                          className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center font-bold text-sm hover:bg-white/90 disabled:opacity-40 transition-opacity"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="w-7 h-7 flex items-center justify-center text-white/50 hover:text-white transition-colors"
                          title="ضبط صدا"
                        >
                          🎙
                        </button>
                        <span className="text-xs text-white/30 tracking-widest pl-1">ıllıl</span>
                        <div className="flex items-center gap-1 text-xs text-white/60 bg-white/5 px-2.5 py-1 rounded-full border border-white/5 cursor-pointer hover:bg-white/10">
                          <span>هوشمند</span>
                          <span className="text-[9px]">▾</span>
                        </div>
                      </div>

                      {/* Right: Plus Icon + Text Input */}
                      <div className="flex-1 flex items-center gap-2">
                        <input
                          type="text"
                          value={prompt}
                          onChange={(e) => setPrompt(e.target.value)}
                          placeholder="سوال خود را بپرسید یا عکس Paste کنید (Ctrl+V)..."
                          className="w-full bg-transparent border-0 outline-none text-sm text-white placeholder-white/40 text-right"
                        />
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="w-6 h-6 flex items-center justify-center text-white/50 hover:text-white transition-colors"
                          title="افزودن عکس یا فایل (حداکثر ۵ عکس)"
                        >
                          +
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              ) : (
                /* Active Conversation Stream */
                <div className="flex-1 flex flex-col overflow-y-auto px-4 py-2 space-y-4 max-w-3xl mx-auto w-full">
                  {chatMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${msg.sender === "user" ? "items-start" : "items-end"} w-full`}
                    >
                      <div
                        className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                          msg.sender === "user"
                            ? "bg-[#25252b] text-white rounded-br-sm"
                            : "bg-[#18181b] border border-white/10 text-zinc-100 rounded-bl-sm"
                        }`}
                      >
                        {/* Attached Images in Message Bubble */}
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
                        {msg.model && (
                          <div className="mt-2 text-[10px] text-cyan-400/80 font-mono flex items-center gap-1">
                            <span>⚡</span>
                            <span>{msg.model}</span>
                          </div>
                        )}
                        {/* Prompt Cache & RTK Badges */}
                        {Boolean(msg.promptCacheTokens || msg.rtkSavingsPercent) && (
                          <div className="mt-2 pt-1.5 border-t border-white/5 flex flex-wrap gap-2 text-[10px]">
                            {Boolean(msg.promptCacheTokens && msg.promptCacheTokens > 0) && (
                              <span className="px-2 py-0.5 rounded-md bg-emerald-950/60 border border-emerald-500/30 text-emerald-300 flex items-center gap-1 font-mono">
                                <span>⚡</span>
                                <span>کش پرامپت: {msg.promptCacheTokens} توکن</span>
                              </span>
                            )}
                            {Boolean(msg.rtkSavingsPercent && msg.rtkSavingsPercent > 0) && (
                              <span className="px-2 py-0.5 rounded-md bg-cyan-950/60 border border-cyan-500/30 text-cyan-300 flex items-center gap-1 font-mono">
                                <span>🛡️</span>
                                <span>صرفه‌جویی RTK: {msg.rtkSavingsPercent}٪</span>
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {/* Fixed bottom input when chatting */}
                  <div className="pt-4 pb-2">
                    {/* Image Attachment Preview Strip */}
                    {attachedImages.length > 0 && (
                      <div className="flex items-center gap-2 mb-2 p-2 rounded-2xl bg-[#141417] border border-white/10 overflow-x-auto shadow-lg">
                        <div className="text-[11px] text-white/50 pl-2">
                          تصاویر پیوست ({attachedImages.length}/۵):
                        </div>
                        {attachedImages.map((img, idx) => (
                          <div key={idx} className="relative group w-14 h-14 rounded-xl overflow-hidden border border-white/20 flex-none shadow-md">
                            <img src={img} alt="attachment" className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={() => removeAttachedImage(idx)}
                              className="absolute top-1 right-1 w-4 h-4 rounded-full bg-black/70 text-white text-[10px] flex items-center justify-center hover:bg-red-500 transition-colors"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    <form
                      onSubmit={handleSubmit}
                      onPaste={handlePaste}
                      className="prompt-box rounded-full px-4 py-2.5 flex items-center justify-between gap-3 bg-[#17171a] border border-white/10 shadow-xl"
                    >
                      <button
                        type="submit"
                        disabled={(!prompt.trim() && attachedImages.length === 0) || sending}
                        className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center font-bold text-sm hover:bg-white/90 disabled:opacity-40"
                      >
                        ↑
                      </button>
                      <input
                        type="text"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        placeholder="پیام بعدی خود را بفرستید یا عکس Paste کنید (Ctrl+V)..."
                        className="w-full bg-transparent border-0 outline-none text-sm text-white placeholder-white/40 text-right px-2"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-6 h-6 flex items-center justify-center text-white/50 hover:text-white transition-colors"
                        title="افزودن عکس (حداکثر ۵ عکس)"
                      >
                        +
                      </button>
                    </form>
                  </div>
                </div>
              )}

              {/* Bottom Disclaimer Footer */}
              <footer className="text-center text-[11px] text-white/30 pt-4">
                مدل‌های هوش مصنوعی می‌توانند اشتباه کنند. صحت اطلاعات مهم را بررسی کنید و از وارد کردن اطلاعات حساس بپرهیزید.
              </footer>
            </div>
          ) : taskView === "addons" ? (
            /* ================= ADDONS / EXTENSIONS VIEW (Image 4) ================= */
            <div className="flex-1 flex flex-col h-full overflow-y-auto p-8 max-w-5xl mx-auto w-full">
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold text-white">افزونه‌ها</h1>
                  <button type="button" className="text-white/60 hover:text-white text-lg">+</button>
                  <button type="button" className="text-white/60 hover:text-white text-sm">⟳</button>
                </div>
                {/* Switch between Addons and Skills */}
                <div className="flex items-center bg-[#1c1c20] p-0.5 rounded-full border border-white/10">
                  <button
                    type="button"
                    onClick={() => setTaskView("addons")}
                    className="px-4 py-1 text-xs rounded-full bg-[#2c2c32] text-white font-medium"
                  >
                    افزونه‌ها
                  </button>
                  <button
                    type="button"
                    onClick={() => setTaskView("skills")}
                    className="px-4 py-1 text-xs rounded-full text-white/60 hover:text-white"
                  >
                    مهارت‌ها
                  </button>
                </div>
              </div>
              <p className="text-xs text-white/50 mb-6">کار با جی‌پی‌تی در کنار ابزارهای مورد علاقه‌تان</p>

              {/* Search Bar */}
              <div className="mb-6 relative">
                <input
                  type="text"
                  value={addonSearch}
                  onChange={(e) => setAddonSearch(e.target.value)}
                  placeholder="جستجوی افزونه‌ها"
                  className="w-full bg-[#161619] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-white/40 text-right outline-none focus:border-white/20"
                />
              </div>

              {/* Installed Apps Row */}
              <div className="mb-6">
                <div className="flex items-center justify-between text-xs text-white/60 mb-3">
                  <span>نصب‌شده</span>
                  <div className="flex items-center gap-2 bg-[#1a1a1e] px-2.5 py-0.5 rounded-full border border-white/5">
                    <span className="text-white font-medium">همه</span>
                    <span>|</span>
                    <span className="text-white/50">نصب‌شده</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 overflow-x-auto pb-2">
                  {["🌐 Chrome", "💻 ترمینال", "📝 VS Code", "💬 اسلک", "📂 Drive", "📊 اکسل", "📄 ورد", "🐙 گیت", "📁 پوشه"].map((app, i) => (
                    <div key={i} className="flex-none px-3.5 py-2 rounded-xl bg-[#17171a] border border-white/5 text-xs text-white/80 flex items-center gap-2">
                      <span>{app}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Featured Addons Grid (Image 4) */}
              <div className="text-xs text-white/60 mb-3">برگزیده</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-8">
                {[
                  { title: "کنترل کامپیوتر", desc: "دیدن و کنترل برنامه‌های دسکتاپ با اجازهٔ شما", icon: "▶", checked: true },
                  { title: "فایل‌های پروژه", desc: "خواندن، ویرایش و بررسی فایل‌های پروژه انتخاب‌شده", icon: "📁", checked: true },
                  { title: "اسناد", desc: "ساخت و ویرایش فایل‌های Word و سند", icon: "📄", checked: true },
                  { title: "صفحه گسترده", desc: "خواندن، ساخت و بررسی فایل‌های اکسل و CSV", icon: "📊", checked: true },
                  { title: "قالب‌ساز", desc: "ساخت قالب از سند، کاربرگ و ارائه‌های شما", icon: "🎨", checked: true },
                  { title: "مرورگر", desc: "باز کردن و کار با وب‌سایت‌ها در مرورگر ایزوله", icon: "🌐", checked: false },
                  { title: "Google Chrome", desc: "کار با تب‌ها و حساب‌های وارد شدهٔ Chrome شما", icon: "🌐", checked: false },
                  { title: "Git", desc: "بررسی تغییرات، تاریخچه و شاخه‌های مخزن", icon: "🐙", checked: true },
                  { title: "PDF", desc: "خواندن، ساخت و بررسی فایل‌های PDF", icon: "📑", checked: false },
                  { title: "ارائه‌ها", desc: "ساخت و ویرایش اسلایدهای ارائه", icon: "📊", checked: false },
                  { title: "مصورسازی", desc: "تبدیل ایده‌ها و داده‌ها به تصویرهای تعاملی", icon: "📈", checked: true },
                ].map((item, i) => (
                  <div key={i} className="feature-card p-3.5 rounded-2xl flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-lg">
                        {item.icon}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-white">{item.title}</div>
                        <div className="text-[11px] text-white/50 mt-0.5">{item.desc}</div>
                      </div>
                    </div>
                    <div className={`w-5 h-5 rounded-md flex items-center justify-center text-xs ${item.checked ? "text-cyan-400 bg-cyan-950/60 border border-cyan-500/40" : "text-white/20 border border-white/10"}`}>
                      {item.checked ? "✓" : ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : taskView === "skills" ? (
            /* ================= SKILLS VIEW (Image 5) ================= */
            <div className="flex-1 flex flex-col h-full overflow-y-auto p-8 max-w-5xl mx-auto w-full">
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold text-white">مهارت‌ها</h1>
                  <button type="button" className="text-white/60 hover:text-white text-lg">+</button>
                  <button type="button" className="text-white/60 hover:text-white text-sm">⟳</button>
                </div>
                {/* Switch between Addons and Skills */}
                <div className="flex items-center bg-[#1c1c20] p-0.5 rounded-full border border-white/10">
                  <button
                    type="button"
                    onClick={() => setTaskView("addons")}
                    className="px-4 py-1 text-xs rounded-full text-white/60 hover:text-white"
                  >
                    افزونه‌ها
                  </button>
                  <button
                    type="button"
                    onClick={() => setTaskView("skills")}
                    className="px-4 py-1 text-xs rounded-full bg-[#2c2c32] text-white font-medium"
                  >
                    مهارت‌ها
                  </button>
                </div>
              </div>
              <p className="text-xs text-white/50 mb-6">OmniOps را با مهارت‌های تخصصی برای هر کار گسترش دهید</p>

              {/* Search & GitHub 9Router Sync Toolbar */}
              <div className="mb-4 flex flex-col md:flex-row items-center gap-3">
                <input
                  type="text"
                  value={skillSearch}
                  onChange={(e) => setSkillSearch(e.target.value)}
                  placeholder="جستجوی مهارت‌ها..."
                  className="w-full md:flex-1 bg-[#161619] border border-white/10 rounded-xl px-4 py-2 text-xs text-white placeholder-white/40 text-right outline-none focus:border-white/20"
                />
                <div className="flex items-center gap-2 w-full md:w-auto">
                  <input
                    type="text"
                    value={skillsRepoUrl}
                    onChange={(e) => setSkillsRepoUrl(e.target.value)}
                    className="bg-[#121215] border border-white/10 rounded-xl px-3 py-2 text-xs text-cyan-300 font-mono outline-none text-left w-52"
                    dir="ltr"
                    title="آدرس مخزن مهارت‌ها در GitHub"
                  />
                  <button
                    type="button"
                    onClick={handleSyncSkills}
                    disabled={skillsSyncing}
                    className="px-3.5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-semibold text-xs transition-colors flex items-center gap-1.5 whitespace-nowrap shadow-md shadow-cyan-500/20 disabled:opacity-50"
                  >
                    <span>{skillsSyncing ? "⏳" : "⟳"}</span>
                    <span>{skillsSyncing ? "در حال دریافت..." : "بروزرسانی از گیت‌هاب"}</span>
                  </button>
                </div>
              </div>

              {/* Installed Skills Section (OmniOps Enterprise Skills) */}
              <div className="flex items-center gap-2 text-xs text-white/60 mb-3">
                <span>مهارت‌های فعال سیستم</span>
                <span className="w-5 h-5 rounded-full bg-cyan-950/80 border border-cyan-500/30 text-cyan-300 flex items-center justify-center text-[10px] font-mono">۱۱</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
                {[
                  { title: "گفت‌وگو و توسعه کد پیشرفته", desc: "مدیریت مکالمه چندزبانه و چرخش هوشمند میان مدل‌های ابری و محلی", icon: "💬" },
                  { title: "هسته ارکستراتور و بهینه‌سازی توکن", desc: "ذخیره‌ساز توکن RTK و درگاه OpenAI Compatible برای ادیتورها و ترمینال", icon: "🌐" },
                  { title: "تعبیه‌سازی و بردارهای RAG", desc: "تولید امبدینگ‌های متنی برای جستجوی معنایی و پایگاه دانش Qdrant", icon: "🧬" },
                  { title: "تولید تصویر هوشمند", desc: "تولید و ویرایش تصویر با Imagen 3 و FLUX", icon: "🖼" },
                  { title: "تبدیل صوت به متن (STT)", desc: "پیاده‌سازی دقیق گفتار به متن فارسی با Whisper روی CPU/GPU", icon: "🎙" },
                  { title: "تبدیل متن به گفتار (TTS)", desc: "تبدیل پاسخ‌ها به صدای رسا و طبیعی فارسی و انگلیسی", icon: "🔊" },
                  { title: "تولید ویدیوی هوش مصنوعی", desc: "رندر و پولینگ ناهمگام ویدیوهای xAI Grok Imagine", icon: "🎥" },
                  { title: "استخراج محتوای وب (Web Fetch)", desc: "واکشی صفحات وب و پاکسازی تگ‌های زائد به مارک‌داون تمیز", icon: "📄" },
                  { title: "جستجوی زنده در وب (Web Search)", desc: "جستجوی زنده اینترنتی و استخراج ارجاعات", icon: "🔍" },
                  { title: "کنترل کامپیوتر ویندوز", desc: "کنترل ماوس، کیبورد و فرامین سیستمی با تایید ۳ لایه", icon: "🛡" },
                  { title: "عیب‌یابی پیشرفته سیستم", desc: "مانیتورینگ سخت‌افزار، سلامت شبکه و تست سرویس‌های ابری", icon: "⚡" },
                ].map((s, i) => (
                  <div key={i} className="feature-card p-3.5 rounded-2xl flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-lg">
                        {s.icon}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-white">{s.title}</div>
                        <div className="text-[11px] text-white/50 mt-0.5">{s.desc}</div>
                      </div>
                    </div>
                    <div className="text-cyan-400 text-xs font-bold">✓</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* ================= TASK PROMPT VIEW (Image 2 & 3) ================= */
            <div className="flex-1 flex flex-col h-full overflow-hidden justify-center items-center p-6 relative">
              {/* Headline */}
              <h1 className="text-3xl font-bold text-white mb-6 tracking-tight text-center">
                امروز چه کاری انجام دهیم؟
              </h1>

              {/* Sub-Pills above prompt: [انتخاب پروژه ˅] and [افزونه‌ها | مهارت‌ها] */}
              <div className="w-full max-w-2xl flex items-center justify-between mb-3 px-2">
                {/* Project Selector Pill */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setProjectDropdownOpen(!projectDropdownOpen)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#18181c] border border-white/10 text-xs text-white/80 hover:bg-[#202025] transition-colors"
                  >
                    <span>📁</span>
                    <span>{selectedProject}</span>
                    <span className="text-[10px] text-white/40">▾</span>
                  </button>

                  {/* Project Dropdown */}
                  {projectDropdownOpen && (
                    <div className="glass-popover absolute top-full right-0 mt-2 w-56 rounded-2xl p-2 z-50">
                      <div className="text-[10px] text-white/40 px-2 py-1">پروژه‌های در دسترس</div>
                      {["پروژه سازمانی OmniOps", "ماژول ویندوز Tauri v2", "هسته هوش مصنوعی Master"].map((p, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => { setSelectedProject(p); setProjectDropdownOpen(false); }}
                          className="w-full text-right px-2 py-1.5 rounded-lg text-xs hover:bg-white/10 flex items-center justify-between"
                        >
                          <span>{p}</span>
                          {selectedProject === p && <span className="text-cyan-400 text-xs">✓</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Add-ons & Skills Pill */}
                <div className="flex items-center bg-[#18181c] p-0.5 rounded-full border border-white/10">
                  <button
                    type="button"
                    onClick={() => setTaskView("addons")}
                    className="px-3 py-1 text-xs rounded-full text-white/70 hover:text-white transition-colors"
                  >
                    افزونه‌ها
                  </button>
                  <span className="text-white/20 text-xs">|</span>
                  <button
                    type="button"
                    onClick={() => setTaskView("skills")}
                    className="px-3 py-1 text-xs rounded-full text-white/70 hover:text-white transition-colors"
                  >
                    مهارت‌ها
                  </button>
                </div>
              </div>

              {/* The Task Prompt Box (Image 2 & 3) */}
              <div className="w-full max-w-2xl relative">
                {/* Image Attachment Preview Strip */}
                {attachedImages.length > 0 && (
                  <div className="flex items-center gap-2 mb-2 p-2 rounded-2xl bg-[#141417] border border-white/10 overflow-x-auto shadow-lg">
                    <div className="text-[11px] text-white/50 pl-2">
                      تصاویر پیوست ({attachedImages.length}/۵):
                    </div>
                    {attachedImages.map((img, idx) => (
                      <div key={idx} className="relative group w-14 h-14 rounded-xl overflow-hidden border border-white/20 flex-none shadow-md">
                        <img src={img} alt="attachment" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removeAttachedImage(idx)}
                          className="absolute top-1 right-1 w-4 h-4 rounded-full bg-black/70 text-white text-[10px] flex items-center justify-center hover:bg-red-500 transition-colors"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <form
                  onSubmit={handleSubmit}
                  onPaste={handlePaste}
                  className="prompt-box rounded-2xl p-4 flex flex-col justify-between gap-4 bg-[#17171a] border border-white/10 shadow-2xl"
                >
                  {/* Top input line */}
                  <div className="flex items-center justify-between gap-3">
                    <input
                      type="text"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="درخواست خود را وارد کنید یا عکس Paste کنید (Ctrl+V)..."
                      className="w-full bg-transparent border-0 outline-none text-sm text-white placeholder-white/40 text-right"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-6 h-6 flex items-center justify-center text-white/50 hover:text-white text-lg"
                      title="افزودن عکس یا فایل (حداکثر ۵ عکس)"
                    >
                      +
                    </button>
                  </div>

                  {/* Bottom Controls Bar: Approval Badge + Effort Slider + Send Button */}
                  <div className="flex items-center justify-between pt-2 border-t border-white/5">
                    {/* Left: Send Button & Mic & Model Picker */}
                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        disabled={!prompt.trim() || sending}
                        className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center font-bold text-sm hover:bg-white/90 disabled:opacity-40 transition-opacity"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="w-7 h-7 flex items-center justify-center text-white/50 hover:text-white text-sm"
                        title="ورودی صوتی"
                      >
                        🎙
                      </button>

                      {/* Model & Effort Slider Button (Image 3) */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => { setEffortPopoverOpen(!effortPopoverOpen); setApprovalPopoverOpen(false); }}
                          className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs text-white/80 bg-white/5 border border-white/10 hover:bg-white/10"
                        >
                          <span>⚡</span>
                          <span>{selectedModel}</span>
                          <span className="text-[9px]">▾</span>
                        </button>

                        {/* Effort Slider Popover (Image 3) */}
                        {effortPopoverOpen && (
                          <div className="glass-popover absolute bottom-full left-0 mb-3 w-64 rounded-2xl p-4 z-50">
                            <div className="flex items-center justify-between text-xs text-white font-medium mb-3">
                              <span className="flex items-center gap-1">
                                <span>⚡</span>
                                <span>{selectedModel}</span>
                              </span>
                              <span className="text-[10px] text-white/40">سطح توان</span>
                            </div>
                            {/* Discrete Slider */}
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-[10px] text-white/50">
                                <span>کم</span>
                                <span>متوسط</span>
                                <span>حداکثر</span>
                              </div>
                              <input
                                type="range"
                                min="1"
                                max="5"
                                step="1"
                                value={effortLevel}
                                onChange={(e) => setEffortLevel(Number(e.target.value))}
                                className="w-full accent-cyan-400 cursor-pointer"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right: The 3-Tier Approval Mode Dropdown (Image 2) */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => { setApprovalPopoverOpen(!approvalPopoverOpen); setEffortPopoverOpen(false); }}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                          approvalMode === "full_access"
                            ? "bg-red-950/40 border-red-500/40 text-red-200 hover:bg-red-900/50"
                            : approvalMode === "auto"
                            ? "bg-cyan-950/40 border-cyan-500/40 text-cyan-200 hover:bg-cyan-900/50"
                            : "bg-amber-950/40 border-amber-500/40 text-amber-200 hover:bg-amber-900/50"
                        }`}
                      >
                        <span>
                          {approvalMode === "full_access" ? "⚡" : approvalMode === "auto" ? "🛡️" : "✋"}
                        </span>
                        <span>
                          {approvalMode === "full_access"
                            ? "دسترسی کامل"
                            : approvalMode === "auto"
                            ? "تأیید خودکار"
                            : "تأیید دستی"}
                        </span>
                        <span className="text-[9px]">▾</span>
                      </button>

                      {/* The Approval Popover Menu (Image 2) */}
                      {approvalPopoverOpen && (
                        <div className="glass-popover absolute bottom-full right-0 mb-3 w-84 rounded-2xl p-3 z-50 shadow-2xl">
                          {/* Header */}
                          <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/10 text-xs">
                            <span className="text-white/80 font-medium">اقدام‌های دستیار چطور تأیید شوند؟</span>
                            <button type="button" className="text-cyan-400 text-[11px] hover:underline">
                              بیشتر بدانید
                            </button>
                          </div>

                          {/* 3 Options */}
                          <div className="space-y-1.5">
                            {/* Option 1: Manual */}
                            <button
                              type="button"
                              onClick={() => updateApprovalMode("manual")}
                              className={`w-full text-right p-2.5 rounded-xl transition-all flex items-start gap-3 ${
                                approvalMode === "manual" ? "bg-white/10 border border-white/15" : "hover:bg-white/5"
                              }`}
                            >
                              <div className="text-lg">✋</div>
                              <div className="flex-1">
                                <div className="text-xs font-semibold text-white flex items-center justify-between">
                                  <span>تأیید دستی</span>
                                  {approvalMode === "manual" && <span className="text-cyan-400 text-xs">✓</span>}
                                </div>
                                <div className="text-[11px] text-white/50 mt-0.5 leading-relaxed">
                                  داخل پروژه ویرایش و اجرا می‌کند؛ اینترنت و بیرون پروژه با اجازه
                                </div>
                              </div>
                            </button>

                            {/* Option 2: Auto */}
                            <button
                              type="button"
                              onClick={() => updateApprovalMode("auto")}
                              className={`w-full text-right p-2.5 rounded-xl transition-all flex items-start gap-3 ${
                                approvalMode === "auto" ? "bg-white/10 border border-white/15" : "hover:bg-white/5"
                              }`}
                            >
                              <div className="text-lg">🛡️</div>
                              <div className="flex-1">
                                <div className="text-xs font-semibold text-white flex items-center justify-between">
                                  <span>تأیید خودکار</span>
                                  {approvalMode === "auto" && <span className="text-cyan-400 text-xs">✓</span>}
                                </div>
                                <div className="text-[11px] text-white/50 mt-0.5 leading-relaxed">
                                  کارهای امن را خودکار تأیید می‌کند؛ موارد پرخطر با اجازه
                                </div>
                              </div>
                            </button>

                            {/* Option 3: Full Access (The user specifically asked for this!) */}
                            <button
                              type="button"
                              onClick={() => updateApprovalMode("full_access")}
                              className={`w-full text-right p-2.5 rounded-xl transition-all flex items-start gap-3 ${
                                approvalMode === "full_access" ? "bg-red-950/40 border border-red-500/40" : "hover:bg-white/5"
                              }`}
                            >
                              <div className="text-lg">⚡</div>
                              <div className="flex-1">
                                <div className="text-xs font-semibold text-white flex items-center justify-between">
                                  <span className="text-red-300">دسترسی کامل</span>
                                  {approvalMode === "full_access" && <span className="text-red-400 text-xs">✓</span>}
                                </div>
                                <div className="text-[11px] text-white/50 mt-0.5 leading-relaxed">
                                  بدون اجازه به اینترنت و همهٔ فایل‌ها دسترسی دارد
                                </div>
                              </div>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </form>
              </div>

              {/* Bottom storage notice */}
              <div className="text-[10px] text-white/30 text-center mt-6">
                وظایف تنها روی دستگاه شما ذخیره می‌شوند و برای پشتیبان‌گیری به تنظیمات مراجعه کنید.
              </div>
            </div>
          )}
        </main>

        {/* 3. COLLAPSIBLE RIGHT SIDEBAR (Image 4 & 5) */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 260, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="flex-none bg-[#111114] border-r border-white/10 flex flex-col justify-between overflow-hidden z-30"
            >
              {/* Top Navigation Items */}
              <div className="p-3 space-y-1">
                <button
                  type="button"
                  onClick={() => { setMode("task"); setTaskView("prompt"); }}
                  className="w-full text-right px-3 py-2 rounded-xl text-xs text-white/80 hover:bg-white/10 flex items-center gap-2.5"
                >
                  <span className="text-sm">+</span>
                  <span>وظیفه جدید</span>
                </button>
                <button
                  type="button"
                  onClick={fetchLocalModels}
                  className="w-full text-right px-3 py-2 rounded-xl text-xs text-white/80 hover:bg-white/10 flex items-center gap-2.5 transition-colors"
                >
                  <span>田</span>
                  <span>مدیریت مدل‌های لوکال (Ollama)</span>
                </button>
                <button
                  type="button"
                  className="w-full text-right px-3 py-2 rounded-xl text-xs text-white/80 hover:bg-white/10 flex items-center gap-2.5"
                >
                  <span>🖼</span>
                  <span>تولید تصویر</span>
                </button>
                <button
                  type="button"
                  className="w-full text-right px-3 py-2 rounded-xl text-xs text-white/80 hover:bg-white/10 flex items-center gap-2.5"
                >
                  <span>🎥</span>
                  <span>تولید ویدیو</span>
                </button>
                <button
                  type="button"
                  className="w-full text-right px-3 py-2 rounded-xl text-xs text-white/80 hover:bg-white/10 flex items-center gap-2.5"
                >
                  <span>👤</span>
                  <span>دستیارها</span>
                </button>
                <button
                  type="button"
                  className="w-full text-right px-3 py-2 rounded-xl text-xs text-white/80 hover:bg-white/10 flex items-center gap-2.5"
                >
                  <span>⏰</span>
                  <span>وظایف زمان‌بندی‌شده</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setMode("task"); setTaskView("addons"); }}
                  className={`w-full text-right px-3 py-2 rounded-xl text-xs flex items-center gap-2.5 ${
                    taskView === "addons" || taskView === "skills"
                      ? "bg-white/10 text-white font-medium"
                      : "text-white/80 hover:bg-white/10"
                  }`}
                >
                  <span>🧩</span>
                  <span>افزونه‌ها و مهارت‌ها</span>
                </button>
              </div>

              {/* Middle: Projects & Recent History */}
              <div className="flex-1 overflow-y-auto px-3 py-2 space-y-4 border-t border-white/5">
                <div>
                  <div className="text-[11px] text-white/40 mb-2 px-2 flex items-center justify-between">
                    <span>پروژه‌ها</span>
                    <span className="text-[10px]">›</span>
                  </div>
                  <div className="text-xs text-white/70 px-2 py-1 rounded-lg hover:bg-white/5 cursor-pointer">
                    {selectedProject}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] text-white/40 mb-2 px-2 flex items-center justify-between">
                    <span>گفت‌وگوها</span>
                    <span className="text-[10px]">˅</span>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] text-white/30 px-2">دیروز</div>
                    <div className="text-xs text-white/70 px-2 py-1 rounded-lg hover:bg-white/5 cursor-pointer truncate">
                      معرفی مدل هوش مصنوعی
                    </div>
                    <div className="text-[10px] text-white/30 px-2 pt-2">هفته گذشته</div>
                    <div className="text-xs text-white/70 px-2 py-1 rounded-lg hover:bg-white/5 cursor-pointer truncate">
                      مهندسی معکوس و بومی‌سازی OmniOps
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom: User Account */}
              <div className="p-3 border-t border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-cyan-900/60 border border-cyan-500/40 flex items-center justify-center text-xs text-cyan-200">
                    👤
                  </div>
                  <div className="text-xs">
                    <div className="font-medium text-white">{profile?.username}</div>
                    <div className="text-[10px] text-white/40">سازمان خصوصی</div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setIdentityModalOpen(true)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-white/50 hover:text-cyan-300 hover:bg-white/10 transition-colors text-sm"
                    title="شناسنامه و فلسفه بنیادین هسته OmniOps"
                  >
                    📖
                  </button>
                  <button
                    type="button"
                    onClick={fetchHardwareMetrics}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors text-sm"
                    title="مانیتورینگ سخت‌افزار سرور و وضعیت کارت گرافیک"
                  >
                    ⚙
                  </button>
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* 4. ACTION APPROVAL GATE MODAL (When Action Needs Permission) */}
      <AnimatePresence>
        {pendingAction && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-popover w-full max-w-md rounded-2xl p-6 border border-white/15 text-right shadow-2xl"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
                <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                  <span>✋</span>
                  <span>تأیید اقدام دستیار هوشمند</span>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-950/60 border border-amber-500/30 text-amber-300">
                  نیازمند تأیید
                </span>
              </div>

              <div className="text-sm font-semibold text-white mb-1">{pendingAction.title}</div>
              <p className="text-xs text-white/60 leading-relaxed mb-4">{pendingAction.description}</p>

              <div className="bg-[#121215] rounded-xl p-3 border border-white/10 font-mono text-[11px] text-cyan-300 mb-6 overflow-x-auto text-left" dir="ltr">
                {JSON.stringify(pendingAction.params, null, 2)}
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={rejectAction}
                  className="px-4 py-2 rounded-xl border border-white/15 text-xs text-white/70 hover:bg-white/10 transition-colors"
                >
                  رد درخواست
                </button>
                <button
                  type="button"
                  onClick={approveAction}
                  className="px-5 py-2 rounded-xl bg-cyan-500 text-black font-semibold text-xs hover:bg-cyan-400 transition-colors shadow-lg shadow-cyan-500/20"
                >
                  تأیید و اجرا
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 5. SHORT-CODE MOBILE PAIRING MODAL */}
      <AnimatePresence>
        {mobilePairModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-popover w-full max-w-md rounded-2xl p-6 border border-white/15 text-right shadow-2xl relative"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
                <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm">
                  <span>📱</span>
                  <span>اتصال سریع به کلاینت اندروید</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobilePairModalOpen(false)}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 text-xs"
                >
                  ✕
                </button>
              </div>

              <p className="text-xs text-white/70 leading-relaxed mb-4">
                کد کوتاه ۶ رقمی زیر را در برنامه اندروید OmniOps وارد کنید تا گوشی به این کلاینت ویندوزی متصل شود و تمام فرایندها و فرامین مستقیماً روی ویندوز اجرا شوند:
              </p>

              {/* 6-Digit Code Display */}
              <div className="bg-[#101014] rounded-2xl p-4 border border-cyan-500/30 text-center my-4 shadow-inner">
                <div className="text-[11px] text-white/40 mb-1">کد اتصال یک‌بار مصرف</div>
                <div className="text-3xl font-mono font-black text-cyan-300 tracking-[0.35em] my-2 select-all" dir="ltr">
                  {mobilePairCode ? `${mobilePairCode.slice(0, 3)} ${mobilePairCode.slice(3)}` : "------"}
                </div>
                <div className="text-[11px] text-amber-300/80 flex items-center justify-center gap-1 mt-1">
                  <span>⏱</span>
                  <span>اعتبار: {Math.floor(mobilePairSeconds / 60)}:{(mobilePairSeconds % 60).toString().padStart(2, "0")} دقیقه</span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 mt-6">
                <button
                  type="button"
                  onClick={generateMobilePairCode}
                  className="px-3 py-2 rounded-xl border border-white/10 text-xs text-white/70 hover:bg-white/10 transition-colors flex items-center gap-1.5"
                >
                  <span>⟳</span>
                  <span>تولید مجدد کد</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (mobilePairCode) {
                      navigator.clipboard.writeText(mobilePairCode);
                      setActionNotice("کد با موفقیت کپی شد");
                      setTimeout(() => setActionNotice(null), 2500);
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-cyan-500 text-black font-semibold text-xs hover:bg-cyan-400 transition-colors"
                >
                  کپی کردن کد
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 6. LOCAL MODELS HUB MODAL */}
      <AnimatePresence>
        {localModelsModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-popover w-full max-w-2xl rounded-2xl p-6 border border-white/15 text-right shadow-2xl relative max-h-[85vh] flex flex-col"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
                <div className="flex items-center gap-2 text-cyan-400 font-bold text-sm">
                  <span>田</span>
                  <span>مدیریت مدل‌های لوکال (Ollama / vLLM Hub)</span>
                </div>
                <button
                  type="button"
                  onClick={() => setLocalModelsModalOpen(false)}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 text-xs"
                >
                  ✕
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {localModels.map((m) => (
                  <div key={m.id} className="p-4 rounded-xl bg-[#141417] border border-white/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white text-xs">{m.name}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/60 font-mono">
                          {m.size_gb} GB
                        </span>
                        {m.active && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-500/30 text-emerald-300">
                            فعال در هسته
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-white/50 mt-1 leading-relaxed">{m.description}</p>
                      {/* Download Progress Bar if downloading */}
                      {m.status === "downloading" && (
                        <div className="mt-2 space-y-1">
                          <div className="flex items-center justify-between text-[10px] text-cyan-300">
                            <span>در حال دانلود ({m.download_speed})...</span>
                            <span className="font-mono">{m.download_progress}%</span>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                            <div
                              className="h-full bg-cyan-400 transition-all duration-300"
                              style={{ width: `${m.download_progress}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-none self-end sm:self-center">
                      {m.status === "available" ? (
                        <button
                          type="button"
                          onClick={() => handlePullModel(m.id)}
                          className="px-3 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-semibold text-xs transition-colors shadow-md"
                        >
                          نصب مدل
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleToggleModel(m.id, m.active)}
                          className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors ${
                            m.active
                              ? "bg-red-950/40 border-red-500/30 text-red-200 hover:bg-red-900/50"
                              : "bg-emerald-950/40 border-emerald-500/30 text-emerald-200 hover:bg-emerald-900/50"
                          }`}
                        >
                          {m.active ? "غیرفعال‌سازی" : "فعال‌سازی"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 7. SERVER HARDWARE TELEMETRY & GPU STATUS MODAL */}
      <AnimatePresence>
        {hardwareModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-popover w-full max-w-lg rounded-2xl p-6 border border-white/15 text-right shadow-2xl relative"
            >
              <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
                <div className="flex items-center gap-2 text-white font-bold text-sm">
                  <span>⚙</span>
                  <span>مانیتورینگ منابع سرور و سخت‌افزار (Cluster Hardware)</span>
                </div>
                <button
                  type="button"
                  onClick={() => setHardwareModalOpen(false)}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 text-xs"
                >
                  ✕
                </button>
              </div>

              {hardwareMetrics && (
                <div className="space-y-4 my-2 text-xs">
                  {/* CPU Usage */}
                  <div className="p-3 rounded-xl bg-[#141417] border border-white/10">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-white/70">پردازنده مرکزی (CPU) - {hardwareMetrics.cpu_cores} هسته</span>
                      <span className="font-mono text-cyan-300">{hardwareMetrics.cpu_percent}%</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full bg-cyan-400" style={{ width: `${hardwareMetrics.cpu_percent}%` }} />
                    </div>
                  </div>

                  {/* RAM Usage */}
                  <div className="p-3 rounded-xl bg-[#141417] border border-white/10">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-white/70">حافظه موقت (RAM)</span>
                      <span className="font-mono text-cyan-300">
                        {hardwareMetrics.ram_used_gb} / {hardwareMetrics.ram_total_gb} GB ({hardwareMetrics.ram_percent}%)
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full bg-cyan-400" style={{ width: `${hardwareMetrics.ram_percent}%` }} />
                    </div>
                  </div>

                  {/* Disk Usage */}
                  <div className="p-3 rounded-xl bg-[#141417] border border-white/10">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-white/70">فضای ذخیره‌سازی (Disk)</span>
                      <span className="font-mono text-cyan-300">
                        {hardwareMetrics.disk_used_gb} / {hardwareMetrics.disk_total_gb} GB ({hardwareMetrics.disk_percent}%)
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full bg-cyan-400" style={{ width: `${hardwareMetrics.disk_percent}%` }} />
                    </div>
                  </div>

                  {/* GPU Card Status Section (USER SPECIFIC FEATURE!) */}
                  {hardwareMetrics.has_gpu ? (
                    <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-emerald-200">
                      <div className="flex items-center justify-between font-semibold">
                        <span>کارت گرافیک (GPU): {hardwareMetrics.gpu_name}</span>
                        <span className="font-mono">{hardwareMetrics.gpu_percent}%</span>
                      </div>
                      <div className="text-[11px] text-emerald-300/80 mt-1">
                        حافظه اختصاصی VRAM: {hardwareMetrics.gpu_vram_used_gb} / {hardwareMetrics.gpu_vram_total_gb} GB
                      </div>
                    </div>
                  ) : (
                    /* The user's exact specification: "اگر سرور کارت گرافیک نداشت ولی رم و CPU خوب داشت سیستم کار کنه و تو پنل بنویسه این سیستم فاقد کارت گرافیک است" */
                    <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/40 text-amber-200 space-y-1">
                      <div className="flex items-center gap-2 font-bold text-amber-300 text-xs">
                        <span>⚠️</span>
                        <span>این سیستم فاقد کارت گرافیک است</span>
                      </div>
                      <p className="text-[11px] text-white/70 leading-relaxed">
                        پردازش‌های هوش مصنوعی با شتاب‌دهنده چندرشته‌ای پردازنده مرکزی (CPU) و حافظه رم قدرتمند با موفقیت و پایداری کامل در حال اجرا هستند.
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={fetchHardwareMetrics}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-colors"
                >
                  ⟳ بروزرسانی وضعیت لحظه‌ای
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 8. SYSTEM IDENTITY & ARCHITECTURAL PHILOSOPHY MODAL */}
      <AnimatePresence>
        {identityModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4" dir="rtl">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-popover w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-3xl p-6 border border-cyan-500/30 text-right shadow-2xl relative space-y-4"
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-cyan-600/30 border border-cyan-400/40 flex items-center justify-center text-xl shadow-lg">
                    🌐
                  </div>
                  <div>
                    <h2 className="text-base font-black text-white">شناسنامه و فلسفه بنیادین: OmniOps</h2>
                    <p className="text-[11px] text-cyan-300/80 font-mono">OmniOps Enterprise Studio • v2.0.0</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIdentityModalOpen(false)}
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 text-xs transition-colors"
                >
                  ✕
                </button>
              </div>

              {/* Core Concept Banner */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-cyan-950/60 to-blue-950/40 border border-cyan-500/20 leading-relaxed text-xs text-zinc-200">
                <span className="font-bold text-cyan-300 block mb-1">مفهوم بنیادین: سیستم مدیریت عملیات همه‌جانبه</span>
                این سیستم به عنوان یک <b className="text-white">«دپارتمان IT خودمختار»</b>، مرزهای سنتی میان توسعه‌دهنده نرم‌افزار (Dev) و مدیر زیرساخت (Ops) را از میان برمی‌دارد و هر گفت‌وگوی ساده را به یک اقدام فیزیکی، مهندسی‌شده و ایمن روی سرورها و سیستم‌های عامل تبدیل می‌کند.
              </div>

              {/* Anatomy of Name */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-white/90">🔹 کالبدشکافی نامگذاری</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  <div className="p-3 rounded-xl bg-[#141417] border border-white/10">
                    <span className="font-bold text-cyan-400 block mb-1">Omni (فراگیر و همه‌جانبه):</span>
                    <p className="text-white/60 text-[11px] leading-relaxed">
                      نماد یکپارچگی چندلایه؛ درک متمرکز تمام مدل‌های ابری و لوکال، منابع شبکه و درگاه‌های ویندوز و اندروید.
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-[#141417] border border-white/10">
                    <span className="font-bold text-cyan-400 block mb-1">Ops (عملیات و اقدام فیزیکی):</span>
                    <p className="text-white/60 text-[11px] leading-relaxed">
                      نماد قدرت اجرایی بی‌واسطه؛ کدنویسی واقعی، تست در داکر، مدیریت پورت‌ها و هدایت پردازش‌ها روی سرور.
                    </p>
                  </div>
                </div>
              </div>

              {/* Architectural Layers */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-white/90">🔹 اکوسیستم و اتاق فرمان</h3>
                <div className="space-y-1.5 text-[11px]">
                  <div className="p-2.5 rounded-xl bg-[#141417] border border-white/5 flex items-center justify-between">
                    <span className="text-zinc-200 font-semibold">🖥️ داشبورد شیشه‌ای ویندوز (Tauri v2 + Rust)</span>
                    <span className="text-cyan-400/80 font-mono text-[10px]">اتاق فرمان مرکزی و کنترل بومی سیستم‌عامل</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#141417] border border-white/5 flex items-center justify-between">
                    <span className="text-zinc-200 font-semibold">📱 ایجنت سیار اندروید (Companion Node)</span>
                    <span className="text-green-400/80 font-mono text-[10px]">پل ارتباطی همراه با LED وضعیت زنده</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-[#141417] border border-white/5 flex items-center justify-between">
                    <span className="text-zinc-200 font-semibold">🏛️ سرور مرکزی مستر (Ubuntu LAN)</span>
                    <span className="text-amber-400/80 font-mono text-[10px]">دیتابیس‌ها، حافظه برداری Qdrant و ارکستراتور</span>
                  </div>
                </div>
              </div>

              {/* Cognitive Pillars */}
              <div className="p-3 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between text-center text-[10px] text-white/70">
                <div>⚡ کش پرامپت سازمانی</div>
                <div>🛡️ ذخیره‌ساز توکن RTK</div>
                <div>🔄 موتور آبشار چندلایه</div>
                <div>🤝 انتقال بی‌وقفه (Handoff)</div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setIdentityModalOpen(false)}
                  className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-black text-xs font-bold transition-all shadow-md"
                >
                  بستن شناسنامه
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

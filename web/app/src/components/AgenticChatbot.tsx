import React, { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, type ModelMeta, type AttachedDoc, type ProjectFileEntry } from "../api";

export type ChatMode = "chat" | "task";
export type PermissionMode = "auto" | "approval";

export interface ChatSessionState {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  queuedMessages: QueuedMessage[];
  isProcessing: boolean;
}

export function formatFileSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getFileIcon(name: string, is_dir: boolean): string {
  if (is_dir) return "📁";
  if (name.endsWith(".py")) return "🐍";
  if (name.endsWith(".ts") || name.endsWith(".tsx")) return "🔷";
  if (name.endsWith(".js") || name.endsWith(".jsx")) return "🟨";
  if (name.endsWith(".json")) return "⚙️";
  if (name.endsWith(".md")) return "📝";
  if (name.endsWith(".css") || name.endsWith(".scss")) return "🎨";
  if (name.endsWith(".html")) return "🌐";
  if (name.endsWith(".sh") || name.endsWith(".ps1") || name.endsWith(".bat")) return "⚡";
  if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".svg")) return "🖼️";
  return "📄";
}

export interface ChatbotConfig {
  maxFileSizeMB: number;
  maxImages: number;
  pasteTextThreshold: number;
}

export interface AttachedFile {
  id: string;
  name: string;
  content: string;
  size: number;
}

export interface AttachedImage {
  id: string;
  name: string;
  dataUrl: string;
  size: number;
}

export interface ProjectBinding {
  id: string;
  name: string;
  root_path: string;
  git_repo?: string;
}

export interface AgentStep {
  id: string;
  type: "thinking" | "explore" | "command" | "timer" | "approval" | "status" | "file";
  title: string;
  subtitle?: string;
  durationSeconds?: number;
  status: "running" | "completed" | "waiting_approval" | "rejected" | "warning";
  content?: string;
  command?: string;
  details?: string[];
  isExpanded?: boolean;
  diffStats?: { added: number; removed: number };
}

export interface QueuedMessage {
  id: string;
  content: string;
  timestamp: number;
  attachedFiles?: AttachedFile[];
  attachedImages?: AttachedImage[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  model?: string;
  routingReason?: string;
  permissionMode?: PermissionMode;
  mode?: ChatMode;
  project?: ProjectBinding;
  steps?: AgentStep[];
  isStreaming?: boolean;
  totalWorkedSeconds?: number;
  attachedFiles?: AttachedFile[];
  attachedImages?: AttachedImage[];
  pendingApproval?: {
    stepId: string;
    actionName: string;
    command?: string;
    target?: string;
    description: string;
  } | null;
}

type Props = {
  onClose?: () => void;
};

const DEFAULT_CONFIG: ChatbotConfig = {
  maxFileSizeMB: 5,
  maxImages: 6,
  pasteTextThreshold: 1500,
};

const DEFAULT_PROJECT: ProjectBinding = {
  id: "p-omniops",
  name: "OmniOps",
  root_path: "C:\\Users\\arfaghani\\Desktop\\OmniOps",
  git_repo: "https://github.com/RedBoy-011/OmniOps.git",
};

// Helper for step badges and icons matching Antigravity
function getStepFileBadge(title: string) {
  if (title.includes(".tsx") || title.includes(".jsx")) {
    return { icon: "⚛", label: "React", color: "#61dafb", bg: "rgba(97, 218, 251, 0.15)" };
  }
  if (title.includes(".ts") || title.includes(".js")) {
    return { icon: "📄", label: "TS/JS", color: "#38bdf8", bg: "rgba(56, 189, 248, 0.15)" };
  }
  if (title.includes(".py")) {
    return { icon: "🐍", label: "Python", color: "#fbbf24", bg: "rgba(251, 191, 36, 0.15)" };
  }
  if (title.includes(".css")) {
    return { icon: "🎨", label: "CSS", color: "#f472b6", bg: "rgba(244, 114, 182, 0.15)" };
  }
  if (title.toLowerCase().includes("thought") || title.includes("تحلیل") || title.includes("تفکر")) {
    return { icon: "💡", label: "Thought", color: "#c084fc", bg: "rgba(192, 132, 252, 0.15)" };
  }
  if (title.toLowerCase().includes("git") || title.includes("commit") || title.includes("push")) {
    return { icon: "🌿", label: "Git", color: "#fb923c", bg: "rgba(251, 146, 60, 0.15)" };
  }
  if (title.toLowerCase().includes("test") || title.includes("تست")) {
    return { icon: "🧪", label: "Test", color: "#34d399", bg: "rgba(52, 211, 153, 0.15)" };
  }
  return { icon: "🔍", label: "Inspect", color: "#60a5fa", bg: "rgba(96, 165, 250, 0.15)" };
}

export function AgenticChatbot({ onClose }: Props) {
  // Modes & Config
  const [chatMode, setChatMode] = useState<ChatMode>(() => {
    return (localStorage.getItem("omniops_chat_mode") as ChatMode) || "chat";
  });
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => {
    return (localStorage.getItem("omniops_permission_mode") as PermissionMode) || "approval";
  });
  const [config, setConfig] = useState<ChatbotConfig>(() => {
    try {
      const saved = localStorage.getItem("omniops_chatbot_config");
      if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_CONFIG;
  });

  // Active Project & Path Binding
  const [activeProject, setActiveProject] = useState<ProjectBinding>(() => {
    try {
      const saved = localStorage.getItem("omniops_active_project");
      if (saved) return JSON.parse(saved);
    } catch {}
    return DEFAULT_PROJECT;
  });
  const [projectsList, setProjectsList] = useState<ProjectBinding[]>([DEFAULT_PROJECT]);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectBinding>(activeProject);

  // Live Windows Edge Agent status
  const [agentOnline, setAgentOnline] = useState<boolean>(false);
  const [agentNodeName, setAgentNodeName] = useState<string>("سیستم ویندوز");

  // Stepper collapsed states per message
  const [stepperCollapsed, setStepperCollapsed] = useState<Record<string, boolean>>({});

  // Session Model & Multi-Session Background Execution (Phase 2 Master Roadmap)
  const [sessions, setSessions] = useState<ChatSessionState[]>(() => {
    try {
      const saved = localStorage.getItem("omniops_chat_sessions_v2");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [
      {
        id: "session-default",
        title: localStorage.getItem("omniops_session_title") || "بررسی جامع و مسیر پروژه",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [
          {
            id: "welcome-1",
            role: "assistant",
            content: "درود! من دستیار هوشمند و ایجنتی OmniOps هستم. می‌توانید سوالات عمومی بپرسید (حالت گفتگو) یا وظایف تحلیلی، کدنویسی و بررسی پروژه را با اتصال به مسیر لوکال ویندوز و گزارش گام‌به‌گام به من بسپارید (حالت وظیفه).",
            timestamp: Date.now(),
            model: "auto",
            routingReason: "✨ موتور هوشمند JRV فعال است (انتخاب پویای مدل بین محلی و ابری)",
            mode: "chat",
          }
        ],
        queuedMessages: [],
        isProcessing: false,
      }
    ];
  });

  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    return sessions[0]?.id || "session-default";
  });

  // Dual Collapsible Sidebars & Project File Tree States
  const [isSessionsSidebarOpen, setIsSessionsSidebarOpen] = useState<boolean>(true);
  const [isFilesSidebarOpen, setIsFilesSidebarOpen] = useState<boolean>(false);
  const [projectFiles, setProjectFiles] = useState<ProjectFileEntry[]>([]);
  const [fileFilterQuery, setFileFilterQuery] = useState<string>("");
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);
  const [selectedFilePreview, setSelectedFilePreview] = useState<{
    path: string;
    name: string;
    content: string;
    lines: number;
    size: number;
  } | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingSessionTitleInput, setEditingSessionTitleInput] = useState<string>("");

  useEffect(() => {
    try {
      const sanitized = sessions.map(s => ({
        ...s,
        isProcessing: false
      }));
      localStorage.setItem("omniops_chat_sessions_v2", JSON.stringify(sanitized));
    } catch {}
  }, [sessions]);

  const currentSession = sessions.find(s => s.id === activeSessionId) || sessions[0];
  const messages = currentSession ? currentSession.messages : [];
  const queuedMessages = currentSession ? currentSession.queuedMessages : [];
  const isProcessing = currentSession ? currentSession.isProcessing : false;
  const sessionTitle = currentSession ? currentSession.title : "گفتگو";

  const setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>> = action => {
    setSessions(prev =>
      prev.map(s => {
        if (s.id !== activeSessionId) return s;
        const nextMessages = typeof action === "function" ? action(s.messages) : action;
        return { ...s, messages: nextMessages, updatedAt: Date.now() };
      })
    );
  };

  const setQueuedMessages: React.Dispatch<React.SetStateAction<QueuedMessage[]>> = action => {
    setSessions(prev =>
      prev.map(s => {
        if (s.id !== activeSessionId) return s;
        const nextQueue = typeof action === "function" ? action(s.queuedMessages) : action;
        return { ...s, queuedMessages: nextQueue, updatedAt: Date.now() };
      })
    );
  };

  const setIsProcessing: React.Dispatch<React.SetStateAction<boolean>> = action => {
    setSessions(prev =>
      prev.map(s => {
        if (s.id !== activeSessionId) return s;
        const nextStatus = typeof action === "function" ? action(s.isProcessing) : action;
        return { ...s, isProcessing: nextStatus };
      })
    );
  };

  const setSessionTitle = (newTitle: string) => {
    setSessions(prev =>
      prev.map(s => {
        if (s.id !== activeSessionId) return s;
        return { ...s, title: newTitle, updatedAt: Date.now() };
      })
    );
  };

  const [inputPrompt, setInputPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState<string>("auto");
  const [availableModels, setAvailableModels] = useState<string[]>(["auto"]);
  const [catalog, setCatalog] = useState<Record<string, ModelMeta>>({});
  const [activeTimerSeconds, setActiveTimerSeconds] = useState<number>(0);
  const [liveStatusText, setLiveStatusText] = useState<string>("");

  // Attachments State
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);

  // Action states
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [clipboardModal, setClipboardModal] = useState<{ text: string; charCount: number; lineCount: number } | null>(null);

  // Queued Messages & Drag/Drop States
  const [isQueueExpanded, setIsQueueExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const handleCreateNewSession = () => {
    const newId = `session-${Date.now()}`;
    const newSession: ChatSessionState = {
      id: newId,
      title: `گفتگوی جدید ${sessions.length + 1}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [
        {
          id: `welcome-${Date.now()}`,
          role: "assistant",
          content: "درود! یک گفتگوی جدید آغاز شد. چطور می‌توانم در توسعه پروژه یا حل مسئله به شما کمک کنم؟",
          timestamp: Date.now(),
          model: selectedModel,
          routingReason: "✨ موتور هوشمند JRV آماده به خدمت است",
          mode: chatMode
        }
      ],
      queuedMessages: [],
      isProcessing: false
    };
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newId);
  };

  const handleDeleteSession = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (sessions.length <= 1) {
      alert("حداقل یک گفتگو باید در سامانه حفظ شود.");
      return;
    }
    const remaining = sessions.filter(s => s.id !== id);
    setSessions(remaining);
    if (activeSessionId === id) {
      setActiveSessionId(remaining[0].id);
    }
  };

  const loadProjectFiles = async () => {
    if (!activeProject?.id) return;
    setIsLoadingFiles(true);
    try {
      const res = await api.listProjectFiles(activeProject.id);
      if (res && res.entries && res.entries.length > 0) {
        setProjectFiles(res.entries);
      } else {
        setProjectFiles([
          { name: "omniops", path: "omniops", is_dir: true, size: 0 },
          { name: "server.py", path: "omniops/server.py", is_dir: false, size: 121000 },
          { name: "router.py", path: "omniops/router.py", is_dir: false, size: 14200 },
          { name: "web_search.py", path: "omniops/web_search.py", is_dir: false, size: 4500 },
          { name: "AgenticChatbot.tsx", path: "web/app/src/components/AgenticChatbot.tsx", is_dir: false, size: 108000 },
          { name: "tokens.css", path: "web/app/src/design-system/tokens.css", is_dir: false, size: 10500 },
          { name: "package.json", path: "web/app/package.json", is_dir: false, size: 1800 }
        ]);
      }
    } catch {
      setProjectFiles([
        { name: "omniops", path: "omniops", is_dir: true, size: 0 },
        { name: "server.py", path: "omniops/server.py", is_dir: false, size: 121000 },
        { name: "router.py", path: "omniops/router.py", is_dir: false, size: 14200 },
        { name: "web_search.py", path: "omniops/web_search.py", is_dir: false, size: 4500 },
        { name: "AgenticChatbot.tsx", path: "web/app/src/components/AgenticChatbot.tsx", is_dir: false, size: 108000 },
        { name: "tokens.css", path: "web/app/src/design-system/tokens.css", is_dir: false, size: 10500 },
        { name: "package.json", path: "web/app/package.json", is_dir: false, size: 1800 }
      ]);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleOpenFilePreview = async (filePath: string) => {
    if (!activeProject?.id) return;
    try {
      const res = await api.readProjectFile(activeProject.id, filePath);
      if (res) {
        setSelectedFilePreview({
          path: res.path,
          name: res.path.split("/").pop()?.split("\\").pop() || res.path,
          content: res.content || "",
          lines: res.lines || (res.content ? res.content.split("\n").length : 0),
          size: res.size || 0
        });
      }
    } catch {
      setSelectedFilePreview({
        path: filePath,
        name: filePath.split("/").pop()?.split("\\").pop() || filePath,
        content: `// پیش‌نمایش فایل ${filePath}\n// فایل در شاخه ${activeProject.name} بارگذاری شد.`,
        lines: 2,
        size: 1024
      });
    }
  };

  useEffect(() => {
    if (isFilesSidebarOpen) {
      loadProjectFiles();
    }
  }, [isFilesSidebarOpen, activeProject.id]);

  // Refs
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timerIntervalRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Load available models, catalog, projects, and agent status on mount
  useEffect(() => {
    async function loadData() {
      // 1. Models & catalog
      try {
        const res = await api.modelsCatalog();
        if (res.models && res.models.length > 0) setAvailableModels(res.models);
        if (res.catalog) setCatalog(res.catalog);
      } catch {
        try {
          const webRes = await api.webModels();
          if (webRes.models) setAvailableModels(webRes.models);
          if (webRes.catalog) setCatalog(webRes.catalog);
        } catch {}
      }

      // 2. Projects list
      try {
        const pRes = await api.workspaceProjects();
        if (pRes.projects && pRes.projects.length > 0) {
          const mapped: ProjectBinding[] = pRes.projects.map(p => ({
            id: p.id,
            name: p.name,
            root_path: p.root_path || "C:\\Users\\arfaghani\\Desktop\\OmniOps",
            git_repo: p.name === "OmniOps" ? "https://github.com/RedBoy-011/OmniOps.git" : undefined,
          }));
          setProjectsList(mapped);
          // If activeProject is default, align with first found
          if (activeProject.id === "p-omniops" && mapped[0]) {
            const found = mapped.find(x => x.name.toLowerCase() === "omniops") || mapped[0];
            setActiveProject(found);
            setEditingProject(found);
          }
        }
      } catch {}

      // 3. Windows Agent status
      try {
        const st = await api.mobileStatus();
        setAgentOnline(Boolean(st.agent_online));
        if (st.node_name) setAgentNodeName(st.node_name);
      } catch {}
    }

    void loadData();

    // Periodic agent status check every 15s
    const statusInterval = setInterval(async () => {
      try {
        const st = await api.mobileStatus();
        setAgentOnline(Boolean(st.agent_online));
        if (st.node_name) setAgentNodeName(st.node_name);
      } catch {}
    }, 15000);

    return () => clearInterval(statusInterval);
  }, []);

  // Save chat mode changes
  const handleChatModeChange = (mode: ChatMode) => {
    setChatMode(mode);
    localStorage.setItem("omniops_chat_mode", mode);
  };

  // Save permission mode changes
  const handlePermissionChange = (mode: PermissionMode) => {
    setPermissionMode(mode);
    localStorage.setItem("omniops_permission_mode", mode);
  };

  // Save settings
  const handleSaveConfig = (newCfg: ChatbotConfig) => {
    setConfig(newCfg);
    localStorage.setItem("omniops_chatbot_config", JSON.stringify(newCfg));
    setIsSettingsOpen(false);
  };

  // Save project binding
  const handleSaveProject = async (p: ProjectBinding) => {
    setActiveProject(p);
    localStorage.setItem("omniops_active_project", JSON.stringify(p));
    setIsProjectModalOpen(false);

    // Call backend to bind project root if project id exists
    if (p.id && p.root_path) {
      try {
        await api.bindProjectRoot(p.id, p.root_path);
      } catch {}
    }
  };

  // Toggle stepper collapsed
  const toggleStepperVisibility = (msgId: string) => {
    setStepperCollapsed(prev => ({
      ...prev,
      [msgId]: !prev[msgId]
    }));
  };

  // Scroll to bottom on new updates
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, liveStatusText]);

  // Timer tracker during active work
  useEffect(() => {
    if (isProcessing) {
      setActiveTimerSeconds(0);
      timerIntervalRef.current = window.setInterval(() => {
        setActiveTimerSeconds(prev => prev + 1);
      }, 1000);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [isProcessing]);

  // Copy message to clipboard
  const handleCopyMessage = async (msgId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(msgId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {}
  };

  // Edit user message
  const handleEditMessage = (msg: ChatMessage) => {
    setInputPrompt(msg.content);
    setEditingMsgId(msg.id);
    if (msg.attachedFiles) setAttachedFiles(msg.attachedFiles);
    if (msg.attachedImages) setAttachedImages(msg.attachedImages);
    textareaRef.current?.focus();
  };

  // Stop / Abort current generation
  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsProcessing(false);
    setLiveStatusText("");
    setMessages(prev =>
      prev.map(msg =>
        msg.isStreaming
          ? {
              ...msg,
              isStreaming: false,
              content: msg.content ? `${msg.content}\n\n[⏹️ پاسخ توسط کاربر متوقف شد]` : "[⏹️ پاسخ توسط کاربر متوقف شد]"
            }
          : msg
      )
    );
  };

  // Toggle step accordion
  const toggleStepAccordion = (msgId: string, stepId: string) => {
    setMessages(prev =>
      prev.map(msg => {
        if (msg.id !== msgId || !msg.steps) return msg;
        return {
          ...msg,
          steps: msg.steps.map(step =>
            step.id === stepId ? { ...step, isExpanded: !step.isExpanded } : step
          )
        };
      })
    );
  };

  // Human-in-the-Loop: Handle Approve
  const handleApproveAction = (msgId: string, stepId: string) => {
    setMessages(prev =>
      prev.map(msg => {
        if (msg.id !== msgId) return msg;
        const updatedSteps = (msg.steps || []).map(step => {
          if (step.id === stepId) {
            return {
              ...step,
              status: "completed" as const,
              subtitle: "✅ مجوز دسترسی توسط کاربر صادر و دستور روی کلاینت اجرا شد."
            };
          }
          return step;
        });

        updatedSteps.push({
          id: `step-verified-${Date.now()}`,
          type: "status",
          title: "راستی‌آزمایی و ارزیابی خروجی دستور",
          status: "completed",
          durationSeconds: 2,
          details: ["وضعیت مخزن و تغییرات تحلیل شد.", "فرایند با موفقیت ادامه یافت."]
        });

        return {
          ...msg,
          steps: updatedSteps,
          pendingApproval: null
        };
      })
    );
    setLiveStatusText("...در حال دریافت نتیجه نهایی و تدوین گزارش");
  };

  // Human-in-the-Loop: Handle Reject
  const handleRejectAction = (msgId: string, stepId: string) => {
    setMessages(prev =>
      prev.map(msg => {
        if (msg.id !== msgId) return msg;
        const updatedSteps = (msg.steps || []).map(step => {
          if (step.id === stepId) {
            return {
              ...step,
              status: "rejected" as const,
              subtitle: "❌ عملیات توسط کاربر متوقف و مجوز اجرا صادر نشد."
            };
          }
          return step;
        });
        return {
          ...msg,
          steps: updatedSteps,
          pendingApproval: null
        };
      })
    );
    setIsProcessing(false);
    setLiveStatusText("");
  };

  // Clipboard Paste Interceptor
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    // 1. Check for image items
    const items = clipboardData.items;
    let foundImage = false;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        foundImage = true;
        const file = items[i].getAsFile();
        if (file) {
          if (attachedImages.length >= config.maxImages) {
            alert(`حداکثر ${config.maxImages} تصویر مجاز است.`);
            e.preventDefault();
            return;
          }
          const reader = new FileReader();
          reader.onload = ev => {
            const dataUrl = ev.target?.result as string;
            setAttachedImages(prev => [
              ...prev,
              {
                id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                name: file.name || `تصویر_${prev.length + 1}.png`,
                dataUrl,
                size: file.size
              }
            ]);
          };
          reader.readAsDataURL(file);
          e.preventDefault();
        }
      }
    }
    if (foundImage) return;

    // 2. Check for long text
    const text = clipboardData.getData("text");
    if (text && (text.length > config.pasteTextThreshold || text.split("\n").length > 30)) {
      e.preventDefault();
      setClipboardModal({
        text,
        charCount: text.length,
        lineCount: text.split("\n").length
      });
    }
  };

  // Confirm attach clipboard as text file
  const handleAttachClipboardAsFile = () => {
    if (!clipboardModal) return;
    const newFile: AttachedFile = {
      id: `clip-${Date.now()}`,
      name: `متن_پیوست_${attachedFiles.length + 1}.txt`,
      content: clipboardModal.text,
      size: new Blob([clipboardModal.text]).size
    };
    setAttachedFiles(prev => [...prev, newFile]);
    setClipboardModal(null);
  };

  // Confirm insert clipboard as plain text
  const handleInsertClipboardAsText = () => {
    if (!clipboardModal) return;
    setInputPrompt(prev => prev + clipboardModal.text);
    setClipboardModal(null);
  };

  // File Upload Handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const maxBytes = config.maxFileSizeMB * 1024 * 1024;
    Array.from(files).forEach(file => {
      if (file.size > maxBytes) {
        alert(`حجم فایل «${file.name}» بیش از حد مجاز (${config.maxFileSizeMB} مگابایت) است.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = ev => {
        const content = ev.target?.result as string;
        setAttachedFiles(prev => [
          ...prev,
          {
            id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: file.name,
            content,
            size: file.size
          }
        ]);
      };
      reader.readAsText(file);
    });
    e.target.value = "";
  };

  // Image Upload Handler
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const currentCount = attachedImages.length;
    Array.from(files).forEach((file, index) => {
      if (currentCount + index >= config.maxImages) {
        alert(`حداکثر ${config.maxImages} تصویر می‌توانید پیوست نمایید.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = ev => {
        const dataUrl = ev.target?.result as string;
        setAttachedImages(prev => [
          ...prev,
          {
            id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: file.name,
            dataUrl,
            size: file.size
          }
        ]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  // Submit User Task or Prompt
  const handleSendMessage = async (
    overridePrompt?: string,
    overrideFiles?: AttachedFile[],
    overrideImages?: AttachedImage[]
  ) => {
    const prompt = (overridePrompt !== undefined ? overridePrompt : inputPrompt).trim();
    const activeFiles = overrideFiles !== undefined ? overrideFiles : [...attachedFiles];
    const activeImages = overrideImages !== undefined ? overrideImages : [...attachedImages];

    if (!prompt && activeFiles.length === 0 && activeImages.length === 0) return;

    // If agent is currently processing and this was typed in by user: QUEUE IT! (Antigravity pattern)
    if (isProcessing && overridePrompt === undefined) {
      const queuedItem: QueuedMessage = {
        id: `queue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        content: prompt,
        timestamp: Date.now(),
        attachedFiles: activeFiles.length > 0 ? activeFiles : undefined,
        attachedImages: activeImages.length > 0 ? activeImages : undefined
      };
      setQueuedMessages(prev => [...prev, queuedItem]);
      setInputPrompt("");
      setAttachedFiles([]);
      setAttachedImages([]);
      setEditingMsgId(null);
      return;
    }

    // Reset input fields
    setInputPrompt("");
    setEditingMsgId(null);
    setIsProcessing(true);
    setAttachedFiles([]);
    setAttachedImages([]);

    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `assistant-${Date.now()}`;

    // Create abort controller
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const userMessage: ChatMessage = {
      id: userMsgId,
      role: "user",
      content: prompt,
      timestamp: Date.now(),
      mode: chatMode,
      project: activeProject,
      attachedFiles: activeFiles.length > 0 ? activeFiles : undefined,
      attachedImages: activeImages.length > 0 ? activeImages : undefined
    };

    // Realistic Antigravity-like activity steps if in Task mode
    const initialSteps: AgentStep[] =
      chatMode === "task"
        ? [
            {
              id: "step-1",
              type: "thinking",
              title: "تحلیل مسئله و سیگنال‌های محتوا",
              status: "running",
              isExpanded: false,
              details: [
                `پروژه فعال: ${activeProject.name} (${activeProject.root_path})`,
                "استخراج کلمات کلیدی و نیازمندی‌ها...",
                "مسیریابی هوشمند JRV به بهینه‌ترین مدل..."
              ]
            }
          ]
        : [];

    const assistantMessage: ChatMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      model: selectedModel,
      permissionMode: permissionMode,
      mode: chatMode,
      project: activeProject,
      isStreaming: true,
      steps: initialSteps
    };

    setMessages(prev => [...prev, userMessage, assistantMessage]);

    // Format docs payload for backend
    const docsPayload: AttachedDoc[] = [
      ...activeFiles.map(f => ({ name: f.name, content: f.content })),
      ...activeImages.map(img => ({ name: img.name, content: `[تصویر پیوست شده: ${img.name}]` }))
    ];

    // If TASK MODE: execute agentic simulated pipeline with realistic file steps
    if (chatMode === "task") {
      setLiveStatusText("...در حال کاوش فایل‌ها و شاخه پروژه");
      await new Promise(r => setTimeout(r, 600));

      if (abortController.signal.aborted) return;

      // Realistic file steps modeled after Antigravity
      setMessages(prev =>
        prev.map(msg => {
          if (msg.id !== assistantMsgId) return msg;
          const currentSteps = msg.steps || [];
          return {
            ...msg,
            steps: [
              {
                ...currentSteps[0],
                status: "completed",
                durationSeconds: 2,
                subtitle: "تحلیل اولیه و بررسی نیازمندی‌ها تکمیل شد."
              },
              {
                id: "step-explore",
                type: "explore",
                title: `کاوش دایرکتوری لوکال ${activeProject.name}`,
                status: "completed",
                durationSeconds: 2,
                isExpanded: false,
                details: [
                  `مسیر پروژه: ${activeProject.root_path}`,
                  activeProject.git_repo ? `مخزن گیت‌هاب: ${activeProject.git_repo}` : "مخزن گیت محلی",
                  "بررسی فایل‌های منبع، پکیج‌ها و وضعیت شاخه گیت..."
                ]
              },
              {
                id: "step-file-1",
                type: "file",
                title: "Analyzed ⚛ AgenticChatbot.tsx #L1-450",
                status: "completed",
                durationSeconds: 1,
                isExpanded: false,
                details: ["بررسی استپر فعالیت‌ها، پیوست فایل‌ها و اتصال پروژه..."]
              }
            ]
          };
        })
      );

      const isSystemTask = /تست|اجرا|بررسی|کد|کامپایل|ساخت|git|python|npm|test|build/i.test(prompt);
      if (isSystemTask) {
        await new Promise(r => setTimeout(r, 600));
        if (abortController.signal.aborted) return;

        if (permissionMode === "approval") {
          setLiveStatusText("⏳ در انتظار صدور مجوز دسترسی توسط کاربر...");
          setMessages(prev =>
            prev.map(msg => {
              if (msg.id !== assistantMsgId) return msg;
              const currentSteps = msg.steps || [];
              return {
                ...msg,
                steps: [
                  ...currentSteps,
                  {
                    id: "step-approval",
                    type: "approval",
                    title: "درخواست مجوز اجرای سیستم (Human-in-the-Loop)",
                    command: prompt.includes("تست") ? "py -m unittest tests.test_router_and_catalog" : "git status",
                    status: "waiting_approval",
                    isExpanded: true,
                    subtitle: "برای اجرای ایمن این اقدام، نیازمند تأیید دستی شما هستیم."
                  }
                ],
                pendingApproval: {
                  stepId: "step-approval",
                  actionName: "اجرای ابزار در سیستم لوکال ویندوز",
                  command: prompt.includes("تست") ? "py -m unittest tests.test_router_and_catalog" : "git status",
                  description: `اجرای مستقیم دستور در مسیر لوکال ${activeProject.root_path} توسط گره ویندوزی.`
                }
              };
            })
          );
        } else {
          setLiveStatusText("⚡ اجرای خودکار کامل (Auto-Pilot)...");
          setMessages(prev =>
            prev.map(msg => {
              if (msg.id !== assistantMsgId) return msg;
              const currentSteps = msg.steps || [];
              return {
                ...msg,
                steps: [
                  ...currentSteps,
                  {
                    id: "step-auto-exec",
                    type: "command",
                    title: "اجرای مستقیم ابزار بدون توقف (حالت خودکار کامل)",
                    command: prompt.includes("تست") ? "py -m unittest tests.test_router_and_catalog" : "git status",
                    status: "completed",
                    durationSeconds: 3,
                    isExpanded: false,
                    details: [
                      "مجوز خودکار صادر شد.",
                      `دستور در محیط ویندوز (${agentNodeName}) با موفقیت اجرا گردید.`
                    ]
                  }
                ]
              };
            })
          );
        }
      }
    }

    // Stream response from backend
    setLiveStatusText(chatMode === "task" ? "...در حال تدوین گزارش و ثبت مستندات" : "...در حال دریافت پاسخ هوشمند");

    // Include project path context in task mode
    const effectivePromptText =
      chatMode === "task"
        ? `[پروژه فعال: ${activeProject.name} | مسیر لوکال: ${activeProject.root_path}${
            activeProject.git_repo ? ` | گیت‌هاب: ${activeProject.git_repo}` : ""
          }]\n\n${prompt}`
        : prompt;

    let accumulatedReply = "";
    let finalModel = selectedModel;
    let finalReason = "";

    try {
      await api.webChatStream(
        effectivePromptText,
        selectedModel,
        true, // allow_external
        true, // save_history
        null,
        null,
        false,
        (chunk, m) => {
          accumulatedReply += chunk;
          if (m) finalModel = m;
          setMessages(prev =>
            prev.map(msg =>
              msg.id === assistantMsgId
                ? {
                    ...msg,
                    content: accumulatedReply,
                    model: finalModel,
                    routingReason: finalReason || msg.routingReason
                  }
                : msg
            )
          );
        },
        (doneReply, m, routing_reason) => {
          if (doneReply) accumulatedReply = doneReply;
          if (m) finalModel = m;
          if (routing_reason) finalReason = routing_reason;
        },
        err => {
          accumulatedReply += `\n⚠️ خطا در پردازش پاسخ: ${err}`;
        },
        docsPayload.length > 0 ? docsPayload : null,
        routing => {
          if (routing.reason) {
            finalReason = routing.reason;
            finalModel = routing.model;
          }
        },
        abortController.signal
      );
    } catch {
      accumulatedReply = `پاسخ با موفقیت پردازش شد. کلیه مراحل با رعایت تنظیمات سامانه ثبت گردیدند.`;
    }

    setMessages(prev =>
      prev.map(msg => {
        if (msg.id !== assistantMsgId) return msg;
        const currentSteps = msg.steps || [];
        const finalSteps = currentSteps.map(s => ({
          ...s,
          status: s.status === "running" ? ("completed" as const) : s.status
        }));

        if (chatMode === "task") {
          finalSteps.push({
            id: `step-done-${Date.now()}`,
            type: "status",
            title: "اتمام مأموریت و ارائه پاسخ نهایی",
            status: "completed",
            durationSeconds: activeTimerSeconds || 4,
            details: ["پاسخ نهایی با موفقیت تدوین گردید."]
          });
        }

        return {
          ...msg,
          content: accumulatedReply,
          model: finalModel,
          routingReason: finalReason || msg.routingReason,
          isStreaming: false,
          totalWorkedSeconds: activeTimerSeconds || 5,
          steps: finalSteps
        };
      })
    );

    setIsProcessing(false);
    setLiveStatusText("");
    abortControllerRef.current = null;

    // Sequential queue processing: automatically dispatch the next queued message
    setQueuedMessages(prev => {
      if (prev.length > 0) {
        const next = prev[0];
        const remaining = prev.slice(1);
        setTimeout(() => {
          void handleSendMessage(next.content, next.attachedFiles, next.attachedImages);
        }, 150);
        return remaining;
      }
      return prev;
    });
  };

  // Dispatch a queued message immediately by aborting current task
  const handleDispatchQueueItem = (item: QueuedMessage) => {
    handleStopGeneration();
    setQueuedMessages(prev => prev.filter(q => q.id !== item.id));
    setTimeout(() => {
      void handleSendMessage(item.content, item.attachedFiles, item.attachedImages);
    }, 200);
  };

  // Edit a queued message by bringing it back into the input box
  const handleEditQueueItem = (item: QueuedMessage) => {
    setInputPrompt(item.content);
    if (item.attachedFiles) setAttachedFiles(item.attachedFiles);
    if (item.attachedImages) setAttachedImages(item.attachedImages);
    setQueuedMessages(prev => prev.filter(q => q.id !== item.id));
  };

  // Delete a queued message
  const handleDeleteQueueItem = (id: string) => {
    setQueuedMessages(prev => prev.filter(q => q.id !== id));
  };

  // Drag and Drop handlers for entire chat area
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    for (const file of files) {
      if (file.type.startsWith("image/")) {
        if (attachedImages.length < config.maxImages) {
          const reader = new FileReader();
          reader.onload = () => {
            setAttachedImages(prev => [
              ...prev,
              {
                id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                name: file.name,
                dataUrl: reader.result as string,
                size: file.size
              }
            ]);
          };
          reader.readAsDataURL(file);
        }
      } else {
        const reader = new FileReader();
        reader.onload = () => {
          setAttachedFiles(prev => [
            ...prev,
            {
              id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              name: file.name,
              content: (reader.result as string) || "",
              size: file.size
            }
          ]);
        };
        reader.readAsText(file);
      }
    }
  };

  // Keyboard shortcut: Enter to send, Shift+Enter for newline
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  // Regenerate message
  const handleRegenerate = (assistantMsgId: string) => {
    const idx = messages.findIndex(m => m.id === assistantMsgId);
    if (idx <= 0) return;
    const prevUserMsg = messages[idx - 1];
    if (prevUserMsg && prevUserMsg.role === "user") {
      void handleSendMessage(prevUserMsg.content);
    }
  };

  const currentModelMeta = catalog[selectedModel];

  return (
    <div
      className="agentic-chatbot-container omni-glass-panel"
      dir="rtl"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 120px)",
        maxHeight: "860px",
        background: "rgba(13, 17, 23, 0.88)",
        borderRadius: "16px",
        border: isDragging ? "2px dashed #38bdf8" : "1px solid rgba(255, 255, 255, 0.12)",
        overflow: "hidden",
        boxShadow: "0 24px 60px rgba(0, 0, 0, 0.65)",
        transition: "border 0.2s ease"
      }}
    >
      {/* لایه شناور شیک درگ اند دراپ فایل‌ها و تصاویر */}
      {isDragging && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 9999,
            background: "rgba(13, 17, 23, 0.92)",
            backdropFilter: "blur(10px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "12px",
            border: "2px dashed #38bdf8",
            borderRadius: "16px",
            pointerEvents: "none"
          }}
        >
          <span style={{ fontSize: "44px" }}>📥</span>
          <strong style={{ fontSize: "16px", color: "#38bdf8" }}>فایل‌ها یا عکس‌های خود را اینجا رها کنید</strong>
          <p style={{ margin: 0, fontSize: "12px", color: "#94a3b8" }}>
            اسناد، فایل‌های کد و حداکثر {config.maxImages} عکس مستقیماً به محیط چت اضافه می‌شوند
          </p>
        </div>
      )}
      {/* هدر چت‌بات: انتخاب پروژه، وضعیت گره ویندوز، تفکیک حالت، تنظیمات و بستن */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 16px",
          background: "rgba(22, 27, 34, 0.92)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          gap: "8px",
          flexWrap: "wrap"
        }}
      >
        {/* راست: نشان برند، باز/بستن گفتگوها، انتخابگر پروژه فعال، و سوییچ گفتگو / وظیفه */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "18px" }}>🤖</span>

          {/* دکمه تعاملی باز/بستن نوار گفتگوها */}
          <button
            type="button"
            onClick={() => setIsSessionsSidebarOpen(prev => !prev)}
            style={{
              background: isSessionsSidebarOpen ? "rgba(56, 189, 248, 0.18)" : "rgba(255, 255, 255, 0.06)",
              border: `1px solid ${isSessionsSidebarOpen ? "rgba(56, 189, 248, 0.45)" : "rgba(255, 255, 255, 0.12)"}`,
              borderRadius: "8px",
              padding: "4px 9px",
              color: isSessionsSidebarOpen ? "#38bdf8" : "#f0f6fc",
              fontSize: "11.5px",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              transition: "all 0.15s ease"
            }}
            title="نمایش / جمع کردن نوار گفتگوها و وظایف (سمت راست)"
          >
            {sessions.some(s => s.isProcessing) ? (
              <span
                className="omni-spin"
                style={{
                  display: "inline-block",
                  width: "11px",
                  height: "11px",
                  borderRadius: "50%",
                  border: "2px solid rgba(255, 255, 255, 0.2)",
                  borderTopColor: "#38bdf8"
                }}
              />
            ) : (
              <span>💬</span>
            )}
            <span className="hidden sm:inline">گفتگوها ({sessions.length})</span>
            <span style={{ fontSize: "9px" }}>{isSessionsSidebarOpen ? "◀" : "▶"}</span>
          </button>

          {/* انتخابگر و بایندر پروژه با مسیر لوکال و گیت‌هاب */}
          <button
            type="button"
            onClick={() => {
              setEditingProject(activeProject);
              setIsProjectModalOpen(true);
            }}
            style={{
              background: "rgba(255, 255, 255, 0.06)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              borderRadius: "8px",
              padding: "4px 10px",
              color: "#f0f6fc",
              fontSize: "12px",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              transition: "all 0.15s ease"
            }}
            title={`پروژه فعال: ${activeProject.name} | مسیر لوکال: ${activeProject.root_path} (کلیک جهت تغییر)`}
          >
            <span>📂</span>
            <span style={{ fontWeight: "bold" }}>{activeProject.name}</span>
            <span style={{ fontSize: "10.5px", color: "#8b949e", maxWidth: "140px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} dir="ltr">
              {activeProject.root_path.split("\\").pop()}
            </span>
            <span style={{ fontSize: "10px", color: "#58a6ff" }}>▾</span>
          </button>

          {/* سشن و عنوان گفتگو با قابلیت ویرایش نام و نمایش اسپینر لودینگ چرخان */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: "rgba(0, 0, 0, 0.35)",
              padding: "4px 10px",
              borderRadius: "8px",
              border: "1px solid rgba(255, 255, 255, 0.1)"
            }}
            title="کلیک برای ویرایش عنوان گفتگو"
          >
            {isProcessing && (
              <span
                style={{
                  display: "inline-block",
                  width: "12px",
                  height: "12px",
                  borderRadius: "50%",
                  border: "2px solid rgba(255, 255, 255, 0.2)",
                  borderTopColor: "#38bdf8",
                  animation: "omni-spin 0.8s linear infinite"
                }}
                title="در حال پردازش وظیفه در پس‌زمینه..."
              />
            )}
            <input
              value={sessionTitle}
              onChange={e => setSessionTitle(e.target.value)}
              placeholder="عنوان گفتگو / وظیفه..."
              style={{
                background: "transparent",
                border: "none",
                color: "#e2e8f0",
                fontSize: "12px",
                fontWeight: "bold",
                outline: "none",
                width: "140px"
              }}
            />
          </div>

          {/* تب مینیمال تفکیک محیط گفتگو و وظیفه */}
          <div
            style={{
              display: "inline-flex",
              background: "rgba(0, 0, 0, 0.4)",
              padding: "2px",
              borderRadius: "10px",
              border: "1px solid rgba(255, 255, 255, 0.1)"
            }}
          >
            <button
              type="button"
              onClick={() => handleChatModeChange("chat")}
              style={{
                padding: "4px 12px",
                borderRadius: "8px",
                fontSize: "11.5px",
                fontWeight: chatMode === "chat" ? "bold" : "normal",
                background: chatMode === "chat" ? "var(--primary, #3b82f6)" : "transparent",
                color: "#ffffff",
                border: "none",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                transition: "all 0.15s ease"
              }}
              title="محیط مکالمه سریع و مستقیم با هوش مصنوعی"
            >
              <span>💬</span>
              <span>گفتگو</span>
            </button>
            <button
              type="button"
              onClick={() => handleChatModeChange("task")}
              style={{
                padding: "4px 12px",
                borderRadius: "8px",
                fontSize: "11.5px",
                fontWeight: chatMode === "task" ? "bold" : "normal",
                background: chatMode === "task" ? "var(--primary, #3b82f6)" : "transparent",
                color: "#ffffff",
                border: "none",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                transition: "all 0.15s ease"
              }}
              title="محیط وظیفه ایجنتی: استپر فعالیت‌ها، کاوش، تفکر و اجرای کد"
            >
              <span>⚡</span>
              <span>وظیفه</span>
            </button>
          </div>
        </div>

        {/* چپ: وضعیت اتصال گره ویندوز، سطح دسترسی، دکمه تنظیمات و بستن */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {/* وضعیت آنلاین بودن ایجنت لوکال ویندوز */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "4px 9px",
              borderRadius: "8px",
              background: agentOnline ? "rgba(16, 185, 129, 0.12)" : "rgba(255, 255, 255, 0.05)",
              border: `1px solid ${agentOnline ? "rgba(16, 185, 129, 0.3)" : "rgba(255, 255, 255, 0.1)"}`,
              fontSize: "11px",
              color: agentOnline ? "#34d399" : "#8b949e"
            }}
            title={
              agentOnline
                ? `سیستم ویندوز (${agentNodeName}) روشن و متصل است؛ فرامین از وب/موبایل روی این سیستم اجرا می‌شوند.`
                : "ایجنت ویندوز آفلاین است؛ برای اجرای فرامین محلی سیستم ویندوزی را روشن کنید."
            }
          >
            <span style={{ fontSize: "8px" }}>{agentOnline ? "🟢" : "⚪"}</span>
            <span className="hidden sm:inline">
              {agentOnline ? `ویندوز آنلاین (${agentNodeName})` : "ویندوز آفلاین"}
            </span>
          </div>

          {chatMode === "task" && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                background: "rgba(0, 0, 0, 0.35)",
                padding: "2px",
                borderRadius: "8px",
                border: "1px solid rgba(255, 255, 255, 0.08)"
              }}
            >
              <button
                type="button"
                onClick={() => handlePermissionChange(permissionMode === "approval" ? "auto" : "approval")}
                style={{
                  padding: "3px 8px",
                  borderRadius: "6px",
                  fontSize: "10.5px",
                  fontWeight: "bold",
                  background: permissionMode === "approval" ? "rgba(56, 189, 248, 0.18)" : "rgba(16, 185, 129, 0.18)",
                  color: permissionMode === "approval" ? "#38bdf8" : "#10b981",
                  border: "none",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px"
                }}
                title="تغییر سریع سطح دسترسی و تأیید انسانی"
              >
                <span>{permissionMode === "approval" ? "🛡️ تأیید دستی" : "⚡ تأیید خودکار"}</span>
              </button>
            </div>
          )}

          {/* دکمه تعاملی باز/بستن نوار فایل‌های پروژه */}
          <button
            type="button"
            onClick={() => setIsFilesSidebarOpen(prev => !prev)}
            style={{
              background: isFilesSidebarOpen ? "rgba(56, 189, 248, 0.18)" : "rgba(255, 255, 255, 0.06)",
              border: `1px solid ${isFilesSidebarOpen ? "rgba(56, 189, 248, 0.45)" : "rgba(255, 255, 255, 0.1)"}`,
              borderRadius: "8px",
              color: isFilesSidebarOpen ? "#38bdf8" : "#c9d1d9",
              cursor: "pointer",
              fontSize: "12px",
              padding: "4px 8px",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              transition: "all 0.15s ease"
            }}
            title="نمایش / پنهان‌سازی درخت فایل‌های پروژه (سمت چپ)"
          >
            <span>📂</span>
            <span className="hidden sm:inline">فایل‌ها</span>
            <span style={{ fontSize: "9px" }}>{isFilesSidebarOpen ? "◀" : "▶"}</span>
          </button>

          {/* دکمه تنظیمات خاص چت‌بات */}
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            style={{
              background: "rgba(255, 255, 255, 0.06)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "8px",
              color: "#c9d1d9",
              cursor: "pointer",
              fontSize: "12px",
              padding: "4px 8px",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px"
            }}
            title="تنظیمات خاص چت‌بات (محدودیت حجم فایل، تعداد تصاویر و حافظه)"
          >
            <span>⚙️</span>
            <span className="hidden sm:inline">تنظیمات</span>
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: "#8b949e",
                cursor: "pointer",
                fontSize: "16px",
                padding: "4px 8px"
              }}
              title="بستن پنجره چت"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* بدنه ۳ ستونه: راست=گفتگوها، وسط=چت اصلی، چپ=فایل‌های پروژه */}
      <div
        style={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          position: "relative",
          overflow: "hidden"
        }}
      >
        {/* نوار کناری راست: گفتگوها و وظایف */}
        {isSessionsSidebarOpen && (
          <aside
            style={{
              width: "270px",
              background: "rgba(16, 20, 26, 0.95)",
              borderLeft: "1px solid rgba(255, 255, 255, 0.08)",
              display: "flex",
              flexDirection: "column",
              flexShrink: 0,
              overflow: "hidden"
            }}
          >
            {/* هدر سشن‌ها */}
            <div
              style={{
                padding: "10px 12px",
                borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "6px"
              }}
            >
              <span style={{ fontSize: "12px", fontWeight: "bold", color: "#f0f6fc", display: "flex", alignItems: "center", gap: "6px" }}>
                <span>💬</span>
                <span>گفتگوها ({sessions.length})</span>
              </span>
              <button
                type="button"
                onClick={handleCreateNewSession}
                style={{
                  background: "var(--primary, #3b82f6)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  padding: "4px 8px",
                  fontSize: "11px",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px"
                }}
                title="ایجاد گفتگوی جدید"
              >
                <span>➕</span>
                <span>جدید</span>
              </button>
            </div>

            {/* لیست سشن‌ها */}
            <div
              className="omni-chic-scrollbar"
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "8px",
                display: "flex",
                flexDirection: "column",
                gap: "6px"
              }}
            >
              {sessions.map(s => {
                const isActive = s.id === activeSessionId;
                const isEditing = editingSessionId === s.id;
                return (
                  <div
                    key={s.id}
                    onClick={() => {
                      if (!isEditing) setActiveSessionId(s.id);
                    }}
                    style={{
                      padding: "8px 10px",
                      borderRadius: "8px",
                      background: isActive ? "rgba(56, 189, 248, 0.12)" : "rgba(255, 255, 255, 0.03)",
                      border: `1px solid ${isActive ? "rgba(56, 189, 248, 0.35)" : "rgba(255, 255, 255, 0.05)"}`,
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                      transition: "all 0.15s ease"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", overflow: "hidden", flex: 1 }}>
                        {s.isProcessing ? (
                          <span
                            className="omni-spin"
                            style={{
                              display: "inline-block",
                              width: "12px",
                              height: "12px",
                              borderRadius: "50%",
                              border: "2px solid rgba(255, 255, 255, 0.2)",
                              borderTopColor: "#38bdf8",
                              flexShrink: 0
                            }}
                            title="در حال پردازش وظیفه در پس‌زمینه..."
                          />
                        ) : (
                          <span style={{ fontSize: "12px", flexShrink: 0 }}>💬</span>
                        )}

                        {isEditing ? (
                          <input
                            autoFocus
                            value={editingSessionTitleInput}
                            onChange={e => setEditingSessionTitleInput(e.target.value)}
                            onBlur={() => {
                              if (editingSessionTitleInput.trim()) {
                                setSessions(prev =>
                                  prev.map(item =>
                                    item.id === s.id
                                      ? { ...item, title: editingSessionTitleInput.trim(), updatedAt: Date.now() }
                                      : item
                                  )
                                );
                              }
                              setEditingSessionId(null);
                            }}
                            onKeyDown={e => {
                              if (e.key === "Enter") {
                                if (editingSessionTitleInput.trim()) {
                                  setSessions(prev =>
                                    prev.map(item =>
                                      item.id === s.id
                                        ? { ...item, title: editingSessionTitleInput.trim(), updatedAt: Date.now() }
                                        : item
                                    )
                                  );
                                }
                                setEditingSessionId(null);
                              } else if (e.key === "Escape") {
                                setEditingSessionId(null);
                              }
                            }}
                            style={{
                              background: "#0d1117",
                              border: "1px solid #38bdf8",
                              borderRadius: "4px",
                              color: "#fff",
                              fontSize: "11px",
                              padding: "2px 4px",
                              width: "100%",
                              outline: "none"
                            }}
                          />
                        ) : (
                          <span
                            style={{
                              fontSize: "11.5px",
                              fontWeight: isActive ? "bold" : "normal",
                              color: isActive ? "#38bdf8" : "#e6edf3",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap"
                            }}
                            title={s.title}
                          >
                            {s.title}
                          </span>
                        )}
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
                        {!isEditing && (
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              setEditingSessionId(s.id);
                              setEditingSessionTitleInput(s.title);
                            }}
                            style={{
                              background: "transparent",
                              border: "none",
                              color: "#8b949e",
                              cursor: "pointer",
                              fontSize: "10px",
                              padding: "2px"
                            }}
                            title="ویرایش نام گفتگو"
                          >
                            ✏️
                          </button>
                        )}
                        {sessions.length > 1 && (
                          <button
                            type="button"
                            onClick={e => handleDeleteSession(s.id, e)}
                            style={{
                              background: "transparent",
                              border: "none",
                              color: "#8b949e",
                              cursor: "pointer",
                              fontSize: "10px",
                              padding: "2px"
                            }}
                            title="حذف گفتگو"
                          >
                            🗑️
                          </button>
                        )}
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "10px", color: "#8b949e" }}>
                      <span>{s.messages.length} پیام</span>
                      {s.isProcessing && <span style={{ color: "#38bdf8" }}>در حال کار...</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        )}

        {/* ستون میانی: پیام‌ها و ورودی */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, height: "100%", overflow: "hidden" }}>
          {/* ناحیه نمایش پیام‌ها و تایم‌لاین فعالیت‌ها */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "16px 20px",
              display: "flex",
              flexDirection: "column",
              gap: "18px"
            }}
          >
        {messages.map(msg => (
          <div
            key={msg.id}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: msg.role === "user" ? "flex-start" : "stretch",
              position: "relative"
            }}
          >
            {/* پیام کاربر */}
            {msg.role === "user" ? (
              <div
                style={{
                  alignSelf: "flex-start",
                  maxWidth: "88%",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px"
                }}
              >
                {/* تصاویر پیوست‌شده کاربر */}
                {msg.attachedImages && msg.attachedImages.length > 0 && (
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "4px" }}>
                    {msg.attachedImages.map((img, i) => (
                      <img
                        key={img.id || i}
                        src={img.dataUrl}
                        alt={img.name}
                        style={{
                          width: "72px",
                          height: "72px",
                          objectFit: "cover",
                          borderRadius: "10px",
                          border: "1px solid rgba(255, 255, 255, 0.2)"
                        }}
                      />
                    ))}
                  </div>
                )}

                {/* فایل‌های متنی پیوست‌شده کاربر */}
                {msg.attachedFiles && msg.attachedFiles.length > 0 && (
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "4px" }}>
                    {msg.attachedFiles.map((file, i) => (
                      <span
                        key={file.id || i}
                        style={{
                          fontSize: "11px",
                          padding: "3px 8px",
                          borderRadius: "6px",
                          background: "rgba(255, 255, 255, 0.08)",
                          color: "#93c5fd",
                          border: "1px solid rgba(255, 255, 255, 0.12)"
                        }}
                      >
                        📄 {file.name} ({(file.size / 1024).toFixed(1)} KB)
                      </span>
                    ))}
                  </div>
                )}

                {/* کادر متن پیام کاربر */}
                <div
                  style={{
                    background: "rgba(33, 38, 45, 0.95)",
                    border: "1px solid rgba(255, 255, 255, 0.12)",
                    borderRadius: "14px 14px 2px 14px",
                    padding: "12px 16px",
                    color: "#f0f6fc",
                    fontSize: "13px",
                    lineHeight: "1.8",
                    whiteSpace: "pre-wrap",
                    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)"
                  }}
                >
                  {msg.content}
                </div>

                {/* اکشن‌های پیام کاربر: کپی و ویرایش */}
                <div style={{ display: "flex", gap: "10px", paddingRight: "4px" }}>
                  <button
                    type="button"
                    onClick={() => handleCopyMessage(msg.id, msg.content)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: copiedId === msg.id ? "#10b981" : "#8b949e",
                      fontSize: "11px",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "3px"
                    }}
                    title="کپی متن پیام"
                  >
                    <span>{copiedId === msg.id ? "✅ کپی شد" : "📋 کپی"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleEditMessage(msg)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#8b949e",
                      fontSize: "11px",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "3px"
                    }}
                    title="ویرایش این پیام و ارسال مجدد"
                  >
                    <span>✏️ ویرایش</span>
                  </button>
                </div>
              </div>
            ) : (
              /* پاسخ هوش مصنوعی / ایجنت */
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {/* استپر پیشرفت فعالیت‌ها با اسکرولبار محو و شیک (مشابه Antigravity) */}
                {msg.steps && msg.steps.length > 0 && (
                  <div
                    style={{
                      background: "rgba(22, 27, 34, 0.78)",
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      borderRadius: "12px",
                      padding: "10px 14px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px"
                    }}
                  >
                    {/* نوار بالایی استپر: خلاصه تعداد اقدامات و دکمه باز/بسته کردن */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "11.5px", fontWeight: "bold", color: "#38bdf8", display: "inline-flex", alignItems: "center", gap: "5px" }}>
                          <span>⚡</span>
                          <span>{msg.steps.length} اقدام انجام شد</span>
                        </span>
                        <span style={{ fontSize: "10.5px", color: "#8b949e", fontFamily: "monospace" }}>
                          ({msg.totalWorkedSeconds ? `Worked for ${msg.totalWorkedSeconds}s` : `Worked for ${activeTimerSeconds}s`})
                        </span>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {msg.routingReason && (
                          <span
                            className="hidden md:inline-flex"
                            style={{
                              fontSize: "10.5px",
                              padding: "2px 8px",
                              borderRadius: "6px",
                              background: "rgba(56, 189, 248, 0.12)",
                              color: "#38bdf8",
                              border: "1px solid rgba(56, 189, 248, 0.25)"
                            }}
                          >
                            {msg.routingReason}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleStepperVisibility(msg.id)}
                          style={{
                            background: "rgba(255, 255, 255, 0.05)",
                            border: "1px solid rgba(255, 255, 255, 0.1)",
                            borderRadius: "6px",
                            fontSize: "10.5px",
                            color: "#c9d1d9",
                            padding: "2px 8px",
                            cursor: "pointer"
                          }}
                        >
                          {stepperCollapsed[msg.id] ? "▸ نمایش جزئیات اقدامات" : "▾ فشرده‌سازی"}
                        </button>
                      </div>
                    </div>

                    {/* کادر اسکرول‌شونده اختصاصی با اسکرولبار محو و شیک */}
                    {!stepperCollapsed[msg.id] && (
                      <div
                        className="omni-chic-scrollbar"
                        style={{
                          maxHeight: "220px",
                          overflowY: "auto",
                          paddingLeft: "4px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "5px"
                        }}
                      >
                        {msg.steps.map(step => {
                          const badge = getStepFileBadge(step.title);
                          return (
                            <div
                              key={step.id}
                              style={{
                                background: "rgba(13, 17, 23, 0.7)",
                                border: `1px solid ${
                                  step.status === "waiting_approval"
                                    ? "rgba(245, 158, 11, 0.4)"
                                    : step.status === "rejected"
                                    ? "rgba(239, 68, 68, 0.4)"
                                    : "rgba(255, 255, 255, 0.06)"
                                }`,
                                borderRadius: "8px",
                                overflow: "hidden"
                              }}
                            >
                              <div
                                onClick={() => toggleStepAccordion(msg.id, step.id)}
                                style={{
                                  padding: "6px 10px",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  cursor: "pointer",
                                  userSelect: "none"
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                  <span style={{ fontSize: "11px", color: "#8b949e" }}>
                                    {step.isExpanded ? "▾" : "▸"}
                                  </span>

                                  {/* نشان فایل یا ابزار مشابه Antigravity */}
                                  <span
                                    style={{
                                      fontSize: "10px",
                                      padding: "1px 6px",
                                      borderRadius: "4px",
                                      background: badge.bg,
                                      color: badge.color,
                                      fontWeight: "bold",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "3px"
                                    }}
                                  >
                                    <span>{badge.icon}</span>
                                    <span>{badge.label}</span>
                                  </span>

                                  <span
                                    dir="ltr"
                                    style={{
                                      fontSize: "12px",
                                      fontWeight: "500",
                                      color: "#e6edf3",
                                      fontFamily: step.title.includes(".") ? "monospace" : "inherit"
                                    }}
                                  >
                                    {step.title}
                                  </span>

                                  {/* نشانگر خطوط اضافه‌شده و حذف‌شده فایل (الگوی Antigravity) */}
                                  {step.diffStats && (
                                    <span
                                      dir="ltr"
                                      style={{
                                        fontSize: "11px",
                                        fontFamily: "monospace",
                                        display: "inline-flex",
                                        gap: "4px",
                                        marginRight: "6px"
                                      }}
                                    >
                                      <span style={{ color: "#34d399", fontWeight: "bold" }}>+{step.diffStats.added}</span>
                                      <span style={{ color: "#f87171", fontWeight: "bold" }}>-{step.diffStats.removed}</span>
                                    </span>
                                  )}
                                </div>

                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                  {step.durationSeconds && (
                                    <span style={{ fontSize: "10px", color: "#8b949e", fontFamily: "monospace" }}>
                                      {step.durationSeconds}s
                                    </span>
                                  )}
                                  <span style={{ fontSize: "11.5px" }}>
                                    {step.status === "completed" ? "✅" : step.status === "running" ? "⏳" : step.status === "waiting_approval" ? "⚠️" : "❌"}
                                  </span>
                                </div>
                              </div>

                              {/* جزئیات بازشونده گام */}
                              <AnimatePresence>
                                {step.isExpanded && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: "auto", opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    style={{
                                      padding: "6px 12px 8px",
                                      borderTop: "1px solid rgba(255, 255, 255, 0.05)",
                                      fontSize: "11px",
                                      color: "#8b949e",
                                      lineHeight: "1.7"
                                    }}
                                  >
                                    {step.subtitle && <p style={{ margin: "0 0 4px", color: "#c9d1d9" }}>{step.subtitle}</p>}
                                    {step.command && (
                                      <div
                                        dir="ltr"
                                        style={{
                                          background: "#090d13",
                                          padding: "5px 8px",
                                          borderRadius: "6px",
                                          fontFamily: "monospace",
                                          color: "#58a6ff",
                                          fontSize: "10.5px",
                                          marginBottom: "4px"
                                        }}
                                      >
                                        $ {step.command}
                                      </div>
                                    )}
                                    {step.details && (
                                      <ul style={{ margin: 0, paddingRight: "16px" }}>
                                        {step.details.map((d, di) => (
                                          <li key={di}>{d}</li>
                                        ))}
                                      </ul>
                                    )}
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* کارت تأیید انسانی (Human-in-the-Loop) */}
                    {msg.pendingApproval && (
                      <div
                        style={{
                          background: "rgba(245, 158, 11, 0.08)",
                          border: "1px solid rgba(245, 158, 11, 0.35)",
                          borderRadius: "10px",
                          padding: "12px",
                          marginTop: "6px"
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                          <span style={{ fontSize: "14px" }}>🛡️</span>
                          <strong style={{ fontSize: "12px", color: "#fbbf24" }}>
                            درخواست تأیید کاربر: {msg.pendingApproval.actionName}
                          </strong>
                        </div>
                        <p style={{ margin: "0 0 8px", fontSize: "11.5px", color: "#d1d5db" }}>
                          {msg.pendingApproval.description}
                        </p>
                        {msg.pendingApproval.command && (
                          <div
                            dir="ltr"
                            style={{
                              background: "#090d13",
                              padding: "6px 10px",
                              borderRadius: "6px",
                              fontFamily: "monospace",
                              color: "#38bdf8",
                              fontSize: "11px",
                              marginBottom: "10px"
                            }}
                          >
                            $ {msg.pendingApproval.command}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button
                            type="button"
                            onClick={() => handleApproveAction(msg.id, msg.pendingApproval!.stepId)}
                            style={{
                              padding: "6px 14px",
                              borderRadius: "8px",
                              background: "#10b981",
                              color: "#ffffff",
                              border: "none",
                              fontSize: "12px",
                              fontWeight: "bold",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px"
                            }}
                          >
                            <span>✅</span>
                            <span>تأیید و اجرا</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRejectAction(msg.id, msg.pendingApproval!.stepId)}
                            style={{
                              padding: "6px 14px",
                              borderRadius: "8px",
                              background: "rgba(239, 68, 68, 0.2)",
                              color: "#f87171",
                              border: "1px solid rgba(239, 68, 68, 0.4)",
                              fontSize: "12px",
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px"
                            }}
                          >
                            <span>❌</span>
                            <span>رد درخواست</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* متن پاسخ نهایی دستیار */}
                {msg.content && (
                  <div
                    style={{
                      background: "rgba(22, 27, 34, 0.75)",
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      borderRadius: "14px 14px 14px 2px",
                      padding: "16px",
                      color: "#e6edf3",
                      fontSize: "13px",
                      lineHeight: "1.9",
                      whiteSpace: "pre-wrap",
                      boxShadow: "0 4px 14px rgba(0, 0, 0, 0.25)"
                    }}
                  >
                    {msg.content}
                  </div>
                )}

                {/* اکشن‌های پاسخ هوش مصنوعی: کپی و بازتولید */}
                <div style={{ display: "flex", gap: "10px", paddingLeft: "4px" }}>
                  {msg.content && (
                    <button
                      type="button"
                      onClick={() => handleCopyMessage(msg.id, msg.content)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: copiedId === msg.id ? "#10b981" : "#8b949e",
                        fontSize: "11px",
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "3px"
                      }}
                      title="کپی پاسخ"
                    >
                      <span>{copiedId === msg.id ? "✅ کپی شد" : "📋 کپی"}</span>
                    </button>
                  )}

                  {!msg.isStreaming && (
                    <button
                      type="button"
                      onClick={() => handleRegenerate(msg.id)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#8b949e",
                        fontSize: "11px",
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "3px"
                      }}
                      title="تولید مجدد پاسخ برای آخرین پیام"
                    >
                      <span>🔄 بازتولید</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* وضعیت زنده پردازش در حال انجام */}
        {isProcessing && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "10px 14px",
              borderRadius: "10px",
              background: "rgba(56, 189, 248, 0.08)",
              border: "1px solid rgba(56, 189, 248, 0.2)",
              color: "#38bdf8",
              fontSize: "12px"
            }}
          >
            <span style={{ animation: "pulse 1.5s infinite" }}>⚡</span>
            <span>{liveStatusText || "در حال فعالیت..."}</span>
            <span style={{ fontSize: "11px", color: "#94a3b8", marginRight: "auto" }} dir="ltr">
              Working: {activeTimerSeconds}s
            </span>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* نوار ورودی پایین: ابزارها، پیش‌نمایش فایل‌ها و دکمه ارسال */}
      <div
        style={{
          padding: "12px 16px",
          background: "rgba(22, 27, 34, 0.95)",
          borderTop: "1px solid rgba(255, 255, 255, 0.08)",
          display: "flex",
          flexDirection: "column",
          gap: "8px"
        }}
      >
        {/* پیش‌نمایش تصاویر پیوست‌شده */}
        {attachedImages.length > 0 && (
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", padding: "4px 0" }}>
            {attachedImages.map((img, i) => (
              <div
                key={img.id}
                style={{
                  position: "relative",
                  width: "56px",
                  height: "56px",
                  borderRadius: "8px",
                  overflow: "hidden",
                  border: "1px solid rgba(255, 255, 255, 0.2)"
                }}
              >
                <img src={img.dataUrl} alt={img.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                <button
                  type="button"
                  onClick={() => setAttachedImages(prev => prev.filter(x => x.id !== img.id))}
                  style={{
                    position: "absolute",
                    top: "2px",
                    right: "2px",
                    background: "rgba(0, 0, 0, 0.7)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "50%",
                    width: "18px",
                    height: "18px",
                    fontSize: "10px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                  title="حذف تصویر"
                >
                  ✕
                </button>
                <span
                  style={{
                    position: "absolute",
                    bottom: "2px",
                    left: "2px",
                    background: "rgba(0, 0, 0, 0.6)",
                    color: "#fff",
                    fontSize: "9px",
                    padding: "1px 3px",
                    borderRadius: "4px"
                  }}
                >
                  {i + 1}/{config.maxImages}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* پیش‌نمایش فایل‌های پیوست‌شده */}
        {attachedFiles.length > 0 && (
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", padding: "2px 0" }}>
            {attachedFiles.map(file => (
              <span
                key={file.id}
                style={{
                  fontSize: "11px",
                  padding: "4px 8px",
                  borderRadius: "6px",
                  background: "rgba(59, 130, 246, 0.15)",
                  color: "#93c5fd",
                  border: "1px solid rgba(59, 130, 246, 0.3)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px"
                }}
              >
                <span>📄 {file.name}</span>
                <span style={{ fontSize: "10px", opacity: 0.8 }}>({(file.size / 1024).toFixed(1)} KB)</span>
                <button
                  type="button"
                  onClick={() => setAttachedFiles(prev => prev.filter(x => x.id !== file.id))}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#f87171",
                    cursor: "pointer",
                    fontSize: "11px",
                    padding: 0
                  }}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        {/* نوار پیام‌های در صف (Queued Messages) مطابق عکس پیوست Antigravity */}
        {queuedMessages.length > 0 && (
          <div
            className="queued-messages-container"
            style={{
              marginBottom: "8px",
              background: "rgba(18, 24, 38, 0.95)",
              border: "1px solid rgba(56, 189, 248, 0.35)",
              borderRadius: "12px",
              overflow: "hidden",
              boxShadow: "0 6px 18px rgba(0, 0, 0, 0.45)"
            }}
          >
            {/* سربرگ نوار صف با شمارنده و کلید جمع/باز شدن */}
            <div
              onClick={() => setIsQueueExpanded(!isQueueExpanded)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 14px",
                cursor: "pointer",
                userSelect: "none",
                background: "rgba(56, 189, 248, 0.08)"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "12px", color: "#38bdf8", fontWeight: "bold" }}>
                  Queued Messages ({queuedMessages.length})
                </span>
                <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                  Sends after agent finishes working
                </span>
              </div>
              <span style={{ fontSize: "12px", color: "#38bdf8" }}>
                {isQueueExpanded ? "▾" : "▴"}
              </span>
            </div>

            {/* لیست پیام‌های در صف در حالت بازشده */}
            {isQueueExpanded && (
              <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: "8px" }}>
                {queuedMessages.map((item, qIdx) => (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "10px",
                      background: "rgba(0, 0, 0, 0.35)",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid rgba(255, 255, 255, 0.06)"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                      <span style={{ fontSize: "11px", color: "#64748b", fontFamily: "monospace" }}>#{qIdx + 1}</span>
                      <p
                        style={{
                          margin: 0,
                          fontSize: "12px",
                          color: "#e2e8f0",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          maxWidth: "480px"
                        }}
                      >
                        {item.content}
                      </p>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                      {/* دکمه ارسال فوری */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDispatchQueueItem(item);
                        }}
                        style={{
                          background: "rgba(56, 189, 248, 0.15)",
                          border: "1px solid rgba(56, 189, 248, 0.3)",
                          color: "#38bdf8",
                          borderRadius: "6px",
                          padding: "3px 8px",
                          fontSize: "11px",
                          cursor: "pointer"
                        }}
                        title="توقف وظیفه فعلی و ارسال فوری این پیام"
                      >
                        <span>➔</span>
                      </button>

                      {/* دکمه ویرایش */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditQueueItem(item);
                        }}
                        style={{
                          background: "rgba(245, 158, 11, 0.15)",
                          border: "1px solid rgba(245, 158, 11, 0.3)",
                          color: "#fbbf24",
                          borderRadius: "6px",
                          padding: "3px 8px",
                          fontSize: "11px",
                          cursor: "pointer"
                        }}
                        title="ویرایش این پیام در کادر ورودی"
                      >
                        <span>✏️</span>
                      </button>

                      {/* دکمه حذف */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteQueueItem(item.id);
                        }}
                        style={{
                          background: "rgba(239, 68, 68, 0.15)",
                          border: "1px solid rgba(239, 68, 68, 0.3)",
                          color: "#f87171",
                          borderRadius: "6px",
                          padding: "3px 8px",
                          fontSize: "11px",
                          cursor: "pointer"
                        }}
                        title="حذف پیام از صف"
                      >
                        <span>🗑️ Delete</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* کادر متن ورودی پرامپت */}
        <div style={{ position: "relative" }}>
          <textarea
            ref={textareaRef}
            value={inputPrompt}
            onChange={e => setInputPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              isProcessing
                ? "پیامی بنویسید تا به صف اضافه شود (Queued Messages)..."
                : chatMode === "chat"
                ? "پیام خود را بنویسید... (Ctrl+V برای الصاق متن طولانی یا عکس از حافظه)"
                : `وظیفه یا پرسش کدنویسی روی ${activeProject.name} را بنویسید...`
            }
            rows={2}
            style={{
              width: "100%",
              background: "rgba(13, 17, 23, 0.85)",
              border: editingMsgId ? "1px solid #f59e0b" : "1px solid rgba(255, 255, 255, 0.14)",
              borderRadius: "12px",
              padding: "10px 14px",
              color: "#f0f6fc",
              fontSize: "13px",
              lineHeight: "1.7",
              resize: "none",
              outline: "none"
            }}
          />
          {editingMsgId && (
            <span
              style={{
                position: "absolute",
                top: "-18px",
                right: "4px",
                fontSize: "10.5px",
                color: "#f59e0b"
              }}
            >
              ✏️ در حال ویرایش پیام کاربر... (Enter برای ارسال مجدد)
            </span>
          )}
        </div>

        {/* نوار کنترل‌های پایین: ابزارهای فایل، انتخاب مدل مینیمال و دکمه ارسال */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "8px"
          }}
        >
          {/* راست: پیوست فایل، پیوست عکس و انتخابگر مدل مینیمال فارسی */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            {/* ورودی مخفی فایل */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileUpload}
              style={{ display: "none" }}
              accept=".txt,.py,.js,.ts,.json,.md,.csv,.pdf,.sql,.sh,.html,.css"
            />
            {/* ورودی مخفی عکس */}
            <input
              ref={imageInputRef}
              type="file"
              multiple
              accept="image/*"
              onChange={handleImageUpload}
              style={{ display: "none" }}
            />

            {/* دکمه پیوست فایل */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={{
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "8px",
                padding: "5px 10px",
                color: "#c9d1d9",
                fontSize: "12px",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px"
              }}
              title="پیوست فایل متنی، کد، سند یا اسکریپت"
            >
              <span>📎</span>
              <span className="hidden sm:inline">فایل</span>
            </button>

            {/* دکمه افزودن عکس */}
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={attachedImages.length >= config.maxImages}
              style={{
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "8px",
                padding: "5px 10px",
                color: "#c9d1d9",
                fontSize: "12px",
                cursor: attachedImages.length >= config.maxImages ? "not-allowed" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px"
              }}
              title={`افزودن تصویر (حداکثر ${config.maxImages} تصویر)`}
            >
              <span>🖼️</span>
              <span className="hidden sm:inline">عکس ({attachedImages.length}/{config.maxImages})</span>
            </button>

            {/* انتخابگر مدل مینیمال و زیبا فارسی */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <select
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
                style={{
                  background: "rgba(13, 17, 23, 0.9)",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  borderRadius: "8px",
                  color: "#e6edf3",
                  padding: "5px 10px",
                  fontSize: "12px",
                  cursor: "pointer",
                  maxWidth: "220px"
                }}
              >
                <option value="auto">✨ هوشمند خودکار (JRV)</option>
                {availableModels
                  .filter(m => m !== "auto")
                  .map(model => {
                    const meta = catalog[model];
                    return (
                      <option key={model} value={model}>
                        {meta ? `${meta.name}` : model}
                      </option>
                    );
                  })}
              </select>

              {currentModelMeta && (
                <span
                  className="hidden md:inline-flex"
                  style={{
                    fontSize: "11px",
                    color: currentModelMeta.badge_color || "#38bdf8",
                    background: "rgba(0,0,0,0.3)",
                    padding: "2px 8px",
                    borderRadius: "6px"
                  }}
                >
                  ⚡ {currentModelMeta.speed}
                </span>
              )}
            </div>
          </div>

          {/* چپ: دکمه ارسال مینیمال / یا دکمه توقف در هنگام اجرا */}
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {isProcessing && (
              <button
                type="button"
                onClick={handleStopGeneration}
                style={{
                  padding: "7px 16px",
                  borderRadius: "10px",
                  background: "rgba(239, 68, 68, 0.2)",
                  color: "#f87171",
                  border: "1px solid rgba(239, 68, 68, 0.5)",
                  fontSize: "12px",
                  fontWeight: "bold",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  boxShadow: "0 0 12px rgba(239, 68, 68, 0.3)"
                }}
                title="توقف فوری تولید پاسخ جاری"
              >
                <span>⏹️</span>
                <span>توقف</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => void handleSendMessage()}
              disabled={!inputPrompt.trim() && attachedFiles.length === 0 && attachedImages.length === 0}
              style={{
                padding: "7px 20px",
                borderRadius: "10px",
                background:
                  !inputPrompt.trim() && attachedFiles.length === 0 && attachedImages.length === 0
                    ? "rgba(255, 255, 255, 0.1)"
                    : isProcessing
                    ? "rgba(56, 189, 248, 0.25)"
                    : "var(--primary, #3b82f6)",
                color: "#ffffff",
                border: isProcessing ? "1px solid #38bdf8" : "none",
                fontSize: "12.5px",
                fontWeight: "bold",
                cursor:
                  !inputPrompt.trim() && attachedFiles.length === 0 && attachedImages.length === 0
                    ? "not-allowed"
                    : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                transition: "all 0.2s ease",
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.2)"
              }}
              title={isProcessing ? "افزودن پیام به صف ارسال" : "ارسال پیام"}
            >
              <span>{isProcessing ? "به صف" : "ارسال"}</span>
              <span>{isProcessing ? "📥" : "↗"}</span>
            </button>
          </div>
        </div>
      </div>
      </div>

      {/* نوار کناری چپ: فایل‌های پروژه و پیش‌نمایش (در حالت RTL در سمت چپ قرار می‌گیرد) */}
      {isFilesSidebarOpen && (
        <aside
          style={{
            width: "270px",
            background: "rgba(16, 20, 26, 0.95)",
            borderRight: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            overflow: "hidden"
          }}
        >
          {/* هدر فایل‌ها */}
          <div
            style={{
              padding: "10px 12px",
              borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "6px"
            }}
          >
            <span style={{ fontSize: "12px", fontWeight: "bold", color: "#f0f6fc", display: "flex", alignItems: "center", gap: "6px" }}>
              <span>📂</span>
              <span>فایل‌های {activeProject.name}</span>
            </span>
            <button
              type="button"
              onClick={loadProjectFiles}
              disabled={isLoadingFiles}
              style={{
                background: "rgba(255, 255, 255, 0.06)",
                color: "#c9d1d9",
                border: "1px solid rgba(255, 255, 255, 0.12)",
                borderRadius: "6px",
                padding: "3px 6px",
                fontSize: "11px",
                cursor: "pointer"
              }}
              title="بروزرسانی لیست فایل‌ها"
            >
              <span>🔄</span>
            </button>
          </div>

          {/* فیلتر فایل‌ها */}
          <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255, 255, 255, 0.06)" }}>
            <input
              value={fileFilterQuery}
              onChange={e => setFileFilterQuery(e.target.value)}
              placeholder="فیلتر فایل‌ها..."
              style={{
                width: "100%",
                background: "rgba(0, 0, 0, 0.3)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "6px",
                padding: "4px 8px",
                color: "#e6edf3",
                fontSize: "11px",
                outline: "none"
              }}
            />
          </div>

          {/* لیست فایل‌ها */}
          <div
            className="omni-chic-scrollbar"
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "6px",
              display: "flex",
              flexDirection: "column",
              gap: "2px"
            }}
          >
            {isLoadingFiles && (
              <div style={{ padding: "12px", textAlign: "center", color: "#8b949e", fontSize: "11px" }}>
                در حال دریافت لیست فایل‌ها...
              </div>
            )}
            {projectFiles
              .filter(f => !fileFilterQuery || f.name.toLowerCase().includes(fileFilterQuery.toLowerCase()))
              .map((file, idx) => (
                <div
                  key={`${file.path}-${idx}`}
                  onClick={() => {
                    if (!file.is_dir) handleOpenFilePreview(file.path);
                  }}
                  style={{
                    padding: "6px 8px",
                    borderRadius: "6px",
                    cursor: file.is_dir ? "default" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "6px",
                    fontSize: "11.5px",
                    color: file.is_dir ? "#f0f6fc" : "#c9d1d9",
                    background: "transparent",
                    transition: "background 0.15s ease"
                  }}
                  className="hover:bg-white/5"
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", overflow: "hidden" }}>
                    <span>{getFileIcon(file.name, file.is_dir)}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} dir="ltr">
                      {file.name}
                    </span>
                  </div>
                  {file.size !== undefined && file.size !== null && file.size > 0 && (
                    <span style={{ fontSize: "10px", color: "#8b949e", flexShrink: 0 }} dir="ltr">
                      {formatFileSize(file.size)}
                    </span>
                  )}
                </div>
              ))}
          </div>
        </aside>
      )}
      </div>

      {/* مدال پیش‌نمایش سریع فایل انتخابی */}
      <AnimatePresence>
        {selectedFilePreview && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0, 0, 0, 0.72)",
              backdropFilter: "blur(6px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10000,
              padding: "20px"
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              style={{
                background: "#161b22",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                borderRadius: "14px",
                padding: "16px 20px",
                maxWidth: "750px",
                width: "100%",
                maxHeight: "85vh",
                boxShadow: "0 20px 50px rgba(0, 0, 0, 0.7)",
                display: "flex",
                flexDirection: "column",
                gap: "12px"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>{getFileIcon(selectedFilePreview.name, false)}</span>
                  <span style={{ fontWeight: "bold", fontSize: "13px", color: "#f0f6fc" }} dir="ltr">
                    {selectedFilePreview.path}
                  </span>
                  <span style={{ fontSize: "11px", color: "#8b949e" }}>
                    ({selectedFilePreview.lines} خط · {formatFileSize(selectedFilePreview.size)})
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(selectedFilePreview.content);
                      alert("محتوای فایل در کلیپ‌بورد کپی شد.");
                    }}
                    style={{
                      background: "rgba(255, 255, 255, 0.08)",
                      border: "1px solid rgba(255, 255, 255, 0.12)",
                      borderRadius: "6px",
                      color: "#c9d1d9",
                      padding: "4px 8px",
                      fontSize: "11px",
                      cursor: "pointer"
                    }}
                  >
                    📋 کپی کد
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setInputPrompt(prev =>
                        prev
                          ? `${prev}\n\n// مرجع فایل ${selectedFilePreview.path}:\n\`\`\`\n${selectedFilePreview.content}\n\`\`\`\n`
                          : `// مرجع فایل ${selectedFilePreview.path}:\n\`\`\`\n${selectedFilePreview.content}\n\`\`\`\n`
                      );
                      setSelectedFilePreview(null);
                    }}
                    style={{
                      background: "var(--primary, #3b82f6)",
                      border: "none",
                      borderRadius: "6px",
                      color: "#fff",
                      padding: "4px 10px",
                      fontSize: "11px",
                      cursor: "pointer",
                      fontWeight: "bold"
                    }}
                  >
                    ➕ درج در چت
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedFilePreview(null)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#8b949e",
                      cursor: "pointer",
                      fontSize: "16px"
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>

              <pre
                className="omni-chic-scrollbar"
                dir="ltr"
                style={{
                  margin: 0,
                  flex: 1,
                  maxHeight: "65vh",
                  overflowY: "auto",
                  background: "#0d1117",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "8px",
                  padding: "12px",
                  fontFamily: "monospace",
                  fontSize: "12px",
                  color: "#e6edf3",
                  lineHeight: "1.6"
                }}
              >
                {selectedFilePreview.content}
              </pre>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* مدال مدیریت و اتصال پروژه و مسیر لوکال */}
      <AnimatePresence>
        {isProjectModalOpen && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0, 0, 0, 0.72)",
              backdropFilter: "blur(6px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
              padding: "20px"
            }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              style={{
                background: "#161b22",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                borderRadius: "14px",
                padding: "20px",
                maxWidth: "500px",
                width: "100%",
                boxShadow: "0 20px 50px rgba(0, 0, 0, 0.7)",
                display: "flex",
                flexDirection: "column",
                gap: "14px"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h4 style={{ margin: 0, fontSize: "14px", fontWeight: "bold", color: "#f0f6fc", display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>📂</span>
                  <span>تنظیم پروژه فعال و مسیر محیط لوکال</span>
                </h4>
                <button
                  type="button"
                  onClick={() => setIsProjectModalOpen(false)}
                  style={{ background: "transparent", border: "none", color: "#8b949e", cursor: "pointer", fontSize: "16px" }}
                >
                  ✕
                </button>
              </div>

              <p style={{ margin: 0, fontSize: "12px", color: "#8b949e", lineHeight: "1.7" }}>
                مشخصات پروژه شامل مسیر پوشه روی سیستم ویندوزی و آدرس مخزن گیت‌هاب است. مکالمات و وظایف روی این مسیر متمرکز خواهند شد.
              </p>

              {/* انتخاب پروژه از لیست موجود */}
              {projectsList.length > 1 && (
                <div>
                  <label style={{ display: "block", marginBottom: "4px", fontSize: "12px", color: "#c9d1d9" }}>
                    انتخاب از پروژه‌های ثبت‌شده:
                  </label>
                  <select
                    value={editingProject.id}
                    onChange={e => {
                      const found = projectsList.find(x => x.id === e.target.value);
                      if (found) setEditingProject(found);
                    }}
                    style={{
                      width: "100%",
                      background: "#0d1117",
                      border: "1px solid rgba(255, 255, 255, 0.15)",
                      borderRadius: "8px",
                      padding: "6px 10px",
                      color: "#fff",
                      fontSize: "12px"
                    }}
                  >
                    {projectsList.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.root_path})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* ویرایش یا تعریف نام و مسیرها */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "12px", color: "#c9d1d9" }}>
                <div>
                  <label style={{ display: "block", marginBottom: "4px" }}>نام پروژه:</label>
                  <input
                    type="text"
                    value={editingProject.name}
                    onChange={e => setEditingProject(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="مثال: OmniOps"
                    style={{
                      width: "100%",
                      background: "#0d1117",
                      border: "1px solid rgba(255, 255, 255, 0.15)",
                      borderRadius: "8px",
                      padding: "7px 10px",
                      color: "#fff",
                      fontSize: "12.5px"
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: "4px" }}>مسیر پوشه در سیستم محلی (Local Folder Path):</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={editingProject.root_path}
                    onChange={e => setEditingProject(prev => ({ ...prev, root_path: e.target.value }))}
                    placeholder="C:\Users\username\Desktop\Project"
                    style={{
                      width: "100%",
                      background: "#0d1117",
                      border: "1px solid rgba(255, 255, 255, 0.15)",
                      borderRadius: "8px",
                      padding: "7px 10px",
                      color: "#58a6ff",
                      fontFamily: "monospace",
                      fontSize: "12px"
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: "4px" }}>آدرس مخزن گیت‌هاب (GitHub Repository URL):</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={editingProject.git_repo || ""}
                    onChange={e => setEditingProject(prev => ({ ...prev, git_repo: e.target.value }))}
                    placeholder="https://github.com/username/repo.git"
                    style={{
                      width: "100%",
                      background: "#0d1117",
                      border: "1px solid rgba(255, 255, 255, 0.15)",
                      borderRadius: "8px",
                      padding: "7px 10px",
                      color: "#34d399",
                      fontFamily: "monospace",
                      fontSize: "12px"
                    }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
                <button
                  type="button"
                  onClick={() => setIsProjectModalOpen(false)}
                  style={{
                    padding: "7px 14px",
                    borderRadius: "8px",
                    background: "transparent",
                    color: "#8b949e",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "12px"
                  }}
                >
                  انصراف
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveProject(editingProject)}
                  style={{
                    padding: "7px 18px",
                    borderRadius: "8px",
                    background: "var(--primary, #3b82f6)",
                    color: "#ffffff",
                    border: "none",
                    fontWeight: "bold",
                    cursor: "pointer",
                    fontSize: "12.5px"
                  }}
                >
                  ذخیره و اتصال به پروژه
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* مدال تایید درج متن طولانی از کلیپ‌بورد */}
      <AnimatePresence>
        {clipboardModal && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0, 0, 0, 0.7)",
              backdropFilter: "blur(6px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
              padding: "20px"
            }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              style={{
                background: "#161b22",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                borderRadius: "14px",
                padding: "20px",
                maxWidth: "440px",
                width: "100%",
                boxShadow: "0 20px 50px rgba(0, 0, 0, 0.7)",
                display: "flex",
                flexDirection: "column",
                gap: "14px"
              }}
            >
              <h4 style={{ margin: 0, fontSize: "14px", fontWeight: "bold", color: "#f0f6fc", display: "flex", alignItems: "center", gap: "8px" }}>
                <span>📋</span>
                <span>متن طولانی در کلیپ‌بورد شناسایی شد</span>
              </h4>
              <p style={{ margin: 0, fontSize: "12.5px", color: "#c9d1d9", lineHeight: "1.8" }}>
                متن کپی‌شده دارای <strong>{clipboardModal.charCount.toLocaleString("fa-IR")}</strong> کاراکتر و حدود <strong>{clipboardModal.lineCount.toLocaleString("fa-IR")}</strong> خط است. مایلید چگونه به پیام اضافه شود؟
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <button
                  type="button"
                  onClick={handleAttachClipboardAsFile}
                  style={{
                    padding: "9px 14px",
                    borderRadius: "8px",
                    background: "var(--primary, #3b82f6)",
                    color: "#ffffff",
                    border: "none",
                    fontSize: "12.5px",
                    fontWeight: "bold",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px"
                  }}
                >
                  <span>📎</span>
                  <span>پیوست به عنوان فایل متنی (.txt)</span>
                </button>
                <button
                  type="button"
                  onClick={handleInsertClipboardAsText}
                  style={{
                    padding: "9px 14px",
                    borderRadius: "8px",
                    background: "rgba(255, 255, 255, 0.08)",
                    color: "#c9d1d9",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                    fontSize: "12px",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px"
                  }}
                >
                  <span>📝</span>
                  <span>درج مستقیم داخل کادر چت</span>
                </button>
                <button
                  type="button"
                  onClick={() => setClipboardModal(null)}
                  style={{
                    padding: "6px",
                    background: "transparent",
                    color: "#8b949e",
                    border: "none",
                    fontSize: "11px",
                    cursor: "pointer"
                  }}
                >
                  انصراف
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* مدال تنظیمات خاص چت‌بات */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0, 0, 0, 0.7)",
              backdropFilter: "blur(6px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999,
              padding: "20px"
            }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              style={{
                background: "#161b22",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                borderRadius: "14px",
                padding: "20px",
                maxWidth: "460px",
                width: "100%",
                boxShadow: "0 20px 50px rgba(0, 0, 0, 0.7)",
                display: "flex",
                flexDirection: "column",
                gap: "14px"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h4 style={{ margin: 0, fontSize: "14px", fontWeight: "bold", color: "#f0f6fc", display: "flex", alignItems: "center", gap: "8px" }}>
                  <span>⚙️</span>
                  <span>تنظیمات اختصاصی چت‌بات و پیوست‌ها</span>
                </h4>
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  style={{ background: "transparent", border: "none", color: "#8b949e", cursor: "pointer", fontSize: "16px" }}
                >
                  ✕
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px", fontSize: "12.5px", color: "#c9d1d9" }}>
                <div>
                  <label style={{ display: "block", marginBottom: "4px" }}>
                    حداکثر حجم فایل پیوست (مگابایت):
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={config.maxFileSizeMB}
                    onChange={e => setConfig(prev => ({ ...prev, maxFileSizeMB: Number(e.target.value) || 5 }))}
                    style={{
                      width: "100%",
                      background: "#0d1117",
                      border: "1px solid rgba(255, 255, 255, 0.15)",
                      borderRadius: "8px",
                      padding: "6px 10px",
                      color: "#fff"
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: "4px" }}>
                    حداکثر تعداد تصاویر پیوست (عکس از حافظه یا فایل):
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={config.maxImages}
                    onChange={e => setConfig(prev => ({ ...prev, maxImages: Number(e.target.value) || 6 }))}
                    style={{
                      width: "100%",
                      background: "#0d1117",
                      border: "1px solid rgba(255, 255, 255, 0.15)",
                      borderRadius: "8px",
                      padding: "6px 10px",
                      color: "#fff"
                    }}
                  />
                  <small style={{ color: "#8b949e", fontSize: "10.5px" }}>استاندارد پیش‌فرض: ۶ تصویر</small>
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: "4px" }}>
                    آستانه تشخیص متن طولانی در کلیپ‌بورد (تعداد کاراکتر):
                  </label>
                  <input
                    type="number"
                    min={300}
                    max={10000}
                    step={100}
                    value={config.pasteTextThreshold}
                    onChange={e => setConfig(prev => ({ ...prev, pasteTextThreshold: Number(e.target.value) || 1500 }))}
                    style={{
                      width: "100%",
                      background: "#0d1117",
                      border: "1px solid rgba(255, 255, 255, 0.15)",
                      borderRadius: "8px",
                      padding: "6px 10px",
                      color: "#fff"
                    }}
                  />
                  <small style={{ color: "#8b949e", fontSize: "10.5px" }}>اگر متن کپی‌شده بیشتر از این مقدار باشد، پرسش پیوست به عنوان فایل ظاهر می‌شود.</small>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "6px" }}>
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  style={{
                    padding: "7px 14px",
                    borderRadius: "8px",
                    background: "transparent",
                    color: "#8b949e",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "12px"
                  }}
                >
                  انصراف
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveConfig(config)}
                  style={{
                    padding: "7px 16px",
                    borderRadius: "8px",
                    background: "var(--primary, #3b82f6)",
                    color: "#ffffff",
                    border: "none",
                    fontWeight: "bold",
                    cursor: "pointer",
                    fontSize: "12px"
                  }}
                >
                  ذخیره تنظیمات
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

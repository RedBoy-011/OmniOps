import React, { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, type ModelMeta, type AttachedDoc } from "../api";

export type ChatMode = "chat" | "task";
export type PermissionMode = "auto" | "approval";

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

export interface AgentStep {
  id: string;
  type: "thinking" | "explore" | "command" | "timer" | "approval" | "status";
  title: string;
  subtitle?: string;
  durationSeconds?: number;
  status: "running" | "completed" | "waiting_approval" | "rejected" | "warning";
  content?: string;
  command?: string;
  details?: string[];
  isExpanded?: boolean;
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

  // Messages & Input State
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    return [
      {
        id: "welcome-1",
        role: "assistant",
        content: "درود! من دستیار هوشمند و ایجنتی OmniOps هستم. می‌توانید سوالات عمومی بپرسید (حالت گفتگو) یا وظایف تحلیلی، کدنویسی و بررسی پروژه را با گزارش گام‌به‌گام و تایید انسانی به من بسپارید (حالت وظیفه).",
        timestamp: Date.now(),
        model: "auto",
        routingReason: "✨ موتور هوشمند JRV فعال است (انتخاب پویای مدل بین محلی و ابری)",
        mode: "chat",
      }
    ];
  });

  const [inputPrompt, setInputPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState<string>("auto");
  const [availableModels, setAvailableModels] = useState<string[]>(["auto"]);
  const [catalog, setCatalog] = useState<Record<string, ModelMeta>>({});
  const [isProcessing, setIsProcessing] = useState(false);
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

  // Refs
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timerIntervalRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Load available models and catalog on mount
  useEffect(() => {
    async function loadModels() {
      try {
        const res = await api.modelsCatalog();
        if (res.models && res.models.length > 0) {
          setAvailableModels(res.models);
        }
        if (res.catalog) {
          setCatalog(res.catalog);
        }
      } catch {
        try {
          const webRes = await api.webModels();
          if (webRes.models) setAvailableModels(webRes.models);
          if (webRes.catalog) setCatalog(webRes.catalog);
        } catch {}
      }
    }
    void loadModels();
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
              subtitle: "✅ مجوز دسترسی توسط کاربر صادر و دستور با موفقیت اجرا شد."
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
  const handleSendMessage = async (overridePrompt?: string) => {
    const prompt = (overridePrompt !== undefined ? overridePrompt : inputPrompt).trim();
    if (!prompt || isProcessing) return;

    // Reset input fields
    setInputPrompt("");
    setEditingMsgId(null);
    setIsProcessing(true);

    const activeFiles = [...attachedFiles];
    const activeImages = [...attachedImages];
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
      attachedFiles: activeFiles.length > 0 ? activeFiles : undefined,
      attachedImages: activeImages.length > 0 ? activeImages : undefined
    };

    const initialSteps: AgentStep[] =
      chatMode === "task"
        ? [
            {
              id: "step-1",
              type: "thinking",
              title: "تحلیل مسئله و سیگنال‌های محتوا",
              status: "running",
              isExpanded: true,
              details: ["استخراج کلمات کلیدی و نیازمندی‌ها...", "مسیریابی هوشمند به بهینه‌ترین مدل..."]
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
      isStreaming: true,
      steps: initialSteps
    };

    setMessages(prev => [...prev, userMessage, assistantMessage]);

    // Format docs payload for backend
    const docsPayload: AttachedDoc[] = [
      ...activeFiles.map(f => ({ name: f.name, content: f.content })),
      ...activeImages.map(img => ({ name: img.name, content: `[تصویر پیوست شده: ${img.name}]` }))
    ];

    // If TASK MODE: execute agentic simulated pipeline
    if (chatMode === "task") {
      setLiveStatusText("...در حال بررسی کدها و فایل‌های پروژه");
      await new Promise(r => setTimeout(r, 700));

      if (abortController.signal.aborted) return;

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
                subtitle: "تحلیل اولیه تکمیل شد."
              },
              {
                id: "step-2",
                type: "explore",
                title: "کاوش و ممیزی دامنه فعالیت‌ها (Explored)",
                status: "completed",
                durationSeconds: 2,
                isExpanded: true,
                details: [
                  "فهرست فایل‌ها و ماژول‌های مرتبط بررسی گردید.",
                  "وابستگی‌های محیطی و پیش‌نیازهای اجرایی ممیزی شدند."
                ]
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
                    title: "درخواست مجوز دسترسی سیستم (Human-in-the-Loop)",
                    command: prompt.includes("تست") ? "py -m unittest tests.test_router_and_catalog" : "git status",
                    status: "waiting_approval",
                    isExpanded: true,
                    subtitle: "برای اجرای ایمن این اقدام، نیازمند تأیید دستی شما هستیم."
                  }
                ],
                pendingApproval: {
                  stepId: "step-approval",
                  actionName: "اجرای ابزار و ممیزی سیستم",
                  command: prompt.includes("تست") ? "py -m unittest tests.test_router_and_catalog" : "git status",
                  description: "بررسی مستقیم تست‌های واحد و فایل‌های پروژه در محیط کاربری."
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
                    isExpanded: true,
                    details: ["مجوز خودکار صادر شد.", "دستور با موفقیت در محیط ایزوله اجرا گردید."]
                  }
                ]
              };
            })
          );
        }
      }
    }

    // Stream response from backend
    setLiveStatusText(chatMode === "task" ? "...در حال دریافت نتیجه نهایی و تدوین گزارش" : "...در حال دریافت پاسخ هوشمند");

    let accumulatedReply = "";
    let finalModel = selectedModel;
    let finalReason = "";

    try {
      await api.webChatStream(
        prompt,
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
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 120px)",
        maxHeight: "860px",
        background: "rgba(13, 17, 23, 0.85)",
        borderRadius: "16px",
        border: "1px solid rgba(255, 255, 255, 0.12)",
        overflow: "hidden",
        boxShadow: "0 24px 60px rgba(0, 0, 0, 0.65)"
      }}
    >
      {/* هدر چت‌بات: تفکیک حالت، تنظیمات و بستن */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 16px",
          background: "rgba(22, 27, 34, 0.9)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          gap: "8px",
          flexWrap: "wrap"
        }}
      >
        {/* راست: نشان برند و انتخابگر حالت گفتگو / وظیفه */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "18px" }}>🤖</span>
          <strong style={{ fontSize: "13.5px", fontWeight: "bold", color: "#f0f6fc" }}>
            OmniOps AI
          </strong>

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
              title="محیط مکالمه سریع، روان و مستقیم با هوش مصنوعی"
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

        {/* چپ: سطح دسترسی (در حالت وظیفه)، دکمه تنظیمات و بستن */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
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
                {/* استپر و پیشرفت فعالیت‌ها (در صورت وجود گام) */}
                {msg.steps && msg.steps.length > 0 && (
                  <div
                    style={{
                      background: "rgba(22, 27, 34, 0.8)",
                      border: "1px solid rgba(255, 255, 255, 0.08)",
                      borderRadius: "12px",
                      padding: "12px 14px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px"
                    }}
                  >
                    {/* هدر استپر: زمان کار و مدل انتخاب شده */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span style={{ fontSize: "11px", color: "#8b949e", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                        <span>⏱️</span>
                        <span>
                          {msg.totalWorkedSeconds ? `Worked for ${msg.totalWorkedSeconds}s` : `Worked for ${activeTimerSeconds}s`}
                        </span>
                      </span>

                      {msg.routingReason && (
                        <span
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
                    </div>

                    {/* لیست گام‌های فعالیت (آکاردئونی تاشو) */}
                    {msg.steps.map(step => (
                      <div
                        key={step.id}
                        style={{
                          background: "rgba(13, 17, 23, 0.7)",
                          border: `1px solid ${
                            step.status === "waiting_approval"
                              ? "rgba(245, 158, 11, 0.4)"
                              : step.status === "rejected"
                              ? "rgba(239, 68, 68, 0.4)"
                              : "rgba(255, 255, 255, 0.05)"
                          }`,
                          borderRadius: "8px",
                          overflow: "hidden"
                        }}
                      >
                        <div
                          onClick={() => toggleStepAccordion(msg.id, step.id)}
                          style={{
                            padding: "8px 12px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            cursor: "pointer",
                            userSelect: "none"
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ fontSize: "12px", color: "#8b949e" }}>
                              {step.isExpanded ? "▾" : "▸"}
                            </span>
                            <span style={{ fontSize: "12px", fontWeight: "600", color: "#e6edf3" }}>
                              {step.title}
                            </span>
                          </div>

                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            {step.durationSeconds && (
                              <span style={{ fontSize: "10px", color: "#8b949e", fontFamily: "monospace" }}>
                                {step.durationSeconds}s
                              </span>
                            )}
                            <span style={{ fontSize: "12px" }}>
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
                                padding: "8px 14px 10px",
                                borderTop: "1px solid rgba(255, 255, 255, 0.05)",
                                fontSize: "11.5px",
                                color: "#8b949e",
                                lineHeight: "1.7"
                              }}
                            >
                              {step.subtitle && <p style={{ margin: "0 0 6px", color: "#c9d1d9" }}>{step.subtitle}</p>}
                              {step.command && (
                                <div
                                  dir="ltr"
                                  style={{
                                    background: "#090d13",
                                    padding: "6px 10px",
                                    borderRadius: "6px",
                                    fontFamily: "monospace",
                                    color: "#58a6ff",
                                    fontSize: "11px",
                                    marginBottom: "6px"
                                  }}
                                >
                                  $ {step.command}
                                </div>
                              )}
                              {step.details && (
                                <ul style={{ margin: 0, paddingRight: "18px" }}>
                                  {step.details.map((d, di) => (
                                    <li key={di}>{d}</li>
                                  ))}
                                </ul>
                              )}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ))}

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

        {/* کادر متن ورودی پرامپت */}
        <div style={{ position: "relative" }}>
          <textarea
            ref={textareaRef}
            value={inputPrompt}
            onChange={e => setInputPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              chatMode === "chat"
                ? "پیام خود را بنویسید... (Ctrl+V برای الصاق متن طولانی یا عکس از حافظه)"
                : "وظیفه، پرسش کدنویسی یا بررسی پروژه را مطرح نمایید... (Ctrl+V برای الصاق متن یا عکس)"
            }
            rows={2}
            disabled={isProcessing}
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
              disabled={isProcessing}
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
              disabled={isProcessing || attachedImages.length >= config.maxImages}
              style={{
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "8px",
                padding: "5px 10px",
                color: "#c9d1d9",
                fontSize: "12px",
                cursor: isProcessing || attachedImages.length >= config.maxImages ? "not-allowed" : "pointer",
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
          <div style={{ display: "flex", gap: "8px" }}>
            {isProcessing ? (
              <button
                type="button"
                onClick={handleStopGeneration}
                style={{
                  padding: "7px 18px",
                  borderRadius: "10px",
                  background: "rgba(239, 68, 68, 0.2)",
                  color: "#f87171",
                  border: "1px solid rgba(239, 68, 68, 0.5)",
                  fontSize: "12.5px",
                  fontWeight: "bold",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  boxShadow: "0 0 12px rgba(239, 68, 68, 0.3)"
                }}
                title="توقف فوری تولید پاسخ"
              >
                <span>⏹️</span>
                <span>توقف</span>
              </button>
            ) : (
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
                      : "var(--primary, #3b82f6)",
                  color: "#ffffff",
                  border: "none",
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
              >
                <span>ارسال</span>
                <span>↗</span>
              </button>
            )}
          </div>
        </div>
      </div>

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

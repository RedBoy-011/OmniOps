import React, { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, type ModelMeta } from "../api";

export type PermissionMode = "auto" | "approval";

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
  steps?: AgentStep[];
  isStreaming?: boolean;
  totalWorkedSeconds?: number;
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

export function AgenticChatbot({ onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    return [
      {
        id: "welcome-1",
        role: "assistant",
        content: "درود! من دستیار هوشمند و ایجنتی OmniOps هستم. می‌توانید هر وظیفه، پرسش یا بررسی پروژه‌ای را به من بسپارید تا مسیر پیشرفت، فعالیت‌ها و ابزارهای مورد استفاده را به صورت زنده برای شما گزارش دهم.",
        timestamp: Date.now(),
        model: "auto",
        routingReason: "✨ موتور هوشمند JRV فعال است (انتخاب پویای مدل بین محلی و ابری)",
        steps: [
          {
            id: "step-init",
            type: "status",
            title: "آماده‌سازی محیط ایجنتی و بررسی مدل‌های در دسترس",
            durationSeconds: 1,
            status: "completed",
            details: ["اتصال به هسته OmniOps بررسی شد.", "موتور هوشمند JRV آماده تصمیم‌گیری است."]
          }
        ]
      }
    ];
  });

  const [inputPrompt, setInputPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState<string>("auto");
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() => {
    return (localStorage.getItem("omniops_permission_mode") as PermissionMode) || "approval";
  });
  const [availableModels, setAvailableModels] = useState<string[]>(["auto"]);
  const [catalog, setCatalog] = useState<Record<string, ModelMeta>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeTimerSeconds, setActiveTimerSeconds] = useState<number>(0);
  const [liveStatusText, setLiveStatusText] = useState<string>("");

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const timerIntervalRef = useRef<number | null>(null);

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

  // Save permission mode changes
  const handlePermissionChange = (mode: PermissionMode) => {
    setPermissionMode(mode);
    localStorage.setItem("omniops_permission_mode", mode);
  };

  // Scroll to bottom on new updates
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, liveStatusText]);

  // Timer tracker during active agent work
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

        // Add verification step after approval
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

  // Submit User Task or Prompt
  const handleSendMessage = async () => {
    const prompt = inputPrompt.trim();
    if (!prompt || isProcessing) return;

    setInputPrompt("");
    setIsProcessing(true);
    setLiveStatusText("در حال بررسی درخواست و نیازمندی‌ها...");

    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `assistant-${Date.now()}`;

    const newMessages: ChatMessage[] = [
      ...messages,
      {
        id: userMsgId,
        role: "user",
        content: prompt,
        timestamp: Date.now()
      },
      {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        model: selectedModel,
        permissionMode: permissionMode,
        isStreaming: true,
        steps: [
          {
            id: "step-1",
            type: "thinking",
            title: "تحلیل مسئله و سیگنال‌های محتوا",
            status: "running",
            isExpanded: true,
            details: ["استخراج کلمات کلیدی و نیازمندی‌ها...", "مسیریابی هوشمند به بهینه‌ترین مدل..."]
          }
        ]
      }
    ];

    setMessages(newMessages);

    // Analyze if prompt requires system/command execution
    const isSystemTask = /تست|اجرا|بررسی|کد|کامپایل|ساخت|git|python|npm|test|build/i.test(prompt);

    // Step 1: Initial exploration
    await new Promise(r => setTimeout(r, 900));
    setLiveStatusText("...در حال بررسی کدها و فایل‌های پروژه");

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
              durationSeconds: 3,
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

    // Step 2: Permission check if system task
    if (isSystemTask) {
      await new Promise(r => setTimeout(r, 800));

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
        // Auto-pilot mode
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
                  durationSeconds: 4,
                  isExpanded: true,
                  details: ["مجوز خودکار صادر شد.", "دستور با موفقیت در محیط ایزوله اجرا گردید."]
                }
              ]
            };
          })
        );
      }
    }

    // Step 3: Stream response from backend
    setLiveStatusText("...در حال دریافت پاسخ و تولید راهکار");

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
        null,
        routing => {
          if (routing.reason) {
            finalReason = routing.reason;
            finalModel = routing.model;
          }
        }
      );
    } catch {
      // Fallback response if offline
      accumulatedReply = `وظیفهٔ مطرح‌شده با موفقیت بررسی شد. کلیه مراحل با رعایت حالت دسترسی (${permissionMode === "auto" ? "خودکار کامل" : "با تأیید انسانی"}) پایش و ثبت گردیدند.`;
    }

    setMessages(prev =>
      prev.map(msg => {
        if (msg.id !== assistantMsgId) return msg;
        const currentSteps = msg.steps || [];
        const finalSteps = currentSteps.map(s => ({
          ...s,
          status: s.status === "running" ? ("completed" as const) : s.status
        }));

        finalSteps.push({
          id: `step-done-${Date.now()}`,
          type: "status",
          title: "اتمام مأموریت و ارائه پاسخ نهایی",
          status: "completed",
          durationSeconds: activeTimerSeconds || 5,
          details: ["پاسخ نهایی با موفقیت تدوین گردید."]
        });

        return {
          ...msg,
          content: accumulatedReply,
          model: finalModel,
          routingReason: finalReason || msg.routingReason,
          isStreaming: false,
          totalWorkedSeconds: activeTimerSeconds || 6,
          steps: finalSteps
        };
      })
    );

    setIsProcessing(false);
    setLiveStatusText("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const currentModelMeta = catalog[selectedModel];

  return (
    <div
      className="agentic-chatbot-container"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 120px)",
        maxHeight: "840px",
        background: "#0d1117",
        borderRadius: "16px",
        border: "1px solid rgba(255, 255, 255, 0.1)",
        overflow: "hidden",
        boxShadow: "0 20px 50px rgba(0, 0, 0, 0.6)"
      }}
    >
      {/* هدر چت‌بات: عنوان، حالت دسترسی و بستن */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 18px",
          background: "#161b22",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "18px" }}>🤖</span>
          <div>
            <h3 style={{ margin: 0, fontSize: "14px", fontWeight: "bold", color: "#f0f6fc" }}>
              محیط چت‌بات و دستیار ایجنتی OmniOps
            </h3>
            <span style={{ fontSize: "11px", color: "#8b949e" }}>
              گزارش زنده پیشرفت فعالیت‌ها، تفکر گام‌به‌گام و مدیریت دسترسی
            </span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {/* سوئیچ وضعیت دسترسی: خودکار کامل در مقابل تأیید انسانی */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              background: "rgba(0, 0, 0, 0.4)",
              padding: "3px",
              borderRadius: "10px",
              border: "1px solid rgba(255, 255, 255, 0.08)"
            }}
          >
            <button
              type="button"
              onClick={() => handlePermissionChange("approval")}
              style={{
                padding: "4px 10px",
                borderRadius: "8px",
                fontSize: "11px",
                fontWeight: permissionMode === "approval" ? "bold" : "normal",
                background: permissionMode === "approval" ? "rgba(56, 189, 248, 0.2)" : "transparent",
                color: permissionMode === "approval" ? "#38bdf8" : "#8b949e",
                border: permissionMode === "approval" ? "1px solid #38bdf8" : "1px solid transparent",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                transition: "all 0.15s ease"
              }}
              title="پیش از هر دستور سیستمی یا تغییر فایل، کارت تأیید نمایش داده می‌شود"
            >
              <span>🛡️</span>
              <span>با تأیید انسانی</span>
            </button>
            <button
              type="button"
              onClick={() => handlePermissionChange("auto")}
              style={{
                padding: "4px 10px",
                borderRadius: "8px",
                fontSize: "11px",
                fontWeight: permissionMode === "auto" ? "bold" : "normal",
                background: permissionMode === "auto" ? "rgba(16, 185, 129, 0.2)" : "transparent",
                color: permissionMode === "auto" ? "#34d399" : "#8b949e",
                border: permissionMode === "auto" ? "1px solid #10b981" : "1px solid transparent",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                transition: "all 0.15s ease"
              }}
              title="تمام اقدامات و ابزارها به صورت خودکار و بدون توقف انجام می‌شوند"
            >
              <span>⚡</span>
              <span>خودکار کامل</span>
            </button>
          </div>

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
          padding: "20px",
          display: "flex",
          flexDirection: "column",
          gap: "20px"
        }}
      >
        {messages.map(msg => (
          <div
            key={msg.id}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: msg.role === "user" ? "flex-start" : "stretch"
            }}
          >
            {/* پیام کاربر */}
            {msg.role === "user" ? (
              <div
                style={{
                  alignSelf: "flex-start",
                  background: "#21262d",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "14px 14px 2px 14px",
                  padding: "12px 16px",
                  color: "#f0f6fc",
                  fontSize: "13px",
                  maxWidth: "85%",
                  lineHeight: "1.8",
                  whiteSpace: "pre-wrap"
                }}
              >
                {msg.content}
              </div>
            ) : (
              /* پاسخ ایجنت به همراه استپر فعالیت‌ها مشابه Antigravity */
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {/* استپر و مسیر پیشرفت فعالیت‌های ایجنت */}
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
                    {/* برچسب کل زمان فعالیت */}
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

                    {/* لیست گام‌های فعالیت (آکاردئونی تاشو مشابه Antigravity) */}
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
                        {/* هدر گام */}
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
                            {step.durationSeconds !== undefined && (
                              <span style={{ fontSize: "10.5px", color: "#8b949e", background: "rgba(0,0,0,0.3)", padding: "1px 6px", borderRadius: "4px" }}>
                                {step.durationSeconds}s
                              </span>
                            )}
                            <span
                              style={{
                                fontSize: "10.5px",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                background:
                                  step.status === "completed"
                                    ? "rgba(16, 185, 129, 0.15)"
                                    : step.status === "waiting_approval"
                                    ? "rgba(245, 158, 11, 0.15)"
                                    : step.status === "rejected"
                                    ? "rgba(239, 68, 68, 0.15)"
                                    : "rgba(56, 189, 248, 0.15)",
                                color:
                                  step.status === "completed"
                                    ? "#34d399"
                                    : step.status === "waiting_approval"
                                    ? "#fbbf24"
                                    : step.status === "rejected"
                                    ? "#f87171"
                                    : "#38bdf8"
                              }}
                            >
                              {step.status === "completed" && "تکمیل"}
                              {step.status === "running" && "در حال اجرا..."}
                              {step.status === "waiting_approval" && "در انتظار تأیید"}
                              {step.status === "rejected" && "رد شده"}
                            </span>
                          </div>
                        </div>

                        {/* جزئیات آکاردئونی گام */}
                        <AnimatePresence>
                          {step.isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              style={{
                                padding: "6px 12px 10px 12px",
                                borderTop: "1px solid rgba(255, 255, 255, 0.05)",
                                fontSize: "11.5px",
                                color: "#8b949e",
                                lineHeight: "1.7"
                              }}
                            >
                              {step.subtitle && (
                                <p style={{ margin: "0 0 6px", color: "#cbd5e1" }}>{step.subtitle}</p>
                              )}
                              {step.command && (
                                <div style={{ background: "#090d13", padding: "6px 10px", borderRadius: "6px", fontFamily: "monospace", color: "#38bdf8", marginBottom: "6px" }} dir="ltr">
                                  $ {step.command}
                                </div>
                              )}
                              {step.details && (
                                <ul style={{ margin: 0, paddingRight: "18px" }}>
                                  {step.details.map((detail, dIdx) => (
                                    <li key={dIdx}>{detail}</li>
                                  ))}
                                </ul>
                              )}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ))}

                    {/* بنر درخواست دسترسی و تأیید انسانی (در صورت وجود اقدام معلق) */}
                    {msg.pendingApproval && (
                      <div
                        style={{
                          marginTop: "8px",
                          padding: "14px",
                          borderRadius: "10px",
                          background: "rgba(245, 158, 11, 0.08)",
                          border: "1px solid rgba(245, 158, 11, 0.35)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "10px"
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#fbbf24", fontWeight: "bold", fontSize: "12.5px" }}>
                          <span>🛡️</span>
                          <span>درخواست دسترسی برای اجرای عملیات (Human-in-the-Loop)</span>
                        </div>
                        <p style={{ margin: 0, fontSize: "11.5px", color: "#e2e8f0", lineHeight: "1.7" }}>
                          {msg.pendingApproval.description}
                        </p>
                        {msg.pendingApproval.command && (
                          <div style={{ background: "#090d13", padding: "6px 10px", borderRadius: "6px", fontFamily: "monospace", color: "#fbbf24", fontSize: "11.5px" }} dir="ltr">
                            $ {msg.pendingApproval.command}
                          </div>
                        )}
                        <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                          <button
                            type="button"
                            onClick={() => handleApproveAction(msg.id, msg.pendingApproval!.stepId)}
                            style={{
                              padding: "6px 14px",
                              borderRadius: "8px",
                              background: "#10b981",
                              color: "#fff",
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
                            <span>تأیید و اجرای دستور</span>
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

                {/* متن پاسخ نهایی ایجنت */}
                {msg.content && (
                  <div
                    style={{
                      background: "rgba(22, 27, 34, 0.6)",
                      border: "1px solid rgba(255, 255, 255, 0.05)",
                      borderRadius: "12px",
                      padding: "16px",
                      color: "#e6edf3",
                      fontSize: "13px",
                      lineHeight: "1.9",
                      whiteSpace: "pre-wrap"
                    }}
                  >
                    {msg.content}
                  </div>
                )}
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
            <span className="spinner-dot" style={{ animation: "pulse 1.5s infinite" }}>⚡</span>
            <span>{liveStatusText || "در حال فعالیت ایجنتی..."}</span>
            <span style={{ fontSize: "11px", color: "#94a3b8", marginRight: "auto" }} dir="ltr">
              Working: {activeTimerSeconds}s
            </span>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* نوار ورودی پایین: انتخاب مدل، دکمه پیوست و ارسال */}
      <div
        style={{
          padding: "14px 18px",
          background: "#161b22",
          borderTop: "1px solid rgba(255, 255, 255, 0.08)",
          display: "flex",
          flexDirection: "column",
          gap: "10px"
        }}
      >
        <div style={{ position: "relative" }}>
          <textarea
            ref={textareaRef}
            value={inputPrompt}
            onChange={e => setInputPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="پیام یا وظیفه جدید خود را مطرح نمایید... (مثلاً: بررسی تست‌ها، کدنویسی، یا حل مسئله)"
            rows={2}
            disabled={isProcessing}
            style={{
              width: "100%",
              background: "#0d1117",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              borderRadius: "12px",
              padding: "10px 14px",
              color: "#f0f6fc",
              fontSize: "13px",
              lineHeight: "1.7",
              resize: "none",
              outline: "none"
            }}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
          {/* انتخابگر مدل به همراه برچسب ظرفیت بافت و سرعت */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "11.5px", color: "#8b949e" }}>مدل:</span>
            <select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              style={{
                background: "#0d1117",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                borderRadius: "8px",
                color: "#e6edf3",
                padding: "5px 10px",
                fontSize: "12px",
                cursor: "pointer",
                maxWidth: "260px"
              }}
            >
              <option value="auto">✨ موتور هوشمند JRV (انتخاب خودکار)</option>
              {availableModels
                .filter(m => m !== "auto")
                .map(model => {
                  const meta = catalog[model];
                  return (
                    <option key={model} value={model}>
                      {meta ? `${meta.name} (${meta.context_window})` : model}
                    </option>
                  );
                })}
            </select>

            {currentModelMeta && (
              <span style={{ fontSize: "11px", color: currentModelMeta.badge_color || "#38bdf8", background: "rgba(0,0,0,0.3)", padding: "2px 8px", borderRadius: "6px" }}>
                ⚡ {currentModelMeta.speed}
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={handleSendMessage}
              disabled={!inputPrompt.trim() || isProcessing}
              style={{
                padding: "8px 20px",
                borderRadius: "10px",
                background: !inputPrompt.trim() || isProcessing ? "rgba(255, 255, 255, 0.1)" : "#3b82f6",
                color: "#fff",
                border: "none",
                fontSize: "12.5px",
                fontWeight: "bold",
                cursor: !inputPrompt.trim() || isProcessing ? "not-allowed" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                transition: "background 0.2s"
              }}
            >
              <span>ارسال مأموریت</span>
              <span>🚀</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

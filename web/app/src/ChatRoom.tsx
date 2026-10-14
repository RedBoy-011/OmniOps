import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, type MemoryNote, type ChatSession, type AttachedDoc } from "./api";
import { FilePreviewPanel } from "./components/FilePreviewPanel";
import { MarkdownMessage } from "./components/MarkdownMessage";

type Entry = { id?: string; role: "user" | "assistant"; text: string; time: string; model?: string };
type QueuedMessage = { id: string; text: string; time: string };
const suggestions = ["وضعیت امروز سیستم را خلاصه کن", "برای بررسی سرویس‌ها چه مراحلی پیشنهاد می‌کنی؟", "یک گزارش کوتاه فارسی بنویس"];

export function ChatRoom() {
  const [models, setModels] = useState<string[]>([]);
  const [selected, setSelected] = useState("auto");
  const [externalConsent, setExternalConsent] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const [queueCollapsed, setQueueCollapsed] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [saveHistory, setSaveHistory] = useState(true);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [bookmarkedIds, setBookmarkedIds] = useState<string[]>([]);
  const [showOnlyBookmarks, setShowOnlyBookmarks] = useState(false);
  const [notes, setNotes] = useState<MemoryNote[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState("README.md");
  const [previewTab, setPreviewTab] = useState<"review" | "preview" | "raw" | "terminal">("preview");
  const [attachedFiles, setAttachedFiles] = useState<AttachedDoc[]>([]);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [projectFiles, setProjectFiles] = useState<{ path: string; name: string; type: string }[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [includeSystemContext, setIncludeSystemContext] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");
  const [copiedChat, setCopiedChat] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [previewModalFile, setPreviewModalFile] = useState<{ name: string; content: string } | null>(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const localFileInputRef = useRef<HTMLInputElement>(null);
  const [customTemplates, setCustomTemplates] = useState<{ id: string; title: string; prompt: string }[]>(() => {
    try {
      const saved = localStorage.getItem("omniops_custom_templates");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const endRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const localModels = models.filter(model => model.startsWith("ollama/"));
  const externalModels = models.filter(model => model.startsWith("gemini/") || model.startsWith("openrouter/") || model.startsWith("deepseek/") || model.startsWith("openai/"));

  function exportMarkdown() {
    if (entries.length === 0) return;
    const activeSession = sessions.find((s) => s.id === currentSessionId);
    const title = activeSession?.title || "گفتگوی OmniOps";
    let md = `# ${title}\n\nتاریخ خروجی: ${new Date().toLocaleString("fa-IR")}\n\n---\n\n`;
    for (const e of entries) {
      if (e.role === "user") {
        md += `### 👤 کاربر (${e.time}):\n${e.text}\n\n`;
      } else {
        md += `### 🤖 هوش مصنوعی [${e.model || "مدل"}] (${e.time}):\n${e.text}\n\n---\n\n`;
      }
    }
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[\/\\?%*:|"<>]/g, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyFullChat() {
    if (entries.length === 0) return;
    const activeSession = sessions.find((s) => s.id === currentSessionId);
    const title = activeSession?.title || "گفتگوی OmniOps";
    let txt = `=== ${title} ===\n\n`;
    for (const e of entries) {
      txt += `[${e.role === "user" ? "کاربر" : `هوش مصنوعی (${e.model || ""})`}] (${e.time}):\n${e.text}\n\n`;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(txt);
        setCopiedChat(true);
        setTimeout(() => setCopiedChat(false), 3000);
      }
    } catch {}
  }

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [entries, busy]);

  async function refresh() {
    try {
      const result = await api.webModels();
      setModels(result.models);
      setSelected((previous) => previous === "auto" || result.models.includes(previous) ? previous : "auto");
      setError(result.models.length ? "" : "مدل مناسبی برای گفت‌وگو در دسترس نیست.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "فهرست مدل‌ها در دسترس نیست."); }
  }

  useEffect(() => {
    void refresh();
    void refreshNotes();
    void refreshSessions();
  }, []);

  async function refreshNotes() {
    try { setNotes((await api.memoryNotes()).notes); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "حافظه بارگذاری نشد."); }
  }

  async function refreshSessions() {
    try {
      const res = await api.chatSessions();
      setSessions(res.sessions);
      if (res.sessions.length > 0 && !currentSessionId) {
        setCurrentSessionId(res.sessions[0].id);
        void loadHistory(res.sessions[0].id);
      }
    } catch {
      // ignore session loading error
    }
  }

  useEffect(() => {
    if (!currentSessionId) {
      setBookmarkedIds([]);
      return;
    }
    try {
      const saved = localStorage.getItem(`omniops_bookmarks_${currentSessionId}`);
      setBookmarkedIds(saved ? JSON.parse(saved) : []);
    } catch {
      setBookmarkedIds([]);
    }
  }, [currentSessionId]);

  function toggleBookmark(msgId: string) {
    setBookmarkedIds((prev) => {
      const next = prev.includes(msgId) ? prev.filter((id) => id !== msgId) : [...prev, msgId];
      if (currentSessionId) {
        try {
          localStorage.setItem(`omniops_bookmarks_${currentSessionId}`, JSON.stringify(next));
        } catch {}
      }
      return next;
    });
  }

  async function loadHistory(sessionId?: string | null) {
    try {
      const result = await api.chatHistory(sessionId || undefined);
      setEntries(result.entries.flatMap(item => [
        { id: `hist-${item.id}-user`, role: "user" as const, text: item.prompt, time: new Date(item.created_at * 1000).toLocaleString("fa-IR") },
        { id: `hist-${item.id}-assistant`, role: "assistant" as const, text: item.reply, model: item.model, time: new Date(item.created_at * 1000).toLocaleString("fa-IR") },
      ]));
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تاریخچه بارگذاری نشد."); }
  }

  async function createNewSession(customTitle?: string) {
    try {
      const res = await api.createChatSession(customTitle);
      const newSess = res.session;
      setSessions(prev => [newSess, ...prev]);
      setCurrentSessionId(newSess.id);
      setEntries([]);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ایجاد گفتگوی جدید با خطا مواجه شد.");
    }
  }

  async function switchSession(id: string) {
    if (id === currentSessionId) return;
    setCurrentSessionId(id);
    void loadHistory(id);
  }

  async function removeSession(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm("این موضوع گفتگو و پیام‌های آن حذف شوند؟")) return;
    try {
      await api.deleteChatSession(id);
      const updated = sessions.filter(s => s.id !== id);
      setSessions(updated);
      if (currentSessionId === id) {
        if (updated.length > 0) {
          setCurrentSessionId(updated[0].id);
          void loadHistory(updated[0].id);
        } else {
          setCurrentSessionId(null);
          setEntries([]);
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "خطا در حذف گفتگو");
    }
  }

  async function clearHistory() {
    if (!window.confirm("پیام‌های این گفتگو پاک شوند؟")) return;
    try {
      await api.clearChatHistory(currentSessionId || undefined);
      setEntries([]);
      setError("");
      void refreshSessions();
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "عملیات روی حافظه انجام نشد."); }
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!noteDraft.trim() || memoryBusy) return;
    setMemoryBusy(true);
    try { await api.addMemory(noteDraft.trim()); setNoteDraft(""); await refreshNotes(); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "عملیات روی حافظه انجام نشد."); }
    finally { setMemoryBusy(false); }
  }

  async function removeNote(id: string) {
    setMemoryBusy(true);
    try { await api.removeMemory(id); await refreshNotes(); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "عملیات روی حافظه انجام نشد."); }
    finally { setMemoryBusy(false); }
  }

  async function handleOpenFilePicker() {
    if (showFilePicker) {
      setShowFilePicker(false);
      return;
    }
    setShowFilePicker(true);
    if (projectFiles.length === 0) {
      setLoadingFiles(true);
      try {
        const res = await api.projectFiles();
        setProjectFiles(res.files);
      } catch {
        // ignore
      } finally {
        setLoadingFiles(false);
      }
    }
  }

  async function handleSelectFileToAttach(file: { path: string; name: string }) {
    setShowFilePicker(false);
    setShowAttachMenu(false);
    try {
      const res = await api.projectFile(file.path);
      setAttachedFiles((prev) => {
        if (prev.length >= 5 || prev.some((f) => f.path === file.path)) return prev;
        return [
          ...prev,
          {
            id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            path: file.path,
            name: file.name,
            content: res.content,
          },
        ];
      });
    } catch {
      setAttachedFiles((prev) => {
        if (prev.length >= 5 || prev.some((f) => f.path === file.path)) return prev;
        return [
          ...prev,
          {
            id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            path: file.path,
            name: file.name,
            content: "",
          },
        ];
      });
    }
  }

  function processUploadedFiles(files: FileList | File[]) {
    const fileArray = Array.from(files).slice(0, 5 - attachedFiles.length);
    for (const file of fileArray) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const rawContent = (e.target?.result as string) || "";
        const content = rawContent.slice(0, 48000);
        setAttachedFiles((prev) => {
          if (prev.length >= 5) return prev;
          return [
            ...prev,
            {
              id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              path: file.name,
              name: file.name,
              content,
            },
          ];
        });
        setShowAttachMenu(false);
      };
      reader.onerror = () => {
        setError("خطا در خواندن فایل محلی.");
      };
      reader.readAsText(file);
    }
  }

  function handleLocalFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    processUploadedFiles(files);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processUploadedFiles(e.dataTransfer.files);
    }
  }

  function saveCurrentAsTemplate() {
    if (!draft.trim()) return;
    const title = window.prompt("عنوان این الگوی اختصاصی را وارد کنید:", draft.trim().slice(0, 30)) || "";
    if (!title.trim()) return;
    const next = [...customTemplates, { id: Date.now().toString(), title: title.trim(), prompt: draft.trim() }];
    setCustomTemplates(next);
    try {
      localStorage.setItem("omniops_custom_templates", JSON.stringify(next));
    } catch {}
  }

  function deleteCustomTemplate(id: string) {
    const next = customTemplates.filter(t => t.id !== id);
    setCustomTemplates(next);
    try {
      localStorage.setItem("omniops_custom_templates", JSON.stringify(next));
    } catch {}
  }

  async function executePrompt(message: string) {
    setBusy(true);
    setError("");
    const filesToSend = [...attachedFiles];
    const systemContextToAttach = includeSystemContext;
    setAttachedFiles([]);
    setIncludeSystemContext(false);

    const userTime = new Date().toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
    const badges: string[] = [];
    if (filesToSend.length === 1) {
      badges.push(`📎 [فایل پیوست: ${filesToSend[0].name}]`);
    } else if (filesToSend.length > 1) {
      badges.push(`📎 [${filesToSend.length.toLocaleString("fa-IR")} سند پیوست: ${filesToSend.map((f) => f.name).join(", ")}]`);
    }
    if (systemContextToAttach) badges.push(`📊 [تله‌متری زنده سرور ضمیمه شد]`);
    const prefix = badges.length ? `${badges.join(" ")}\n` : "";
    const userDisplayMessage = `${prefix}${message}`;

    const userMsgId = `live-${Date.now()}-user`;
    const asstMsgId = `live-${Date.now()}-assistant`;

    setEntries((before) => [
      ...before,
      { id: userMsgId, role: "user", text: userDisplayMessage, time: userTime },
      { id: asstMsgId, role: "assistant", text: "", model: selected === "auto" ? "هوشمند خودکار" : selected, time: userTime },
    ]);

    await api.webChatStream(
      message,
      selected,
      externalConsent,
      saveHistory,
      filesToSend[0] ? { name: filesToSend[0].name, content: filesToSend[0].content || "" } : null,
      currentSessionId,
      systemContextToAttach,
      (chunk, model) => {
        setEntries((before) => {
          if (before.length === 0) return before;
          const next = [...before];
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = {
              ...last,
              text: last.text + chunk,
              model: model || last.model,
            };
          }
          return next;
        });
      },
      (fullReply, model) => {
        setEntries((before) => {
          if (before.length === 0) return before;
          const next = [...before];
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = {
              ...last,
              text: fullReply || last.text,
              model: model || last.model,
            };
          }
          return next;
        });
        setBusy(false);
        void refreshSessions();
      },
      (errMsg) => {
        setError(errMsg);
        setEntries((before) => {
          const next = [...before];
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = {
              ...last,
              text: last.text ? last.text : `⚠️ ${errMsg}`,
            };
          }
          return next;
        });
        setBusy(false);
      },
      filesToSend
    );
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || (!localModels.length && !(externalConsent && externalModels.length))) return;

    if (busy) {
      // اگر مدل مشغول است، پیام به صف اضافه می‌شود
      const queuedItem: QueuedMessage = {
        id: Date.now().toString(),
        text: message,
        time: new Date().toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" }),
      };
      setQueue((prev) => [...prev, queuedItem]);
      setDraft("");
      return;
    }

    setDraft("");
    await executePrompt(message);
  }

  // ارسال خودکار پیام بعدی از صف پس از پایان پاسخ هوش مصنوعی
  useEffect(() => {
    if (!busy && queue.length > 0) {
      const nextItem = queue[0];
      setQueue((prev) => prev.slice(1));
      void executePrompt(nextItem.text);
    }
  }, [busy, queue]);

  function removeQueueItem(id: string) {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  }

  function editQueueItem(item: QueuedMessage) {
    setDraft(item.text);
    removeQueueItem(item.id);
  }

  function promoteQueueItem(item: QueuedMessage) {
    // اولویت دادن به پیام و انتقال به ابتدای صف
    setQueue((prev) => [item, ...prev.filter((i) => i.id !== item.id)]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault(); formRef.current?.requestSubmit();
    }
  }

  return (
    <div className={`web-chat-workspace-wrapper ${previewOpen ? "with-preview" : ""}`}>
      <section className="glass admin-card operations-card web-chat" aria-label="گفت‌وگو با هسته">
        <div className="web-chat-top">
          <div className="web-chat-title">
            <span className="chat-core" aria-hidden="true">✦</span>
            <div>
              <h2>گفت‌وگو با هسته OmniOps</h2>
              <p>مدل محلی در اولویت است · خروج متن به API بیرونی فقط با رضایت شما</p>
            </div>
          </div>
          <div className="web-chat-top-actions">
            {entries.length > 0 && (
              <>
                <button
                  type="button"
                  className="quiet-button export-chat-btn"
                  onClick={exportMarkdown}
                  title="دانلود متن گفتگو در قالب فایل Markdown"
                >
                  📥 خروجی MD
                </button>
                <button
                  type="button"
                  className="quiet-button copy-chat-btn"
                  onClick={() => void copyFullChat()}
                  title="کپی کل متن گفتگو در کلیپ‌بورد"
                >
                  {copiedChat ? "کپی شد ✓" : "📋 کپی گفتگو"}
                </button>
              </>
            )}
            <button
              type="button"
              className={`chat-preview-toggle-button ${previewOpen ? "active" : ""}`}
              onClick={() => setPreviewOpen(!previewOpen)}
              title={previewOpen ? "بستن پنل پیش‌نمایش فایل" : "باز کردن پنل پیش‌نمایش فایل"}
            >
              <span className="preview-icon">◫</span>
              <span>{previewOpen ? "بستن پیش‌نمایش" : "پیش‌نمایش فایل"}</span>
              <span className="preview-badge-name">{previewFile}</span>
            </button>
            <span className={`chat-presence ${models.length ? "connected" : ""}`}>
              <i aria-hidden="true" />{models.length ? "سیستم هوش مصنوعی آنلاین" : "در حال اتصال به ورکر"}
            </span>
          </div>
        </div>

        {/* نوار مدیریت تاپیک‌ها و گفتگوهای چندگانه */}
        <div className="chat-sessions-bar" aria-label="موضوعات گفتگو">
          <button
            type="button"
            className="new-session-button"
            onClick={() => void createNewSession()}
            disabled={busy}
            title="شروع یک گفتگوی تازه"
          >
            <span className="plus-icon">+</span>
            <span>گفتگوی جدید</span>
          </button>

          {sessions.length > 2 && (
            <div className="session-search-wrap">
              <input
                type="text"
                className="session-search-input"
                placeholder="🔍 فیلتر تاپیک‌ها..."
                value={sessionSearch}
                onChange={(e) => setSessionSearch(e.target.value)}
              />
              {sessionSearch && (
                <button
                  type="button"
                  className="clear-search-btn"
                  onClick={() => setSessionSearch("")}
                  title="پاک کردن"
                >
                  ✕
                </button>
              )}
            </div>
          )}

          <div className="chat-sessions-scroll">
            {sessions.length === 0 ? (
              <span style={{ fontSize: "11px", color: "#9ca3af", padding: "0 8px" }}>گفتگوی فعالی ثبت نشده است</span>
            ) : (
              sessions
                .filter((s) => !sessionSearch.trim() || s.title.toLowerCase().includes(sessionSearch.trim().toLowerCase()))
                .map((sess) => {
                const isActive = sess.id === currentSessionId;
                return (
                  <div
                    key={sess.id}
                    className={`session-pill ${isActive ? "active" : ""}`}
                    onClick={() => void switchSession(sess.id)}
                    role="button"
                    tabIndex={0}
                    title={sess.title}
                  >
                    <span className="session-pill-icon">{isActive ? "💬" : "🗨️"}</span>
                    <span className="session-pill-title">{sess.title}</span>
                    {sess.message_count > 0 && (
                      <span className="session-pill-count">{sess.message_count}</span>
                    )}
                    <button
                      type="button"
                      className="session-delete-btn"
                      onClick={(e) => void removeSession(sess.id, e)}
                      title="حذف این گفتگو"
                      aria-label={`حذف گفتگوی ${sess.title}`}
                    >
                      ×
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

    {/* بخش رضایت API ابری */}
    {externalModels.length > 0 && (
      <label className="chat-external-consent">
        <input
          type="checkbox"
          checked={externalConsent}
          disabled={busy}
          onChange={event => {
            setExternalConsent(event.target.checked);
            if (!event.target.checked && !selected.startsWith("ollama/")) setSelected("auto");
          }}
        />
        <span>
          <strong>اجازهٔ ارسال پیام به مدل‌های ابری آنلاین (OpenAI / DeepSeek / Gemini)</strong>
          <small>در صورت قطعی یا عدم توانایی مدل محلی، پرامپت از طریق پروکسی امن SOCKS5 به ارائه‌دهنده خارجی هدایت می‌شود.</small>
        </span>
      </label>
    )}

    {/* ابزارهای حافظه و تاریخچه شخصی */}
    <section className="chat-memory-tools" aria-label="حافظه و تاریخچهٔ حساب">
      <div className="chat-memory-heading">
        <strong>حافظهٔ شخصی شما</strong>
        <small>فقط در حساب شما · یادداشت‌ها فعلاً به مدل فرستاده نمی‌شوند</small>
      </div>
      <form onSubmit={(event) => void addNote(event)} className="chat-memory-form">
        <label className="sr-only" htmlFor="memory-note">یادداشت شخصی</label>
        <input
          id="memory-note"
          value={noteDraft}
          maxLength={500}
          onChange={event => setNoteDraft(event.target.value)}
          placeholder="یک نکته برای پروفایل خود ثبت کنید…"
        />
        <button type="submit" className="quiet-button" disabled={memoryBusy || !noteDraft.trim()}>
          ثبت
        </button>
      </form>
      <div className="chat-memory-list">
        {notes.map(note => (
          <div key={note.id} className="chat-memory-item">
            <span>{note.content}</span>
            <button
              type="button"
              className="quiet-button danger"
              disabled={memoryBusy}
              onClick={() => void removeNote(note.id)}
              aria-label="حذف یادداشت"
            >
              حذف
            </button>
          </div>
        ))}
      </div>
      <div className="chat-history-options">
        <label>
          <input
            type="checkbox"
            checked={saveHistory}
            onChange={event => setSaveHistory(event.target.checked)}
          />{" "}
          ذخیرهٔ گفتگوهای بعدی در حساب من
        </label>
        <button type="button" className="quiet-button" onClick={() => void loadHistory(currentSessionId)}>
          نمایش تاریخچه
        </button>
        <button
          type="button"
          className={`quiet-button bookmark-filter-toggle ${showOnlyBookmarks ? "active" : ""}`}
          onClick={() => setShowOnlyBookmarks(!showOnlyBookmarks)}
          title="فیلتر پیام‌های برگزیده"
        >
          {showOnlyBookmarks ? "نمایش همه پیام‌ها" : `⭐ پیام‌های برگزیده (${bookmarkedIds.length.toLocaleString("fa-IR")})`}
        </button>
        <button type="button" className="quiet-button danger" onClick={() => void clearHistory()}>
          پاک‌کردن تاریخچه
        </button>
      </div>
    </section>

    {/* تاریخچه چت */}
    <div className="web-chat-history" role="log" aria-live="polite" aria-relevant="additions text">
      {entries.length === 0 && (
        <div className="chat-welcome">
          <span className="chat-welcome-icon" aria-hidden="true">✧</span>
          <strong>فضای کاربری هوش مصنوعی سازمانی</strong>
          <p>یک سؤال مطرح کنید یا از الگوهای آماده زیر برای شروع کار استفاده نمایید:</p>

          <div className="chat-prompt-templates">
            <button
              type="button"
              className="prompt-template-chip"
              onClick={() => setDraft("لطفاً متن یا گزارش زیر را تحلیل کن و خلاصه‌سازی اجرایی آن را به همراه مهم‌ترین اقدامات مورد نیاز ارائه بده:\n\n")}
            >
              📝 خلاصه‌سازی گزارش و اسناد
            </button>
            <button
              type="button"
              className="prompt-template-chip"
              onClick={() => setDraft("لطفاً یک نامه رسمی اداری و سازمانی با لحن محترمانه و لحن استاندارد درباره موضوع زیر تنظیم کن:\n\n")}
            >
              ✉️ نگارش نامه رسمی اداری
            </button>
            <button
              type="button"
              className="prompt-template-chip"
              onClick={() => setDraft("خطای زیر در سیستم رخ داده است؛ لطفاً دلیل رخ‌دادن خطا و راهکار دقیق و گام‌به‌گام رفع آن را توضیح بده:\n\n")}
            >
              🔍 تحلیل و رفع خطای فنی
            </button>
            <button
              type="button"
              className="prompt-template-chip"
              onClick={() => setDraft("داده‌ها و آمارهای زیر را بررسی کن و مهم‌ترین روندها، بینش‌ها و شاخص‌های کلیدی را استخراج کن:\n\n")}
            >
              📊 تحلیل داده و بینش آماری
            </button>
            {customTemplates.map((t) => (
              <div key={t.id} className="custom-template-chip-wrap">
                <button
                  type="button"
                  className="prompt-template-chip custom"
                  onClick={() => setDraft(t.prompt)}
                  title={t.prompt}
                >
                  ⭐ {t.title}
                </button>
                <button
                  type="button"
                  className="custom-template-del-btn"
                  onClick={(e) => { e.stopPropagation(); deleteCustomTemplate(t.id); }}
                  title="حذف این الگو"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="chat-suggestions">
            {suggestions.map(text => (
              <button type="button" className="quiet-button" key={text} onClick={() => setDraft(text)}>
                {text}
              </button>
            ))}
          </div>
        </div>
      )}
      <AnimatePresence initial={false}>
        {(showOnlyBookmarks ? entries.filter((e) => e.id && bookmarkedIds.includes(e.id)) : entries).map((entry, index) => {
          const isBookmarked = entry.id ? bookmarkedIds.includes(entry.id) : false;
          return (
            <motion.article
              className={`web-chat-entry ${entry.role} ${isBookmarked ? "bookmarked-entry" : ""}`}
              key={entry.id || index}
              initial={{ opacity: 0, y: 12, scale: .98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: .25 }}
            >
              <div className="chat-entry-header-row">
                <span className="chat-entry-label">{entry.role === "user" ? "شما" : "OmniOps AI"}</span>
                {isBookmarked && <span className="entry-bookmark-badge">⭐ برگزیده</span>}
              </div>
              {entry.role === "assistant" ? (
                <div className="chat-message-bubble-content">
                  <MarkdownMessage content={entry.text} />
                  {busy && index === entries.length - 1 && (
                    <span className="chat-streaming-cursor" aria-hidden="true">▍</span>
                  )}
                </div>
              ) : (
                <p style={{ whiteSpace: "pre-wrap" }}>{entry.text}</p>
              )}
              {entry.role === "assistant" && (
                <div className="antigravity-chat-file-card">
                  <div className="file-card-info">
                    <span className="file-card-icon">📄</span>
                    <span className="file-card-name">
                      {entry.text.includes("CHANGELOG") ? "CHANGELOG.md" : entry.text.includes("update-ubuntu") ? "scripts/update-ubuntu.sh" : entry.text.includes("PROJECT_RULES") ? "docs/PROJECT_RULES.fa.md" : "README.md"}
                    </span>
                    <span className="file-card-diff">+15 -15</span>
                  </div>
                  <button
                    type="button"
                    className="file-card-action-btn"
                    onClick={() => {
                      const target = entry.text.includes("CHANGELOG") ? "CHANGELOG.md" : entry.text.includes("update-ubuntu") ? "scripts/update-ubuntu.sh" : entry.text.includes("PROJECT_RULES") ? "docs/PROJECT_RULES.fa.md" : "README.md";
                      setPreviewFile(target);
                      setPreviewTab(entry.text.includes("CHANGELOG") ? "preview" : "review");
                      setPreviewOpen(true);
                    }}
                    title="پیش‌نمایش این فایل در پنل بغل"
                  >
                    Review / پیش‌نمایش ↗
                  </button>
                </div>
              )}
              <div className="chat-entry-meta">
                <time>{entry.time}</time>
                {entry.model && <bdi dir="ltr">{entry.model}</bdi>}
                {entry.role === "assistant" && entry.id && (
                  <button
                    type="button"
                    className={`msg-bookmark-pill-btn ${isBookmarked ? "bookmarked" : ""}`}
                    onClick={() => toggleBookmark(entry.id!)}
                    title={isBookmarked ? "حذف از برگزیده‌ها" : "نشان کردن این پاسخ به عنوان برگزیده"}
                  >
                    {isBookmarked ? "★ برگزیده" : "☆ نشان کردن"}
                  </button>
                )}
              </div>
            </motion.article>
          );
        })}
      </AnimatePresence>
      {showOnlyBookmarks && entries.filter((e) => e.id && bookmarkedIds.includes(e.id)).length === 0 && (
        <div className="empty-bookmark-notice">
          ⭐ هنوز پاسخی در این گفتگو نشان نشده است. با کلیک بر روی «☆ نشان کردن» در زیر هر پاسخ، می‌توانید آن را به برگزیده‌ها اضافه کنید.
        </div>
      )}
      {busy && (
        <div className="web-chat-entry assistant chat-thinking" role="status">
          <span className="chat-entry-label">OmniOps</span>
          <span className="chat-typing" aria-hidden="true"><i /><i /><i /></span>
          <span>در حال پردازش و استدلال مدل…</span>
        </div>
      )}
      <div ref={endRef} />
    </div>

    {/* پنل صف پیام‌ها (دقیقاً مشابه باکس Queued Messages در تصویر ۱) */}
    {queue.length > 0 && (
      <div className="antigravity-queue-box" role="region" aria-label="صف پیام‌های در انتظار">
        <div className="antigravity-queue-header">
          <div className="antigravity-queue-header-left">
            <span className="antigravity-queue-title">Queued Messages</span>
            <span className="antigravity-queue-badge">{queue.length}</span>
            <span className="antigravity-queue-subtitle">Sends after agent finishes working</span>
          </div>
          <button
            type="button"
            className="antigravity-queue-toggle"
            onClick={() => setQueueCollapsed(!queueCollapsed)}
            title={queueCollapsed ? "نمایش صف" : "جمع کردن صف"}
          >
            {queueCollapsed ? "▾" : "▴"}
          </button>
        </div>

        {!queueCollapsed && (
          <div className="antigravity-queue-list">
            {queue.map((item, idx) => (
              <div key={item.id} className="antigravity-queue-row">
                <span className="antigravity-queue-text">
                  <span className="antigravity-queue-idx">#{idx + 1}</span> {item.text}
                </span>
                <div className="antigravity-queue-actions">
                  <button type="button" onClick={() => editQueueItem(item)} title="ویرایش پیام (Edit)">
                    ✏️
                  </button>
                  <button type="button" onClick={() => promoteQueueItem(item)} title="اولویت‌دهی و ارسال بعد از پاسخ (Promote)">
                    ↗
                  </button>
                  <button type="button" onClick={() => removeQueueItem(item.id)} title="حذف از صف (Delete)">
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )}

    {/* کادر نوشتن پیام با منوی انتخاب مدل در پایین (مشابه تصاویر ۱، ۲ و ۳) */}
    <form className="web-chat-form" ref={formRef} onSubmit={(event) => void send(event)}>
      <label className="sr-only" htmlFor="web-chat-input">پیام</label>
      <input
        type="file"
        ref={localFileInputRef}
        style={{ display: "none" }}
        multiple
        onChange={handleLocalFileChange}
        accept=".txt,.md,.markdown,.json,.csv,.log,.py,.js,.ts,.tsx,.jsx,.html,.css,.sql,.yaml,.yml,.sh,.bat,.xml,.ini,.env"
      />
      <div
        className={`antigravity-composer ${isDragging ? "chat-dropzone-active" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="chat-dropzone-overlay">
            <span>📂 فایل‌ها را اینجا رها کنید تا به چت پیوست شوند (تا ۵ فایل)</span>
          </div>
        )}
        {attachedFiles.length > 0 && (
          <div className="chat-attached-files-container">
            <div className="chat-attached-summary-bar">
              <span className="summary-title">
                📎 <strong>{attachedFiles.length.toLocaleString("fa-IR")} سند در پایگاه دانش پیام</strong>
                <small>
                  ({(attachedFiles.reduce((acc, f) => acc + (f.content?.length || 0), 0) / 1024).toFixed(1)} KB ·
                  ~{Math.ceil(attachedFiles.reduce((acc, f) => acc + (f.content?.length || 0), 0) / 3.5).toLocaleString("fa-IR")} توکن تخمینی)
                </small>
              </span>
              {attachedFiles.length > 1 && (
                <button
                  type="button"
                  className="clear-all-attachments-btn"
                  onClick={() => setAttachedFiles([])}
                  title="حذف تمام فایل‌های پیوست‌شده"
                >
                  🗑️ حذف همه ({attachedFiles.length.toLocaleString("fa-IR")})
                </button>
              )}
            </div>

            <div className="chat-attached-files-grid">
              {attachedFiles.map((file) => {
                const lines = file.content ? file.content.split("\n").length : 0;
                const words = file.content ? file.content.trim().split(/\s+/).filter(Boolean).length : 0;
                const tokens = file.content ? Math.ceil(file.content.length / 3.5) : 0;
                return (
                  <div className="chat-attached-file-pill" key={file.id || file.name}>
                    <span
                      className="attached-file-clickable"
                      onClick={() => setPreviewModalFile({ name: file.name, content: file.content || "" })}
                      title="کلیک برای مشاهده پیش‌نمایش محتوای فایل"
                    >
                      📄 <strong>{file.name}</strong>
                      <small className="attached-file-size">
                        ({(file.content.length / 1024).toFixed(1)} KB)
                      </small>
                      <span className="attached-file-metrics" title="آمار و تخمین توکن سند">
                        <span>📑 {lines.toLocaleString("fa-IR")} سطر</span>
                        <span>📝 {words.toLocaleString("fa-IR")} کلمه</span>
                        <span>⚡ ~{tokens.toLocaleString("fa-IR")} توکن</span>
                      </span>
                      <span className="file-preview-hint">👁️ پیش‌نمایش</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setAttachedFiles((prev) => prev.filter((f) => (f.id ? f.id !== file.id : f.name !== file.name)))}
                      title="حذف این پیوست"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>

            {/* نوار اقدامات هوشمند دستیار سند */}
            <div className="doc-quick-actions-bar" aria-label="اقدامات هوشمند تحلیل سند">
              <span className="quick-actions-label">✨ دستیار تحلیل:</span>
              <button
                type="button"
                className="doc-quick-action-btn"
                onClick={() => {
                  setDraft("لطفاً این اسناد پیوست‌شده را به صورت ساختاریافته، عمیق و همراه با خلاصه اجرایی و دستاوردهای اصلی تحلیل و خلاصه کن.");
                  document.getElementById("web-chat-input")?.focus();
                }}
              >
                ✨ خلاصه‌سازی عمیق
              </button>
              <button
                type="button"
                className="doc-quick-action-btn"
                onClick={() => {
                  setDraft("تمام نکات کلیدی، الزامات فنی، تصمیمات مهم و یافته‌های اساسی این اسناد را استخراج و در قالب لیست تفکیک‌شده ارائه کن.");
                  document.getElementById("web-chat-input")?.focus();
                }}
              >
                📌 استخراج نکات کلیدی
              </button>
              <button
                type="button"
                className="doc-quick-action-btn"
                onClick={() => {
                  setDraft("براساس محتوای این اسناد، ۵ پرسش و پاسخ اساسی (Q&A) در رابطه با جزئیات و چالش‌های احتمالی آن‌ها تدوین و به تفصیل پاسخ بده.");
                  document.getElementById("web-chat-input")?.focus();
                }}
              >
                🔍 پرسش و پاسخ (Q&A)
              </button>
              <button
                type="button"
                className="doc-quick-action-btn"
                onClick={() => {
                  setDraft("سرفصل‌ها، ساختار درختی و مقایسه بخش‌های مختلف این اسناد را همراه با خلاصه کوتاه برای هر بخش مشخص کن.");
                  document.getElementById("web-chat-input")?.focus();
                }}
              >
                📑 استخراج سرفصل‌ها
              </button>
            </div>
          </div>
        )}
        <textarea
          id="web-chat-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          maxLength={8000}
          rows={2}
          placeholder="Ask anything, @ to mention, / for actions (یا پیام را بنویسید تا در صف قرار گیرد)..."
        />

        <div className="antigravity-composer-footer">
          {/* دکمه پیوست فایل با منوی دوگانه (محلی و پروژه) */}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className={`chat-attach-file-btn ${attachedFiles.length > 0 ? "active" : ""}`}
              onClick={() => setShowAttachMenu(!showAttachMenu)}
              title="پیوست فایل محلی یا فایل‌های پروژه سرور"
            >
              <span>📎</span>
              <span>
                {attachedFiles.length === 1
                  ? attachedFiles[0].name
                  : attachedFiles.length > 1
                  ? `${attachedFiles.length} سند پیوست`
                  : "پیوست فایل"}
              </span>
            </button>

            {showAttachMenu && (
              <div className="chat-attach-menu-dropdown">
                <button
                  type="button"
                  className="chat-attach-menu-item"
                  onClick={() => {
                    setShowAttachMenu(false);
                    localFileInputRef.current?.click();
                  }}
                >
                  <span>📁</span>
                  <span>بارگذاری از کامپیوتر (Local File)</span>
                </button>
                <button
                  type="button"
                  className="chat-attach-menu-item"
                  onClick={() => {
                    setShowAttachMenu(false);
                    void handleOpenFilePicker();
                  }}
                >
                  <span>🗂️</span>
                  <span>فایل‌های پروژه سرور (Project Files)</span>
                </button>
              </div>
            )}

            {showFilePicker && (
              <div className="chat-file-picker-dropdown">
                <div className="chat-file-picker-header">
                  <span>انتخاب فایل پروژه سرور</span>
                  <button type="button" onClick={() => setShowFilePicker(false)} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer" }}>✕</button>
                </div>
                {loadingFiles ? (
                  <div style={{ padding: "8px", fontSize: "11px", color: "#8c7b88" }}>در حال دریافت فایل‌ها…</div>
                ) : (
                  projectFiles.map(f => (
                    <div
                      key={f.path}
                      className="chat-file-picker-item"
                      onClick={() => void handleSelectFileToAttach(f)}
                    >
                      <span>📄</span>
                      <span style={{ direction: "ltr", textAlign: "left", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* دکمه تزریق تله‌متری و وضعیت زنده سرور */}
          <button
            type="button"
            className={`chat-attach-file-btn ${includeSystemContext ? "active" : ""}`}
            onClick={() => setIncludeSystemContext(!includeSystemContext)}
            title="تزریق آمار زنده سخت‌افزار سرور (CPU, RAM, GPU, مدل‌ها) به این پرسش"
          >
            <span>📊</span>
            <span>{includeSystemContext ? "✓ وضعیت سرور ضمیمه شد" : "تزریق وضعیت سرور"}</span>
          </button>

          {draft.trim().length > 5 && (
            <button
              type="button"
              className="chat-save-template-btn"
              onClick={saveCurrentAsTemplate}
              title="ذخیره این متن به عنوان الگوی آماده اختصاصی"
            >
              ⭐ ذخیره به عنوان الگو
            </button>
          )}

          {/* دکمه انتخاب مدل و منوی سهمیه (تصویر ۲ و ۳) */}
          <div className="antigravity-model-picker-container">
            <button
              type="button"
              className="antigravity-model-pill"
              onClick={() => setShowModelPicker(!showModelPicker)}
            >
              <span>✦</span>
              <span className="antigravity-model-name">
                {selected === "auto" ? "انتخاب خودکار (Auto)" : selected}
              </span>
              <span className="antigravity-model-arrow">▲</span>
            </button>

            {/* پاپ‌آپ لیست مدل‌ها با نشانگر سهمیه و سرعت */}
            {showModelPicker && (
              <div className="antigravity-model-dropdown">
                <div className="antigravity-model-dropdown-header">
                  <span>مدل‌های هوش مصنوعی (AI Models)</span>
                  <small>سرعت و سهمیه فعال</small>
                </div>

                <div className="antigravity-model-section">
                  <span className="antigravity-model-section-title">مدل‌های محلی ورکر (Ollama):</span>
                  <div
                    className={`antigravity-model-item ${selected === "auto" ? "active" : ""}`}
                    onClick={() => { setSelected("auto"); setShowModelPicker(false); }}
                  >
                    <span>⚡ هوشمند خودکار (Auto Router)</span>
                    <span className="antigravity-badge green">Fast</span>
                  </div>
                  {localModels.map(m => (
                    <div
                      key={m}
                      className={`antigravity-model-item ${selected === m ? "active" : ""}`}
                      onClick={() => { setSelected(m); setShowModelPicker(false); }}
                    >
                      <span className="truncate">{m}</span>
                      <span className="antigravity-badge purple">GPU Local</span>
                    </div>
                  ))}
                </div>

                {externalModels.length > 0 && externalConsent && (
                  <div className="antigravity-model-section">
                    <span className="antigravity-model-section-title">مدل‌های ابری آنلاین (Cloud API):</span>
                    {externalModels.map(m => (
                      <div
                        key={m}
                        className={`antigravity-model-item ${selected === m ? "active" : ""}`}
                        onClick={() => { setSelected(m); setShowModelPicker(false); }}
                      >
                        <span className="truncate">{m}</span>
                        <div className="antigravity-quota-indicator">
                          <span className="antigravity-quota-circle"></span>
                          <span>94% باقی‌مانده</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="antigravity-composer-controls">
            <small className="antigravity-char-count">{draft.length.toLocaleString("fa-IR")} / ۸٬۰۰۰</small>
            <button
              className={`antigravity-send-button ${busy ? "queue-mode" : ""}`}
              disabled={!draft.trim() || (!localModels.length && !(externalConsent && externalModels.length))}
            >
              {busy ? "Queued (+)" : "↗"}
            </button>
          </div>
        </div>
      </div>
    </form>
    {error && <p className="admin-message" role="alert">{error}</p>}
  </section>

      {previewModalFile && (
        <div className="chat-file-preview-modal-backdrop" onClick={() => setPreviewModalFile(null)}>
          <div className="chat-file-preview-modal" onClick={(e) => e.stopPropagation()} dir="rtl">
            <div className="preview-modal-header">
              <div>
                <h3>📄 پیش‌نمایش محتوای فایل: {previewModalFile.name}</h3>
                <small>{previewModalFile.content.length.toLocaleString("fa-IR")} کاراکتر متن آماده پردازش توسط هوش مصنوعی</small>
              </div>
              <button type="button" className="close-preview-btn" onClick={() => setPreviewModalFile(null)} aria-label="بستن">✕</button>
            </div>
            <pre className="preview-modal-body" dir="ltr">
              <code>{previewModalFile.content || "(محتوای فایل خالی است)"}</code>
            </pre>
            <div className="preview-modal-footer">
              <button type="button" className="submit-button small" onClick={() => setPreviewModalFile(null)}>بستن پیش‌نمایش</button>
            </div>
          </div>
        </div>
      )}

      {previewOpen && (
        <FilePreviewPanel
          currentFile={previewFile}
          initialTab={previewTab}
          onClose={() => setPreviewOpen(false)}
          onSelectFile={(f) => setPreviewFile(f)}
        />
      )}
    </div>
  );
}

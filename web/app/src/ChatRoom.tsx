import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, type MemoryNote, type ChatSession } from "./api";
import { FilePreviewPanel } from "./components/FilePreviewPanel";
import { MarkdownMessage } from "./components/MarkdownMessage";

type Entry = { role: "user" | "assistant"; text: string; time: string; model?: string };
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
  const [notes, setNotes] = useState<MemoryNote[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState("README.md");
  const [previewTab, setPreviewTab] = useState<"review" | "preview" | "raw" | "terminal">("preview");
  const [attachedFile, setAttachedFile] = useState<{ path: string; name: string; content?: string } | null>(null);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [projectFiles, setProjectFiles] = useState<{ path: string; name: string; type: string }[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [includeSystemContext, setIncludeSystemContext] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");
  const [copiedChat, setCopiedChat] = useState(false);
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

  async function loadHistory(sessionId?: string | null) {
    try {
      const result = await api.chatHistory(sessionId || undefined);
      setEntries(result.entries.flatMap(item => [
        { role: "user" as const, text: item.prompt, time: new Date(item.created_at * 1000).toLocaleString("fa-IR") },
        { role: "assistant" as const, text: item.reply, model: item.model, time: new Date(item.created_at * 1000).toLocaleString("fa-IR") },
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
    try {
      const res = await api.projectFile(file.path);
      setAttachedFile({ path: file.path, name: file.name, content: res.content });
    } catch {
      setAttachedFile({ path: file.path, name: file.name, content: "" });
    }
  }

  async function executePrompt(message: string) {
    setBusy(true);
    setError("");
    const fileToAttach = attachedFile;
    const systemContextToAttach = includeSystemContext;
    setAttachedFile(null);
    setIncludeSystemContext(false);

    const userTime = new Date().toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
    const badges: string[] = [];
    if (fileToAttach) badges.push(`📎 [فایل پیوست: ${fileToAttach.name}]`);
    if (systemContextToAttach) badges.push(`📊 [تله‌متری زنده سرور ضمیمه شد]`);
    const prefix = badges.length ? `${badges.join(" ")}\n` : "";
    const userDisplayMessage = `${prefix}${message}`;

    setEntries((before) => [
      ...before,
      { role: "user", text: userDisplayMessage, time: userTime },
      { role: "assistant", text: "", model: selected === "auto" ? "هوشمند خودکار" : selected, time: userTime },
    ]);

    await api.webChatStream(
      message,
      selected,
      externalConsent,
      saveHistory,
      fileToAttach ? { name: fileToAttach.name, content: fileToAttach.content || "" } : null,
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
      }
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
        {entries.map((entry, index) => (
          <motion.article
            className={`web-chat-entry ${entry.role}`}
            key={index}
            initial={{ opacity: 0, y: 12, scale: .98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: .25 }}
          >
            <span className="chat-entry-label">{entry.role === "user" ? "شما" : "OmniOps AI"}</span>
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
            </div>
          </motion.article>
        ))}
      </AnimatePresence>
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
      <div className="antigravity-composer">
        {attachedFile && (
          <div className="chat-attached-file-pill">
            <span>📄 {attachedFile.name}</span>
            <button
              type="button"
              onClick={() => setAttachedFile(null)}
              title="حذف پیوست"
            >
              ✕
            </button>
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
          {/* دکمه پیوست فایل پروژه */}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className={`chat-attach-file-btn ${attachedFile ? "active" : ""}`}
              onClick={() => void handleOpenFilePicker()}
              title="پیوست فایل پروژه به چت"
            >
              <span>📎</span>
              <span>{attachedFile ? attachedFile.name : "پیوست فایل"}</span>
            </button>

            {showFilePicker && (
              <div className="chat-file-picker-dropdown">
                <div className="chat-file-picker-header">
                  <span>انتخاب فایل پروژه</span>
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

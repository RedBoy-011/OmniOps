import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, type MemoryNote } from "./api";

type Entry = { role: "user" | "assistant"; text: string; time: string; model?: string };
const suggestions = ["وضعیت امروز سیستم را خلاصه کن", "برای بررسی سرویس‌ها چه مراحلی پیشنهاد می‌کنی؟", "یک گزارش کوتاه فارسی بنویس"];

export function ChatRoom() {
  const [models, setModels] = useState<string[]>([]);
  const [selected, setSelected] = useState("auto");
  const [externalConsent, setExternalConsent] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveHistory, setSaveHistory] = useState(false);
  const [notes, setNotes] = useState<MemoryNote[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const localModels = models.filter(model => model.startsWith("ollama/"));
  const externalModels = models.filter(model => model.startsWith("gemini/") || model.startsWith("openrouter/"));

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [entries, busy]);

  async function refresh() {
    try {
      const result = await api.webModels();
      setModels(result.models);
      setSelected((previous) => previous === "auto" || result.models.includes(previous) ? previous : "auto");
      setError(result.models.length ? "" : "مدل مناسبی برای گفت‌وگو در دسترس نیست.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "فهرست مدل‌ها در دسترس نیست."); }
  }

  useEffect(() => { void refresh(); void refreshNotes(); }, []);

  async function refreshNotes() {
    try { setNotes((await api.memoryNotes()).notes); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "حافظه بارگذاری نشد."); }
  }

  async function loadHistory() {
    try {
      const result = await api.chatHistory();
      setEntries(result.entries.flatMap(item => [
        { role: "user" as const, text: item.prompt, time: new Date(item.created_at * 1000).toLocaleString("fa-IR") },
        { role: "assistant" as const, text: item.reply, model: item.model, time: new Date(item.created_at * 1000).toLocaleString("fa-IR") },
      ]));
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "تاریخچه بارگذاری نشد."); }
  }

  async function clearHistory() {
    if (!window.confirm("تاریخچهٔ ذخیره‌شدهٔ همین حساب پاک شود؟")) return;
    try { await api.clearChatHistory(); setEntries([]); setError(""); }
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

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy || (!localModels.length && !(externalConsent && externalModels.length))) return;
    setDraft(""); setBusy(true); setError("");
    setEntries((before) => [...before, { role: "user", text: message, time: new Date().toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" }) }]);
    try {
      const result = await api.webChat(message, selected, externalConsent, saveHistory);
      setEntries((before) => [...before, { role: "assistant", text: result.reply, model: result.model, time: new Date().toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" }) }]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "پاسخ مدل دریافت نشد."); }
    finally { setBusy(false); }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault(); formRef.current?.requestSubmit();
    }
  }

  return <section className="glass admin-card operations-card web-chat" aria-label="گفت‌وگو با هسته">
    <div className="web-chat-top"><div className="web-chat-title"><span className="chat-core" aria-hidden="true">✦</span><div><h2>گفت‌وگو با هسته</h2><p>مدل محلی در اولویت است · خروج متن به API بیرونی فقط با اجازهٔ همین صفحه</p></div></div>
      <span className={`chat-presence ${models.length ? "connected" : ""}`}><i aria-hidden="true" />{models.length ? "مدل آماده" : "در حال بررسی"}</span></div>
    <div className="web-chat-controls"><label htmlFor="web-chat-model">مدل پاسخ‌گو</label><select id="web-chat-model" dir="ltr" value={selected} disabled={busy} onChange={event => setSelected(event.target.value)}><option value="auto">محلی، با جایگزین بیرونی در صورت اجازه</option>{localModels.map(model => <option value={model} key={model}>{model}</option>)}{externalModels.map(model => <option value={model} key={model} disabled={!externalConsent}>{model}</option>)}</select><button className="quiet-button" type="button" onClick={() => void refresh()} aria-label="تازه‌سازی مدل‌ها">↻ <span>تازه‌سازی</span></button></div>
    {externalModels.length > 0 && <label className="chat-external-consent"><input type="checkbox" checked={externalConsent} disabled={busy} onChange={event => { setExternalConsent(event.target.checked); if (!event.target.checked && !selected.startsWith("ollama/")) setSelected("auto"); }} /><span><strong>اجازهٔ ارسال پیام به مدل‌های API بیرونی</strong><small>در انتخاب خودکار ابتدا مدل محلی امتحان می‌شود. با فعال‌کردن این گزینه، متن پیام در صورت انتخاب مدل بیرونی یا خرابی همهٔ مدل‌های محلی به Provider ارسال می‌شود و ممکن است هزینه داشته باشد.</small></span></label>}
    <section className="chat-memory-tools" aria-label="حافظه و تاریخچهٔ حساب">
      <div className="chat-memory-heading"><strong>حافظهٔ شخصی شما</strong><small>فقط در حساب شما · یادداشت‌ها فعلاً به مدل فرستاده نمی‌شوند</small></div>
      <form onSubmit={(event) => void addNote(event)} className="chat-memory-form"><label className="sr-only" htmlFor="memory-note">یادداشت شخصی</label><input id="memory-note" value={noteDraft} maxLength={500} onChange={event => setNoteDraft(event.target.value)} placeholder="یک نکته برای پروفایل خود ثبت کنید…" /><button type="submit" className="quiet-button" disabled={memoryBusy || !noteDraft.trim()}>ثبت</button></form>
      <div className="chat-memory-list">{notes.map(note => <div key={note.id} className="chat-memory-item"><span>{note.content}</span><button type="button" className="quiet-button danger" disabled={memoryBusy} onClick={() => void removeNote(note.id)} aria-label="حذف یادداشت">حذف</button></div>)}</div>
      <div className="chat-history-options"><label><input type="checkbox" checked={saveHistory} onChange={event => setSaveHistory(event.target.checked)} /> ذخیرهٔ گفتگوهای بعدی در حساب من</label><button type="button" className="quiet-button" onClick={() => void loadHistory()}>نمایش تاریخچه</button><button type="button" className="quiet-button danger" onClick={() => void clearHistory()}>پاک‌کردن تاریخچه</button></div>
    </section>
    <div className="web-chat-history" role="log" aria-live="polite" aria-relevant="additions text">
      {entries.length === 0 && <div className="chat-welcome"><span className="chat-welcome-icon" aria-hidden="true">✧</span><strong>از اینجا شروع کنیم</strong><p>یک سؤال بپرسید یا یکی از پیشنهادها را انتخاب کنید.</p><div className="chat-suggestions">{suggestions.map(text => <button type="button" className="quiet-button" key={text} onClick={() => setDraft(text)}>{text}</button>)}</div></div>}
      <AnimatePresence initial={false}>{entries.map((entry, index) => <motion.article className={`web-chat-entry ${entry.role}`} key={index} initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .25 }}>
        <span className="chat-entry-label">{entry.role === "user" ? "شما" : "OmniOps"}</span><p>{entry.text}</p><div className="chat-entry-meta"><time>{entry.time}</time>{entry.model && <bdi dir="ltr">{entry.model}</bdi>}</div>
      </motion.article>)}</AnimatePresence>
      {busy && <div className="web-chat-entry assistant chat-thinking" role="status"><span className="chat-entry-label">OmniOps</span><span className="chat-typing" aria-hidden="true"><i /><i /><i /></span><span>در حال دریافت پاسخ از مدل…</span></div>}
      <div ref={endRef} />
    </div>
    <form className="web-chat-form" ref={formRef} onSubmit={(event) => void send(event)}><label className="sr-only" htmlFor="web-chat-input">پیام</label><div className="chat-composer"><textarea id="web-chat-input" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} maxLength={8000} rows={2} placeholder="پیام خود را بنویسید…" disabled={busy} /><div className="chat-composer-foot"><small>{draft.length.toLocaleString("fa-IR")} / ۸٬۰۰۰ · Enter ارسال، Shift+Enter خط جدید</small><button className="submit-button" disabled={busy || !draft.trim() || (!localModels.length && !(externalConsent && externalModels.length))}>{busy ? "در حال پاسخ…" : "ارسال پیام ↗"}</button></div></div></form>
    {error && <p className="admin-message" role="alert">{error}</p>}
  </section>;
}

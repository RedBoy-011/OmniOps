import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api";

type Entry = { role: "user" | "assistant"; text: string; model?: string };

export function ChatRoom() {
  const [models, setModels] = useState<string[]>([]);
  const [selected, setSelected] = useState("auto");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const result = await api.webModels();
      setModels(result.models);
      setSelected((previous) => previous === "auto" || result.models.includes(previous) ? previous : "auto");
      setError(result.models.length ? "" : "مدل مناسب گفت‌وگو روی Worker پیدا نشد.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "فهرست مدل‌ها در دسترس نیست."); }
  }

  useEffect(() => { void refresh(); }, []);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;
    setDraft(""); setBusy(true); setError("");
    setEntries((before) => [...before, { role: "user", text: message }]);
    try {
      const result = await api.webChat(message, selected);
      setEntries((before) => [...before, { role: "assistant", text: result.reply, model: result.model }]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "پاسخ مدل دریافت نشد."); }
    finally { setBusy(false); }
  }

  return <section className="glass admin-card operations-card web-chat" aria-label="گفت‌وگو با هسته">
    <div className="card-title"><div><h2>گفت‌وگو با هسته</h2><p>مدل انتخابی روی Worker خصوصی اجرا می‌شود. گفت‌وگو با خروج از این صفحه از حافظهٔ مرورگر پاک می‌شود.</p></div></div>
    <div className="web-chat-controls"><label htmlFor="web-chat-model">مدل پاسخ‌گو</label><select id="web-chat-model" dir="ltr" value={selected} disabled={busy} onChange={(event) => setSelected(event.target.value)}><option value="auto">هوشمند محلی (سبک برای پیام کوتاه)</option>{models.map((model) => <option value={model} key={model}>{model}</option>)}</select><button className="quiet-button" type="button" onClick={() => void refresh()}>به‌روزرسانی مدل‌ها</button></div>
    <div className="web-chat-history" role="log" aria-live="polite">{entries.length === 0 && <p className="empty-note">پیام خود را بنویسید؛ مدل‌های مخصوص embedding در این فهرست نمایش داده نمی‌شوند.</p>}{entries.map((entry, index) => <article className={`web-chat-entry ${entry.role}`} key={index}><p>{entry.text}</p>{entry.model && <small dir="ltr">{entry.model}</small>}</article>)}</div>
    <form className="web-chat-form" onSubmit={(event) => void send(event)}><label className="sr-only" htmlFor="web-chat-input">پیام</label><textarea id="web-chat-input" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={8000} rows={2} placeholder="پیام خود را بنویسید…" disabled={busy} /><button className="submit-button" disabled={busy || !draft.trim() || models.length === 0}>{busy ? "در حال پاسخ…" : "ارسال"}</button></form>
    {error && <p className="admin-message" role="alert">{error}</p>}
  </section>;
}

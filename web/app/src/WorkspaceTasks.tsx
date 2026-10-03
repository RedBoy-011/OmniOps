import { useEffect, useState, type ChangeEvent, type DragEvent, type ClipboardEvent, type FormEvent } from "react";
import { api, type TaskDraft, type WorkspaceAttachment, type WorkspaceProject } from "./api";

export function WorkspaceTasks({ canRequest }: { canRequest: boolean }) {
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [tasks, setTasks] = useState<TaskDraft[]>([]);
  const [projectName, setProjectName] = useState("");
  const [attachments, setAttachments] = useState<WorkspaceAttachment[]>([]);
  const [staged, setStaged] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [selected, setSelected] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const list = await api.projects();
      setProjects(list.projects);
      setSelected(previous => list.projects.some(item => item.id === previous) ? previous : list.projects[0]?.id ?? "");
      if (canRequest) setTasks((await api.taskDrafts()).tasks);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "فضای کاری در دسترس نیست."); }
  }
  useEffect(() => { void refresh(); }, [canRequest]);
  useEffect(() => {
    setStaged(null); setPreview("");
    if (!selected) { setAttachments([]); return; }
    void api.attachments(selected).then(result => setAttachments(result.attachments)).catch(cause => setError(cause instanceof Error ? cause.message : "پیوست‌ها بارگذاری نشدند."));
  }, [selected]);

  async function stage(file: File | undefined) {
    if (!file) return;
    const mime = file.type === "" && file.name.toLowerCase().endsWith(".txt") ? "text/plain" : file.type;
    if (!["text/plain", "image/png", "image/jpeg", "image/webp"].includes(mime) || file.size === 0 || file.size > 256 * 1024) {
      setError("تنها متن UTF-8 یا تصویر PNG/JPEG/WebP تا ۲۵۶ کیلوبایت پذیرفته می‌شود."); return;
    }
    setStaged(new File([file], file.name, { type: mime }));
    if (mime === "text/plain") setPreview((await file.text()).slice(0, 500));
    else setPreview(await new Promise<string>((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("پیش‌نمایش تصویر در دسترس نیست.")); reader.readAsDataURL(file);
    }));
    setError("");
  }

  function fromClipboard(event: ClipboardEvent<HTMLElement>) {
    const image = Array.from(event.clipboardData.files).find(file => file.type.startsWith("image/"));
    if (image) { event.preventDefault(); void stage(new File([image], `clipboard-${Date.now()}.png`, { type: image.type })); return; }
    const text = event.clipboardData.getData("text/plain");
    if (text) { event.preventDefault(); void stage(new File([text], `clipboard-${Date.now()}.txt`, { type: "text/plain" })); }
  }

  async function uploadAttachment() {
    if (!selected || !staged || busy) return;
    setBusy(true);
    try {
      const encoded = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
        reader.onerror = () => reject(new Error("فایل خوانده نشد."));
        reader.readAsDataURL(staged);
      });
      await api.addAttachment(selected, staged.name, staged.type, encoded);
      setAttachments((await api.attachments(selected)).attachments); setStaged(null); setPreview(""); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "بارگذاری ممکن نشد."); }
    finally { setBusy(false); }
  }

  async function removeAttachment(id: string) {
    if (busy) return;
    setBusy(true);
    try { await api.removeAttachment(id); setAttachments((await api.attachments(selected)).attachments); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "حذف پیوست ممکن نشد."); }
    finally { setBusy(false); }
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!projectName.trim() || busy) return;
    setBusy(true);
    try { const project = await api.createProject(projectName.trim()); setProjectName(""); await refresh(); setSelected(project.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "ساخت پروژه ممکن نشد."); }
    finally { setBusy(false); }
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected || !description.trim() || busy) return;
    setBusy(true);
    try { await api.createTaskDraft(selected, description.trim()); setDescription(""); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "ثبت پیش‌نویس ممکن نشد."); }
    finally { setBusy(false); }
  }

  async function cancel(id: string) {
    if (!window.confirm("این پیش‌نویس لغو شود؟")) return;
    setBusy(true);
    try { await api.cancelTaskDraft(id); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "لغو پیش‌نویس ممکن نشد."); }
    finally { setBusy(false); }
  }

  return <section className="glass admin-card operations-card workspace-tasks" aria-label="فضای کاری و وظایف">
    <div className="card-title"><div><h2>پروژه‌ها و وظایف</h2><p>وظیفهٔ ثبت‌شده فعلاً پیش‌نویس است؛ اجرای ابزار و تأیید مرحله‌ای در نسخهٔ بعد فعال می‌شود.</p></div><span className="count-pill">{tasks.filter(item => item.status === "draft").length.toLocaleString("fa-IR")} پیش‌نویس</span></div>
    <form className="workspace-project-form" onSubmit={(event) => void createProject(event)}><label htmlFor="project-name">پروژهٔ شخصی تازه</label><div><input id="project-name" value={projectName} maxLength={100} onChange={event => setProjectName(event.target.value)} placeholder="نام پروژه" /><button className="quiet-button" disabled={busy || !projectName.trim()}>افزودن پروژه</button></div></form>
    {projects.length ? <><label htmlFor="task-project">پروژهٔ انتخاب‌شده</label><select id="task-project" value={selected} onChange={event => setSelected(event.target.value)}>{projects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select></> : <p className="empty-note">یک پروژه بسازید تا کارهایش را جدا نگه دارید.</p>}
    {selected && <section className="workspace-attachment-panel" aria-label="پیوست‌های پروژه">
      <h3>پیوست‌های خصوصی پروژه</h3><p>در این مرحله فایل فقط در پروژه ذخیره می‌شود و به مدل هوش مصنوعی فرستاده نمی‌شود.</p>
      <div className="workspace-drop" tabIndex={0} onPaste={fromClipboard} onDragOver={event => event.preventDefault()} onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); void stage(event.dataTransfer.files[0]); }}>
        <label>انتخاب فایل <input type="file" accept=".txt,text/plain,image/png,image/jpeg,image/webp" onChange={(event: ChangeEvent<HTMLInputElement>) => { void stage(event.target.files?.[0]); event.target.value = ""; }} /></label>
        <span>یا فایل را اینجا رها کنید؛ برای متن/تصویر کلیپ‌بورد روی این کادر کلیک کنید و Ctrl+V بزنید.</span>
      </div>
      {staged && <div className="workspace-attachment-preview"><strong>{staged.name} · {(staged.size / 1024).toFixed(1)} KB</strong>{staged.type.startsWith("image/") ? <img src={preview} alt={`پیش‌نمایش ${staged.name}`} /> : <p>{preview}</p>}<button type="button" className="submit-button" disabled={busy} onClick={() => void uploadAttachment()}>ذخیره در پروژه</button><button type="button" className="quiet-button" onClick={() => { setStaged(null); setPreview(""); }}>انصراف</button></div>}
      <div className="workspace-attachment-list">{attachments.map(item => <div key={item.id}><span>{item.name} · {(item.size / 1024).toFixed(1)} KB</span><button type="button" className="quiet-button danger" disabled={busy} onClick={() => void removeAttachment(item.id)}>حذف</button></div>)}</div>
    </section>}
    {canRequest ? <><form className="workspace-task-form" onSubmit={(event) => void createTask(event)}><label htmlFor="task-description">شرح وظیفه</label><textarea id="task-description" rows={4} maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} placeholder="نتیجهٔ مورد انتظار را شرح دهید…" /><button className="submit-button" disabled={busy || !selected || !description.trim()}>ثبت پیش‌نویس وظیفه</button></form>
      <div className="workspace-task-list">{tasks.filter(task => task.project_id === selected).map(task => <article key={task.id} className="workspace-task-item"><p>{task.description}</p><small>{task.status === "draft" ? "پیش‌نویس · هنوز اجرا نمی‌شود" : "لغوشده"} · {new Date(task.created_at * 1000).toLocaleString("fa-IR")}</small>{task.status === "draft" && <button type="button" disabled={busy} className="quiet-button danger" onClick={() => void cancel(task.id)}>لغو پیش‌نویس</button>}</article>)}</div></> : <p className="empty-note">برای ساخت وظیفه، مجوز «درخواست اقدام» در پروفایل شما لازم است.</p>}
    {error && <p className="admin-message" role="alert">{error}</p>}
  </section>;
}

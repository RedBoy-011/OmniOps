import { useEffect, useState, type FormEvent } from "react";
import { api, type TaskDraft, type WorkspaceProject } from "./api";

export function WorkspaceTasks({ canRequest }: { canRequest: boolean }) {
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [tasks, setTasks] = useState<TaskDraft[]>([]);
  const [projectName, setProjectName] = useState("");
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
    {canRequest ? <><form className="workspace-task-form" onSubmit={(event) => void createTask(event)}><label htmlFor="task-description">شرح وظیفه</label><textarea id="task-description" rows={4} maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} placeholder="نتیجهٔ مورد انتظار را شرح دهید…" /><button className="submit-button" disabled={busy || !selected || !description.trim()}>ثبت پیش‌نویس وظیفه</button></form>
      <div className="workspace-task-list">{tasks.filter(task => task.project_id === selected).map(task => <article key={task.id} className="workspace-task-item"><p>{task.description}</p><small>{task.status === "draft" ? "پیش‌نویس · هنوز اجرا نمی‌شود" : "لغوشده"} · {new Date(task.created_at * 1000).toLocaleString("fa-IR")}</small>{task.status === "draft" && <button type="button" disabled={busy} className="quiet-button danger" onClick={() => void cancel(task.id)}>لغو پیش‌نویس</button>}</article>)}</div></> : <p className="empty-note">برای ساخت وظیفه، مجوز «درخواست اقدام» در پروفایل شما لازم است.</p>}
    {error && <p className="admin-message" role="alert">{error}</p>}
  </section>;
}

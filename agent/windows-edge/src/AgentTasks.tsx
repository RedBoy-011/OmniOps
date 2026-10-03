import { useEffect, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";

type Project = { id: string; name: string; created_at: number };
type TaskDraft = { id: string; project_id: string; description: string; status: "draft" | "cancelled"; created_at: number };

export function AgentTasks({ canRequest }: { canRequest: boolean }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskDraft[]>([]);
  const [projectName, setProjectName] = useState("");
  const [selected, setSelected] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const response = await invoke<{ projects: Project[] }>("list_agent_projects");
      setProjects(response.projects);
      setSelected(previous => response.projects.some(project => project.id === previous) ? previous : response.projects[0]?.id ?? "");
      if (canRequest) setTasks((await invoke<{ tasks: TaskDraft[] }>("list_agent_tasks")).tasks);
      setError("");
    } catch { setError("پروژه‌ها از هسته دریافت نشدند."); }
  }
  useEffect(() => { void refresh(); }, [canRequest]);

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!projectName.trim() || busy) return;
    setBusy(true);
    try {
      const created = await invoke<{ id: string }>("create_agent_project", { name: projectName.trim() });
      setProjectName(""); await refresh(); setSelected(created.id);
    } catch { setError("ساخت پروژه ممکن نشد."); }
    finally { setBusy(false); }
  }
  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!description.trim() || !selected || busy) return;
    setBusy(true);
    try {
      await invoke("create_agent_task", { projectId: selected, description: description.trim() });
      setDescription(""); await refresh();
    } catch { setError("ثبت پیش‌نویس ممکن نشد."); }
    finally { setBusy(false); }
  }
  async function cancel(id: string) {
    if (!window.confirm("این پیش‌نویس لغو شود؟")) return;
    setBusy(true);
    try { await invoke("cancel_agent_task", { id }); await refresh(); }
    catch { setError("لغو پیش‌نویس ممکن نشد."); }
    finally { setBusy(false); }
  }

  return <section className="agent-task-pane" aria-label="پروژه‌ها و وظایف">
    <h2>فضای کاری</h2><p>پیش‌نویس‌ها روی هسته ذخیره می‌شوند. اجرای خودکار و ابزارها هنوز در این بخش فعال نیستند.</p>
    <form onSubmit={(event) => void createProject(event)}><label htmlFor="agent-project-name">پروژهٔ جدید</label><div><input id="agent-project-name" maxLength={100} value={projectName} onChange={event => setProjectName(event.target.value)} placeholder="نام پروژه" /><button disabled={busy || !projectName.trim()}>افزودن</button></div></form>
    {projects.length > 0 && <><label htmlFor="agent-project-selected">پروژه</label><select id="agent-project-selected" value={selected} onChange={event => setSelected(event.target.value)}>{projects.map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select></>}
    {canRequest ? <><form onSubmit={(event) => void createTask(event)}><label htmlFor="agent-task-description">وظیفهٔ مورد نظر</label><textarea id="agent-task-description" rows={3} maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} placeholder="نتیجهٔ مورد انتظار را بنویسید…" /><button disabled={busy || !selected || !description.trim()}>ثبت پیش‌نویس</button></form><div className="agent-task-list">{tasks.filter(task => task.project_id === selected).map(task => <article key={task.id}><p>{task.description}</p><small>{task.status === "draft" ? "پیش‌نویس · بدون اجرا" : "لغوشده"}</small>{task.status === "draft" && <button type="button" disabled={busy} onClick={() => void cancel(task.id)}>لغو</button>}</article>)}</div></> : <p>برای ساخت وظیفه، مجوز «درخواست اقدام» لازم است.</p>}
    {error && <p role="alert" className="agent-error">{error}</p>}
  </section>;
}

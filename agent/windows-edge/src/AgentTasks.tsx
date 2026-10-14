import { useEffect, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";

type Project = { id: string; name: string; created_at: number; root_path?: string };
type TaskDraft = { id: string; project_id: string; description: string; status: "draft" | "cancelled"; created_at: number };

type AgentPlanStep = {
  index: number;
  title: string;
  action: string;
  status: string;
  summary: string;
  command?: string;
};

type SubagentRun = {
  id: string;
  role: string;
  title: string;
  status: string;
  prompt: string;
  summary: string;
};

type AgentRun = {
  id: string;
  project_id: string;
  prompt: string;
  role?: string;
  mode?: "single" | "swarm";
  status: string;
  current_step_index: number;
  plan_steps: AgentPlanStep[];
  subagents?: SubagentRun[];
  result_summary: string;
  created_at: number;
};

export function AgentTasks({ canRequest }: { canRequest: boolean }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<TaskDraft[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null);
  const [projectName, setProjectName] = useState("");
  const [selected, setSelected] = useState("");
  const [description, setDescription] = useState("");
  const [runPrompt, setRunPrompt] = useState("");
  const [role, setRole] = useState<"general" | "coder" | "tester" | "architect">("general");
  const [mode, setMode] = useState<"single" | "swarm">("single");
  const [tab, setTab] = useState<"autonomous" | "drafts">("autonomous");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const response = await invoke<{ projects: Project[] }>("list_agent_projects");
      setProjects(response.projects);
      const activeProjId = response.projects.some(project => project.id === selected) ? selected : response.projects[0]?.id ?? "";
      setSelected(activeProjId);
      if (canRequest) setTasks((await invoke<{ tasks: TaskDraft[] }>("list_agent_tasks")).tasks);
      if (activeProjId) {
        const runsRes = await invoke<{ runs: AgentRun[] }>("list_agent_runs", { projectId: activeProjId }).catch(() => ({ runs: [] }));
        setRuns(runsRes.runs || []);
        if (runsRes.runs?.length) {
          const ongoing = runsRes.runs.find(r => r.status === "in_progress" || r.status === "waiting_approval");
          setActiveRun(ongoing || runsRes.runs[0]);
        }
      }
      setError("");
    } catch { setError("پروژه‌ها یا وظایف از هسته دریافت نشدند."); }
  }

  useEffect(() => { void refresh(); }, [canRequest]);

  useEffect(() => {
    if (!selected) return;
    void (async () => {
      try {
        const runsRes = await invoke<{ runs: AgentRun[] }>("list_agent_runs", { projectId: selected });
        setRuns(runsRes.runs || []);
        if (runsRes.runs?.length) {
          const ongoing = runsRes.runs.find(r => r.status === "in_progress" || r.status === "waiting_approval");
          setActiveRun(ongoing || runsRes.runs[0]);
        } else {
          setActiveRun(null);
        }
      } catch {
        setRuns([]);
        setActiveRun(null);
      }
    })();
  }, [selected]);

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!projectName.trim() || busy) return;
    setBusy(true);
    try {
      const created = await invoke<{ id: string }>("create_agent_project", { name: projectName.trim() });
      setProjectName(""); await refresh(); setSelected(created.id);
    } catch { setError("ساخت پروژه ممکن نشد."); }
    finally { setBusy(false); }
  }

  async function startRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!runPrompt.trim() || !selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await invoke<{ run: AgentRun }>("start_agent_run", {
        projectId: selected,
        prompt: runPrompt.trim(),
        role,
        mode,
      });
      setActiveRun(res.run);
      setRunPrompt("");
      await refresh();
    } catch (err) {
      setError(typeof err === "string" ? err : "شروع چرخه خودکار ایجنت ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  async function advanceRun() {
    if (!activeRun || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await invoke<{ run: AgentRun }>("advance_agent_run", { runId: activeRun.id });
      setActiveRun(res.run);
      await refresh();
    } catch (err) {
      setError(typeof err === "string" ? err : "پیشبرد گام با خطا مواجه شد.");
    } finally {
      setBusy(false);
    }
  }

  async function approveRun() {
    if (!activeRun || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await invoke<{ run: AgentRun }>("approve_agent_run_step", { runId: activeRun.id });
      setActiveRun(res.run);
      await refresh();
    } catch (err) {
      setError(typeof err === "string" ? err : "تأیید اقدام ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelRun() {
    if (!activeRun || busy) return;
    setBusy(true);
    try {
      const res = await invoke<{ run: AgentRun }>("cancel_agent_run", { runId: activeRun.id });
      setActiveRun(res.run);
      await refresh();
    } catch {
      setError("لغو تسک ممکن نشد.");
    } finally {
      setBusy(false);
    }
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

  async function cancelDraft(id: string) {
    if (!window.confirm("این پیش‌نویس لغو شود؟")) return;
    setBusy(true);
    try { await invoke("cancel_agent_task", { id }); await refresh(); }
    catch { setError("لغو پیش‌نویس ممکن نشد."); }
    finally { setBusy(false); }
  }

  return (
    <section className="agent-task-pane" aria-label="پروژه‌ها و وظایف">
      <h2>میز کار و هدایت پروژه</h2>
      <p>هدایت خودکار تسک‌ها توسط هوش مصنوعی، پویش ساختار و اجرای ساندباکس ابزارها.</p>

      <form onSubmit={(event) => void createProject(event)}>
        <label htmlFor="agent-project-name">پروژهٔ جدید</label>
        <div>
          <input
            id="agent-project-name"
            maxLength={100}
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder="نام پروژه"
          />
          <button disabled={busy || !projectName.trim()}>افزودن</button>
        </div>
      </form>

      {projects.length > 0 && (
        <>
          <label htmlFor="agent-project-selected">پروژه فعال:</label>
          <select
            id="agent-project-selected"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            {projects.map((project) => (
              <option value={project.id} key={project.id}>
                {project.name} {project.root_path ? `(${project.root_path})` : ""}
              </option>
            ))}
          </select>
        </>
      )}

      {/* انتخاب حالت کار */}
      <div style={{ display: "flex", gap: "8px", margin: "12px 0" }}>
        <button
          type="button"
          style={{
            flex: 1,
            padding: "6px",
            fontSize: "12px",
            borderRadius: "6px",
            cursor: "pointer",
            background: tab === "autonomous" ? "rgba(99,102,241,0.25)" : "transparent",
            borderColor: tab === "autonomous" ? "#6366f1" : "rgba(255,255,255,0.1)",
          }}
          onClick={() => setTab("autonomous")}
        >
          🤖 چرخه خودکار ایجنت
        </button>
        <button
          type="button"
          style={{
            flex: 1,
            padding: "6px",
            fontSize: "12px",
            borderRadius: "6px",
            cursor: "pointer",
            background: tab === "drafts" ? "rgba(99,102,241,0.25)" : "transparent",
            borderColor: tab === "drafts" ? "#6366f1" : "rgba(255,255,255,0.1)",
          }}
          onClick={() => setTab("drafts")}
        >
          📋 پیش‌نویس‌ها ({tasks.filter((t) => t.project_id === selected).length})
        </button>
      </div>

      {tab === "autonomous" ? (
        <div className="agent-autonomous-view">
          <form onSubmit={(e) => void startRun(e)}>
            <label htmlFor="agent-run-prompt">تعریف وظیفه یا هدف روی پروژه:</label>
            {/* انتخاب مد ارکستراسیون */}
            <div style={{ display: "flex", gap: "6px", margin: "6px 0 6px 0" }}>
              <button
                type="button"
                style={{
                  flex: 1,
                  padding: "4px 8px",
                  fontSize: "11px",
                  borderRadius: "4px",
                  background: mode === "single" ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.05)",
                  borderColor: mode === "single" ? "#6366f1" : "rgba(255,255,255,0.1)",
                  cursor: "pointer",
                }}
                onClick={() => setMode("single")}
              >
                👤 تک‌ایـجنت
              </button>
              <button
                type="button"
                style={{
                  flex: 1,
                  padding: "4px 8px",
                  fontSize: "11px",
                  borderRadius: "4px",
                  background: mode === "swarm" ? "rgba(245,158,11,0.3)" : "rgba(255,255,255,0.05)",
                  borderColor: mode === "swarm" ? "#f59e0b" : "rgba(255,255,255,0.1)",
                  cursor: "pointer",
                  color: mode === "swarm" ? "#fbbf24" : "inherit",
                }}
                onClick={() => setMode("swarm")}
              >
                🐝 سوارم چندعاملی (Swarm)
              </button>
            </div>

            {mode === "single" ? (
              <div style={{ display: "flex", gap: "6px", margin: "4px 0 8px 0" }}>
                {(
                  [
                    ["general", "🧠 عمومی"],
                    ["coder", "🛠️ برنامه‌نویس"],
                    ["tester", "🧪 تست"],
                    ["architect", "🏛️ معمار"],
                  ] as const
                ).map(([r, label]) => (
                  <button
                    key={r}
                    type="button"
                    style={{
                      flex: 1,
                      padding: "4px",
                      fontSize: "11px",
                      borderRadius: "4px",
                      background: role === r ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.05)",
                      borderColor: role === r ? "#6366f1" : "rgba(255,255,255,0.1)",
                      cursor: "pointer",
                    }}
                    onClick={() => setRole(r)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ padding: "6px 8px", background: "rgba(245,158,11,0.1)", borderRadius: "4px", fontSize: "11px", color: "#fde68a", margin: "4px 0 8px 0" }}>
                🐝 همکاری هماهنگ ۳ زیرایجنت: <strong>🏛️ معمار</strong> ➔ <strong>🛠️ کدنویس</strong> ➔ <strong>🧪 تستر</strong>
              </div>
            )}
            <textarea
              id="agent-run-prompt"
              rows={2}
              maxLength={2000}
              value={runPrompt}
              onChange={(e) => setRunPrompt(e.target.value)}
              placeholder="مثلاً: بررسی تست‌ها و فایل‌های کانفیگ پروژه و رفع باگ..."
            />
            <button disabled={busy || !selected || !runPrompt.trim()} style={{ marginTop: "6px" }}>
              🚀 اجرای خودکار وظیفه
            </button>
          </form>

          {activeRun && (
            <article style={{ marginTop: "14px", padding: "10px", background: "rgba(15,23,42,0.6)", borderRadius: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <strong>🎯 هدف: {activeRun.prompt}</strong>
                <small style={{ color: activeRun.status === "completed" ? "#34d399" : "#fbbf24" }}>
                  {activeRun.status === "completed" ? "✅ پایان یافته" :
                   activeRun.status === "waiting_approval" ? "⚠️ نیازمند تایید" :
                   activeRun.status === "in_progress" ? "⏳ در حال اجرا" : activeRun.status}
                </small>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {activeRun.plan_steps.map((st, i) => (
                  <div key={i} style={{ fontSize: "12px", padding: "4px 8px", background: "rgba(255,255,255,0.03)", borderRadius: "4px" }}>
                    <span>{st.status === "completed" ? "✅" : st.status === "waiting_approval" ? "⚠️" : "⚪"} </span>
                    <strong>گام {i + 1}: {st.title}</strong>
                    <div style={{ color: "#94a3b8", fontSize: "11px", marginTop: "2px" }}>{st.summary}</div>
                    {st.command && <code dir="ltr" style={{ color: "#38bdf8", fontSize: "11px" }}>$ {st.command}</code>}
                  </div>
                ))}
              </div>

              {activeRun.subagents && activeRun.subagents.length > 0 && (
                <div style={{ marginTop: "10px", padding: "8px", background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: "6px" }}>
                  <small style={{ color: "#fbbf24", fontWeight: 700, display: "block", marginBottom: "6px" }}>🐝 زیرایجنت‌های هماهنگ سوارم:</small>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {activeRun.subagents.map((sub) => (
                      <div key={sub.id} style={{ fontSize: "11px", padding: "4px 6px", background: "rgba(0,0,0,0.3)", borderRadius: "4px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <strong style={{ color: "#f1f5f9" }}>{sub.title}</strong>
                          <span style={{ color: sub.status === "completed" ? "#86efac" : sub.status === "in_progress" ? "#7dd3fc" : "#cbd5e1" }}>
                            {sub.status === "completed" ? "✅ تکمیل" : sub.status === "in_progress" ? "⏳ در حال اجرا" : sub.status}
                          </span>
                        </div>
                        {sub.summary && <div style={{ color: "#94a3b8", marginTop: "2px" }}>{sub.summary}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                {activeRun.status === "waiting_approval" && (
                  <button type="button" disabled={busy} onClick={() => void approveRun()} style={{ background: "#f59e0b", color: "#000", fontWeight: 700 }}>
                    ✅ تأیید اقدام
                  </button>
                )}
                {activeRun.status === "in_progress" && (
                  <button type="button" disabled={busy} onClick={() => void advanceRun()}>
                    ▶️ گام بعد
                  </button>
                )}
                {activeRun.status !== "completed" && activeRun.status !== "cancelled" && (
                  <button type="button" disabled={busy} onClick={() => void cancelRun()} style={{ color: "#f87171" }}>
                    🛑 لغو
                  </button>
                )}
              </div>

              {activeRun.result_summary && (
                <div style={{ marginTop: "10px", padding: "8px", background: "rgba(16,185,129,0.1)", borderRadius: "6px", fontSize: "12px" }}>
                  <strong style={{ color: "#34d399" }}>🏁 خلاصه دستاورد ایجنت:</strong>
                  <p style={{ margin: "4px 0 0 0", color: "#e2e8f0", whiteSpace: "pre-wrap" }}>{activeRun.result_summary}</p>
                </div>
              )}
            </article>
          )}

          {runs.length > 1 && (
            <div style={{ marginTop: "12px" }}>
              <small style={{ color: "#94a3b8" }}>سایر اجراها:</small>
              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "4px" }}>
                {runs.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    style={{
                      fontSize: "11px",
                      padding: "2px 8px",
                      borderRadius: "4px",
                      background: activeRun?.id === r.id ? "#6366f1" : "rgba(255,255,255,0.05)",
                    }}
                    onClick={() => setActiveRun(r)}
                  >
                    {r.prompt.slice(0, 15)}...
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : canRequest ? (
        <>
          <form onSubmit={(event) => void createTask(event)}>
            <label htmlFor="agent-task-description">وظیفهٔ مورد نظر</label>
            <textarea
              id="agent-task-description"
              rows={3}
              maxLength={2000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="نتیجهٔ مورد انتظار را بنویسید…"
            />
            <button disabled={busy || !selected || !description.trim()}>ثبت پیش‌نویس</button>
          </form>
          <div className="agent-task-list">
            {tasks
              .filter((task) => task.project_id === selected)
              .map((task) => (
                <article key={task.id}>
                  <p>{task.description}</p>
                  <small>{task.status === "draft" ? "پیش‌نویس · بدون اجرا" : "لغوشده"}</small>
                  {task.status === "draft" && (
                    <button type="button" disabled={busy} onClick={() => void cancelDraft(task.id)}>
                      لغو
                    </button>
                  )}
                </article>
              ))}
          </div>
        </>
      ) : (
        <p>برای ساخت وظیفه، مجوز «درخواست اقدام» لازم است.</p>
      )}

      {error && <p role="alert" className="agent-error">{error}</p>}
    </section>
  );
}


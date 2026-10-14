import { useState, useEffect } from "react";
import {
  api,
  type WorkspaceProject,
  type ProjectInspection,
  type ProjectFileEntry,
  type CommandExecutionResult,
  type AgentRun,
  type AgentRole,
  type AgentMode,
  type FilePatchProposal,
} from "../api";

interface AgenticWorkspaceCardProps {
  onLoadContextToChat?: (contextPrompt: string) => void;
  canExecuteCommands?: boolean;
}

export function AgenticWorkspaceCard({ onLoadContextToChat, canExecuteCommands = false }: AgenticWorkspaceCardProps) {
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Agent Role & Swarm Mode selection state
  const [selectedRole, setSelectedRole] = useState<AgentRole>("general");
  const [selectedMode, setSelectedMode] = useState<AgentMode>("single");
  const [expandedSubagentId, setExpandedSubagentId] = useState<string | null>(null);

  // File viewing and patch proposal state
  const [isEditingFile, setIsEditingFile] = useState(false);
  const [editedFileContent, setEditedFileContent] = useState("");
  const [patchDiffResult, setPatchDiffResult] = useState<FilePatchProposal | null>(null);
  const [calculatingDiff, setCalculatingDiff] = useState(false);
  const [applyingPatch, setApplyingPatch] = useState(false);

  // Create / Bind state
  const [showNewModal, setShowNewModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectRoot, setNewProjectRoot] = useState("");

  // Inspection state
  const [inspection, setInspection] = useState<ProjectInspection | null>(null);
  const [inspecting, setInspecting] = useState(false);

  // Files state
  const [files, setFiles] = useState<ProjectFileEntry[]>([]);
  const [viewingFile, setViewingFile] = useState<{ path: string; content: string; lines: number; size: number } | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  // Command execution state
  const [commandInput, setCommandInput] = useState("");
  const [commandRunning, setCommandRunning] = useState(false);
  const [lastCommandResult, setLastCommandResult] = useState<CommandExecutionResult | null>(null);
  const [commandApprovalRequired, setCommandApprovalRequired] = useState(false);

  // Agent Runs state
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [activeRun, setActiveRun] = useState<AgentRun | null>(null);
  const [agentTaskPrompt, setAgentTaskPrompt] = useState("");
  const [startingRun, setStartingRun] = useState(false);
  const [advancingRun, setAdvancingRun] = useState(false);

  // Load projects list
  async function loadProjects() {
    try {
      setLoading(true);
      const res = await api.workspaceProjects();
      setProjects(res.projects || []);
      if (res.projects?.length && !selectedProjectId) {
        setSelectedProjectId(res.projects[0].id);
      }
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در بارگذاری فهرست پروژه‌ها");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  // Inspect selected project
  useEffect(() => {
    if (!selectedProjectId) {
      setInspection(null);
      setFiles([]);
      return;
    }
    const currentProj = projects.find((p) => p.id === selectedProjectId);
    if (!currentProj?.root_path) {
      setInspection(null);
      setFiles([]);
      return;
    }

    void handleInspectProject(selectedProjectId);
    void loadAgentRuns(selectedProjectId);
  }, [selectedProjectId, projects]);

  async function loadAgentRuns(projectId: string) {
    if (!projectId) return;
    try {
      const res = await api.listAgentRuns(projectId);
      setAgentRuns(res.runs || []);
      if (res.runs?.length) {
        const ongoing = res.runs.find(
          (r) => r.status === "in_progress" || r.status === "waiting_approval" || r.status === "planning"
        );
        setActiveRun(ongoing || res.runs[0]);
      } else {
        setActiveRun(null);
      }
    } catch {
      // ignore
    }
  }

  async function handleStartAgentRun(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!selectedProjectId || !agentTaskPrompt.trim()) return;
    setStartingRun(true);
    setError("");
    setSuccessMsg("");
    try {
      const res = await api.startAgentRun(selectedProjectId, agentTaskPrompt.trim(), selectedRole, selectedMode);
      setActiveRun(res.run);
      setAgentTaskPrompt("");
      setSuccessMsg(
        selectedMode === "swarm"
          ? "🐝 چرخه همکاری چندعاملی سوارم (Multi-Agent Swarm) با موفقیت آغاز شد."
          : "چرخه اجرای خودکار وظیفه توسط ایجنت با موفقیت آغاز شد."
      );
      await loadAgentRuns(selectedProjectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "آغاز چرخه ایجنت ناموفق بود.");
    } finally {
      setStartingRun(false);
    }
  }

  async function handleAdvanceRun() {
    if (!activeRun) return;
    setAdvancingRun(true);
    setError("");
    try {
      const res = await api.advanceAgentRun(activeRun.id);
      setActiveRun(res.run);
      await loadAgentRuns(selectedProjectId);
      if (res.run.status === "completed") {
        const filesRes = await api.listProjectFiles(selectedProjectId);
        setFiles(filesRes.entries || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "پیشبرد گام با خطا مواجه شد.");
    } finally {
      setAdvancingRun(false);
    }
  }

  async function handleApproveStep() {
    if (!activeRun) return;
    setAdvancingRun(true);
    setError("");
    try {
      const res = await api.approveAgentRunStep(activeRun.id);
      setActiveRun(res.run);
      await loadAgentRuns(selectedProjectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تأیید اقدام با خطا مواجه شد.");
    } finally {
      setAdvancingRun(false);
    }
  }

  async function handleCancelRun() {
    if (!activeRun) return;
    setError("");
    try {
      const res = await api.cancelAgentRun(activeRun.id);
      setActiveRun(res.run);
      await loadAgentRuns(selectedProjectId);
      setSuccessMsg("اجرای تسک ایجنت متوقف شد.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "لغو تسک ناموفق بود.");
    }
  }

  async function handleInspectProject(projectId: string) {
    setInspecting(true);
    setError("");
    try {
      const info = await api.inspectWorkspaceProject(projectId);
      setInspection(info);
      const filesRes = await api.listProjectFiles(projectId);
      setFiles(filesRes.entries || []);
    } catch (err) {
      setInspection(null);
      setFiles([]);
      setError(err instanceof Error ? err.message : "پویش پروژه با خطا مواجه شد.");
    } finally {
      setInspecting(false);
    }
  }

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    setError("");
    setSuccessMsg("");
    try {
      const created = await api.createWorkspaceProject(newProjectName.trim(), newProjectRoot.trim());
      setSuccessMsg(`پروژه «${created.name}» با موفقیت ثبت شد.`);
      setNewProjectName("");
      setNewProjectRoot("");
      setShowNewModal(false);
      await loadProjects();
      setSelectedProjectId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ایجاد پروژه ناموفق بود.");
    }
  }

  async function handleReadFile(path: string) {
    if (!selectedProjectId) return;
    setLoadingFile(true);
    setError("");
    setIsEditingFile(false);
    setPatchDiffResult(null);
    try {
      const detail = await api.readProjectFile(selectedProjectId, path);
      setViewingFile(detail);
      setEditedFileContent(detail.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خواندن فایل ممکن نشد.");
    } finally {
      setLoadingFile(false);
    }
  }

  async function handleCalculateDiff() {
    if (!selectedProjectId || !viewingFile) return;
    setCalculatingDiff(true);
    setError("");
    try {
      const proposal = await api.proposeFilePatch(selectedProjectId, viewingFile.path, editedFileContent, false);
      setPatchDiffResult(proposal);
    } catch (err) {
      setError(err instanceof Error ? err.message : "محاسبه پچ و اختلاف فایل با خطا مواجه شد.");
    } finally {
      setCalculatingDiff(false);
    }
  }

  async function handleApplyPatch() {
    if (!selectedProjectId || !viewingFile) return;
    setApplyingPatch(true);
    setError("");
    setSuccessMsg("");
    try {
      const res = await api.proposeFilePatch(selectedProjectId, viewingFile.path, editedFileContent, true);
      setPatchDiffResult(res);
      setSuccessMsg(`وصله فایل «${viewingFile.path}» با موفقیت روی دیسک اعمال شد.`);
      const detail = await api.readProjectFile(selectedProjectId, viewingFile.path);
      setViewingFile(detail);
      setEditedFileContent(detail.content);
      const filesRes = await api.listProjectFiles(selectedProjectId);
      setFiles(filesRes.entries || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "اعمال پچ با خطا مواجه شد.");
    } finally {
      setApplyingPatch(false);
    }
  }

  function handleSendContextToChat() {
    if (!inspection) return;
    const filesList = files.slice(0, 20).map((f) => `- ${f.path}${f.is_dir ? " (پوشه)" : ""}`).join("\n");
    let prompt = `من در حال کار روی پروژه محلی «${inspection.name}» هستم.\n`;
    prompt += `نوع پروژه: ${inspection.project_type} (${inspection.framework})\n`;
    prompt += `مسیر محلی: ${inspection.root_path}\n\n`;

    if (inspection.readme_preview) {
      prompt += `--- مستندات / خلاصه README پروژه ---\n${inspection.readme_preview.trim()}\n\n`;
    }
    if (inspection.tasks_context) {
      prompt += `--- تسک‌های نیمه‌کاره کشف‌شده در TODO/Roadmap ---\n${inspection.tasks_context.trim()}\n\n`;
    }
    prompt += `--- ساختار کلیدی فایل‌ها ---\n${filesList}\n\n`;
    prompt += `لطفاً وضعیت فعلی پروژه را بررسی کن و گام‌های بعدی توسعه و تکمیل تسک‌ها را مشخص نما.`;

    if (onLoadContextToChat) {
      onLoadContextToChat(prompt);
      setSuccessMsg("کانتکست پروژه با موفقیت در کادر چت بارگذاری شد.");
    }
  }

  async function executeCommandNow() {
    if (!selectedProjectId || !commandInput.trim()) return;
    setCommandRunning(true);
    setError("");
    setCommandApprovalRequired(false);
    try {
      const res = await api.executeProjectCommand(selectedProjectId, commandInput.trim(), 20);
      setLastCommandResult(res);
      // Refresh files after command execution (e.g. build or git output)
      const filesRes = await api.listProjectFiles(selectedProjectId);
      setFiles(filesRes.entries || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "اجرای دستور با خطا مواجه شد.");
    } finally {
      setCommandRunning(false);
    }
  }

  function handleRunCommandClick() {
    if (!commandInput.trim()) return;
    // Interactive approval confirmation
    setCommandApprovalRequired(true);
  }

  const selectedProj = projects.find((p) => p.id === selectedProjectId);

  return (
    <div className="agentic-workspace-panel" aria-label="میز کار و هدایت پروژه محلی">
      <div className="agentic-workspace-header">
        <div className="workspace-header-title">
          <span className="workspace-badge-icon">🛠️</span>
          <div>
            <strong>میز کار و هدایت پروژه محلی (Local Workspace Pilot)</strong>
            <small>اتصال به دایرکتوری پروژه‌ها، اسکن تسک‌های نیمه‌کاره و اجرای ابزارهای توسعه</small>
          </div>
        </div>
        <div className="workspace-header-actions">
          <button
            type="button"
            className="quiet-button"
            onClick={() => setShowNewModal(!showNewModal)}
          >
            {showNewModal ? "✕ انصراف" : "➕ اتصال پروژه جدید"}
          </button>
        </div>
      </div>

      {error && <div className="agentic-error-banner" role="alert">⚠️ {error}</div>}
      {successMsg && <div className="agentic-success-banner" role="status">✅ {successMsg}</div>}

      {showNewModal && (
        <form className="agentic-new-project-card" onSubmit={handleCreateProject}>
          <h4>افزودن و اتصال پروژه محلی یا پروژه نیمه‌کاره</h4>
          <p>آدرس پوشه پروژه در کامپیوتر یا سرور را وارد کنید تا ساختار و تسک‌های آن به طور خودکار کشف شوند:</p>
          <div className="agentic-form-row">
            <label htmlFor="agentic-proj-name">نام نمایشی پروژه:</label>
            <input
              id="agentic-proj-name"
              type="text"
              placeholder="مثلاً: پروژه وب فروشگاهی نیمه‌کاره"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              required
              maxLength={100}
            />
          </div>
          <div className="agentic-form-row">
            <label htmlFor="agentic-proj-root">مسیر کامل پوشه روی سیستم (Local Directory Path):</label>
            <input
              id="agentic-proj-root"
              type="text"
              dir="ltr"
              placeholder="مثلاً: C:\Users\Username\Projects\MyIncompleteApp یا /home/user/app"
              value={newProjectRoot}
              onChange={(e) => setNewProjectRoot(e.target.value)}
            />
          </div>
          <div className="agentic-form-actions">
            <button type="submit" className="action-button" disabled={!newProjectName.trim()}>
              💾 ذخیره و اتصال به پروژه
            </button>
            <button type="button" className="quiet-button" onClick={() => setShowNewModal(false)}>
              انصراف
            </button>
          </div>
        </form>
      )}

      {/* نوار انتخاب پروژه */}
      <div className="agentic-project-selector-bar">
        <label htmlFor="agentic-active-project">پروژه فعال:</label>
        {loading ? (
          <span className="no-projects-hint">در حال بارگذاری پروژه‌ها...</span>
        ) : projects.length > 0 ? (
          <select
            id="agentic-active-project"
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.root_path ? `(${p.root_path})` : "— بدون پوشه محلی"}
              </option>
            ))}
          </select>
        ) : (
          <span className="no-projects-hint">هنوز پروژه‌ای ثبت نشده است. از دکمه «➕ اتصال پروژه جدید» استفاده کنید.</span>
        )}
        {selectedProjectId && selectedProj?.root_path && (
          <button
            type="button"
            className="quiet-button"
            onClick={() => handleInspectProject(selectedProjectId)}
            disabled={inspecting}
            title="پویش مجدد فایل‌ها و متادیتا"
          >
            {inspecting ? "🔄 در حال پویش..." : "🔄 بازخوانی مجدد"}
          </button>
        )}
      </div>

      {selectedProj && !selectedProj.root_path && (
        <div className="agentic-bind-root-notice">
          <span>💡 این پروژه فاقد مسیر محلی است. می‌توانید پوشه لوکال آن را تعیین کنید تا ابزارهای خودکار فعال شوند.</span>
        </div>
      )}

      {/* خلاصه هوشمند وضعیت پروژه */}
      {inspection && (
        <div className="agentic-inspection-dashboard">
          <div className="inspection-meta-badges">
            <span className="meta-badge framework">
              ⚡ فریم‌ورک / زبان: <strong>{inspection.framework}</strong>
            </span>
            <span className="meta-badge files-count">
              📁 تعداد موارد: <strong>{inspection.total_entries.toLocaleString("fa-IR")} فایل و پوشه</strong>
            </span>
            <span className="meta-badge path-badge" dir="ltr" title={inspection.root_path}>
              📍 <code>{inspection.root_path}</code>
            </span>
          </div>

          {/* اکشن بار هوشمند برای بارگذاری در چت */}
          <div className="agentic-context-actions-row">
            <button
              type="button"
              className="action-button primary-accent"
              onClick={handleSendContextToChat}
            >
              🚀 بارگذاری کانتکست و تسک‌های پروژه در چت هوش مصنوعی
            </button>
            <span className="context-action-tip">
              (ارسال خودکار ساختار، داکیومنت‌ها و تسک‌های ناتمام به دستیار جهت ادامه هوشمند توسعه)
            </span>
          </div>

          {/* پیش‌نمایش تسک‌های نیمه‌کاره کشف‌شده */}
          {inspection.tasks_context && (
            <div className="agentic-tasks-preview-box">
              <div className="box-title">
                <span>📝 تسک‌ها و الزامات ناتمام کشف‌شده (TODO / Roadmap):</span>
              </div>
              <pre>{inspection.tasks_context}</pre>
            </div>
          )}

          {/* پیش‌نمایش README در صورت وجود */}
          {inspection.readme_preview && !inspection.tasks_context && (
            <div className="agentic-tasks-preview-box">
              <div className="box-title">
                <span>📖 مستندات و شناسنامه کشف‌شده (README.md):</span>
              </div>
              <pre>{inspection.readme_preview}</pre>
            </div>
          )}

          {/* بخش چرخه اجرای وظیفه خودکار هوش مصنوعی (Antigravity Autonomous Agent Task Loop) */}
          <div className="agentic-autonomous-runner-card">
            <div className="runner-header-row">
              <div className="runner-title">
                <span className="runner-pulse-icon">🤖</span>
                <div>
                  <strong>چرخه خودکار وظایف ایجنت (Autonomous Agent Task Loop)</strong>
                  <small>تعریف هدف یا وظیفه روی پروژه و واگذاری گام‌به‌گام به هوش مصنوعی با تأیید انسانی</small>
                </div>
              </div>
              {activeRun && (
                <div className={`run-status-pill ${activeRun.status}`}>
                  وضعیت: {
                    activeRun.status === "in_progress" ? "⏳ در حال پردازش گام‌ها" :
                    activeRun.status === "waiting_approval" ? "⚠️ نیازمند تأیید اقدام" :
                    activeRun.status === "completed" ? "✅ پایان یافته" :
                    activeRun.status === "cancelled" ? "⛔ لغوشده" : activeRun.status
                  }
                </div>
              )}
            </div>

            {/* فرم ورود تسک یا هدف */}
            <form onSubmit={handleStartAgentRun} className="agent-task-input-box">
              <div className="agent-mode-selector-row">
                <span className="mode-selector-label">حالت ارکستراسیون:</span>
                <button
                  type="button"
                  className={`mode-pill-btn ${selectedMode === "single" ? "active" : ""}`}
                  onClick={() => setSelectedMode("single")}
                  title="اجرای مستقل با تمرکز روی یک نقش تخصصی انتخابی"
                >
                  👤 تک‌ایـجنت (Single Agent)
                </button>
                <button
                  type="button"
                  className={`mode-pill-btn swarm ${selectedMode === "swarm" ? "active" : ""}`}
                  onClick={() => setSelectedMode("swarm")}
                  title="همکاری تیمی ۳ ایجنت متخصص (معمار + برنامه‌نویس + تستر)"
                >
                  🐝 همکاری گروهی سوارم (Multi-Agent Swarm)
                </button>
              </div>

              {selectedMode === "single" ? (
                <div className="agent-role-selector-row">
                  <span className="role-selector-label">نقش تخصصی ایجنت:</span>
                  <button
                    type="button"
                    className={`role-pill-btn ${selectedRole === "general" ? "active" : ""}`}
                    onClick={() => setSelectedRole("general")}
                    title="بررسی عمومی، داکیومنت‌ها، وابستگی‌ها و تدوین نقشه راه"
                  >
                    🧠 عمومی (Generalist)
                  </button>
                  <button
                    type="button"
                    className={`role-pill-btn ${selectedRole === "coder" ? "active" : ""}`}
                    onClick={() => setSelectedRole("coder")}
                    title="تحلیل ماژول‌ها، بررسی سینتکس، کامپایلر و تولید پیشنهاد پچ (Patch)"
                  >
                    🛠️ برنامه‌نویس (Coder)
                  </button>
                  <button
                    type="button"
                    className={`role-pill-btn ${selectedRole === "tester" ? "active" : ""}`}
                    onClick={() => setSelectedRole("tester")}
                    title="پویش پایگاه تست‌ها، اجرای آزمون‌ها و گزارش تضمین کیفیت QA"
                  >
                    🧪 تست و ارزیابی (Tester)
                  </button>
                  <button
                    type="button"
                    className={`role-pill-btn ${selectedRole === "architect" ? "active" : ""}`}
                    onClick={() => setSelectedRole("architect")}
                    title="تحلیل کلان معماری، استانداردهای مهندسی، توپولوژی و انطباق سیستم"
                  >
                    🏛️ معمار سیستم (Architect)
                  </button>
                </div>
              ) : (
                <div className="swarm-mode-banner">
                  <span className="swarm-badge-icon">🐝</span>
                  <div className="swarm-banner-text">
                    <strong>تیم چندعاملی هماهنگ (Multi-Agent Swarm):</strong>
                    <span> ارکستراسیون ۳ زیرایجنت هوشمند به صورت همگام: <strong>🏛️ معمار</strong> (تحلیل ساختار کلان) ➔ <strong>🛠️ کدنویس</strong> (ممیزی و اعمال تغییرات) ➔ <strong>🧪 تستر</strong> (ارزیابی آزمون‌ها و کیفیت)</span>
                  </div>
                </div>
              )}

              <div className="prompt-input-row">
                <input
                  type="text"
                  placeholder="هدف یا وظیفه مورد نظر روی پروژه... (مثلاً: بررسی کدهای پروژه و حل تسک‌های مشخص‌شده در TODO)"
                  value={agentTaskPrompt}
                  onChange={(e) => setAgentTaskPrompt(e.target.value)}
                  disabled={startingRun}
                />
                <button
                  type="submit"
                  className="action-button primary-accent"
                  disabled={startingRun || !agentTaskPrompt.trim()}
                >
                  {startingRun ? "⏳ در حال آغاز..." : "🚀 اجرای خودکار وظیفه"}
                </button>
              </div>
              <div className="quick-suggestions-row">
                <span>پیشنهادات سریع:</span>
                <button type="button" onClick={() => setAgentTaskPrompt("بررسی سلامت پروژه و اجرای تست‌ها")}>
                  ⚡ ارزیابی و تست پروژه
                </button>
                <button type="button" onClick={() => setAgentTaskPrompt("تحلیل تسک‌های ناتمام TODO و ارائه نقشه راه تکمیل")}>
                  📝 سازماندهی تسک‌های TODO
                </button>
                <button type="button" onClick={() => setAgentTaskPrompt("بررسی معماری و فایل‌های کانفیگ")}>
                  🔍 تحلیل پیکربندی و ساختار
                </button>
              </div>
            </form>

            {/* تاریخچه اجراهای گذشته این پروژه */}
            {agentRuns.length > 1 && (
              <div className="past-runs-row">
                <small>تاریخچه اجراهای ایجنت روی این پروژه:</small>
                {agentRuns.map((r) => (
                  <button
                    type="button"
                    key={r.id}
                    className={`past-run-chip ${activeRun?.id === r.id ? "active" : ""}`}
                    onClick={() => setActiveRun(r)}
                  >
                    <span>{r.status === "completed" ? "✅" : r.status === "in_progress" ? "⏳" : "⚪"}</span>
                    <span>{r.prompt.slice(0, 24)}...</span>
                  </button>
                ))}
              </div>
            )}

            {/* تایم‌لاین گام‌های ایجنت */}
            {activeRun && (
              <div className="agent-active-run-view">
                <div className="run-goal-banner">
                  <span>🎯 هدف فعال:</span> <strong>«{activeRun.prompt}»</strong>
                </div>

                <div className="run-steps-timeline">
                  {activeRun.plan_steps.map((step, idx) => (
                    <div key={idx} className={`timeline-step-card ${step.status}`}>
                      <div className="step-badge">
                        {step.status === "completed" ? "✅" :
                         step.status === "in_progress" ? "⏳" :
                         step.status === "waiting_approval" ? "⚠️" :
                         step.status === "warning" ? "⚠️" :
                         step.status === "failed" ? "❌" : "⚪"}
                      </div>
                      <div className="step-info">
                        <strong>گام {step.index + 1}: {step.title}</strong>
                        <p>{step.summary}</p>
                        {step.command && <code dir="ltr">$ {step.command}</code>}
                      </div>
                      <div className="step-status-tag">
                        {step.status === "completed" ? "تکمیل شده" :
                         step.status === "in_progress" ? "در حال اجرا" :
                         step.status === "waiting_approval" ? "در انتظار تایید" :
                         step.status === "pending" ? "در نوبت" : step.status}
                      </div>
                    </div>
                  ))}
                </div>

                {/* درخت هماهنگی و وضعیت زیرایجنت‌های سوارم */}
                {activeRun.subagents && activeRun.subagents.length > 0 && (
                  <div className="swarm-orchestration-section">
                    <div className="swarm-header">
                      <h4>🐝 ساختار تیم چندعاملی سوارم ({activeRun.subagents.length} زیرایجنت هماهنگ)</h4>
                      <span className="swarm-tag">Multi-Agent Swarm Orchestration</span>
                    </div>
                    <div className="swarm-subagents-grid">
                      {activeRun.subagents.map((sub) => (
                        <div key={sub.id} className={`swarm-subagent-card ${sub.status}`}>
                          <div className="subagent-card-header">
                            <div className="subagent-role-title">
                              <strong>{sub.title}</strong>
                              <span className="subagent-role-pill">{sub.role}</span>
                            </div>
                            <span className={`subagent-status-badge ${sub.status}`}>
                              {sub.status === "completed" ? "✅ تکمیل شده" :
                               sub.status === "in_progress" ? "⏳ در حال اجرا" :
                               sub.status === "waiting_approval" ? "⚠️ نیازمند تایید" :
                               sub.status === "pending" ? "در نوبت" : sub.status}
                            </span>
                          </div>
                          <p className="subagent-prompt"><strong>ماموریت:</strong> {sub.prompt}</p>
                          {sub.summary && <p className="subagent-summary"><strong>دستاورد:</strong> {sub.summary}</p>}
                          {sub.logs && sub.logs.length > 0 && (
                            <div className="subagent-logs-wrapper">
                              <button
                                type="button"
                                className="subagent-logs-toggle"
                                onClick={() => setExpandedSubagentId(expandedSubagentId === sub.id ? null : sub.id)}
                              >
                                {expandedSubagentId === sub.id ? "▲ بستن لاگ‌ها" : `▼ لاگ‌های زیرایجنت (${sub.logs.length})`}
                              </button>
                              {expandedSubagentId === sub.id && (
                                <div className="subagent-logs-list">
                                  {sub.logs.map((log, lIdx) => (
                                    <div key={lIdx} className="subagent-log-item">
                                      <small>{log.title}</small>
                                      <pre dir="ltr">{log.content}</pre>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* اقدامات هدایت گام‌ها */}
                <div className="run-controls-row">
                  {activeRun.status === "waiting_approval" && (
                    <div className="step-approval-alert">
                      <span>⚠️ گام بعدی نیازمند تأیید مجوز اجرای دستور در پروژه است:</span>
                      <button
                        type="button"
                        className="action-button confirm-btn"
                        onClick={() => void handleApproveStep()}
                        disabled={advancingRun}
                      >
                        {advancingRun ? "⏳ در حال اجرا..." : "✅ تأیید و ادامه اجرا"}
                      </button>
                    </div>
                  )}

                  {activeRun.status === "in_progress" && (
                    <button
                      type="button"
                      className="action-button"
                      onClick={() => void handleAdvanceRun()}
                      disabled={advancingRun}
                    >
                      {advancingRun ? "⏳ در حال اجرا..." : "▶️ گام بعد"}
                    </button>
                  )}

                  {activeRun.status !== "completed" && activeRun.status !== "cancelled" && (
                    <button
                      type="button"
                      className="quiet-button cancel-run-btn"
                      onClick={() => void handleCancelRun()}
                    >
                      🛑 توقف / لغو تسک
                    </button>
                  )}
                </div>

                {/* خلاصه نتیجه نهایی */}
                {activeRun.result_summary && (
                  <div className="run-result-summary-box">
                    <div className="summary-title">🏁 گزارش دستاورد ایجنت:</div>
                    <pre>{activeRun.result_summary}</pre>
                  </div>
                )}

                {/* لاگ‌های سیستمی گام‌ها */}
                {activeRun.logs.length > 0 && (
                  <details className="run-logs-collapsible">
                    <summary>📜 مشاهده لاگ‌ها و جزئیات تله‌متری ایجنت ({activeRun.logs.length} رویداد)</summary>
                    <div className="run-logs-content">
                      {activeRun.logs.map((log, lIdx) => (
                        <div key={lIdx} className="run-log-item">
                          <span className="log-title">🔹 {log.title}</span>
                          {log.content && <pre dir="ltr">{log.content}</pre>}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>

          {/* کاوشگر سریع فایل‌ها */}
          <div className="agentic-files-explorer">
            <div className="explorer-header">
              <strong>🗂️ کاوشگر فایل‌های پروژه:</strong>
              <small>{loadingFile ? "⏳ در حال خواندن محتوای فایل..." : "کلیک روی هر فایل برای مشاهده محتوا"}</small>
            </div>
            <div className="explorer-files-grid">
              {files.map((file) => (
                <button
                  type="button"
                  key={file.path}
                  className={`explorer-file-chip ${file.is_dir ? "directory" : "file"}`}
                  onClick={() => !file.is_dir && handleReadFile(file.path)}
                  title={file.is_dir ? "پوشه" : `مشاهده ${file.path}`}
                >
                  <span>{file.is_dir ? "📁" : "📄"}</span>
                  <span className="chip-name">{file.name}</span>
                  {file.size != null && <small>({(file.size / 1024).toFixed(1)} KB)</small>}
                </button>
              ))}
            </div>
          </div>

          {/* نمایشگر و موتور مقایسه و پیشنهاد پچ فایل */}
          {viewingFile && (
            <div className="agentic-file-viewer-modal">
              <div className="file-viewer-header">
                <div className="viewer-title-group">
                  <span>📄 {viewingFile.path}</span>
                  <small>({viewingFile.lines.toLocaleString("fa-IR")} سطر · {(viewingFile.size / 1024).toFixed(1)} KB)</small>
                </div>
                <div className="file-viewer-actions">
                  <button
                    type="button"
                    className={`mode-toggle-btn ${!isEditingFile ? "active" : ""}`}
                    onClick={() => {
                      setIsEditingFile(false);
                      setPatchDiffResult(null);
                    }}
                  >
                    👁️ مشاهده محتوا
                  </button>
                  <button
                    type="button"
                    className={`mode-toggle-btn ${isEditingFile ? "active" : ""}`}
                    onClick={() => setIsEditingFile(true)}
                  >
                    🛠️ ویرایش و پیشنهاد پچ (Diff)
                  </button>
                  <button type="button" className="close-viewer-btn" onClick={() => setViewingFile(null)}>✕ بستن</button>
                </div>
              </div>

              {!isEditingFile ? (
                <pre className="file-viewer-content">{viewingFile.content}</pre>
              ) : (
                <div className="file-patch-editor-container">
                  <div className="editor-hint-banner">
                    💡 محتوای فایل را ویرایش یا کد جدید را جایگزین کنید، سپس دکمه <strong>«محاسبه Diff»</strong> را بزنید تا تغییرات خط‌به‌خط بررسی و اعتبارسنجی شوند.
                  </div>
                  <textarea
                    className="file-editor-textarea"
                    dir="ltr"
                    value={editedFileContent}
                    onChange={(e) => setEditedFileContent(e.target.value)}
                    rows={12}
                    placeholder="محتوای جدید فایل..."
                  />

                  <div className="patch-controls-bar">
                    <button
                      type="button"
                      className="action-button"
                      onClick={() => void handleCalculateDiff()}
                      disabled={calculatingDiff || applyingPatch}
                    >
                      {calculatingDiff ? "⏳ در حال محاسبه Diff..." : "🔍 محاسبه Diff و تغییرات"}
                    </button>
                    {patchDiffResult && (
                      <button
                        type="button"
                        className="action-button primary-accent"
                        onClick={() => void handleApplyPatch()}
                        disabled={applyingPatch}
                      >
                        {applyingPatch ? "⏳ در حال اعمال..." : "💾 اعمال پچ روی فایل (Apply Patch)"}
                      </button>
                    )}
                  </div>

                  {patchDiffResult && (
                    <div className="patch-diff-preview-box">
                      <div className="diff-header">
                        <span className="diff-title">نتیجهٔ اختلاف و بازبینی پچ (Unified Diff):</span>
                        <div className="diff-stats">
                          <span className="additions">+{patchDiffResult.additions} سطر</span>
                          <span className="deletions">-{patchDiffResult.deletions} سطر</span>
                          <span className="diff-status">
                            {patchDiffResult.has_changes ? "تغییرات تشخیص داده شد" : "بدون تغییر"}
                          </span>
                        </div>
                      </div>
                      <pre className="diff-content" dir="ltr">
                        {patchDiffResult.diff || "هیچ اختلافی با فایل اصلی یافت نشد."}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ترمینال و مجری دستورات در دایرکتوری پروژه */}
          <div className="agentic-command-runner-section">
            <div className="runner-header">
              <strong>⚡ اجرای دستور در محیط پروژه (Workspace Terminal Runner):</strong>
              <span className="safety-badge">🛡️ ساندباکس در پوشه محلی</span>
            </div>
            {!canExecuteCommands ? (
              <p className="no-perm-hint">💡 اجرای مستقیم دستورات ترمینال نیازمند مجوز «تایید اقدام» (action.approve) یا نقش مدیر ارشد است.</p>
            ) : (
              <div className="command-input-row">
                <input
                  type="text"
                  dir="ltr"
                  placeholder="دستور مورد نظر... (مثلاً: npm test یا git status یا python script.py)"
                  value={commandInput}
                  onChange={(e) => setCommandInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleRunCommandClick();
                    }
                  }}
                />
                <button
                  type="button"
                  className="action-button"
                  disabled={commandRunning || !commandInput.trim()}
                  onClick={handleRunCommandClick}
                >
                  {commandRunning ? "⏳ در حال اجرا..." : "▶️ بررسی و اجرا"}
                </button>
              </div>
            )}

            {/* پنجره تأیید امنیتی اقدام (Human-in-the-Loop Approval) */}
            {commandApprovalRequired && (
              <div className="agentic-approval-pill">
                <div className="approval-content">
                  <span>⚠️ آیا اجرای دستور زیر در دایرکتوری پروژه را تایید می‌کنید؟</span>
                  <code dir="ltr">{commandInput}</code>
                </div>
                <div className="approval-actions">
                  <button type="button" className="action-button confirm-btn" onClick={() => void executeCommandNow()}>
                    ✅ تایید و اجرای قطعی
                  </button>
                  <button type="button" className="quiet-button" onClick={() => setCommandApprovalRequired(false)}>
                    انصراف
                  </button>
                </div>
              </div>
            )}

            {/* نتیجه آخرین دستور */}
            {lastCommandResult && (
              <div className={`command-result-terminal ${lastCommandResult.exit_code === 0 ? "success" : "failed"}`}>
                <div className="terminal-header">
                  <span>دستور: <code dir="ltr">{lastCommandResult.command}</code></span>
                  <span>کد خروجی: {lastCommandResult.exit_code} · زمان: {lastCommandResult.duration_ms}ms</span>
                </div>
                {lastCommandResult.stdout && <pre className="terminal-stdout">{lastCommandResult.stdout}</pre>}
                {lastCommandResult.stderr && <pre className="terminal-stderr">{lastCommandResult.stderr}</pre>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

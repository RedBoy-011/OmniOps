import { useState, useEffect } from "react";
import { api, type WorkspaceProject, type ProjectInspection, type ProjectFileEntry, type CommandExecutionResult } from "../api";

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
  }, [selectedProjectId, projects]);

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
    try {
      const detail = await api.readProjectFile(selectedProjectId, path);
      setViewingFile(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خواندن فایل ممکن نشد.");
    } finally {
      setLoadingFile(false);
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

          {/* نمایشگر محتوای فایل انتخاب‌شده */}
          {viewingFile && (
            <div className="agentic-file-viewer-modal">
              <div className="file-viewer-header">
                <span>📄 {viewingFile.path} ({viewingFile.lines.toLocaleString("fa-IR")} سطر · {(viewingFile.size / 1024).toFixed(1)} KB)</span>
                <button type="button" onClick={() => setViewingFile(null)}>✕ بستن</button>
              </div>
              <pre className="file-viewer-content">{viewingFile.content}</pre>
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

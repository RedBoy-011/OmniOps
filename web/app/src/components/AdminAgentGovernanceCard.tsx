import { useState, useEffect } from "react";
import {
  api,
  type AgentRun,
  type AgentPlanStep,
  type AgentRunLog,
  type SubagentRun,
} from "../api";

export function AdminAgentGovernanceCard() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [inspectRun, setInspectRun] = useState<AgentRun | null>(null);

  // Emergency stop modal
  const [stoppingRunId, setStoppingRunId] = useState<string | null>(null);
  const [stopReason, setStopReason] = useState("توقف اضطراری توسط مدیریت ارشد سیستم");
  const [actionBusy, setActionBusy] = useState(false);

  // Sandbox policy configuration state
  const [showSandboxConfig, setShowSandboxConfig] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policyTimeout, setPolicyTimeout] = useState<number>(30);
  const [policyStrict, setPolicyStrict] = useState<boolean>(false);
  const [policyAllowed, setPolicyAllowed] = useState<string>("");
  const [policyBlocked, setPolicyBlocked] = useState<string>("");

  async function loadRuns() {
    setLoading(true);
    setError("");
    try {
      const res = await api.adminAgentRuns(100);
      setRuns(res.runs || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در بارگذاری فهرست ایجنت‌های سازمان");
    } finally {
      setLoading(false);
    }
  }

  async function loadSandboxPolicy() {
    try {
      const res = await api.getSandboxPolicy();
      setPolicyTimeout(res.policy.max_timeout_seconds);
      setPolicyStrict(res.policy.strict_mode);
      setPolicyAllowed((res.policy.allowed_prefixes || []).join(", "));
      setPolicyBlocked((res.policy.blocked_commands || []).join(", "));
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در دریافت سیاست‌های سندباکس");
    }
  }

  async function handleSaveSandboxPolicy(e: React.FormEvent) {
    e.preventDefault();
    setSavingPolicy(true);
    setError("");
    setActionSuccess("");
    try {
      const allowedArr = policyAllowed.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      const blockedArr = policyBlocked.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      await api.updateSandboxPolicy({
        max_timeout_seconds: Number(policyTimeout),
        strict_mode: policyStrict,
        allowed_prefixes: allowedArr,
        blocked_commands: blockedArr,
      });
      setActionSuccess("سیاست‌های امنیتی و محدودیت‌های اجرایی سندباکس با موفقیت ذخیره شد.");
      setShowSandboxConfig(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در بروزرسانی سیاست‌های سندباکس");
    } finally {
      setSavingPolicy(false);
    }
  }

  useEffect(() => {
    void loadRuns();
    const interval = setInterval(() => {
      void loadRuns();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  async function handleAdminApprove(runId: string) {
    setActionBusy(true);
    setError("");
    setActionSuccess("");
    try {
      const res = await api.adminApproveAgentRun(runId);
      setActionSuccess(`گام تسک «${res.run.id.slice(0, 8)}» توسط مدیر ارشد تأیید شد و ادامه یافت.`);
      await loadRuns();
      if (inspectRun?.id === runId) {
        setInspectRun(res.run);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "تأیید گام با خطا مواجه شد.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleConfirmEmergencyStop() {
    if (!stoppingRunId) return;
    setActionBusy(true);
    setError("");
    setActionSuccess("");
    try {
      const res = await api.adminStopAgentRun(stoppingRunId, stopReason.trim());
      setActionSuccess(`توقف اضطراری برای تسک «${res.run.id.slice(0, 8)}» با موفقیت اعمال گردید.`);
      setStoppingRunId(null);
      await loadRuns();
      if (inspectRun?.id === stoppingRunId) {
        setInspectRun(res.run);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "اعمال توقف اضطراری ناموفق بود.");
    } finally {
      setActionBusy(false);
    }
  }

  const roleLabels: Record<string, { label: string; icon: string; cls: string }> = {
    general: { label: "عمومی", icon: "🧠", cls: "role-general" },
    coder: { label: "برنامه‌نویس", icon: "🛠️", cls: "role-coder" },
    tester: { label: "تست و ارزیابی", icon: "🧪", cls: "role-tester" },
    architect: { label: "معمار سیستم", icon: "🏛️", cls: "role-architect" },
  };

  const statusLabels: Record<string, { text: string; cls: string }> = {
    in_progress: { text: "⏳ در حال اجرا", cls: "in_progress" },
    waiting_approval: { text: "⚠️ در انتظار تأیید", cls: "waiting_approval" },
    completed: { text: "✅ پایان‌یافته", cls: "completed" },
    cancelled: { text: "⛔ متوقف‌شده", cls: "cancelled" },
    planning: { text: "🔍 در حال برنامه‌ریزی", cls: "planning" },
    failed: { text: "❌ خطا", cls: "failed" },
  };

  const waitingCount = runs.filter((r) => r.status === "waiting_approval").length;
  const inProgressCount = runs.filter((r) => r.status === "in_progress").length;
  const completedCount = runs.filter((r) => r.status === "completed").length;

  const filteredRuns = runs.filter((r) => {
    if (filterStatus === "all") return true;
    return r.status === filterStatus;
  });

  return (
    <div className="admin-governance-card" aria-label="حاکمیت بر ایجنت‌های سازمانی">
      <div className="governance-header">
        <div className="governance-title-group">
          <span className="governance-icon">🤖</span>
          <div>
            <h3>حاکمیت و نظارت بر ایجنت‌های سازمانی (Agent Governance Control Plane)</h3>
            <p>مشاهده تمام چرخه‌های ایجنت در سازمان، صدور مجوز اقدام‌های حساس و توقف اضطراری (Kill-Switch)</p>
          </div>
        </div>
        <div className="governance-actions-top">
          <button
            type="button"
            className="action-button secondary-btn"
            onClick={() => {
              void loadSandboxPolicy();
              setShowSandboxConfig(true);
            }}
          >
            🛡️ تنظیمات سندباکس و سقف منابع
          </button>
          <button
            type="button"
            className="quiet-button"
            onClick={() => void loadRuns()}
            disabled={loading}
          >
            {loading ? "⏳ در حال بازیابی..." : "🔄 بروزرسانی زنده"}
          </button>
        </div>
      </div>

      {error && <div className="agentic-error-banner" role="alert">⚠️ {error}</div>}
      {actionSuccess && <div className="agentic-success-banner" role="status">✅ {actionSuccess}</div>}

      {/* کارت‌های آماری شاخص‌ها */}
      <div className="governance-stats-grid">
        <div className="gov-stat-tile total">
          <span className="stat-label">کل چرخه‌های ثبت‌شده</span>
          <strong className="stat-value">{runs.length.toLocaleString("fa-IR")}</strong>
        </div>
        <div className="gov-stat-tile active">
          <span className="stat-label">ایجنت‌های فعال (در حال پردازش)</span>
          <strong className="stat-value">{inProgressCount.toLocaleString("fa-IR")}</strong>
        </div>
        <div className={`gov-stat-tile waiting ${waitingCount > 0 ? "urgent" : ""}`}>
          <span className="stat-label">نیازمند تأیید مدیر (Human-in-the-Loop)</span>
          <strong className="stat-value">{waitingCount.toLocaleString("fa-IR")}</strong>
        </div>
        <div className="gov-stat-tile completed">
          <span className="stat-label">تسک‌های موفق نهایی‌شده</span>
          <strong className="stat-value">{completedCount.toLocaleString("fa-IR")}</strong>
        </div>
      </div>

      {/* فیلترهای وضعیت */}
      <div className="governance-filter-row">
        <span className="filter-title">فیلتر وضعیت:</span>
        <button
          type="button"
          className={`filter-btn ${filterStatus === "all" ? "active" : ""}`}
          onClick={() => setFilterStatus("all")}
        >
          همه ({runs.length})
        </button>
        <button
          type="button"
          className={`filter-btn ${filterStatus === "waiting_approval" ? "active" : ""}`}
          onClick={() => setFilterStatus("waiting_approval")}
        >
          ⚠️ در انتظار تأیید ({waitingCount})
        </button>
        <button
          type="button"
          className={`filter-btn ${filterStatus === "in_progress" ? "active" : ""}`}
          onClick={() => setFilterStatus("in_progress")}
        >
          ⏳ در حال اجرا ({inProgressCount})
        </button>
        <button
          type="button"
          className={`filter-btn ${filterStatus === "completed" ? "active" : ""}`}
          onClick={() => setFilterStatus("completed")}
        >
          ✅ تکمیل‌شده ({completedCount})
        </button>
      </div>

      {/* جدول تسک‌های ایجنت */}
      <div className="governance-table-container">
        {filteredRuns.length === 0 ? (
          <div className="empty-runs-state">
            <p>هیچ مأموریت یا تسکی در این وضعیت یافت نشد.</p>
          </div>
        ) : (
          <table className="governance-table">
            <thead>
              <tr>
                <th>هدف و پرامپت ایجنت</th>
                <th>پروژه</th>
                <th>کاربر آغازگر</th>
                <th>نقش تخصصی</th>
                <th>پیشرفت</th>
                <th>وضعیت</th>
                <th>عملیات حاکمیتی مدیر</th>
              </tr>
            </thead>
            <tbody>
              {filteredRuns.map((r) => {
                const roleMeta = roleLabels[r.role] || roleLabels.general;
                const statusMeta = statusLabels[r.status] || { text: r.status, cls: "unknown" };
                const isWaiting = r.status === "waiting_approval";
                const isActive = r.status === "in_progress" || isWaiting;

                return (
                  <tr key={r.id} className={isWaiting ? "row-waiting" : ""}>
                    <td className="col-prompt">
                      <div className="prompt-text" title={r.prompt}>
                        {r.prompt}
                      </div>
                      <small className="run-id-sub">شناسه: {r.id.slice(0, 10)}</small>
                    </td>
                    <td>
                      <span className="project-badge">{r.project_name || "پروژه محلی"}</span>
                    </td>
                    <td>
                      <span className="owner-badge">👤 {r.owner_username || "نامشخص"}</span>
                    </td>
                    <td>
                      <div className="role-and-mode">
                        <span className={`role-badge ${roleMeta.cls}`}>
                          {roleMeta.icon} {roleMeta.label}
                        </span>
                        {r.mode === "swarm" || (r.subagents && r.subagents.length > 0) ? (
                          <span className="swarm-indicator-badge">🐝 سوارم</span>
                        ) : (
                          <span className="single-indicator-badge">👤 تک‌ایـجنت</span>
                        )}
                      </div>
                    </td>
                    <td className="col-progress">
                      <span className="step-counter">گام {r.current_step_index + 1} از {r.plan_steps.length}</span>
                    </td>
                    <td>
                      <span className={`run-status-pill ${statusMeta.cls}`}>
                        {statusMeta.text}
                      </span>
                    </td>
                    <td className="col-actions">
                      <div className="actions-button-group">
                        {isWaiting && (
                          <button
                            type="button"
                            className="action-button approve-btn"
                            onClick={() => void handleAdminApprove(r.id)}
                            disabled={actionBusy}
                            title="تأیید اقدام حساس و ادامه پیشروی ایجنت"
                          >
                            ✅ تأیید اقدام
                          </button>
                        )}
                        {isActive && (
                          <button
                            type="button"
                            className="danger-button stop-btn"
                            onClick={() => {
                              setStoppingRunId(r.id);
                              setStopReason("توقف اضطراری توسط مدیریت ارشد سیستم");
                            }}
                            disabled={actionBusy}
                            title="توقف اضطراری فوری (Emergency Kill-Switch)"
                          >
                            ⛔ توقف فوری
                          </button>
                        )}
                        <button
                          type="button"
                          className="quiet-button inspect-btn"
                          onClick={() => setInspectRun(r)}
                        >
                          👁️ مشاهده
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* مدال توقف اضطراری */}
      {stoppingRunId && (
        <div className="admin-modal-backdrop">
          <div className="admin-modal-card">
            <h4>⛔ تأیید توقف اضطراری چرخه ایجنت (Kill-Switch)</h4>
            <p>
              با متوقف ساختن این تسک، فرایند اجرای دستورات ساندباکس و ادامه گام‌ها لغو گردیده و رخداد در لاگ امنیتی سازمان ثبت خواهد شد.
            </p>
            <div className="modal-form-field">
              <label htmlFor="stop-reason-input">علت توقف اداری:</label>
              <input
                id="stop-reason-input"
                type="text"
                value={stopReason}
                onChange={(e) => setStopReason(e.target.value)}
                placeholder="دلیل توقف اضطراری..."
              />
            </div>
            <div className="modal-actions-row">
              <button
                type="button"
                className="danger-button"
                onClick={() => void handleConfirmEmergencyStop()}
                disabled={actionBusy || !stopReason.trim()}
              >
                {actionBusy ? "⏳ در حال توقف..." : "⛔ اعمال قطعی توقف اضطراری"}
              </button>
              <button
                type="button"
                className="quiet-button"
                onClick={() => setStoppingRunId(null)}
                disabled={actionBusy}
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}

      {/* مدال بازرسی لاگ‌ها و طرح گام‌های ایجنت */}
      {inspectRun && (
        <div className="admin-modal-backdrop" onClick={() => setInspectRun(null)}>
          <div className="admin-modal-card large" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row">
              <div>
                <h4>📋 مانیتورینگ جزئیات تسک «{inspectRun.id.slice(0, 10)}»</h4>
                <small>هدف: {inspectRun.prompt}</small>
              </div>
              <button type="button" className="close-btn" onClick={() => setInspectRun(null)}>
                ✕
              </button>
            </div>

            {/* گام‌های طرح */}
            <div className="inspect-plan-section">
              <h5>طرح گام‌به‌گام هوش مصنوعی:</h5>
              <div className="inspect-steps-list">
                {inspectRun.plan_steps.map((st: AgentPlanStep) => (
                  <div key={st.index} className={`step-item ${st.status}`}>
                    <span className="step-num">گام {st.index + 1}</span>
                    <div className="step-info">
                      <strong>{st.title}</strong>
                      <small>{st.summary}</small>
                      {st.command && <code dir="ltr" className="step-cmd">{st.command}</code>}
                    </div>
                    <span className={`step-pill ${st.status}`}>
                      {statusLabels[st.status]?.text || st.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* لاگ‌های اجرای زنده */}
            <div className="inspect-logs-section">
              <h5>لاگ‌ها و خروجی‌های گام‌ها ({inspectRun.logs.length} رویداد):</h5>
              <div className="inspect-logs-container">
                {inspectRun.logs.map((log: AgentRunLog, idx: number) => (
                  <div key={idx} className={`log-entry ${log.type}`}>
                    <div className="log-top">
                      <span className="log-type-tag">{log.type}</span>
                      <span className="log-title">{log.title}</span>
                      <small className="log-time">{new Date(log.timestamp * 1000).toLocaleTimeString("fa-IR")}</small>
                    </div>
                    <pre className="log-content">{log.content}</pre>
                  </div>
                ))}
              </div>
            </div>

            {/* زیرایجنت‌های سوارم */}
            {inspectRun.subagents && inspectRun.subagents.length > 0 && (
              <div className="inspect-subagents-section">
                <h5>🐝 زیرایجنت‌های هماهنگ سوارم ({inspectRun.subagents.length} عامل):</h5>
                <div className="inspect-subagents-grid">
                  {inspectRun.subagents.map((sub: SubagentRun) => (
                    <div key={sub.id} className={`inspect-subagent-card ${sub.status}`}>
                      <div className="subagent-top">
                        <strong>{sub.title}</strong>
                        <span className={`sub-status-pill ${sub.status}`}>{statusLabels[sub.status]?.text || sub.status}</span>
                      </div>
                      <small className="sub-prompt"><strong>ماموریت:</strong> {sub.prompt}</small>
                      {sub.summary && <p className="sub-summary">{sub.summary}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {inspectRun.result_summary && (
              <div className="inspect-result-summary">
                <h5>🎯 جمع‌بندی نهایی ایجنت:</h5>
                <pre>{inspectRun.result_summary}</pre>
              </div>
            )}

            <div className="modal-actions-row">
              {inspectRun.status === "waiting_approval" && (
                <button
                  type="button"
                  className="action-button approve-btn"
                  onClick={() => void handleAdminApprove(inspectRun.id)}
                  disabled={actionBusy}
                >
                  ✅ تأیید اقدام حساس
                </button>
              )}
              {inspectRun.status === "in_progress" && (
                <button
                  type="button"
                  className="danger-button"
                  onClick={() => {
                    setStoppingRunId(inspectRun.id);
                  }}
                  disabled={actionBusy}
                >
                  ⛔ توقف اضطراری
                </button>
              )}
              <button type="button" className="quiet-button" onClick={() => setInspectRun(null)}>
                بستن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* مدال تنظیمات سندباکس و سقف منابع */}
      {showSandboxConfig && (
        <div className="admin-modal-backdrop" onClick={() => setShowSandboxConfig(false)}>
          <div className="admin-modal-card large" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row">
              <div>
                <h4>🛡️ سیاست‌های امنیتی و محدودیت‌های اجرایی سندباکس (Workspace Sandbox Policy)</h4>
                <small>تنظیم سقف زمان اجرا، حالت سخت‌گیرانه، و الگوهای مجاز/غیرمجاز فرامین ایجنت در رایانه و سرور</small>
              </div>
              <button type="button" className="close-btn" onClick={() => setShowSandboxConfig(false)}>✕</button>
            </div>

            <form onSubmit={handleSaveSandboxPolicy} className="sandbox-policy-form">
              <div className="form-row-grid">
                <div className="modal-form-field">
                  <label htmlFor="policy-timeout-input">
                    ⏱️ سقف مجاز زمان اجرای هر دستور (ثانیه):
                  </label>
                  <input
                    id="policy-timeout-input"
                    type="number"
                    min={5}
                    max={120}
                    value={policyTimeout}
                    onChange={(e) => setPolicyTimeout(Number(e.target.value))}
                    required
                  />
                  <small>محدوده مجاز بین ۵ تا ۱۲۰ ثانیه (پیش‌فرض: ۳۰ ثانیه)</small>
                </div>

                <div className="modal-form-field checkbox-field">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={policyStrict}
                      onChange={(e) => setPolicyStrict(e.target.checked)}
                    />
                    <strong>🔒 فعال‌سازی حالت سخت‌گیرانه (Strict Whitelist Mode)</strong>
                  </label>
                  <small>در این حالت، فقط دستوراتی که با پیشوندهای مجاز زیر شروع شوند اجازه اجرا خواهند داشت.</small>
                </div>
              </div>

              <div className="modal-form-field">
                <label htmlFor="policy-allowed-input">
                  ✅ پیشوندهای دستورات مجاز (جداشده با کاما):
                </label>
                <textarea
                  id="policy-allowed-input"
                  dir="ltr"
                  rows={3}
                  value={policyAllowed}
                  onChange={(e) => setPolicyAllowed(e.target.value)}
                  placeholder="git, npm, yarn, python, pytest, cargo, go..."
                />
                <small>ابزارهایی مانند کامپایلرها، پکیج‌منیجرها و آزمون‌گرهای استاندارد</small>
              </div>

              <div className="modal-form-field">
                <label htmlFor="policy-blocked-input">
                  🚫 عبارات و الگوهای خطرناک ممنوعه (جداشده با کاما):
                </label>
                <textarea
                  id="policy-blocked-input"
                  dir="ltr"
                  rows={3}
                  value={policyBlocked}
                  onChange={(e) => setPolicyBlocked(e.target.value)}
                  placeholder="format, rmdir /s /q, del /f /s /q, rm -rf /..."
                />
                <small>هر فرمانی حاوی این کلیدواژه‌ها بلافاصله توسط موتور سندباکس مسدود می‌شود.</small>
              </div>

              <div className="modal-actions-row">
                <button
                  type="submit"
                  className="action-button primary-accent"
                  disabled={savingPolicy}
                >
                  {savingPolicy ? "⏳ در حال ذخیره..." : "💾 ذخیره سیاست‌های سندباکس"}
                </button>
                <button
                  type="button"
                  className="quiet-button"
                  onClick={() => setShowSandboxConfig(false)}
                  disabled={savingPolicy}
                >
                  انصراف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

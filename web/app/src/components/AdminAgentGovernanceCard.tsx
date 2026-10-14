import { useState, useEffect } from "react";
import {
  api,
  type AgentRun,
  type AgentPlanStep,
  type AgentRunLog,
  type SubagentRun,
  type GovernanceWebhook,
} from "../api";

export function AdminAgentGovernanceCard() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [inspectRun, setInspectRun] = useState<AgentRun | null>(null);
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [searchQuery, setSearchQuery] = useState("");
  const [advancingRunId, setAdvancingRunId] = useState<string | null>(null);
  const [inspectModalTab, setInspectModalTab] = useState<"plan" | "logs" | "subagents" | "result">("plan");

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

  // Webhooks state
  const [showWebhooksConfig, setShowWebhooksConfig] = useState(false);
  const [webhooks, setWebhooks] = useState<GovernanceWebhook[]>([]);
  const [loadingWebhooks, setLoadingWebhooks] = useState(false);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [testingWebhookId, setTestingWebhookId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; status: string; message: string } | null>(null);

  // New webhook form
  const [whName, setWhName] = useState("");
  const [whUrl, setWhUrl] = useState("");
  const [whSecret, setWhSecret] = useState("");
  const [whEvents, setWhEvents] = useState<string[]>(["emergency_stop", "sandbox_violation", "waiting_approval"]);

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

  async function loadWebhooks() {
    setLoadingWebhooks(true);
    try {
      const res = await api.listGovernanceWebhooks();
      setWebhooks(res.webhooks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در دریافت وب‌هوک‌ها");
    } finally {
      setLoadingWebhooks(false);
    }
  }

  async function handleSaveWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!whName.trim() || !whUrl.trim()) return;
    setSavingWebhook(true);
    setError("");
    setActionSuccess("");
    try {
      await api.saveGovernanceWebhook({
        name: whName.trim(),
        url: whUrl.trim(),
        secret: whSecret.trim(),
        events: whEvents,
        enabled: true,
      });
      setActionSuccess("وب‌هوک با موفقیت ثبت شد.");
      setWhName("");
      setWhUrl("");
      setWhSecret("");
      await loadWebhooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در ذخیره وب‌هوک");
    } finally {
      setSavingWebhook(false);
    }
  }

  async function handleDeleteWebhook(id: string) {
    try {
      await api.deleteGovernanceWebhook(id);
      setActionSuccess("وب‌هوک حذف شد.");
      await loadWebhooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در حذف وب‌هوک");
    }
  }

  async function handleTestWebhook(id: string) {
    setTestingWebhookId(id);
    setTestResult(null);
    try {
      const res = await api.testGovernanceWebhook(id);
      setTestResult({ id, status: res.status, message: res.message });
    } catch (err) {
      setTestResult({ id, status: "error", message: err instanceof Error ? err.message : "خطای تست" });
    } finally {
      setTestingWebhookId(null);
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

  async function handleAdvanceRun(runId: string) {
    setAdvancingRunId(runId);
    setError("");
    setActionSuccess("");
    try {
      const res = await api.advanceAgentRun(runId);
      setActionSuccess(`گام تسک «${res.run.id.slice(0, 8)}» با موفقیت اجرا شد و به گام بعدی منتقل گردید.`);
      await loadRuns();
      if (inspectRun?.id === runId) {
        setInspectRun(res.run);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در پیشبرد گام تسک ایجنت");
    } finally {
      setAdvancingRunId(null);
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
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const promptMatch = r.prompt?.toLowerCase().includes(q);
      const idMatch = r.id?.toLowerCase().includes(q);
      const projectMatch = r.project_name?.toLowerCase().includes(q);
      const ownerMatch = r.owner_username?.toLowerCase().includes(q);
      return Boolean(promptMatch || idMatch || projectMatch || ownerMatch);
    }
    return true;
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
            className="action-button secondary-btn"
            onClick={() => {
              void loadWebhooks();
              setShowWebhooksConfig(true);
            }}
          >
            🔔 وب‌هوک‌ها و هشدارهای حاکمیتی
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

      {/* تولبار حاکمیتی، فیلترها، جستجو و تغییر نمای کارت/جدول */}
      <div className="governance-toolbar-row">
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

        <div className="governance-search-and-view">
          <div className="gov-search-wrap">
            <input
              type="text"
              className="gov-search-input"
              placeholder="🔍 جستجو بر اساس هدف، شناسه، پروژه یا کاربر..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="gov-clear-search-btn"
                onClick={() => setSearchQuery("")}
                title="پاکسازی جستجو"
              >
                ✕
              </button>
            )}
          </div>

          <div className="view-mode-toggle" role="group" aria-label="انتخاب نحوه نمایش تسک‌ها">
            <button
              type="button"
              className={`view-mode-btn ${viewMode === "cards" ? "active" : ""}`}
              onClick={() => setViewMode("cards")}
              title="نمای کارت‌های تعاملی با پایپ‌لاین و استپر"
            >
              🎴 کارت‌های هوشمند
            </button>
            <button
              type="button"
              className={`view-mode-btn ${viewMode === "table" ? "active" : ""}`}
              onClick={() => setViewMode("table")}
              title="نمای فشرده جدولی"
            >
              📊 جدول کلاسیک
            </button>
          </div>
        </div>
      </div>

      {/* نمایش تسک‌ها بر اساس نمای انتخاب‌شده */}
      {filteredRuns.length === 0 ? (
        <div className="empty-runs-state">
          <p>
            {searchQuery
              ? `هیچ مأموریت یا تسکی با مشخصات «${searchQuery}» یافت نشد.`
              : "هیچ مأموریت یا تسکی در این وضعیت یافت نشد."}
          </p>
        </div>
      ) : viewMode === "cards" ? (
        <div className="governance-tasks-grid">
          {filteredRuns.map((r) => {
            const roleMeta = roleLabels[r.role] || roleLabels.general;
            const statusMeta = statusLabels[r.status] || { text: r.status, cls: "unknown" };
            const isWaiting = r.status === "waiting_approval";
            const isActive = r.status === "in_progress" || isWaiting;
            const totalSteps = Math.max(r.plan_steps.length, 1);
            const progressPercent = Math.min(
              100,
              Math.round(((r.current_step_index + (r.status === "completed" ? 1 : 0)) / totalSteps) * 100)
            );
            const currentStep = r.plan_steps[r.current_step_index] || r.plan_steps[r.plan_steps.length - 1];

            return (
              <div
                key={r.id}
                className={`gov-task-card ${isWaiting ? "waiting-approval" : ""} ${r.status}`}
              >
                {/* Header: Role + Swarm & Status */}
                <div className="gov-task-card-header">
                  <div className="task-role-cluster">
                    <span className={`role-badge ${roleMeta.cls}`}>
                      {roleMeta.icon} {roleMeta.label}
                    </span>
                    {r.mode === "swarm" || (r.subagents && r.subagents.length > 0) ? (
                      <span className="swarm-indicator-badge">🐝 سوارم</span>
                    ) : (
                      <span className="single-indicator-badge">👤 تک‌ایـجنت</span>
                    )}
                  </div>
                  <div className="task-status-cluster">
                    <span className={`run-status-pill ${statusMeta.cls}`}>
                      <span className="status-dot"></span>
                      {statusMeta.text}
                    </span>
                  </div>
                </div>

                {/* Prompt & Metadata */}
                <div>
                  <h4 className="task-prompt-heading" title={r.prompt}>
                    {r.prompt}
                  </h4>
                  <div className="task-card-meta-row">
                    <span className="meta-tag id">#{r.id.slice(0, 8)}</span>
                    <span className="meta-tag">📁 {r.project_name || "پروژه محلی"}</span>
                    <span className="meta-tag">👤 {r.owner_username || "نامشخص"}</span>
                    <span className="meta-tag">🕒 {new Date(r.created_at * 1000).toLocaleTimeString("fa-IR")}</span>
                  </div>
                </div>

                {/* Stepper Pipeline */}
                <div className="gov-task-stepper-box">
                  <div className="stepper-header-row">
                    <span>
                      پیشرفت پایپ‌لاین ({Math.min(r.current_step_index + 1, totalSteps)} از {totalSteps})
                    </span>
                    <span className="stepper-percent">{progressPercent}%</span>
                  </div>
                  <div className="gov-stepper-track">
                    <div
                      className="gov-stepper-progress-bar"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <div className="gov-stepper-nodes">
                    {r.plan_steps.map((st, sIdx) => {
                      let nodeCls = "pending";
                      if (r.status === "completed" || sIdx < r.current_step_index) {
                        nodeCls = "completed";
                      } else if (sIdx === r.current_step_index) {
                        nodeCls = isWaiting ? "waiting" : "active";
                      }
                      return (
                        <div
                          key={sIdx}
                          className={`stepper-node-item ${nodeCls}`}
                          title={`گام ${sIdx + 1}: ${st.title} (${st.status})`}
                        >
                          <span className="node-circle">{nodeCls === "completed" ? "✓" : sIdx + 1}</span>
                          <span className="node-title-snippet">
                            {st.title.length > 12 ? st.title.slice(0, 10) + "..." : st.title}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Current Active Step Callout */}
                {currentStep && (
                  <div className={`gov-current-step-callout ${isWaiting ? "waiting_approval" : r.status}`}>
                    <div className="callout-title">
                      <strong>📌 {isWaiting ? "اقدام معلق نیازمند تأیید:" : "گام فعال:"}</strong> {currentStep.title}
                    </div>
                    {currentStep.command && (
                      <code dir="ltr" className="callout-cmd">
                        $ {currentStep.command}
                      </code>
                    )}
                    {currentStep.summary && (
                      <p className="callout-summary">{currentStep.summary}</p>
                    )}
                  </div>
                )}

                {/* Actions Footer */}
                <div className="gov-task-card-footer">
                  <div className="card-actions-row">
                    {isWaiting && (
                      <button
                        type="button"
                        className="action-button approve-btn"
                        onClick={() => void handleAdminApprove(r.id)}
                        disabled={actionBusy}
                        title="تأیید اقدام حساس و ادامه پیشروی ایجنت (Human-in-the-Loop)"
                      >
                        ✅ تأیید اقدام
                      </button>
                    )}
                    {r.status === "in_progress" && (
                      <button
                        type="button"
                        className="action-button advance-btn"
                        onClick={() => void handleAdvanceRun(r.id)}
                        disabled={actionBusy || advancingRunId === r.id}
                        title="هدایت و پیشبرد دستی به گام بعدی چرخه"
                      >
                        {advancingRunId === r.id ? "⏳ در حال پیشروی..." : "⚡ گام بعد"}
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
                        title="توقف اضطراری فوری (Kill-Switch)"
                      >
                        ⛔ توقف فوری
                      </button>
                    )}
                    <button
                      type="button"
                      className="quiet-button inspect-btn"
                      onClick={() => {
                        setInspectRun(r);
                        setInspectModalTab("plan");
                      }}
                      title="مشاهده و پایش جزئیات تسک"
                    >
                      👁️ بازرسی جامع
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="governance-table-container">
          <table className="governance-table">
            <thead>
              <tr>
                <th>هدف و پرامپت ایجنت</th>
                <th>پروژه</th>
                <th>کاربر آغازگر</th>
                <th>نقش تخصصی</th>
                <th>پیشرفت و استپر</th>
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
                const totalSteps = Math.max(r.plan_steps.length, 1);
                const progressPercent = Math.min(
                  100,
                  Math.round(((r.current_step_index + (r.status === "completed" ? 1 : 0)) / totalSteps) * 100)
                );

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
                    <td className="col-progress" style={{ minWidth: "140px" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
                          <span className="step-counter">گام {r.current_step_index + 1} از {totalSteps}</span>
                          <span style={{ color: "#00ffaa", fontFamily: "monospace", fontWeight: 700 }}>{progressPercent}%</span>
                        </div>
                        <div className="gov-stepper-track" style={{ marginBottom: 0, height: "4px" }}>
                          <div className="gov-stepper-progress-bar" style={{ width: `${progressPercent}%` }} />
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`run-status-pill ${statusMeta.cls}`}>
                        <span className="status-dot"></span>
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
                            ✅ تأیید
                          </button>
                        )}
                        {r.status === "in_progress" && (
                          <button
                            type="button"
                            className="action-button advance-btn"
                            onClick={() => void handleAdvanceRun(r.id)}
                            disabled={actionBusy || advancingRunId === r.id}
                            title="پیشبرد دستی به گام بعدی"
                          >
                            ⚡ گام بعد
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
                            ⛔ توقف
                          </button>
                        )}
                        <button
                          type="button"
                          className="quiet-button inspect-btn"
                          onClick={() => {
                            setInspectRun(r);
                            setInspectModalTab("plan");
                          }}
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
        </div>
      )}

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

            {/* تب‌های بازرسی جامع */}
            <div className="modal-tabs-header">
              <button
                type="button"
                className={`modal-tab-btn ${inspectModalTab === "plan" ? "active" : ""}`}
                onClick={() => setInspectModalTab("plan")}
              >
                📋 طرح گام‌ها ({inspectRun.plan_steps.length})
              </button>
              <button
                type="button"
                className={`modal-tab-btn ${inspectModalTab === "logs" ? "active" : ""}`}
                onClick={() => setInspectModalTab("logs")}
              >
                📜 لاگ‌های رویداد ({inspectRun.logs.length})
              </button>
              {inspectRun.subagents && inspectRun.subagents.length > 0 && (
                <button
                  type="button"
                  className={`modal-tab-btn ${inspectModalTab === "subagents" ? "active" : ""}`}
                  onClick={() => setInspectModalTab("subagents")}
                >
                  🐝 سوارم و ساب‌ایـجنت‌ها ({inspectRun.subagents.length})
                </button>
              )}
              {inspectRun.result_summary && (
                <button
                  type="button"
                  className={`modal-tab-btn ${inspectModalTab === "result" ? "active" : ""}`}
                  onClick={() => setInspectModalTab("result")}
                >
                  🎯 جمع‌بندی نهایی
                </button>
              )}
            </div>

            {/* گام‌های طرح */}
            {inspectModalTab === "plan" && (
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
            )}

            {/* لاگ‌های اجرای زنده */}
            {inspectModalTab === "logs" && (
              <div className="inspect-logs-section">
                <h5>لاگ‌ها و خروجی‌های گام‌ها ({inspectRun.logs.length} رویداد):</h5>
                {inspectRun.logs.length === 0 ? (
                  <p className="empty-hint">هنوز لاگی برای این تسک ثبت نشده است.</p>
                ) : (
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
                )}
              </div>
            )}

            {/* زیرایجنت‌های سوارم */}
            {inspectModalTab === "subagents" && inspectRun.subagents && inspectRun.subagents.length > 0 && (
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

            {/* جمع‌بندی نهایی */}
            {inspectModalTab === "result" && inspectRun.result_summary && (
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
                  className="action-button advance-btn"
                  onClick={() => void handleAdvanceRun(inspectRun.id)}
                  disabled={actionBusy || advancingRunId === inspectRun.id}
                >
                  {advancingRunId === inspectRun.id ? "⏳ در حال پیشروی..." : "⚡ پیشبرد به گام بعد"}
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

      {/* مدال وب‌هوک‌ها و هشدارهای حاکمیتی */}
      {showWebhooksConfig && (
        <div className="admin-modal-backdrop" onClick={() => setShowWebhooksConfig(false)}>
          <div className="admin-modal-card large" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-row">
              <div>
                <h4>🔔 وب‌هوک‌ها و هشدارهای حاکمیتی (Governance Webhooks & Alerting)</h4>
                <small>ارسال برخط رویدادهای بحرانی ایجنت‌ها به سامانه‌های بیرونی سازمان نظیر دیسکورد، اسلک یا وب‌هوک اختصاصی</small>
              </div>
              <button type="button" className="close-btn" onClick={() => setShowWebhooksConfig(false)}>✕</button>
            </div>

            <div className="webhooks-modal-content">
              {/* فهرست وب‌هوک‌های تعریف‌شده */}
              <div className="webhooks-list-section">
                <h5>فهرست مقاصد هشدار فعال:</h5>
                {loadingWebhooks ? (
                  <p className="loading-hint">⏳ در حال دریافت لیست وب‌هوک‌ها...</p>
                ) : webhooks.length === 0 ? (
                  <p className="empty-hint">هیچ وب‌هوکی تعریف نشده است. می‌توانید در فرم زیر وب‌هوک جدید ایجاد کنید.</p>
                ) : (
                  <div className="webhooks-grid">
                    {webhooks.map((wh) => (
                      <div key={wh.id} className="webhook-card">
                        <div className="webhook-card-header">
                          <strong>{wh.name}</strong>
                          <span className="webhook-status-badge active">فعال</span>
                        </div>
                        <div className="webhook-url" dir="ltr">{wh.url}</div>
                        <div className="webhook-events-row">
                          {wh.events.map((ev) => (
                            <span key={ev} className="event-badge">
                              {ev === "emergency_stop" && "⛔ توقف اضطراری"}
                              {ev === "sandbox_violation" && "🚫 نقض سندباکس"}
                              {ev === "waiting_approval" && "⚠️ انتظار تأیید"}
                              {!["emergency_stop", "sandbox_violation", "waiting_approval"].includes(ev) && ev}
                            </span>
                          ))}
                        </div>
                        <div className="webhook-card-actions">
                          <button
                            type="button"
                            className="quiet-button test-btn"
                            disabled={testingWebhookId === wh.id}
                            onClick={() => void handleTestWebhook(wh.id)}
                          >
                            {testingWebhookId === wh.id ? "⏳ در حال ارسال پینگ..." : "⚡ ارسال پینگ تستی"}
                          </button>
                          <button
                            type="button"
                            className="danger-button delete-btn"
                            onClick={() => void handleDeleteWebhook(wh.id)}
                          >
                            🗑️ حذف
                          </button>
                        </div>
                        {testResult && testResult.id === wh.id && (
                          <div className={`webhook-test-result ${testResult.status}`}>
                            {testResult.status === "success" ? "✅ پاسخ سرور مقصد: " : "❌ خطا در برقراری ارتباط: "}
                            {testResult.message}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* فرم افزودن وب‌هوک جدید */}
              <form onSubmit={handleSaveWebhook} className="new-webhook-form">
                <h5>➕ ثبت مقصد وب‌هوک جدید:</h5>
                <div className="form-row-grid">
                  <div className="modal-form-field">
                    <label htmlFor="wh-name-input">نام / عنوان وب‌هوک:</label>
                    <input
                      id="wh-name-input"
                      type="text"
                      placeholder="مثال: دیسکورد کانال هشدارهای امنیتی"
                      value={whName}
                      onChange={(e) => setWhName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="modal-form-field">
                    <label htmlFor="wh-secret-input">رمز امضای محرمانه (HMAC Secret - اختیاری):</label>
                    <input
                      id="wh-secret-input"
                      type="password"
                      dir="ltr"
                      placeholder="کلید اختیاری جهت اعتبارسنجی X-OmniOps-Signature"
                      value={whSecret}
                      onChange={(e) => setWhSecret(e.target.value)}
                    />
                  </div>
                </div>

                <div className="modal-form-field">
                  <label htmlFor="wh-url-input">آدرس Endpoint مقصد (URL):</label>
                  <input
                    id="wh-url-input"
                    type="url"
                    dir="ltr"
                    placeholder="https://hooks.slack.com/services/... یا https://api.mycorp.internal/webhook"
                    value={whUrl}
                    onChange={(e) => setWhUrl(e.target.value)}
                    required
                  />
                </div>

                <div className="modal-form-field">
                  <label>اشتراک در رویدادهای حاکمیتی:</label>
                  <div className="events-checkbox-group">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={whEvents.includes("emergency_stop")}
                        onChange={(e) => {
                          setWhEvents((prev) =>
                            e.target.checked ? [...prev, "emergency_stop"] : prev.filter((x) => x !== "emergency_stop")
                          );
                        }}
                      />
                      <span>⛔ توقف اضطراری ایجنت (Emergency Kill Switch)</span>
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={whEvents.includes("sandbox_violation")}
                        onChange={(e) => {
                          setWhEvents((prev) =>
                            e.target.checked ? [...prev, "sandbox_violation"] : prev.filter((x) => x !== "sandbox_violation")
                          );
                        }}
                      />
                      <span>🚫 نقض قوانین سندباکس یا دستور ممنوعه (Sandbox Violation)</span>
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={whEvents.includes("waiting_approval")}
                        onChange={(e) => {
                          setWhEvents((prev) =>
                            e.target.checked ? [...prev, "waiting_approval"] : prev.filter((x) => x !== "waiting_approval")
                          );
                        }}
                      />
                      <span>⚠️ توقف ایجنت در انتظار تأیید انسانی (Waiting Human Approval)</span>
                    </label>
                  </div>
                </div>

                <div className="modal-actions-row">
                  <button
                    type="submit"
                    className="action-button primary-accent"
                    disabled={savingWebhook || !whName.trim() || !whUrl.trim()}
                  >
                    {savingWebhook ? "⏳ در حال ثبت..." : "💾 ذخیره و فعال‌سازی وب‌هوک"}
                  </button>
                  <button
                    type="button"
                    className="quiet-button"
                    onClick={() => setShowWebhooksConfig(false)}
                  >
                    بستن
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from "react";
import {
  api,
  type WorkspaceSpec,
  type SpecTaskStep,
  type AgentRole,
  type AgentMode,
  type AgentRun
} from "../api";

interface SpecReviewModalProps {
  spec: WorkspaceSpec;
  isOpen: boolean;
  onClose: () => void;
  onExecuted?: (run: AgentRun) => void;
  onSpecUpdated?: (updatedSpec: WorkspaceSpec) => void;
}

export function SpecReviewModal({
  spec: initialSpec,
  isOpen,
  onClose,
  onExecuted,
  onSpecUpdated,
}: SpecReviewModalProps) {
  const [spec, setSpec] = useState<WorkspaceSpec>(initialSpec);
  const [activeTab, setActiveTab] = useState<"requirements" | "design" | "tasks">("requirements");
  const [isEditing, setIsEditing] = useState(false);

  // Editable fields
  const [title, setTitle] = useState(initialSpec.title);
  const [requirements, setRequirements] = useState(initialSpec.requirements);
  const [designApproach, setDesignApproach] = useState(initialSpec.design_approach);
  const [taskSteps, setTaskSteps] = useState<SpecTaskStep[]>(initialSpec.task_breakdown || []);

  // Execution options
  const [selectedRole, setSelectedRole] = useState<AgentRole>("general");
  const [selectedMode, setSelectedMode] = useState<AgentMode>("single");
  const [debugMode, setDebugMode] = useState(false);

  // States
  const [saving, setSaving] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    setSpec(initialSpec);
    setTitle(initialSpec.title);
    setRequirements(initialSpec.requirements);
    setDesignApproach(initialSpec.design_approach);
    setTaskSteps(initialSpec.task_breakdown || []);
    setIsEditing(false);
    setShowRejectInput(false);
    setErrorMsg("");
    setStatusMsg("");
  }, [initialSpec]);

  if (!isOpen) return null;

  const isLocked = spec.status === "executed" || spec.status === "rejected";

  const handleSaveEdits = async () => {
    setSaving(true);
    setErrorMsg("");
    setStatusMsg("");
    try {
      const res = await api.updateSpec({
        spec_id: spec.id,
        title,
        requirements,
        design_approach: designApproach,
        task_breakdown: taskSteps,
      });
      setSpec(res.spec);
      setIsEditing(false);
      setStatusMsg("تغییرات سند مشخصات با موفقیت ذخیره و در ممیزی ثبت شد.");
      if (onSpecUpdated) onSpecUpdated(res.spec);
    } catch (err: any) {
      setErrorMsg(err?.message || "خطا در ذخیره مشخصات");
    } finally {
      setSaving(false);
    }
  };

  const handleApproveAndExecute = async () => {
    if (!window.confirm("آیا از تأیید مشخصات و آغاز اجرای خودکار مأموریت اطمینان دارید؟")) {
      return;
    }
    setExecuting(true);
    setErrorMsg("");
    setStatusMsg("");
    try {
      // If user has unsaved edits in active editing mode, save first
      if (isEditing) {
        await api.updateSpec({
          spec_id: spec.id,
          title,
          requirements,
          design_approach: designApproach,
          task_breakdown: taskSteps,
        });
      }

      const res = await api.approveSpec({
        spec_id: spec.id,
        role: selectedRole,
        mode: selectedMode,
        debug_mode: debugMode,
      });

      setSpec(res.spec);
      setStatusMsg("سند تأیید شد و موتور وظایف (Task Engine) شروع به اجرا کرد!");
      if (onExecuted) {
        onExecuted(res.run);
      }
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: any) {
      setErrorMsg(err?.message || "خطا در تأیید و اجرای سند مشخصات");
    } finally {
      setExecuting(false);
    }
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) {
      setErrorMsg("لطفاً دلیل رد مشخصات را مشخص نمایید.");
      return;
    }
    setRejecting(true);
    setErrorMsg("");
    try {
      const res = await api.rejectSpec({
        spec_id: spec.id,
        reason: rejectionReason.trim(),
      });
      setSpec(res.spec);
      setShowRejectInput(false);
      setStatusMsg("سند با موفقیت رد شد و سوابق در Audit Trail ذخیره گردید.");
      if (onSpecUpdated) onSpecUpdated(res.spec);
    } catch (err: any) {
      setErrorMsg(err?.message || "خطا در رد سند");
    } finally {
      setRejecting(false);
    }
  };

  const handleAddStep = () => {
    const nextStepNum = taskSteps.length + 1;
    setTaskSteps([
      ...taskSteps,
      {
        step: nextStepNum,
        title: `گام ${nextStepNum}: مرحله جدید`,
        description: "شرح جزئیات این مرحله...",
        status: "pending",
      },
    ]);
  };

  const handleRemoveStep = (index: number) => {
    const filtered = taskSteps.filter((_, idx) => idx !== index);
    const renumbered = filtered.map((st, i) => ({ ...st, step: i + 1 }));
    setTaskSteps(renumbered);
  };

  const handleUpdateStep = (index: number, key: keyof SpecTaskStep, val: any) => {
    const updated = [...taskSteps];
    updated[index] = { ...updated[index], [key]: val };
    setTaskSteps(updated);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/75 backdrop-blur-md animate-fade-in font-sans" dir="rtl">
      <div className="relative flex flex-col w-full max-w-4xl max-h-[92vh] bg-slate-900/95 border border-emerald-500/30 rounded-2xl shadow-2xl shadow-emerald-950/50 overflow-hidden backdrop-blur-xl text-slate-100 transition-all">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-emerald-500/20 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight text-emerald-300">
                  سند مشخصات و تحلیل وظیفه (Spec-Driven Gate)
                </h2>
                <span
                  className={`px-2.5 py-0.5 text-xs font-semibold rounded-full border ${
                    spec.status === "executed"
                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                      : spec.status === "rejected"
                      ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                      : "bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse"
                  }`}
                >
                  {spec.status === "executed"
                    ? "✓ اجرا شده"
                    : spec.status === "rejected"
                    ? "✕ رد شده"
                    : "⏳ در انتظار تأیید"}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                تأییدیه انسانی الزامی است؛ بدون تأیید نهایی هیچ دستوری در محیط پروژه اجرا نخواهد شد.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="بستن پنجره"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Title & Info Bar */}
        <div className="px-6 py-3 bg-slate-900/80 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="flex-1 min-w-[260px]">
            {isEditing ? (
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-1.5 text-sm bg-slate-950/80 border border-emerald-500/40 rounded-lg text-emerald-200 focus:outline-none focus:border-emerald-400"
                placeholder="عنوان سند مشخصات..."
              />
            ) : (
              <span className="font-semibold text-slate-200">{title}</span>
            )}
          </div>

          {!isLocked && (
            <button
              onClick={() => setIsEditing(!isEditing)}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-300 flex items-center gap-1.5 transition-all"
            >
              <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
              {isEditing ? "انصراف از ویرایش" : "ویرایش سند"}
            </button>
          )}
        </div>

        {/* Alerts / Feedback */}
        {errorMsg && (
          <div className="px-6 py-2 bg-rose-500/15 border-b border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span>{errorMsg}</span>
          </div>
        )}
        {statusMsg && (
          <div className="px-6 py-2 bg-emerald-500/15 border-b border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span>{statusMsg}</span>
          </div>
        )}

        {/* Tabs Navigation */}
        <div className="flex border-b border-slate-800 bg-slate-950/40 px-6 pt-2 gap-2">
          <button
            onClick={() => setActiveTab("requirements")}
            className={`px-4 py-2.5 text-xs font-medium rounded-t-lg transition-all border-b-2 flex items-center gap-2 ${
              activeTab === "requirements"
                ? "border-emerald-400 text-emerald-400 bg-slate-800/60"
                : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30"
            }`}
          >
            <span>۱. نیازمندی‌ها و معیار پذیرش</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          </button>

          <button
            onClick={() => setActiveTab("design")}
            className={`px-4 py-2.5 text-xs font-medium rounded-t-lg transition-all border-b-2 flex items-center gap-2 ${
              activeTab === "design"
                ? "border-emerald-400 text-emerald-400 bg-slate-800/60"
                : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30"
            }`}
          >
            <span>۲. رویکرد و معماری پیشنهادی</span>
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
          </button>

          <button
            onClick={() => setActiveTab("tasks")}
            className={`px-4 py-2.5 text-xs font-medium rounded-t-lg transition-all border-b-2 flex items-center gap-2 ${
              activeTab === "tasks"
                ? "border-emerald-400 text-emerald-400 bg-slate-800/60"
                : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30"
            }`}
          >
            <span>۳. مراحل اجرایی شماره‌گذاری‌شده</span>
            <span className="px-1.5 py-0.2 text-[10px] rounded bg-emerald-500/20 text-emerald-300 font-mono">
              {taskSteps.length}
            </span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 max-h-[55vh]">
          {/* Tab 1: Requirements */}
          {activeTab === "requirements" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">
                  نیازمندی‌های عملکردی، معیارهای پذیرش و الزامات مهار ریسک:
                </span>
                {isEditing && (
                  <span className="text-[11px] text-amber-400">حالت ویرایش فعال است</span>
                )}
              </div>
              {isEditing ? (
                <textarea
                  value={requirements}
                  onChange={(e) => setRequirements(e.target.value)}
                  rows={12}
                  className="w-full p-4 text-xs font-mono bg-slate-950/80 border border-slate-700 rounded-xl text-slate-200 focus:outline-none focus:border-emerald-500 leading-relaxed"
                  placeholder="نیازمندی‌ها و معیارهای پذیرش را با فرمت Markdown بنویسید..."
                />
              ) : (
                <div className="p-4 bg-slate-950/50 border border-slate-800 rounded-xl text-xs text-slate-300 whitespace-pre-line leading-relaxed font-sans">
                  {requirements || "هیچ نیازمندی ثبت نشده است."}
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Design & Approach */}
          {activeTab === "design" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">
                  معماری فنی، پترن پیاده‌سازی و استراتژی شکست/رول‌بک:
                </span>
                {isEditing && (
                  <span className="text-[11px] text-amber-400">حالت ویرایش فعال است</span>
                )}
              </div>
              {isEditing ? (
                <textarea
                  value={designApproach}
                  onChange={(e) => setDesignApproach(e.target.value)}
                  rows={12}
                  className="w-full p-4 text-xs font-mono bg-slate-950/80 border border-slate-700 rounded-xl text-slate-200 focus:outline-none focus:border-emerald-500 leading-relaxed"
                  placeholder="رویکرد فنی و جزئیات معماری را بنویسید..."
                />
              ) : (
                <div className="p-4 bg-slate-950/50 border border-slate-800 rounded-xl text-xs text-slate-300 whitespace-pre-line leading-relaxed font-sans">
                  {designApproach || "هیچ رویکردی ثبت نشده است."}
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Task Breakdown */}
          {activeTab === "tasks" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">
                  مراحل اجرایی که پس از تایید توسط Task Engine اجرا می‌شوند:
                </span>
                {isEditing && !isLocked && (
                  <button
                    onClick={handleAddStep}
                    className="text-xs px-2.5 py-1 rounded bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/30 transition-all flex items-center gap-1"
                  >
                    + افزودن مرحله جدید
                  </button>
                )}
              </div>

              <div className="space-y-2.5">
                {taskSteps.map((step, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 bg-slate-950/60 border border-slate-800 rounded-xl flex items-start gap-3 transition-all hover:border-slate-700"
                  >
                    <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-mono text-xs font-bold shrink-0 mt-0.5">
                      {step.step}
                    </div>

                    <div className="flex-1 space-y-1.5">
                      {isEditing ? (
                        <>
                          <input
                            type="text"
                            value={step.title}
                            onChange={(e) => handleUpdateStep(idx, "title", e.target.value)}
                            className="w-full px-2.5 py-1 text-xs bg-slate-900 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-emerald-400"
                            placeholder="عنوان گام..."
                          />
                          <textarea
                            value={step.description}
                            onChange={(e) => handleUpdateStep(idx, "description", e.target.value)}
                            rows={2}
                            className="w-full px-2.5 py-1 text-xs bg-slate-900 border border-slate-700 rounded text-slate-300 focus:outline-none focus:border-emerald-400"
                            placeholder="توضیحات اجرایی گام..."
                          />
                        </>
                      ) : (
                        <>
                          <div className="font-semibold text-xs text-slate-200">{step.title}</div>
                          <div className="text-xs text-slate-400 leading-relaxed">{step.description}</div>
                        </>
                      )}
                    </div>

                    {isEditing && !isLocked && (
                      <button
                        onClick={() => handleRemoveStep(idx)}
                        className="text-slate-500 hover:text-rose-400 p-1 rounded"
                        title="حذف گام"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Rejection input box */}
        {showRejectInput && (
          <div className="p-4 bg-rose-950/40 border-t border-rose-500/30 flex flex-col gap-2 animate-fade-in">
            <span className="text-xs font-semibold text-rose-300">
              دلیل رد مشخصات را وارد نمایید (در لاگ ممیزی امنیتی ثبت می‌شود):
            </span>
            <div className="flex gap-2">
              <input
                type="text"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="مثال: نیازمندی‌های امنیتی رعایت نشده یا مغایر با معماری جاری است..."
                className="flex-1 px-3 py-1.5 text-xs bg-slate-950 border border-rose-500/40 rounded-lg text-slate-200 focus:outline-none focus:border-rose-400"
              />
              <button
                onClick={handleReject}
                disabled={rejecting}
                className="px-4 py-1.5 text-xs font-bold rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition-all disabled:opacity-50"
              >
                {rejecting ? "در حال ثبت رد..." : "تأیید رد مشخصات"}
              </button>
              <button
                onClick={() => setShowRejectInput(false)}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-700 bg-slate-800 text-slate-300"
              >
                انصراف
              </button>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-slate-950/80 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
          {/* Execution settings (if not locked) */}
          {!isLocked ? (
            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">نقش ایجنت:</span>
                <select
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value as AgentRole)}
                  className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="general">عمومی (General)</option>
                  <option value="coder">برنامه‌نویس (Coder)</option>
                  <option value="architect">معمار سیستم (Architect)</option>
                  <option value="tester">تستر کیفی (Tester)</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-slate-400">حالت اجرا:</span>
                <select
                  value={selectedMode}
                  onChange={(e) => setSelectedMode(e.target.value as AgentMode)}
                  className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="single">تک ایجنت (Single Agent)</option>
                  <option value="swarm">همکاری گروهی (Multi-Agent Swarm)</option>
                </select>
              </div>

              <label className="flex items-center gap-1 text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={debugMode}
                  onChange={(e) => setDebugMode(e.target.checked)}
                  className="rounded bg-slate-900 border-slate-700 text-emerald-500 focus:ring-0"
                />
                <span>توقف دیباگ در گام ۱</span>
              </label>
            </div>
          ) : (
            <div className="text-xs text-slate-400">
              {spec.status === "executed" && (
                <span>ایجنت با شناسه ران <code className="text-emerald-400 font-mono">{spec.run_id}</code> متصل به این سند است.</span>
              )}
              {spec.status === "rejected" && (
                <span className="text-rose-300">علت رد: {spec.rejection_reason}</span>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {isEditing && !isLocked && (
              <button
                onClick={handleSaveEdits}
                disabled={saving}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition-all disabled:opacity-50"
              >
                {saving ? "در حال ذخیره..." : "ذخیره پیش‌نویس"}
              </button>
            )}

            {!isLocked && !showRejectInput && (
              <button
                onClick={() => setShowRejectInput(true)}
                className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-rose-500/40 text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 transition-all"
              >
                رد سند مشخصات
              </button>
            )}

            {!isLocked && (
              <button
                onClick={handleApproveAndExecute}
                disabled={executing}
                className="px-5 py-2 text-xs font-bold rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {executing ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <span>در حال راه‌اندازی Task Engine...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                    </svg>
                    <span>تأیید نهایی و اجرای وظیفه</span>
                  </>
                )}
              </button>
            )}

            {isLocked && (
              <button
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 transition-all"
              >
                بستن
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

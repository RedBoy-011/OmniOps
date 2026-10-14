import { useState, useEffect, useRef } from "react";
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
  type FilePatchRecord,
  type ProjectSearchResult,
  type CommandHistoryRecord,
  type GitStatusResult,
  type ProjectArtifact,
  type TaskPreset,
  type WorkspaceSpec,
  type ProjectSteering,
  type ProjectSteeringResponse,
  TASK_PRESETS,
} from "../api";
import { SpecReviewModal } from "./SpecReviewModal";

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

  // Patch history and rollback state
  const [patches, setPatches] = useState<FilePatchRecord[]>([]);
  const [loadingPatches, setLoadingPatches] = useState(false);
  const [selectedPatchForDiff, setSelectedPatchForDiff] = useState<FilePatchRecord | null>(null);
  const [rollingBackPatchId, setRollingBackPatchId] = useState<string | null>(null);

  // Project Search & Grep state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchExtensions, setSearchExtensions] = useState("");
  const [searchResults, setSearchResults] = useState<ProjectSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);

  // Command History state
  const [commandHistory, setCommandHistory] = useState<CommandHistoryRecord[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // Steer active run state
  const [steerInput, setSteerInput] = useState("");
  const [steeringRun, setSteeringRun] = useState(false);

  // Git Status state
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null);
  const [loadingGit, setLoadingGit] = useState(false);
  const [showGitModal, setShowGitModal] = useState(false);

  // Project Artifacts state
  const [artifacts, setArtifacts] = useState<ProjectArtifact[]>([]);
  const [loadingArtifacts, setLoadingArtifacts] = useState(false);
  const [showArtifactsModal, setShowArtifactsModal] = useState(false);
  const [viewingArtifact, setViewingArtifact] = useState<ProjectArtifact | null>(null);
  const [deletingArtifactId, setDeletingArtifactId] = useState<string | null>(null);
  const [copiedArtifactId, setCopiedArtifactId] = useState<string | null>(null);

  // Spec-Driven Development state
  const [specs, setSpecs] = useState<WorkspaceSpec[]>([]);
  const [selectedSpec, setSelectedSpec] = useState<WorkspaceSpec | null>(null);
  const [showSpecModal, setShowSpecModal] = useState(false);
  const [showSpecsListModal, setShowSpecsListModal] = useState(false);
  const [generatingSpec, setGeneratingSpec] = useState(false);

  // Project Steering Files state
  const [steeringData, setSteeringData] = useState<ProjectSteeringResponse | null>(null);
  const [loadingSteering, setLoadingSteering] = useState(false);
  const [savingSteering, setSavingSteering] = useState(false);
  const [showSteeringModal, setShowSteeringModal] = useState(false);
  const [steeringRulesText, setSteeringRulesText] = useState("");
  const [steeringToolsText, setSteeringToolsText] = useState("");
  const [steeringRawYaml, setSteeringRawYaml] = useState("");
  const [steeringEditorTab, setSteeringEditorTab] = useState<"visual" | "yaml">("visual");

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

  // Debugger state
  const [debugMode, setDebugMode] = useState(false);
  const [steppingRun, setSteppingRun] = useState(false);
  const [showStepModify, setShowStepModify] = useState(false);
  const [stepEditCmd, setStepEditCmd] = useState("");
  const [stepEditPrompt, setStepEditPrompt] = useState("");

  // Live Terminal Streaming state
  const [showStreamModal, setShowStreamModal] = useState(false);
  const [streamCommandInput, setStreamCommandInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingLines, setStreamingLines] = useState<string[]>([]);
  const [streamExitCode, setStreamExitCode] = useState<number | null>(null);
  const [streamDurationMs, setStreamDurationMs] = useState<number | null>(null);
  const terminalOutputRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (terminalOutputRef.current) {
      terminalOutputRef.current.scrollTop = terminalOutputRef.current.scrollHeight;
    }
  }, [streamingLines]);

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
    void loadProjectPatches(selectedProjectId);
    void loadCommandHistory(selectedProjectId);
    void loadGitStatus(selectedProjectId);
    void loadArtifacts(selectedProjectId);
    void loadSpecs(selectedProjectId);
    void loadProjectSteering(selectedProjectId);
  }, [selectedProjectId, projects]);

  async function loadGitStatus(projectId: string) {
    if (!projectId) return;
    try {
      setLoadingGit(true);
      const res = await api.getProjectGitStatus(projectId);
      setGitStatus(res);
    } catch {
      setGitStatus(null);
    } finally {
      setLoadingGit(false);
    }
  }

  async function loadArtifacts(projectId: string) {
    if (!projectId) return;
    try {
      setLoadingArtifacts(true);
      const res = await api.listProjectArtifacts(projectId);
      setArtifacts(res.artifacts || []);
    } catch {
      // ignore
    } finally {
      setLoadingArtifacts(false);
    }
  }

  async function handleDeleteArtifact(artifactId: string) {
    if (!selectedProjectId || !artifactId) return;
    if (!window.confirm("آیا از حذف این سند اطمینان دارید؟")) return;
    try {
      setDeletingArtifactId(artifactId);
      await api.deleteProjectArtifact(selectedProjectId, artifactId);
      setArtifacts((prev) => prev.filter((a) => a.id !== artifactId));
      if (viewingArtifact?.id === artifactId) {
        setViewingArtifact(null);
      }
      setSuccessMsg("سند فرآورده با موفقیت حذف شد.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در حذف سند");
    } finally {
      setDeletingArtifactId(null);
    }
  }

  function handleSelectPreset(preset: TaskPreset) {
    setSelectedRole(preset.role);
    setSelectedMode(preset.mode);
    setAgentTaskPrompt(preset.prompt);
    setSuccessMsg(`الگوی «${preset.title}» با نقش ${preset.role} و حالت ${preset.mode} اعمال شد.`);
  }

  function handleCopyArtifact(art: ProjectArtifact) {
    navigator.clipboard.writeText(art.content);
    setCopiedArtifactId(art.id);
    setTimeout(() => setCopiedArtifactId(null), 2000);
  }

  function handleDownloadArtifact(art: ProjectArtifact) {
    const blob = new Blob([art.content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${art.title.replace(/[\\/:*?"<>|]/g, "_")}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function loadSpecs(projectId: string) {
    if (!projectId) return;
    try {
      const res = await api.listSpecs(projectId);
      setSpecs(res.specs || []);
    } catch {
      // ignore
    }
  }

  async function loadProjectSteering(projectId: string) {
    if (!projectId) return;
    try {
      setLoadingSteering(true);
      const res = await api.getProjectSteering(projectId);
      setSteeringData(res);
      const rules = res.steering?.project_rules || [];
      const tools = res.steering?.guidelines?.allowed_tools || [];
      setSteeringRulesText(rules.join("\n"));
      setSteeringToolsText(tools.join(", "));
      setSteeringRawYaml(res.raw_yaml || "");
    } catch {
      setSteeringData(null);
    } finally {
      setLoadingSteering(false);
    }
  }

  async function handleSaveSteering() {
    if (!selectedProjectId) return;
    try {
      setSavingSteering(true);
      setError("");
      const rules = steeringRulesText
        .split("\n")
        .map((r) => r.trim())
        .filter(Boolean);
      const tools = steeringToolsText
        .split(/[,\n]/)
        .map((t) => t.trim())
        .filter(Boolean);

      const payload: ProjectSteering = {
        version: steeringData?.steering?.version || "1.0",
        project_name: steeringData?.steering?.project_name,
        project_rules: rules,
        guidelines: {
          ...(steeringData?.steering?.guidelines || {}),
          allowed_tools: tools,
        },
      };

      const res = await api.saveProjectSteering(selectedProjectId, payload);
      setSteeringData(res);
      setSteeringRawYaml(res.raw_yaml);
      setSuccessMsg("قوانین هدایت پروژه (.omniops/steering.yaml) با موفقیت ذخیره شد.");
      setShowSteeringModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در ذخیره قوانین هدایت پروژه");
    } finally {
      setSavingSteering(false);
    }
  }

  async function handleCreateSpec(promptText?: string) {
    const targetPrompt = (promptText || agentTaskPrompt).trim();
    if (!selectedProjectId || !targetPrompt) return;
    setGeneratingSpec(true);
    setError("");
    try {
      const res = await api.createSpec({
        project_id: selectedProjectId,
        prompt: targetPrompt,
        auto_generate: true,
      });
      setSelectedSpec(res.spec);
      setShowSpecModal(true);
      await loadSpecs(selectedProjectId);
    } catch (err: any) {
      setError(err?.message || "خطا در تولید سند مشخصات.");
    } finally {
      setGeneratingSpec(false);
    }
  }

  async function loadCommandHistory(projectId: string) {
    if (!projectId) return;
    try {
      setLoadingHistory(true);
      const res = await api.listProjectCommands(projectId, 50);
      setCommandHistory(res.commands || []);
    } catch {
      // ignore
    } finally {
      setLoadingHistory(false);
    }
  }

  async function handleSearch(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!selectedProjectId || !searchQuery.trim()) return;
    try {
      setSearching(true);
      setError("");
      const extList = searchExtensions
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const res = await api.searchProjectFiles({
        project_id: selectedProjectId,
        query: searchQuery.trim(),
        case_sensitive: searchCaseSensitive,
        file_extensions: extList.length ? extList : undefined,
      });
      setSearchResults(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در جستجوی فایل‌ها");
    } finally {
      setSearching(false);
    }
  }

  async function handleSendSteer(e: React.FormEvent) {
    e.preventDefault();
    if (!activeRun || !steerInput.trim()) return;
    try {
      setSteeringRun(true);
      setError("");
      const res = await api.sendAgentRunFeedback(activeRun.id, steerInput.trim());
      setActiveRun(res.run);
      setSteerInput("");
      setSuccessMsg("دستور هدایت تکمیلی با موفقیت به ایجنت ابلاغ شد.");
      await loadAgentRuns(selectedProjectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در ارسال هدایت به ایجنت");
    } finally {
      setSteeringRun(false);
    }
  }

  async function loadProjectPatches(projectId: string) {
    if (!projectId) return;
    try {
      setLoadingPatches(true);
      const res = await api.listProjectPatches(projectId);
      setPatches(res.patches || []);
    } catch {
      // ignore
    } finally {
      setLoadingPatches(false);
    }
  }

  async function handleRollbackPatch(patchId: string) {
    if (!selectedProjectId) return;
    setRollingBackPatchId(patchId);
    setError("");
    setSuccessMsg("");
    try {
      const res = await api.rollbackProjectPatch(patchId);
      setSuccessMsg(`وصله فایل «${res.patch.path}» با موفقیت بازگردانی (Rollback) شد.`);
      await loadProjectPatches(selectedProjectId);
      const filesRes = await api.listProjectFiles(selectedProjectId);
      setFiles(filesRes.entries || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "بازگردانی وصله با خطا مواجه شد.");
    } finally {
      setRollingBackPatchId(null);
    }
  }

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
      const res = await api.startAgentRun(selectedProjectId, agentTaskPrompt.trim(), selectedRole, selectedMode, debugMode);
      setActiveRun(res.run);
      setAgentTaskPrompt("");
      setSuccessMsg(
        debugMode
          ? "🐞 چرخه وظیفه در حالت دیباگ گام‌به‌گام آغاز شد و در نقطه بازرسی متوقف گردید."
          : selectedMode === "swarm"
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

  async function handleToggleDebug(enabled: boolean) {
    if (!activeRun) return;
    try {
      const res = await api.toggleAgentRunDebug(activeRun.id, enabled);
      setActiveRun(res.run);
      await loadAgentRuns(selectedProjectId);
      setSuccessMsg(enabled ? "حالت دیباگ برای این تسک فعال شد." : "حالت دیباگ برای این تسک غیرفعال شد.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در تغییر وضعیت دیباگ");
    }
  }

  async function handleStepRun(action: "step" | "skip" | "modify" | "continue") {
    if (!activeRun) return;
    setSteppingRun(true);
    setError("");
    try {
      const res = await api.stepAgentRun(
        activeRun.id,
        action,
        action === "modify" ? stepEditCmd.trim() : undefined,
        action === "modify" ? stepEditPrompt.trim() : undefined
      );
      setActiveRun(res.run);
      setShowStepModify(false);
      await loadAgentRuns(selectedProjectId);
      if (action === "step") setSuccessMsg("گام با موفقیت اجرا شد و در گام بعدی متوقف شد.");
      else if (action === "skip") setSuccessMsg("گام با موفقیت رد شد (Skip).");
      else if (action === "modify") setSuccessMsg("گام با دستور اصلاح‌شده اجرا شد.");
      else if (action === "continue") setSuccessMsg("ادامه اجرای خودکار تا پایان تسک فعال شد.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در اجرای گام دیباگ");
    } finally {
      setSteppingRun(false);
    }
  }

  async function handleStartStreamingCommand(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProjectId || !streamCommandInput.trim() || isStreaming) return;
    setIsStreaming(true);
    setStreamExitCode(null);
    setStreamDurationMs(null);
    setStreamingLines([`$ ${streamCommandInput.trim()}`]);
    setError("");
    try {
      const res = await api.startStreamingCommand(selectedProjectId, streamCommandInput.trim());
      await api.listenCommandStream(
        res.id,
        (event) => {
          if (event.type === "stdout" && event.text) {
            setStreamingLines((prev) => [...prev, event.text!]);
          } else if (event.type === "stderr" && event.text) {
            setStreamingLines((prev) => [...prev, `[stderr] ${event.text}`]);
          } else if (event.type === "done") {
            setStreamExitCode(event.exit_code ?? 0);
            setStreamDurationMs(event.duration_ms ?? 0);
          }
        },
        (streamErr) => {
          setStreamingLines((prev) => [...prev, `[ERROR] ${streamErr}`]);
          setError(streamErr);
          setIsStreaming(false);
        },
        (exitCode, durationMs) => {
          setStreamExitCode(exitCode);
          setStreamDurationMs(durationMs);
          setIsStreaming(false);
          void loadCommandHistory(selectedProjectId);
        }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطا در شروع استریم ترمینال");
      setIsStreaming(false);
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
      void loadProjectPatches(selectedProjectId);
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
      void loadCommandHistory(selectedProjectId);
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
            {gitStatus?.is_git_repo && (
              <button
                type="button"
                className="meta-badge git-badge clickable"
                onClick={() => setShowGitModal(true)}
                title="مشاهده شاخه، کامیت‌ها و تغییرات محلی گیت"
              >
                🌿 شاخه: <strong>{gitStatus.branch || "main"}</strong>
                <span className={`git-clean-tag ${gitStatus.clean ? "clean" : "dirty"}`}>
                  {gitStatus.clean ? "✓ تمیز" : `⚠️ ${(gitStatus.unstaged?.length || 0) + (gitStatus.staged?.length || 0) + (gitStatus.untracked?.length || 0)} تغییر`}
                </span>
              </button>
            )}
            <button
              type="button"
              className="meta-badge artifacts-badge clickable"
              onClick={() => setShowArtifactsModal(true)}
              title="مشاهده اسناد، طرح‌های معماری و گزارش‌های ایجنت"
            >
              📑 اسناد و طرح‌ها: <strong>{artifacts.length} سند</strong>
            </button>
            <button
              type="button"
              className="meta-badge specs-badge clickable"
              onClick={() => setShowSpecsListModal(true)}
              title="مشاهده اسناد مشخصات و مراحل اجرایی (Spec-Driven)"
            >
              📋 مشخصات (Spec): <strong>{specs.length} سند</strong>
            </button>
            <button
              type="button"
              className="meta-badge steering-badge clickable"
              onClick={() => {
                void loadProjectSteering(selectedProjectId);
                setShowSteeringModal(true);
              }}
              title="مشاهده و ویرایش قوانین هدایت پروژه (Steering Rules)"
            >
              🧭 قوانین پروژه: <strong>{steeringData?.steering?.project_rules?.length ?? 0} قانون</strong>
            </button>
          </div>

          {/* اکشن بار هوشمند برای بارگذاری در چت و دسترسی سریع */}
          <div className="agentic-context-actions-row">
            <button
              type="button"
              className="action-button primary-accent"
              onClick={handleSendContextToChat}
            >
              🚀 بارگذاری کانتکست و تسک‌های پروژه در چت هوش مصنوعی
            </button>
            {gitStatus?.is_git_repo && (
              <button
                type="button"
                className="action-button git-action-btn"
                onClick={() => setShowGitModal(true)}
              >
                🌿 کنترل وضعیت گیت
              </button>
            )}
            <button
              type="button"
              className="action-button artifacts-action-btn"
              onClick={() => setShowArtifactsModal(true)}
            >
              📑 گالری اسناد پروژه ({artifacts.length})
            </button>
            <button
              type="button"
              className="action-button spec-action-btn"
              onClick={() => setShowSpecsListModal(true)}
              title="مشاهده، بازبینی و مدیریت اسناد مشخصات و مراحل اجرایی (Spec-Driven)"
            >
              📋 اسناد مشخصات ({specs.length})
            </button>
            <button
              type="button"
              className="action-button steering-action-btn"
              onClick={() => {
                void loadProjectSteering(selectedProjectId);
                setShowSteeringModal(true);
              }}
              title="مشاهده، تنظیم و ویرایش قوانین راهبردی ایجنت (.omniops/steering.yaml)"
            >
              🧭 قوانین هدایت (Steering)
            </button>
            <button
              type="button"
              className="action-button stream-terminal-action-btn"
              onClick={() => setShowStreamModal(true)}
              title="اجرای مستقیم و مشاهده خط‌به‌خط خروجی دستورات به صورت جریانی (SSE)"
            >
              ⚡ استریم زنده ترمینال
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
                    activeRun.status === "paused_debug" ? "⏸️ متوقف در دیباگ (Paused Debug)" :
                    activeRun.status === "completed" ? "✅ پایان یافته" :
                    activeRun.status === "cancelled" ? "⛔ لغوشده" : activeRun.status
                  }
                </div>
              )}
            </div>

            {/* فرم ورود تسک یا هدف */}
            <form onSubmit={handleStartAgentRun} className="agent-task-input-box">
              {/* نوار الگوهای مأموریت آماده (Task Presets) */}
              <div className="agent-presets-selector-row">
                <span className="presets-label">⚡ الگوهای سریع مأموریت:</span>
                <div className="presets-chips-container">
                  {TASK_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="preset-chip-btn"
                      onClick={() => handleSelectPreset(p)}
                      title={p.description}
                    >
                      <span className="preset-icon">{p.icon}</span>
                      <span className="preset-title">{p.title}</span>
                    </button>
                  ))}
                </div>
              </div>

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
                <button
                  type="button"
                  className={`mode-pill-btn debug-mode ${debugMode ? "active" : ""}`}
                  onClick={() => setDebugMode(!debugMode)}
                  title="توقف در هر گام و امکان بازرسی، ویرایش دستور و رد کردن گام‌ها (Step Debugger)"
                >
                  🐞 حالت دیباگ گام‌به‌گام {debugMode ? "(فعال)" : "(غیرفعال)"}
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
                  type="button"
                  className="action-button spec-gate-btn"
                  onClick={() => handleCreateSpec()}
                  disabled={startingRun || generatingSpec || !agentTaskPrompt.trim()}
                  title="تولید خودکار سند مشخصات (Spec) با ۳ بخش نیازمندی‌ها، معماری و مراحل اجرایی قبل از شروع مأموریت"
                >
                  {generatingSpec ? "⏳ تولید سند..." : "📋 بازبینی مشخصات (Spec Gate)"}
                </button>
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

                {/* پنل دیباگر تعاملی گام‌به‌گام (Interactive Step Debugger) */}
                {(activeRun.debug_mode || activeRun.status === "paused_debug") && (
                  <div className="agent-debug-inspector-panel">
                    <div className="debug-inspector-header">
                      <div className="debug-badge">
                        <span>🐞 دیباگر گام‌به‌گام هوشمند (Interactive Step Debugger)</span>
                        <span className={`debug-status-indicator ${activeRun.status === "paused_debug" ? "paused" : "running"}`}>
                          {activeRun.status === "paused_debug" ? "⏸️ متوقف در نقطه بازرسی (Paused at Breakpoint)" : "▶️ در حال پردازش..."}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="quiet-button toggle-debug-btn"
                        onClick={() => void handleToggleDebug(!activeRun.debug_mode)}
                        title="تغییر وضعیت دیباگ تسک جاری"
                      >
                        {activeRun.debug_mode ? "غیرفعال‌سازی دیباگ" : "فعال‌سازی دیباگ"}
                      </button>
                    </div>

                    {activeRun.status === "paused_debug" && (
                      <div className="debug-step-details">
                        <div className="current-step-badge">
                          🎯 گام جاری آماده بازرسی: <strong>گام {activeRun.current_step_index + 1} از {activeRun.plan_steps.length}: {activeRun.plan_steps[activeRun.current_step_index]?.title}</strong>
                        </div>
                        <p className="current-step-summary">{activeRun.plan_steps[activeRun.current_step_index]?.summary}</p>
                        {activeRun.plan_steps[activeRun.current_step_index]?.command && (
                          <div className="current-step-cmd">
                            <span>دستور اجرایی تعیین‌شده:</span>
                            <code dir="ltr">$ {activeRun.plan_steps[activeRun.current_step_index]?.command}</code>
                          </div>
                        )}

                        {showStepModify ? (
                          <div className="debug-modify-box">
                            <label>ویرایش دستور گام قبل از اجرا:</label>
                            <input
                              type="text"
                              dir="ltr"
                              className="debug-modify-input"
                              value={stepEditCmd}
                              onChange={(e) => setStepEditCmd(e.target.value)}
                              placeholder="دستور سفارشی..."
                            />
                            <label>ویرایش پرامپت ایجنت برای این گام:</label>
                            <input
                              type="text"
                              className="debug-modify-input"
                              value={stepEditPrompt}
                              onChange={(e) => setStepEditPrompt(e.target.value)}
                              placeholder="پرامپت اصلاح‌شده..."
                            />
                            <div className="debug-modify-actions">
                              <button
                                type="button"
                                className="action-button confirm-btn"
                                onClick={() => void handleStepRun("modify")}
                                disabled={steppingRun}
                              >
                                {steppingRun ? "⏳ در حال اجرا..." : "✅ اعمال تغییر و اجرای این گام"}
                              </button>
                              <button
                                type="button"
                                className="quiet-button"
                                onClick={() => setShowStepModify(false)}
                              >
                                انصراف
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="debug-actions-toolbar">
                            <button
                              type="button"
                              className="action-button step-btn"
                              onClick={() => void handleStepRun("step")}
                              disabled={steppingRun}
                              title="اجرای دقیق همین یک گام و توقف در گام بعدی"
                            >
                              {steppingRun ? "⏳ در حال اجرا..." : "⏭️ اجرای این گام (Step Over)"}
                            </button>
                            <button
                              type="button"
                              className="action-button skip-btn"
                              onClick={() => void handleStepRun("skip")}
                              disabled={steppingRun}
                              title="رد کردن این گام بدون اجرا و رفتن به گام بعد"
                            >
                              ⏩ پرش از این گام (Skip Step)
                            </button>
                            <button
                              type="button"
                              className="action-button modify-btn"
                              onClick={() => {
                                setStepEditCmd(activeRun.plan_steps[activeRun.current_step_index]?.command || "");
                                setStepEditPrompt(activeRun.plan_steps[activeRun.current_step_index]?.title || "");
                                setShowStepModify(true);
                              }}
                              title="ویرایش دستور یا پرامپت قبل از اجرا"
                            >
                              ✏️ ویرایش دستور و اجرا (Modify & Run)
                            </button>
                            <button
                              type="button"
                              className="action-button continue-btn"
                              onClick={() => void handleStepRun("continue")}
                              disabled={steppingRun}
                              title="ادامه اجرای بقیه گام‌ها بدون توقف"
                            >
                              🚀 ادامه تا انتها (Continue)
                            </button>
                          </div>
                        )}
                      </div>
                    )}
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

                {/* هدایت تعاملی حین اجرای ایجنت (Agent Steerability & Guidance) */}
                {(activeRun.status === "in_progress" || activeRun.status === "waiting_approval" || activeRun.status === "paused_debug") && (
                  <form onSubmit={handleSendSteer} className="agent-steer-form">
                    <div className="steer-input-row">
                      <span className="steer-icon">🎯</span>
                      <input
                        type="text"
                        placeholder="💬 هدایت تعاملی ایجنت (مثلاً: تست‌ها را با فلگ -v اجرا کن، یا وابستگی axios را جایگزین کن)..."
                        value={steerInput}
                        onChange={(e) => setSteerInput(e.target.value)}
                        disabled={steeringRun}
                      />
                      <button
                        type="submit"
                        className="action-button steer-btn"
                        disabled={steeringRun || !steerInput.trim()}
                        title="ارسال دستور تکمیلی به لاگ و روند کار ایجنت"
                      >
                        {steeringRun ? "⏳ در حال ارسال..." : "🚀 ارسال هدایت"}
                      </button>
                    </div>
                  </form>
                )}

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
              <div className="header-title-group">
                <strong>🗂️ کاوشگر فایل‌های پروژه:</strong>
                <small>{loadingFile ? "⏳ در حال خواندن محتوای فایل..." : "کلیک روی هر فایل برای مشاهده محتوا"}</small>
              </div>
              <button
                type="button"
                className="quiet-button search-open-btn"
                onClick={() => setShowSearchModal(true)}
              >
                🔍 جستجوی کد در پروژه (Grep)
              </button>
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
              <div className="header-title-group">
                <strong>⚡ اجرای دستور در محیط پروژه (Workspace Terminal Runner):</strong>
                <span className="safety-badge">🛡️ ساندباکس در پوشه محلی</span>
              </div>
              <button
                type="button"
                className="quiet-button history-btn"
                onClick={() => {
                  void loadCommandHistory(selectedProjectId);
                  setShowHistoryModal(true);
                }}
              >
                📜 تاریخچه فرامین ({commandHistory.length})
              </button>
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

          {/* بخش تاریخچه پچ‌ها و بازگردانی سریع (Patch History & Rollback) */}
          <div className="agentic-patch-history-section">
            <div className="runner-header">
              <div className="header-title-group">
                <strong>📜 تاریخچه پچ‌های اعمال‌شده بر پروژه (Patch History & Rollback):</strong>
                <span className="count-badge">{patches.length} وصله</span>
              </div>
              <button
                type="button"
                className="quiet-button"
                onClick={() => selectedProjectId && void loadProjectPatches(selectedProjectId)}
                disabled={loadingPatches}
              >
                {loadingPatches ? "⏳ در حال بروزرسانی..." : "🔄 بازخوانی تاریخچه"}
              </button>
            </div>

            {patches.length === 0 ? (
              <p className="no-perm-hint">هنوز هیچ پچی روی فایل‌های این پروژه اعمال نشده است.</p>
            ) : (
              <div className="patch-history-list">
                {patches.map((p) => (
                  <div key={p.id} className={`patch-history-item ${p.status}`}>
                    <div className="patch-info">
                      <div className="patch-title-row">
                        <span className="file-path" dir="ltr">📄 {p.path}</span>
                        <span className={`patch-status-badge ${p.status}`}>
                          {p.status === "applied" ? "✅ اعمال‌شده روی فایل" : "↩️ بازگردانی‌شده (Reverted)"}
                        </span>
                      </div>
                      <div className="patch-meta-row">
                        <span className="patch-stats">
                          <span className="additions">+{p.additions}</span> / <span className="deletions">-{p.deletions}</span> سطر
                        </span>
                        <span>توسط: <strong>{p.applied_by_username || "کاربر"}</strong></span>
                        <span>زمان ثبت: {new Date(p.created_at * 1000).toLocaleString("fa-IR")}</span>
                        {p.reverted_at && (
                          <span className="reverted-time">· بازگردانی در: {new Date(p.reverted_at * 1000).toLocaleString("fa-IR")}</span>
                        )}
                      </div>
                    </div>
                    <div className="patch-item-actions">
                      <button
                        type="button"
                        className="quiet-button"
                        onClick={() => setSelectedPatchForDiff(p)}
                        title="مشاهده تفاوت‌های خط‌به‌خط"
                      >
                        👁️ مشاهده Diff
                      </button>
                      {p.status === "applied" && (
                        <button
                          type="button"
                          className="action-button rollback-btn"
                          disabled={rollingBackPatchId === p.id}
                          onClick={() => void handleRollbackPatch(p.id)}
                          title="بازگردانی فایل به محتوای قبل از اعمال پچ"
                        >
                          {rollingBackPatchId === p.id ? "⏳ در حال بازگردانی..." : "↩️ بازگردانی ۱-کلیک (Rollback)"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* مدال بازبینی اختلاف پچ تاریخچه */}
          {selectedPatchForDiff && (
            <div className="agent-modal-overlay">
              <div className="agent-modal-card patch-diff-modal">
                <div className="modal-header">
                  <h3>🔍 بازبینی پچ: <code dir="ltr">{selectedPatchForDiff.path}</code></h3>
                  <button type="button" className="close-btn" onClick={() => setSelectedPatchForDiff(null)}>✕</button>
                </div>
                <div className="modal-body">
                  <div className="diff-meta-bar">
                    <span>وضعیت: <strong>{selectedPatchForDiff.status === "applied" ? "اعمال‌شده" : "بازگردانی‌شده"}</strong></span>
                    <span className="additions">+{selectedPatchForDiff.additions} سطر اضافه</span>
                    <span className="deletions">-{selectedPatchForDiff.deletions} سطر حذف</span>
                  </div>
                  <pre className="diff-content" dir="ltr">
                    {selectedPatchForDiff.diff_text || "بدون اختلاف."}
                  </pre>
                </div>
                <div className="modal-footer">
                  {selectedPatchForDiff.status === "applied" && (
                    <button
                      type="button"
                      className="action-button rollback-btn"
                      disabled={rollingBackPatchId === selectedPatchForDiff.id}
                      onClick={async () => {
                        await handleRollbackPatch(selectedPatchForDiff.id);
                        setSelectedPatchForDiff(null);
                      }}
                    >
                      ↩️ بازگردانی این وصله
                    </button>
                  )}
                  <button type="button" className="quiet-button" onClick={() => setSelectedPatchForDiff(null)}>
                    بستن
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* مدال جستجوی کد و Grep در پروژه */}
          {showSearchModal && (
            <div className="agent-modal-overlay" onClick={() => setShowSearchModal(false)}>
              <div className="agent-modal-card search-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>🔍 جستجوی محتوا و Grep در کدهای پروژه</h3>
                  <button type="button" className="close-btn" onClick={() => setShowSearchModal(false)}>✕</button>
                </div>
                <div className="modal-body">
                  <form onSubmit={handleSearch} className="search-form-row">
                    <div className="search-input-wrap">
                      <input
                        type="text"
                        placeholder="عبارت، تابع، کامپوننت، یا متغیر مورد نظر برای جستجو..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="search-options-row">
                      <input
                        type="text"
                        placeholder="پسوندها (مثلاً: js, ts, py, json)..."
                        value={searchExtensions}
                        onChange={(e) => setSearchExtensions(e.target.value)}
                        className="ext-input"
                        dir="ltr"
                      />
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={searchCaseSensitive}
                          onChange={(e) => setSearchCaseSensitive(e.target.checked)}
                        />
                        <span>حساس به حروف بزرگ و کوچک</span>
                      </label>
                      <button
                        type="submit"
                        className="action-button primary-accent"
                        disabled={searching || !searchQuery.trim()}
                      >
                        {searching ? "⏳ در حال جستجو..." : "🔎 جستجو"}
                      </button>
                    </div>
                  </form>

                  {searchResults && (
                    <div className="search-results-section">
                      <div className="search-results-header">
                        <span>یافته‌ها برای «<strong>{searchResults.query}</strong>»:</span>
                        <span className="results-count-badge">{searchResults.total_matches} مورد در {searchResults.results.length} فایل</span>
                      </div>

                      {searchResults.results.length === 0 ? (
                        <p className="no-matches-hint">هیچ موردی مطابق با عبارت جستجو یافت نشد.</p>
                      ) : (
                        <div className="search-results-list">
                          {searchResults.results.map((fileRes) => (
                            <div key={fileRes.path} className="search-file-group">
                              <div
                                className="search-file-title"
                                onClick={() => {
                                  setShowSearchModal(false);
                                  void handleReadFile(fileRes.path);
                                }}
                                title="کلیک برای باز کردن فایل"
                              >
                                <span className="file-icon">📄</span>
                                <code dir="ltr">{fileRes.path}</code>
                                <span className="matches-pill">{fileRes.matches.length} تطابق</span>
                              </div>
                              <div className="search-matches-list">
                                {fileRes.matches.map((m, mIdx) => (
                                  <div
                                    key={mIdx}
                                    className="search-match-line"
                                    onClick={() => {
                                      setShowSearchModal(false);
                                      void handleReadFile(fileRes.path);
                                    }}
                                  >
                                    <span className="line-num">{m.line_number}:</span>
                                    <pre className="line-code" dir="ltr">{m.line_text}</pre>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="modal-footer">
                  <button type="button" className="quiet-button" onClick={() => setShowSearchModal(false)}>
                    بستن
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* مدال تاریخچه فرامین ترمینال پروژه */}
          {showHistoryModal && (
            <div className="agent-modal-overlay" onClick={() => setShowHistoryModal(false)}>
              <div className="agent-modal-card history-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>📜 تاریخچه اجرای فرامین ترمینال پروژه</h3>
                  <button type="button" className="close-btn" onClick={() => setShowHistoryModal(false)}>✕</button>
                </div>
                <div className="modal-body">
                  <div className="history-modal-meta">
                    <span>مجموع فرامین ثبت‌شده: <strong>{commandHistory.length}</strong></span>
                    <button
                      type="button"
                      className="quiet-button"
                      onClick={() => selectedProjectId && void loadCommandHistory(selectedProjectId)}
                      disabled={loadingHistory}
                    >
                      {loadingHistory ? "⏳..." : "🔄 بازخوانی"}
                    </button>
                  </div>

                  {commandHistory.length === 0 ? (
                    <p className="no-matches-hint">هنوز هیچ فرمانی روی این پروژه اجرا نشده است.</p>
                  ) : (
                    <div className="command-history-list">
                      {commandHistory.map((cmd) => (
                        <div key={cmd.id} className={`command-history-item exit-${cmd.exit_code === 0 ? "success" : "fail"}`}>
                          <div className="cmd-item-header">
                            <code className="cmd-text" dir="ltr">{cmd.command}</code>
                            <div className="cmd-badges">
                              <span className={`cmd-exit-badge ${cmd.exit_code === 0 ? "success" : "fail"}`}>
                                {cmd.exit_code === 0 ? "✅ کد ۰ (موفق)" : `❌ کد ${cmd.exit_code}`}
                              </span>
                              <span className="cmd-duration">{cmd.duration_ms}ms</span>
                            </div>
                          </div>
                          <div className="cmd-item-meta">
                            <span>مجری: <strong>{cmd.executed_by_username || "کاربر"}</strong></span>
                            <span>زمان: {new Date(cmd.created_at * 1000).toLocaleString("fa-IR")}</span>
                            <button
                              type="button"
                              className="quiet-button reuse-cmd-btn"
                              onClick={() => {
                                setCommandInput(cmd.command);
                                setShowHistoryModal(false);
                              }}
                              title="قرار دادن این دستور در کادر ورودی ترمینال"
                            >
                              ↩️ استفاده مجدد
                            </button>
                          </div>
                          {(cmd.stdout || cmd.stderr) && (
                            <details className="cmd-output-details">
                              <summary>مشاهده خروجی دستور</summary>
                              {cmd.stdout && <pre className="cmd-stdout" dir="ltr">{cmd.stdout}</pre>}
                              {cmd.stderr && <pre className="cmd-stderr" dir="ltr">{cmd.stderr}</pre>}
                            </details>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="modal-footer">
                  <button type="button" className="quiet-button" onClick={() => setShowHistoryModal(false)}>
                    بستن
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* مدال کنترل وضعیت و شاخه‌های گیت پروژه */}
          {showGitModal && (
            <div className="agent-modal-overlay" onClick={() => setShowGitModal(false)}>
              <div className="agent-modal-card git-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>🌿 وضعیت کنترل نسخه و شاخه‌های گیت</h3>
                  <button type="button" className="close-btn" onClick={() => setShowGitModal(false)}>✕</button>
                </div>
                <div className="modal-body">
                  <div className="git-modal-top-bar">
                    <div className="git-branch-info">
                      <span>شاخه فعال:</span>
                      <span className="git-branch-name">🌿 {gitStatus?.branch || "main"}</span>
                      <span className={`git-clean-tag ${gitStatus?.clean ? "clean" : "dirty"}`}>
                        {gitStatus?.clean ? "✓ درخت کاری کاملاً تمیز است" : "⚠️ دارای تغییرات ثبت‌نشده"}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="quiet-button"
                      onClick={() => selectedProjectId && void loadGitStatus(selectedProjectId)}
                      disabled={loadingGit}
                    >
                      {loadingGit ? "⏳..." : "🔄 بروزرسانی وضعیت"}
                    </button>
                  </div>

                  {/* تغییرات Staged */}
                  <div className="git-changes-group">
                    <h4>تغییرات استیج‌شده (Staged Changes) ({gitStatus?.staged?.length || 0}):</h4>
                    {!gitStatus?.staged?.length ? (
                      <p className="no-matches-hint">هیچ فایلی برای کامیت مرحله‌بندی نشده است.</p>
                    ) : (
                      <div className="git-files-list">
                        {gitStatus.staged.map((f, idx) => (
                          <div key={idx} className="git-file-row staged">
                            <span className="git-status-badge staged">{f.status}</span>
                            <code dir="ltr">{f.path}</code>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* تغییرات Unstaged */}
                  <div className="git-changes-group">
                    <h4>تغییرات اصلاح‌شده (Unstaged Modified) ({gitStatus?.unstaged?.length || 0}):</h4>
                    {!gitStatus?.unstaged?.length ? (
                      <p className="no-matches-hint">تغییرات مرحله‌بندی نشده‌ای وجود ندارد.</p>
                    ) : (
                      <div className="git-files-list">
                        {gitStatus.unstaged.map((f, idx) => (
                          <div key={idx} className="git-file-row unstaged">
                            <span className="git-status-badge unstaged">{f.status}</span>
                            <code dir="ltr">{f.path}</code>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* فایل‌های Untracked */}
                  <div className="git-changes-group">
                    <h4>فایل‌های جدید و ردیابی‌نشده (Untracked) ({gitStatus?.untracked?.length || 0}):</h4>
                    {!gitStatus?.untracked?.length ? (
                      <p className="no-matches-hint">فایل جدید ردیابی‌نشده‌ای وجود ندارد.</p>
                    ) : (
                      <div className="git-files-list">
                        {gitStatus.untracked.map((p, idx) => (
                          <div key={idx} className="git-file-row untracked">
                            <span className="git-status-badge untracked">??</span>
                            <code dir="ltr">{p}</code>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* آخرین کامیت‌ها */}
                  <div className="git-commits-group">
                    <h4>آخرین کامیت‌های ثبت‌شده شاخه:</h4>
                    {!gitStatus?.recent_commits?.length ? (
                      <p className="no-matches-hint">هنوز هیچ کمیتی در این مخزن یافت نشد.</p>
                    ) : (
                      <div className="git-commits-list">
                        {gitStatus.recent_commits.map((c) => (
                          <div key={c.hash} className="git-commit-item">
                            <div className="commit-header">
                              <code className="commit-hash" dir="ltr">{c.hash}</code>
                              <span className="commit-time">{c.date}</span>
                            </div>
                            <div className="commit-message">{c.message}</div>
                            <div className="commit-author">نویسنده: {c.author}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="quiet-button" onClick={() => setShowGitModal(false)}>
                    بستن
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* مدال گالری اسناد و طرح‌های پروژه */}
          {showArtifactsModal && (
            <div className="agent-modal-overlay" onClick={() => setShowArtifactsModal(false)}>
              <div className="agent-modal-card artifacts-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>📑 اسناد، گزارش‌ها و طرح‌های اجرایی پروژه</h3>
                  <button type="button" className="close-btn" onClick={() => setShowArtifactsModal(false)}>✕</button>
                </div>
                <div className="modal-body">
                  <div className="artifacts-modal-meta">
                    <span>مجموع اسناد ثبت‌شده: <strong>{artifacts.length} سند</strong></span>
                    <button
                      type="button"
                      className="quiet-button"
                      onClick={() => selectedProjectId && void loadArtifacts(selectedProjectId)}
                      disabled={loadingArtifacts}
                    >
                      {loadingArtifacts ? "⏳..." : "🔄 بازخوانی اسناد"}
                    </button>
                  </div>

                  {artifacts.length === 0 ? (
                    <div className="empty-artifacts-box">
                      <span className="empty-icon">📂</span>
                      <p>هنوز سندی برای این پروژه ثبت نشده است.</p>
                      <small>هنگامی که ایجنت‌ها مأموریتی را به اتمام برسانند، گزارش و نقشه راه فنی به‌طور خودکار در این گالری ذخیره می‌شود.</small>
                    </div>
                  ) : (
                    <div className="artifacts-grid">
                      {artifacts.map((art) => (
                        <div key={art.id} className={`artifact-card type-${art.artifact_type}`}>
                          <div className="artifact-card-header">
                            <span className={`artifact-type-badge ${art.artifact_type}`}>
                              {art.artifact_type === "plan" ? "🏛️ طرح معماری" :
                               art.artifact_type === "report" ? "📊 گزارش مأموریت" :
                               art.artifact_type === "review" ? "🔍 ممیزی کد" :
                               art.artifact_type === "code" ? "💻 قطعه کد" : "📄 سند فنی"}
                            </span>
                            <span className="artifact-date">
                              {new Date(art.created_at * 1000).toLocaleDateString("fa-IR")}
                            </span>
                          </div>
                          <h4 className="artifact-title">{art.title}</h4>
                          <p className="artifact-snippet">
                            {art.content.slice(0, 140)}...
                          </p>
                          <div className="artifact-actions-row">
                            <button
                              type="button"
                              className="action-button primary-accent"
                              onClick={() => setViewingArtifact(art)}
                            >
                              👁️ مشاهده کامل
                            </button>
                            <button
                              type="button"
                              className="quiet-button"
                              onClick={() => handleCopyArtifact(art)}
                              title="کپی متن در کلیپ‌بورد"
                            >
                              {copiedArtifactId === art.id ? "✓ کپی شد" : "📋 کپی"}
                            </button>
                            <button
                              type="button"
                              className="quiet-button"
                              onClick={() => handleDownloadArtifact(art)}
                              title="دانلود فایل مارک‌داون"
                            >
                              📥 دانلود .md
                            </button>
                            <button
                              type="button"
                              className="quiet-button danger-btn"
                              onClick={() => void handleDeleteArtifact(art.id)}
                              disabled={deletingArtifactId === art.id}
                              title="حذف سند"
                            >
                              {deletingArtifactId === art.id ? "..." : "🗑️"}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="modal-footer">
                  <button type="button" className="quiet-button" onClick={() => setShowArtifactsModal(false)}>
                    بستن
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* مدال مشاهده متن کامل سند */}
          {viewingArtifact && (
            <div className="agent-modal-overlay" onClick={() => setViewingArtifact(null)}>
              <div className="agent-modal-card artifact-view-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <div className="view-modal-title">
                    <span className={`artifact-type-badge ${viewingArtifact.artifact_type}`}>
                      {viewingArtifact.artifact_type}
                    </span>
                    <h3>{viewingArtifact.title}</h3>
                  </div>
                  <button type="button" className="close-btn" onClick={() => setViewingArtifact(null)}>✕</button>
                </div>
                <div className="modal-body">
                  <div className="artifact-view-meta">
                    <span>زمان ثبت: {new Date(viewingArtifact.created_at * 1000).toLocaleString("fa-IR")}</span>
                    <div className="meta-actions">
                      <button
                        type="button"
                        className="quiet-button"
                        onClick={() => handleCopyArtifact(viewingArtifact)}
                      >
                        {copiedArtifactId === viewingArtifact.id ? "✓ در کلیپ‌بورد کپی شد" : "📋 کپی متن"}
                      </button>
                      <button
                        type="button"
                        className="quiet-button"
                        onClick={() => handleDownloadArtifact(viewingArtifact)}
                      >
                        📥 دانلود فایل .md
                      </button>
                    </div>
                  </div>
                  <div className="artifact-content-viewer">
                    <pre className="artifact-pre-text">{viewingArtifact.content}</pre>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="quiet-button" onClick={() => setViewingArtifact(null)}>
                    بستن
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* مدال استریم زنده ترمینال (Live Terminal SSE Streaming) */}
          {showStreamModal && (
            <div className="agent-modal-overlay" onClick={() => !isStreaming && setShowStreamModal(false)}>
              <div className="agent-modal-card terminal-stream-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <div className="terminal-header-title">
                    <span className="terminal-icon">⚡</span>
                    <h3>ترمینال استریم زنده سرور (Live Line-by-Line Terminal)</h3>
                    {isStreaming && <span className="terminal-live-badge">در حال اجرا (LIVE)</span>}
                  </div>
                  <button
                    type="button"
                    className="close-btn"
                    onClick={() => setShowStreamModal(false)}
                    disabled={isStreaming}
                  >
                    ✕
                  </button>
                </div>
                <div className="modal-body">
                  <form onSubmit={handleStartStreamingCommand} className="terminal-cmd-form">
                    <div className="terminal-cmd-input-row">
                      <span className="terminal-prompt-symbol">$</span>
                      <input
                        type="text"
                        dir="ltr"
                        placeholder="دستور مورد نظر را وارد کنید... (مثلاً: pytest, git status, npm run build)"
                        value={streamCommandInput}
                        onChange={(e) => setStreamCommandInput(e.target.value)}
                        disabled={isStreaming}
                        className="terminal-cmd-input"
                      />
                      <button
                        type="submit"
                        className="action-button primary-accent"
                        disabled={isStreaming || !streamCommandInput.trim()}
                      >
                        {isStreaming ? "⏳ در حال اجرا..." : "⚡ اجرای استریم"}
                      </button>
                    </div>
                  </form>

                  <div className="terminal-screen-window" ref={terminalOutputRef}>
                    <div className="terminal-screen-header">
                      <span>ROOT: {inspection?.root_path || "—"}</span>
                      {streamExitCode !== null && (
                        <span className={`exit-code-badge ${streamExitCode === 0 ? "success" : "failed"}`}>
                          کد بازگشت: {streamExitCode} {streamDurationMs !== null ? `(${streamDurationMs}ms)` : ""}
                        </span>
                      )}
                    </div>
                    <div className="terminal-lines-container" dir="ltr">
                      {streamingLines.length === 0 ? (
                        <div className="terminal-empty-hint">
                          دستوری وارد کنید و دکمه «اجرای استریم» را بزنید تا خروجی خط‌به‌خط در زمان واقعی نمایش داده شود...
                        </div>
                      ) : (
                        streamingLines.map((line, idx) => (
                          <div key={idx} className="terminal-line">
                            {line}
                          </div>
                        ))
                      )}
                      {isStreaming && (
                        <div className="terminal-cursor-line">
                          <span className="terminal-cursor">█</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="quiet-button"
                    onClick={() => setStreamingLines([])}
                    disabled={isStreaming || streamingLines.length === 0}
                  >
                    پاکسازی صفحه
                  </button>
                  <button
                    type="button"
                    className="quiet-button"
                    onClick={() => setShowStreamModal(false)}
                    disabled={isStreaming}
                  >
                    بستن
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* مدال بازبینی و تأیید سند مشخصات (Spec-Driven Gate) */}
          {selectedSpec && showSpecModal && (
            <SpecReviewModal
              spec={selectedSpec}
              isOpen={showSpecModal}
              onClose={() => setShowSpecModal(false)}
              onExecuted={(run) => {
                setActiveRun(run);
                void loadAgentRuns(selectedProjectId);
                void loadSpecs(selectedProjectId);
                setSuccessMsg("سند مشخصات تأیید شد و مأموریت ایجنت با موفقیت آغاز گردید.");
              }}
              onSpecUpdated={(updatedSpec) => {
                setSelectedSpec(updatedSpec);
                void loadSpecs(selectedProjectId);
              }}
            />
          )}

          {/* مدال فهرست اسناد مشخصات پروژه */}
          {showSpecsListModal && (
            <div className="agent-modal-overlay" onClick={() => setShowSpecsListModal(false)}>
              <div className="agent-modal-content max-w-3xl" onClick={(e) => e.stopPropagation()} dir="rtl">
                <div className="modal-header">
                  <div className="modal-title-with-icon">
                    <span className="modal-icon">📋</span>
                    <div>
                      <h3 className="modal-title">اسناد مشخصات و تحلیل وظایف (Spec-Driven Gates)</h3>
                      <span className="modal-subtitle">تاریخچه اسناد تولیدشده، پیش‌نویس‌ها و وظایف نیازمند تأیید در این پروژه</span>
                    </div>
                  </div>
                  <button type="button" className="close-btn" onClick={() => setShowSpecsListModal(false)}>✕</button>
                </div>
                <div className="modal-body space-y-3">
                  {specs.length === 0 ? (
                    <div className="text-center py-8 text-gray-400 text-xs">
                      هیچ سند مشخصاتی برای این پروژه ثبت نشده است. از دکمه «📋 بازبینی مشخصات» برای تولید سند استفاده کنید.
                    </div>
                  ) : (
                    specs.map((sp) => (
                      <div key={sp.id} className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-between gap-3 hover:border-emerald-500/40 transition">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <strong className="text-xs text-slate-200">{sp.title}</strong>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                              sp.status === 'executed' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' :
                              sp.status === 'rejected' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40' :
                              'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            }`}>
                              {sp.status === 'executed' ? '✓ اجرا شده' : sp.status === 'rejected' ? '✕ رد شده' : '⏳ در انتظار تأیید'}
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-400 line-clamp-1">{sp.requirements?.slice(0, 100)}...</p>
                        </div>
                        <button
                          type="button"
                          className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/30 transition shrink-0"
                          onClick={() => {
                            setSelectedSpec(sp);
                            setShowSpecModal(true);
                            setShowSpecsListModal(false);
                          }}
                        >
                          مشاهده و مدیریت
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <div className="modal-footer">
                  <button type="button" className="quiet-button" onClick={() => setShowSpecsListModal(false)}>بستن</button>
                </div>
              </div>
            </div>
          )}

          {/* مدال قوانین و چارچوب هدایت پروژه (Project Steering Files) */}
          {showSteeringModal && (
            <div className="agent-modal-overlay" onClick={() => setShowSteeringModal(false)}>
              <div className="agent-modal-content max-w-3xl omni-glass-panel" onClick={(e) => e.stopPropagation()} dir="rtl">
                <div className="modal-header">
                  <div className="modal-title-with-icon">
                    <span className="modal-icon">🧭</span>
                    <div>
                      <h3 className="modal-title font-bold text-base text-cyan-300">قوانین و چارچوب هدایت پروژه (Project Steering Files)</h3>
                      <span className="modal-subtitle text-xs text-slate-400">
                        تنظیم خط‌مشی‌ها، هویت بصری، ابزارهای مجاز و محدودیت‌های عملیاتی ایجنت در <code>{steeringData?.path || ".omniops/steering.yaml"}</code>
                      </span>
                    </div>
                  </div>
                  <button type="button" className="close-btn" onClick={() => setShowSteeringModal(false)}>✕</button>
                </div>

                <div className="modal-body space-y-4">
                  {/* اطلاعات کلی و وضعیت استیرینگ */}
                  <div className="p-3 bg-slate-900/70 border border-slate-800 rounded-xl flex items-center justify-between text-xs flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">وضعیت سند:</span>
                      <span className={`px-2 py-0.5 rounded-full font-semibold border ${
                        steeringData?.is_custom
                          ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                          : "bg-slate-700/40 text-slate-300 border-slate-600/40"
                      }`}>
                        {steeringData?.is_custom ? "🌟 سفارشی‌شده پروژه" : "⚙️ پیش‌فرض هوشمند سیستم"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">فونت و جهت:</span>
                      <span className="text-slate-300 font-mono">
                        {steeringData?.steering?.guidelines?.visual_identity?.font_family || "Vazirmatn"} (RTL)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400">رنگ‌های برند:</span>
                      <span className="w-3.5 h-3.5 rounded-full border border-white/20 inline-block" style={{ backgroundColor: steeringData?.steering?.guidelines?.visual_identity?.primary_color || "#00f0ff" }} title="Primary Cyan" />
                      <span className="w-3.5 h-3.5 rounded-full border border-white/20 inline-block" style={{ backgroundColor: steeringData?.steering?.guidelines?.visual_identity?.secondary_color || "#00ffaa" }} title="Secondary Emerald" />
                    </div>
                  </div>

                  {/* تب‌های ویرایشگر */}
                  <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                    <button
                      type="button"
                      className={`px-3 py-1 text-xs rounded-lg font-medium transition ${
                        steeringEditorTab === "visual"
                          ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                      onClick={() => setSteeringEditorTab("visual")}
                    >
                      ✏️ ویرایش ساختاریافته
                    </button>
                    <button
                      type="button"
                      className={`px-3 py-1 text-xs rounded-lg font-medium transition ${
                        steeringEditorTab === "yaml"
                          ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                      onClick={() => setSteeringEditorTab("yaml")}
                    >
                      📄 پیش‌نمایش فایل YAML
                    </button>
                  </div>

                  {loadingSteering ? (
                    <div className="text-center py-8 text-cyan-400 text-xs">در حال بارگذاری قوانین هدایت...</div>
                  ) : steeringEditorTab === "visual" ? (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">
                          قوانین و الزامات پروژه (هر سطر یک قانون):
                        </label>
                        <textarea
                          className="w-full bg-slate-950/80 border border-slate-800 focus:border-cyan-500 rounded-xl p-3 text-xs text-slate-100 font-sans leading-relaxed focus:outline-none focus:ring-1 focus:ring-cyan-500 min-h-[140px]"
                          value={steeringRulesText}
                          onChange={(e) => setSteeringRulesText(e.target.value)}
                          placeholder="مثال: تمام فایل‌ها باید دارای مستندات و تایپ کامل باشند..."
                          dir="rtl"
                        />
                        <span className="text-[11px] text-slate-500">
                          این قوانین به‌طور خودکار در شروع هر چرخه کاری (Task Loop) به پرامپت ایجنت تزریق می‌گردند.
                        </span>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1">
                          ابزارهای مجاز ایجنت (Allowed Tools):
                        </label>
                        <input
                          type="text"
                          className="w-full bg-slate-950/80 border border-slate-800 focus:border-cyan-500 rounded-xl p-2.5 text-xs text-slate-100 font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500"
                          value={steeringToolsText}
                          onChange={(e) => setSteeringToolsText(e.target.value)}
                          placeholder="bash, read_file, write_file, git_status, playwright"
                          dir="ltr"
                        />
                        <span className="text-[11px] text-slate-500">
                          فهرست ابزارهایی که ایجنت مجاز به فراخوانی آن‌ها در این مخزن است (با کاما جدا شود).
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs text-slate-400 font-mono">.omniops/steering.yaml</span>
                        <button
                          type="button"
                          className="text-xs text-cyan-400 hover:text-cyan-300 transition"
                          onClick={() => {
                            navigator.clipboard.writeText(steeringRawYaml);
                            setSuccessMsg("متن YAML در کلیپ‌بورد کپی شد.");
                          }}
                        >
                          📋 کپی محتوا
                        </button>
                      </div>
                      <pre className="w-full bg-slate-950/90 border border-slate-800 rounded-xl p-3 text-xs font-mono text-cyan-200 overflow-x-auto max-h-[220px]" dir="ltr">
                        {steeringRawYaml || "# No YAML content available"}
                      </pre>
                    </div>
                  )}
                </div>

                <div className="modal-footer flex items-center justify-between gap-2 border-t border-slate-800 pt-3">
                  <span className="text-[11px] text-slate-400">
                    💡 تغییرات بلافاصله در پرامپت‌های بعدی ایجنت اعمال خواهد شد.
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="quiet-button"
                      onClick={() => setShowSteeringModal(false)}
                      disabled={savingSteering}
                    >
                      انصراف
                    </button>
                    <button
                      type="button"
                      className="action-button primary-accent font-bold"
                      onClick={() => void handleSaveSteering()}
                      disabled={savingSteering || loadingSteering}
                    >
                      {savingSteering ? "⏳ در حال ذخیره..." : "💾 ذخیره قوانین هدایت"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

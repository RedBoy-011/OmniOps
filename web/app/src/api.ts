export type Profile = {
  id: string;
  username: string;
  mobile?: string;
  role: "superadmin" | "member";
  status: "active" | "pending" | "rejected";
  capabilities: string[];
  created_at?: number;
};

export type ChatQuota = {
  unlimited: boolean;
  used: number;
  limit: number | null;
  remaining: number | null;
  reset_in_seconds?: number;
};

export type ManagedUser = {
  id: string;
  username: string;
  mobile: string;
  role: "superadmin" | "member";
  status: "active" | "pending" | "rejected";
  capabilities: string[];
  created_at: number;
  decided_by?: string | null;
  decided_at?: number | null;
  chat_quota?: ChatQuota;
};

export type UserProfileReport = {
  user: {
    id: string;
    username: string;
    mobile: string;
    role: "superadmin" | "member";
    status: "active" | "pending" | "rejected";
    capabilities: string[];
    created_at: number;
  };
  stats: {
    total_sessions: number;
    total_messages: number;
    active_web_sessions: number;
    active_agent_sessions: number;
  };
  chat_quota?: ChatQuota;
};

export type ChatSession = { id: string; title: string; created_at: number; updated_at: number; message_count: number };
export type ChatHistory = { id: string; prompt: string; reply: string; model: string; created_at: number; session_id?: string | null };
export type MemoryNote = { id: string; content: string; created_at: number };
export type WorkspaceProject = { id: string; name: string; created_at: number; root_path?: string };
export type WorkspaceAttachment = { id: string; project_id: string; name: string; mime: string; size: number; created_at: number };
export type TaskDraft = { id: string; project_id: string; description: string; status: "draft" | "cancelled"; created_at: number; updated_at: number };
export type PendingUser = { id: string; username: string; mobile: string; created_at: number };
export type LoginResult = { token: string; user: Profile; pending_count: number };
export type LocalModel = { id: string; size_bytes: number | null };
export type NodeStatus = { id: string; kind: "master" | "worker"; status: "up" | "no_models" | "unreachable"; checked_at: number; latency_ms?: number | null; models?: LocalModel[] };
export type DiskItem = {
  name: string;
  path: string;
  size_bytes: number;
  size_mb: number;
  size_gb: number;
  reason?: string;
};

export type DiskCategory = {
  count: number;
  size_bytes: number;
  size_gb: number;
  size_mb: number;
  items?: DiskItem[];
};

export type DiskBreakdown = {
  total_wasted_bytes: number;
  total_wasted_gb: number;
  freed_bytes?: number;
  freed_gb?: number;
  incomplete_models: DiskCategory;
  failed_models: DiskCategory;
  temp_files: DiskCategory;
  diagnostics: string[];
};

export type WorkerOptimizationReport = {
  status: string;
  node_id: string;
  node_name: string;
  optimized_at: number;
  before: {
    disk_total_gb: number;
    disk_used_gb: number;
    disk_free_gb: number;
    disk_percent: number;
    wasted_gb: number;
    incomplete_count: number;
    failed_count: number;
    temp_count: number;
  };
  after: {
    disk_total_gb: number;
    disk_used_gb: number;
    disk_free_gb: number;
    disk_percent: number;
    wasted_gb: number;
    freed_gb: number;
    freed_bytes: number;
  };
  actions_taken: string[];
  healthy_models: {
    count: number;
    models: string[];
    status: string;
  };
  audit_event: string;
};

export type ManagedNode = {
  id: string; role: "worker" | "edge"; name: string; created_at: number;
  last_seen: number | null; revoked_at: number | null; credential_expires_at: number;
  metrics: {
    version?: string;
    cpu_percent?: number;
    ram_percent?: number;
    disk_percent?: number;
    disk_total_gb?: number;
    disk_used_gb?: number;
    disk_free_gb?: number;
    disk_breakdown?: DiskBreakdown;
    models?: string[];
  } | null;
};
export type ModelPull = { id: string; node_id: string; model: string; action: "pull" | "delete";
  status: "queued" | "running" | "completed" | "failed"; progress: number | null;
  detail: string; created_at: number; updated_at: number };
export type ApiProvider = { kind: "openai" | "gemini" | "anthropic" | "openrouter"; configured: boolean;
  enabled: boolean; network_mode: "direct" | "socks"; proxy_url: string;
  models: string[]; tested_at: number | null;
  prices: Record<string, { input: string; output: string }>;
  catalog_prices: Record<string, { input: string; output: string }> };
export type SocksHealthStatus = "healthy" | "degraded" | "down";
export type SocksHealthResult = {
  status: "ok" | "error" | "unconfigured";
  health: SocksHealthStatus;
  proxy_url: string;
  latency_ms: number | null;
  tested_at: number;
  target_host: string;
  message: string;
  error?: string;
};
export type NodeGrant = { id: string; role: "worker" | "edge"; grant: string; expires_at: number };
export type NodeTokenResponse = {
  id: string;
  grant: string;
  role: "worker" | "edge";
  expires_at: number;
  master_url: string;
  token: string;
  command: string;
};
export type ProjectFileSummary = { path: string; name: string; type: string; size?: number; changes?: string; category?: string };
export type ProjectFileDetail = {
  path: string;
  name: string;
  content: string;
  size: number;
  lines: number;
  type: string;
  diff?: { diff_text?: string; added?: number; removed?: number } | null;
};
export type SystemMetrics = {
  server_time: number;
  uptime_seconds: number;
  cpu: {
    percent: number;
    cores: number;
    load_avg: number[] | null;
  };
  ram: {
    total_bytes: number;
    used_bytes: number;
    free_bytes: number;
    percent: number;
    total_gb: number;
    used_gb: number;
    free_gb: number;
  };
  disk: {
    path: string;
    total_bytes: number;
    used_bytes: number;
    free_bytes: number;
    percent: number;
    total_gb: number;
    used_gb: number;
    free_gb: number;
  };
  gpu: {
    available: boolean;
    name: string;
    vram_total_mb: number | null;
    vram_used_mb: number | null;
    vram_free_mb: number | null;
    vram_percent: number | null;
    temperature_c: number | null;
    gpu_utilization_percent: number | null;
  };
  runtime: {
    os: string;
    os_release: string;
    platform_string: string;
    python_version: string;
    active_inferences: number;
    max_inferences: number;
    worker_nodes_count: number;
    active_sessions_count: number;
    ollama_status: string;
    ollama_model_count: number;
  };
};

export type DatabaseBackup = {
  filename: string;
  size_bytes: number;
  created_at: number;
};

export type UpdateStatus = {
  update_available: boolean;
  current_commit: string;
  current_full_commit: string;
  latest_commit: string;
  latest_full_commit: string;
  branch: string;
  last_checked: number;
  error?: string | null;
};

export type UpdateResult = {
  status: "updated" | "error";
  message: string;
  previous_commit?: string;
  new_commit?: string;
  rebuilt_frontend?: boolean;
  pull_output?: string;
  restart_recommended?: boolean;
};

export type AuditLog = {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  event: string;
  subject_id: string | null;
  created_at: number;
};

export type NodePingResult = {
  status: string;
  latency_ms: number;
  version: string;
  model_count: number;
  base_url: string;
};

export type Operations = {
  master: "up";
  hardware?: SystemMetrics;
  ollama: { url: string; status: NodeStatus["status"]; models: LocalModel[] };
  nodes: NodeStatus[];
};

let volatileWebToken: string | null = null;
export function keepSessionInMemory(token: string) {
  volatileWebToken = token;
  try { localStorage.setItem("omniops_token", token); } catch {}
}
export function forgetSession() {
  volatileWebToken = null;
  try {
    localStorage.removeItem("omniops_token");
    localStorage.removeItem("omniops_user");
    localStorage.removeItem("omniops_pending_count");
  } catch {}
}
export function getStoredToken(): string | null {
  return volatileWebToken || (typeof localStorage !== "undefined" ? localStorage.getItem("omniops_token") : null);
}

async function request<T>(path: string, method = "GET", payload?: object): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = volatileWebToken || (typeof localStorage !== "undefined" ? localStorage.getItem("omniops_token") : null);
  if (token) headers.Authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      cache: "no-store",
      credentials: "omit",
    });
  } catch {
    throw new Error("ارتباط با هسته برقرار نشد. آدرس و شبکه را بررسی کنید.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || "درخواست با خطا روبه‌رو شد.");
  return data as T;
}

export type AttachedDoc = {
  id?: string;
  name: string;
  content: string;
  path?: string;
};

export type ProjectInspection = {
  project_id: string;
  name: string;
  root_path: string;
  project_type: string;
  framework: string;
  total_entries: number;
  top_entries: Array<{ name: string; is_dir: boolean; size?: number | null }>;
  has_readme: boolean;
  readme_preview: string;
  tasks_context: string;
};

export type ProjectFileEntry = {
  name: string;
  path: string;
  is_dir: boolean;
  size?: number | null;
};

export type CommandExecutionResult = {
  project_id: string;
  command: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
};

export type AgentPlanStep = {
  index: number;
  title: string;
  action: string;
  status: "completed" | "in_progress" | "pending" | "waiting_approval" | "failed" | "skipped" | "warning" | "paused_debug";
  summary: string;
  command?: string;
  target?: string;
};

export type AgentRunLog = {
  timestamp: number;
  step: number;
  type: string;
  title: string;
  content: string;
  exit_code?: number;
};

export type AgentRole = "general" | "coder" | "tester" | "architect" | "swarm";
export type AgentMode = "single" | "swarm";

export type SubagentRun = {
  id: string;
  parent_run_id: string;
  role: string;
  title: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled" | "waiting_approval";
  prompt: string;
  summary: string;
  logs: Array<{ timestamp: number; title: string; content: string }>;
  created_at: number;
  updated_at: number;
};

export type SandboxPolicy = {
  max_timeout_seconds: number;
  strict_mode: boolean;
  allowed_prefixes: string[];
  blocked_commands: string[];
  updated_at: number;
};

export type FilePatchProposal = {
  patch_id?: string;
  project_id: string;
  path: string;
  is_new_file: boolean;
  old_size: number;
  new_size: number;
  additions: number;
  deletions: number;
  diff: string;
  has_changes: boolean;
  applied: boolean;
};

export type FilePatchRecord = {
  id: string;
  project_id: string;
  path: string;
  diff_text: string;
  additions: number;
  deletions: number;
  is_new_file: number;
  applied_by: string;
  applied_by_username?: string;
  status: "applied" | "reverted";
  created_at: number;
  reverted_at?: number | null;
};

export type GovernanceWebhook = {
  id: string;
  name: string;
  url: string;
  secret?: string;
  events: string[];
  enabled: boolean;
  created_at: number;
  updated_at: number;
};

export type SearchMatchLine = {
  line_number: number;
  line_text: string;
};

export type SearchFileResult = {
  path: string;
  matches: SearchMatchLine[];
};

export type ProjectSearchResult = {
  project_id: string;
  query: string;
  total_matches: number;
  results: SearchFileResult[];
};

export type CommandHistoryRecord = {
  id: string;
  project_id: string;
  command: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  executed_by: string;
  executed_by_username?: string;
  created_at: number;
};

export type GitCommitInfo = {
  hash: string;
  author: string;
  date: string;
  message: string;
};

export type GitStatusResult = {
  is_git_repo: boolean;
  branch?: string;
  clean?: boolean;
  staged?: Array<{ path: string; status: string }>;
  unstaged?: Array<{ path: string; status: string }>;
  untracked?: string[];
  recent_commits?: GitCommitInfo[];
  message?: string;
};

export type ProjectArtifact = {
  id: string;
  project_id: string;
  run_id?: string | null;
  title: string;
  artifact_type: "plan" | "report" | "review" | "code" | "general";
  content: string;
  created_by: string;
  created_at: number;
  updated_at: number;
};

export type SpecTaskStep = {
  step: number;
  title: string;
  description: string;
  action?: string;
  status: string;
};

export type WorkspaceSpec = {
  id: string;
  project_id: string;
  owner_id: string;
  title: string;
  requirements: string;
  design_approach: string;
  task_breakdown: SpecTaskStep[];
  status: "draft" | "approved" | "rejected" | "executed";
  run_id?: string | null;
  approved_by?: string | null;
  approved_at?: number | null;
  rejection_reason?: string | null;
  created_at: number;
  updated_at: number;
};

export type TaskPreset = {
  id: string;
  title: string;
  icon: string;
  role: AgentRole;
  mode: AgentMode;
  prompt: string;
  description: string;
};

export const TASK_PRESETS: TaskPreset[] = [
  {
    id: "security_audit",
    title: "ممیزی امنیتی و آسیب‌پذیری‌ها",
    icon: "🛡️",
    role: "tester",
    mode: "swarm",
    prompt: "بررسی جامع امنیتی پروژه، اسکن فایل‌های پیکربندی و وابستگی‌ها برای جلوگیری از نشت کلیدها و آسیب‌پذیری‌های امنیتی.",
    description: "پویش فایل‌های محرمانه و بررسی پکیج‌های آسیب‌پذیر"
  },
  {
    id: "quality_qa",
    title: "تست خودکار و سنجش کیفیت (QA)",
    icon: "🧪",
    role: "tester",
    mode: "swarm",
    prompt: "یافتن تست‌های پروژه، اجرای دستورات اعتبارسنجی کیفی، تحلیل تست‌کیس‌ها و تدوین گزارش پوشش آزمون.",
    description: "اجرای تست‌ها و ارائه گزارش کنترل کیفیت"
  },
  {
    id: "refactor_clean",
    title: "بهینه‌سازی کارایی و رفکتور کد",
    icon: "⚡",
    role: "coder",
    mode: "single",
    prompt: "بازبینی توابع حجیم، پاک‌سازی کدهای تکراری و بدهی‌های فنی و بهینه‌سازی سرعت پردازش توابع کلیدی.",
    description: "اصلاح ساختار کدهای پیچیده و ارتقای پرفورمنس"
  },
  {
    id: "architecture_plan",
    title: "تحلیل ساختار و طرح جامع معماری",
    icon: "🏛️",
    role: "architect",
    mode: "swarm",
    prompt: "تحلیل ماژول‌ها، درخت وابستگی‌ها، مانیفست‌ها و تدوین سند تفصیلی معماری و نقشه راه توسعه سیستم.",
    description: "ترسیم دیاگرام ارتباطات و طرح نقشه راه فنی"
  },
  {
    id: "auto_docs",
    title: "مستندسازی و تولید README / داکس",
    icon: "📝",
    role: "general",
    mode: "single",
    prompt: "استخراج متادیتا، تدوین داکیومنت کامل راهنمای نصب و راه‌اندازی (README.md) و مستندسازی اندپوینت‌ها.",
    description: "تدوین راهنمای توسعه و مستندات استاندارد"
  }
];

export type CommandStreamEvent = {
  type: "stdout" | "stderr" | "done" | "error";
  text?: string;
  exit_code?: number;
  duration_ms?: number;
  error?: string;
  timestamp?: number;
};

export type AgentRun = {
  id: string;
  owner_id?: string;
  owner_username?: string;
  project_id: string;
  project_name?: string;
  prompt: string;
  role: AgentRole;
  mode?: AgentMode;
  status: "planning" | "in_progress" | "waiting_approval" | "completed" | "failed" | "cancelled" | "paused_debug";
  current_step_index: number;
  plan_steps: AgentPlanStep[];
  logs: AgentRunLog[];
  subagents?: SubagentRun[];
  result_summary: string;
  debug_mode?: boolean;
  created_at: number;
  updated_at: number;
};

export const api = {
  login: (username: string, password: string) => request<LoginResult>("/api/auth/login", "POST", { username, password }),
  register: (username: string, password: string, mobile: string) => request<{ status: string; message: string }>("/api/auth/register", "POST", { username, password, mobile }),
  me: () => request<{ user: Profile; pending_count?: number }>("/api/auth/me"),
  pending: () => request<{ users: PendingUser[] }>("/api/admin/pending"),
  operations: () => request<Operations>("/api/admin/operations"),
  webModels: () => request<{ models: string[] }>("/api/web/models"),
  webChat: (
    message: string,
    model: string,
    allow_external = false,
    save_history = false,
    attached_file?: { name: string; content: string } | null,
    session_id?: string | null,
    include_system_context?: boolean,
    attached_files?: AttachedDoc[] | null
  ) =>
    request<{ reply: string; model: string }>("/api/web/chat", "POST", {
      message,
      model,
      allow_external,
      save_history,
      attached_file,
      session_id,
      include_system_context,
      attached_files,
    }),
  webChatStream: async (
    message: string,
    model: string,
    allow_external: boolean,
    save_history: boolean,
    attached_file: { name: string; content: string } | null,
    session_id: string | null | undefined,
    include_system_context: boolean,
    onChunk: (chunk: string, model?: string) => void,
    onDone: (fullReply: string, model?: string) => void,
    onError: (err: string) => void,
    attached_files?: AttachedDoc[] | null
  ) => {
    const token = localStorage.getItem("omniops_token") || volatileWebToken || "";
    try {
      const response = await fetch("/api/web/chat/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message,
          model,
          allow_external,
          save_history,
          attached_file,
          session_id,
          include_system_context,
          attached_files,
        }),
      });

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        throw new Error(errorJson.error?.message || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("مرورگر از دریافت پاسخ جریانی (Stream) پشتیبانی نمی‌کند.");
      }

      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let fullReply = "";
      let modelUsed = model;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data:")) {
            try {
              const data = JSON.parse(trimmed.slice(5).trim());
              if (data.error) {
                onError(data.error);
                return;
              }
              if (data.chunk) {
                fullReply += data.chunk;
                if (data.model) modelUsed = data.model;
                onChunk(data.chunk, data.model);
              }
              if (data.done) {
                if (data.model) modelUsed = data.model;
                if (data.reply) fullReply = data.reply;
                onDone(fullReply, modelUsed);
                return;
              }
            } catch {
              // ignore parse error on incomplete chunks
            }
          }
        }
      }
      onDone(fullReply, modelUsed);
    } catch (err) {
      onError(err instanceof Error ? err.message : "خطا در برقراری ارتباط جریانی با سرور");
    }
  },
  projects: () => request<{ projects: WorkspaceProject[] }>("/api/web/workspace/projects"),
  createProject: (name: string) => request<{ id: string; name: string }>("/api/web/workspace/projects", "POST", { name }),
  attachments: (project_id: string) => request<{ attachments: WorkspaceAttachment[] }>(`/api/web/workspace/attachments?project_id=${encodeURIComponent(project_id)}`),
  addAttachment: (project_id: string, name: string, mime: string, content_base64: string) => request<WorkspaceAttachment>("/api/web/workspace/attachments", "POST", { project_id, name, mime, content_base64 }),
  removeAttachment: (id: string) => request<{ status: string }>("/api/web/workspace/attachments/remove", "POST", { id }),
  taskDrafts: () => request<{ tasks: TaskDraft[] }>("/api/web/workspace/tasks"),
  createTaskDraft: (project_id: string, description: string) => request<{ id: string; status: string }>("/api/web/workspace/tasks", "POST", { project_id, description }),
  cancelTaskDraft: (id: string) => request<{ status: string }>("/api/web/workspace/tasks/cancel", "POST", { id }),
  chatHistory: (sessionId?: string) =>
    request<{ entries: ChatHistory[] }>(sessionId ? `/api/chat/history?session_id=${encodeURIComponent(sessionId)}` : "/api/chat/history"),
  clearChatHistory: (sessionId?: string) =>
    request<{ status: string }>("/api/chat/history/clear", "POST", sessionId ? { session_id: sessionId } : {}),
  chatSessions: () => request<{ sessions: ChatSession[] }>("/api/chat/sessions"),
  createChatSession: (title?: string) => request<{ session: ChatSession }>("/api/chat/sessions", "POST", { title }),
  renameChatSession: (id: string, title: string) => request<{ id: string; title: string }>("/api/chat/sessions/rename", "POST", { id, title }),
  deleteChatSession: (id: string) => request<{ status: string; id: string }>("/api/chat/sessions/delete", "POST", { id }),
  memoryNotes: () => request<{ notes: MemoryNote[] }>("/api/chat/memory"),
  addMemory: (content: string) => request<{ id: string }>("/api/chat/memory/add", "POST", { content }),
  removeMemory: (id: string) => request<{ status: string }>("/api/chat/memory/remove", "POST", { id }),
  managedNodes: () => request<{ nodes: ManagedNode[] }>("/api/admin/nodes"),
  pingNode: () => request<NodePingResult>("/api/admin/nodes/ping"),
  modelPulls: () => request<{ jobs: ModelPull[] }>("/api/admin/nodes/model-pulls"),
  createModelPull: (node_id: string, model: string) => request<{ id: string; status: string }>("/api/admin/nodes/model-pulls", "POST", { node_id, model }),
  cancelModelPull: (id: string) => request<{ status: string; id: string }>("/api/admin/nodes/model-pulls/cancel", "POST", { id }),
  deleteModel: (node_id: string, model: string) => request<{ id: string; status: string }>("/api/admin/nodes/model-delete", "POST", { node_id, model }),
  cleanNodeDisk: (node_id: string, targets?: string[]) =>
    request<{ status: string; node_id: string; freed_bytes: number; freed_gb: number; message: string }>(
      "/api/admin/nodes/clean-disk",
      "POST",
      { node_id, targets }
    ),
  nodeDiskDiagnostics: (node_id: string) =>
    request<{ breakdown: DiskBreakdown }>(`/api/admin/nodes/disk-diagnostics?node_id=${encodeURIComponent(node_id)}`),
  optimizeWorkerResources: (node_id: string) =>
    request<WorkerOptimizationReport>("/api/admin/nodes/optimize-resources", "POST", { node_id }),
  providers: () => request<{ providers: ApiProvider[] }>("/api/admin/providers"),
  saveProvider: (kind: string, api_key: string | null, network_mode: "direct" | "socks", proxy_url: string) =>
    request<{ status: string }>("/api/admin/providers/save", "POST", { kind, api_key, network_mode, proxy_url }),
  testProvider: (kind: string) => request<{ models: string[]; network_mode: string }>("/api/admin/providers/test", "POST", { kind }),
  testSocks: (proxy_url?: string, kind?: string) =>
    request<{ status: string; health: SocksHealthStatus; latency_ms: number; proxy_url: string; message: string; target_host?: string; tested_at?: number }>("/api/admin/providers/test-socks", "POST", { proxy_url, kind }),
  socksHealth: (proxy_url?: string, kind?: string) =>
    request<SocksHealthResult>("/api/admin/providers/socks-health", "POST", { proxy_url, kind }),
  getSocksHealth: (proxy_url?: string, kind?: string) => {
    const params = new URLSearchParams();
    if (proxy_url) params.set("proxy_url", proxy_url);
    if (kind) params.set("kind", kind);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return request<SocksHealthResult>(`/api/admin/providers/socks-health${qs}`);
  },
  enableProvider: (kind: string, enabled: boolean) => request<{ enabled: boolean }>("/api/admin/providers/enable", "POST", { kind, enabled }),
  priceProvider: (kind: string, model: string, input: string, output: string) =>
    request<{ model: string }>("/api/admin/providers/price", "POST", { kind, model, input, output }),
  issueNodeGrant: (role: "worker" | "edge") => request<NodeGrant>("/api/admin/nodes/grants", "POST", { role }),
  issueNodeToken: (role: "worker" | "edge", master_url?: string) =>
    request<NodeTokenResponse>("/api/admin/nodes/token", "POST", { role, master_url }),
  revokeNodeGrant: (id: string) => request<{ status: string }>("/api/admin/nodes/grants/revoke", "POST", { id }),
  revokeNode: (id: string) => request<{ status: string }>("/api/admin/nodes/revoke", "POST", { id }),
  deleteNode: (id: string) => request<{ status: string }>("/api/admin/nodes/delete", "POST", { id }),
  saveOllamaEndpoint: (url: string) => request<Operations["ollama"]>("/api/admin/ollama-endpoint", "POST", { url }),
  approve: (id: string, capabilities: string[]) => request<{ status: string }>(`/api/admin/pending/${encodeURIComponent(id)}/approve`, "POST", { capabilities }),
  reject: (id: string) => request<{ status: string }>(`/api/admin/pending/${encodeURIComponent(id)}/reject`, "POST", {}),
  issuePairing: () => request<{ code: string; expires_at: number }>("/api/agent/pairing", "POST", {}),
  logout: () => request<{ status: string }>("/api/auth/logout", "POST", {}),
  projectFiles: () => request<{ files: ProjectFileSummary[] }>("/api/web/project/files"),
  projectFile: (path: string) => request<ProjectFileDetail>(`/api/web/project/file?path=${encodeURIComponent(path)}`),
  systemMetrics: () => request<SystemMetrics>("/api/admin/system/metrics"),
  databaseBackups: () => request<{ backups: DatabaseBackup[] }>("/api/admin/system/backups"),
  createDatabaseBackup: () => request<{ status: string; filename: string; size_bytes: number; created_at: number }>("/api/admin/system/backups", "POST", {}),
  downloadBackupUrl: (filename: string) => `/api/admin/system/backups/download?filename=${encodeURIComponent(filename)}`,
  updateStatus: (force = false) => request<UpdateStatus>(`/api/admin/system/update-status${force ? "?force=true" : ""}`),
  applyUpdate: () => request<UpdateResult>("/api/admin/system/update", "POST", {}),
  adminUsers: () => request<{ users: ManagedUser[] }>("/api/admin/users"),
  updateUserAccess: (data: { user_id: string; role?: string; status?: string; capabilities?: string[] }) =>
    request<{ user: ManagedUser }>("/api/admin/users/update", "POST", data),
  resetUserQuota: (user_id: string) =>
    request<{ status: string; user_id: string }>("/api/admin/users/reset-quota", "POST", { user_id }),
  userProfile: () => request<UserProfileReport>("/api/user/profile"),
  updateProfile: (data: { username?: string; mobile?: string }) =>
    request<{ user: ManagedUser }>("/api/user/profile", "POST", data),
  changePassword: (old_password: string, new_password: string) =>
    request<{ status: string; message: string }>("/api/user/change-password", "POST", { old_password, new_password }),
  auditLogs: (limit = 100, event?: string) =>
    request<{ logs: AuditLog[] }>(`/api/admin/audit?limit=${limit}${event ? `&event=${encodeURIComponent(event)}` : ""}`),
  workspaceProjects: () => request<{ projects: WorkspaceProject[] }>("/api/web/workspace/projects"),
  createWorkspaceProject: (name: string, root_path?: string) =>
    request<WorkspaceProject>("/api/web/workspace/projects", "POST", { name, root_path }),
  bindProjectRoot: (project_id: string, root_path: string) =>
    request<{ status: string; project_id: string; root_path: string }>("/api/web/workspace/projects/bind-root", "POST", { project_id, root_path }),
  inspectWorkspaceProject: (project_id: string) =>
    request<ProjectInspection>(`/api/web/workspace/project/inspect?project_id=${encodeURIComponent(project_id)}`),
  listProjectFiles: (project_id: string, subpath?: string) =>
    request<{ project_id: string; subpath: string; entries: ProjectFileEntry[] }>(`/api/web/workspace/project/files?project_id=${encodeURIComponent(project_id)}${subpath ? `&subpath=${encodeURIComponent(subpath)}` : ""}`),
  readProjectFile: (project_id: string, path: string) =>
    request<{ project_id: string; path: string; size: number; lines: number; content: string }>(`/api/web/workspace/project/file?project_id=${encodeURIComponent(project_id)}&path=${encodeURIComponent(path)}`),
  writeProjectFile: (project_id: string, path: string, content: string) =>
    request<{ status: string; project_id: string; path: string; bytes: number }>("/api/web/workspace/project/file", "POST", { project_id, path, content }),
  executeProjectCommand: (project_id: string, command: string, timeout = 15) =>
    request<CommandExecutionResult>("/api/web/workspace/project/command", "POST", { project_id, command, timeout }),
  startStreamingCommand: (project_id: string, command: string, timeout = 30) =>
    request<{ id: string; project_id: string; command: string; status: string }>("/api/web/workspace/project/command/stream", "POST", { project_id, command, timeout }),
  listenCommandStream: async (
    commandId: string,
    onEvent: (event: CommandStreamEvent) => void,
    onError: (err: string) => void,
    onDone: (exitCode: number, durationMs: number) => void
  ) => {
    const token = localStorage.getItem("omniops_token") || volatileWebToken || "";
    try {
      const response = await fetch(`/api/web/workspace/project/command/stream?command_id=${encodeURIComponent(commandId)}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        throw new Error(errorJson.error?.message || `HTTP ${response.status}`);
      }
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("مرورگر از دریافت پاسخ جریانی (Stream) پشتیبانی نمی‌کند.");
      }
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data:")) {
            try {
              const event: CommandStreamEvent = JSON.parse(trimmed.slice(5).trim());
              onEvent(event);
              if (event.type === "done") {
                onDone(event.exit_code ?? 0, event.duration_ms ?? 0);
                return;
              }
              if (event.type === "error") {
                onError(event.error || "خطای ناشناخته در استریم ترمینال");
                return;
              }
            } catch {
              // ignore json parse error
            }
          }
        }
      }
      onDone(0, 0);
    } catch (err) {
      onError(err instanceof Error ? err.message : "خطا در برقراری ارتباط استریم با سرور");
    }
  },
  startAgentRun: (project_id: string, prompt: string, role: AgentRole = "general", mode: AgentMode = "single", debug_mode = false) =>
    request<{ run: AgentRun }>("/api/web/workspace/task/run", "POST", { project_id, prompt, role, mode, debug_mode }),
  stepAgentRun: (run_id: string, action = "step", modified_command?: string, modified_prompt?: string) =>
    request<{ run: AgentRun }>("/api/web/workspace/task/run/debug/step", "POST", { run_id, action, modified_command, modified_prompt }),
  toggleAgentRunDebug: (run_id: string, debug_mode?: boolean) =>
    request<{ run: AgentRun }>("/api/web/workspace/task/run/debug/toggle", "POST", { run_id, debug_mode }),
  proposeFilePatch: (project_id: string, path: string, content: string, apply = false) =>
    request<FilePatchProposal>("/api/web/workspace/project/patch", "POST", { project_id, path, content, apply }),
  advanceAgentRun: (run_id: string) =>
    request<{ run: AgentRun }>("/api/web/workspace/task/run/advance", "POST", { run_id }),
  approveAgentRunStep: (run_id: string) =>
    request<{ run: AgentRun }>("/api/web/workspace/task/run/approve", "POST", { run_id }),
  cancelAgentRun: (run_id: string) =>
    request<{ run: AgentRun }>("/api/web/workspace/task/run/cancel", "POST", { run_id }),
  getAgentRun: (run_id: string) =>
    request<{ run: AgentRun }>(`/api/web/workspace/task/run?run_id=${encodeURIComponent(run_id)}`),
  listAgentRuns: (project_id: string) =>
    request<{ runs: AgentRun[] }>(`/api/web/workspace/task/runs?project_id=${encodeURIComponent(project_id)}`),
  adminAgentRuns: (limit = 50) =>
    request<{ runs: AgentRun[] }>(`/api/admin/workspace/agent/runs?limit=${limit}`),
  adminStopAgentRun: (run_id: string, reason?: string) =>
    request<{ run: AgentRun }>("/api/admin/workspace/agent/runs/stop", "POST", { run_id, reason }),
  adminApproveAgentRun: (run_id: string) =>
    request<{ run: AgentRun }>("/api/admin/workspace/agent/runs/approve", "POST", { run_id }),
  getSandboxPolicy: () =>
    request<{ policy: SandboxPolicy }>("/api/admin/workspace/sandbox/policy"),
  updateSandboxPolicy: (payload: Partial<SandboxPolicy>) =>
    request<{ policy: SandboxPolicy }>("/api/admin/workspace/sandbox/policy", "POST", payload),
  listProjectPatches: (project_id: string) =>
    request<{ patches: FilePatchRecord[] }>(`/api/web/workspace/project/patches?project_id=${encodeURIComponent(project_id)}`),
  rollbackProjectPatch: (patch_id: string) =>
    request<{ patch: FilePatchRecord }>("/api/web/workspace/project/patches/rollback", "POST", { patch_id }),
  listGovernanceWebhooks: () =>
    request<{ webhooks: GovernanceWebhook[] }>("/api/admin/workspace/webhooks"),
  saveGovernanceWebhook: (payload: Partial<GovernanceWebhook>) =>
    request<{ webhook: GovernanceWebhook }>("/api/admin/workspace/webhooks", "POST", payload),
  deleteGovernanceWebhook: (webhook_id: string) =>
    request<{ status: string; id: string }>("/api/admin/workspace/webhooks/delete", "POST", { webhook_id }),
  testGovernanceWebhook: (webhook_id: string) =>
    request<{ status: string; code: number; message: string }>("/api/admin/workspace/webhooks/test", "POST", { webhook_id }),
  searchProjectFiles: (payload: { project_id: string; query: string; case_sensitive?: boolean; max_results?: number; file_extensions?: string[] }) =>
    request<ProjectSearchResult>("/api/web/workspace/project/search", "POST", payload),
  listProjectCommands: (project_id: string, limit = 50) =>
    request<{ commands: CommandHistoryRecord[] }>(`/api/web/workspace/project/commands?project_id=${encodeURIComponent(project_id)}&limit=${limit}`),
  sendAgentRunFeedback: (run_id: string, message: string) =>
    request<{ run: AgentRun }>("/api/web/workspace/task/run/feedback", "POST", { run_id, message }),
  getProjectGitStatus: (project_id: string) =>
    request<GitStatusResult>(`/api/web/workspace/project/git/status?project_id=${encodeURIComponent(project_id)}`),
  listProjectArtifacts: (project_id: string, limit = 50) =>
    request<{ artifacts: ProjectArtifact[] }>(`/api/web/workspace/project/artifacts?project_id=${encodeURIComponent(project_id)}&limit=${limit}`),
  createProjectArtifact: (payload: { project_id: string; title: string; content: string; artifact_type?: string; run_id?: string }) =>
    request<{ artifact: ProjectArtifact }>("/api/web/workspace/project/artifacts", "POST", payload),
  deleteProjectArtifact: (project_id: string, artifact_id: string) =>
    request<{ status: string; artifact_id: string }>("/api/web/workspace/project/artifacts/delete", "POST", { project_id, artifact_id }),
  createSpec: (payload: { project_id: string; prompt: string; title?: string; requirements?: string; design_approach?: string; task_breakdown?: SpecTaskStep[]; auto_generate?: boolean }) =>
    request<{ spec: WorkspaceSpec }>("/api/web/workspace/spec/create", "POST", payload),
  updateSpec: (payload: { spec_id: string; title?: string; requirements?: string; design_approach?: string; task_breakdown?: SpecTaskStep[] }) =>
    request<{ spec: WorkspaceSpec }>("/api/web/workspace/spec/update", "POST", payload),
  approveSpec: (payload: { spec_id: string; role?: AgentRole; mode?: AgentMode; debug_mode?: boolean }) =>
    request<{ status: string; spec: WorkspaceSpec; run: AgentRun }>("/api/web/workspace/spec/approve", "POST", payload),
  rejectSpec: (payload: { spec_id: string; reason?: string }) =>
    request<{ status: string; spec: WorkspaceSpec }>("/api/web/workspace/spec/reject", "POST", payload),
  getSpec: (spec_id: string) =>
    request<{ spec: WorkspaceSpec }>(`/api/web/workspace/spec?spec_id=${encodeURIComponent(spec_id)}`),
  listSpecs: (project_id: string, limit = 50) =>
    request<{ specs: WorkspaceSpec[] }>(`/api/web/workspace/specs?project_id=${encodeURIComponent(project_id)}&limit=${limit}`),
};

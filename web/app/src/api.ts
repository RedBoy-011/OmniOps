export type Profile = {
  id: string;
  username: string;
  role: "superadmin" | "member";
  status: "active" | "pending" | "rejected";
  capabilities: string[];
};

export type ChatSession = { id: string; title: string; created_at: number; updated_at: number; message_count: number };
export type ChatHistory = { id: string; prompt: string; reply: string; model: string; created_at: number; session_id?: string | null };
export type MemoryNote = { id: string; content: string; created_at: number };
export type WorkspaceProject = { id: string; name: string; created_at: number };
export type WorkspaceAttachment = { id: string; project_id: string; name: string; mime: string; size: number; created_at: number };
export type TaskDraft = { id: string; project_id: string; description: string; status: "draft" | "cancelled"; created_at: number; updated_at: number };
export type PendingUser = { id: string; username: string; mobile: string; created_at: number };
export type LoginResult = { token: string; user: Profile; pending_count: number };
export type LocalModel = { id: string; size_bytes: number | null };
export type NodeStatus = { id: string; kind: "master" | "worker"; status: "up" | "no_models" | "unreachable"; checked_at: number; latency_ms?: number | null; models?: LocalModel[] };
export type ManagedNode = {
  id: string; role: "worker" | "edge"; name: string; created_at: number;
  last_seen: number | null; revoked_at: number | null; credential_expires_at: number;
  metrics: { version?: string; cpu_percent?: number; ram_percent?: number;
             disk_percent?: number; models?: string[] } | null;
};
export type ModelPull = { id: string; node_id: string; model: string; action: "pull" | "delete";
  status: "queued" | "running" | "completed" | "failed"; progress: number | null;
  detail: string; created_at: number; updated_at: number };
export type ApiProvider = { kind: "openai" | "gemini" | "anthropic" | "openrouter"; configured: boolean;
  enabled: boolean; network_mode: "direct" | "socks"; proxy_url: string;
  models: string[]; tested_at: number | null;
  prices: Record<string, { input: string; output: string }>;
  catalog_prices: Record<string, { input: string; output: string }> };
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

export type Operations = {
  master: "up";
  hardware?: SystemMetrics;
  ollama: { url: string; status: NodeStatus["status"]; models: LocalModel[] };
  nodes: NodeStatus[];
};

let volatileWebToken: string | null = null;
export function keepSessionInMemory(token: string) { volatileWebToken = token; }
export function forgetSession() { volatileWebToken = null; }

async function request<T>(path: string, method = "GET", payload?: object): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (volatileWebToken) headers.Authorization = `Bearer ${volatileWebToken}`;
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

export const api = {
  login: (username: string, password: string) => request<LoginResult>("/api/auth/login", "POST", { username, password }),
  register: (username: string, password: string, mobile: string) => request<{ status: string; message: string }>("/api/auth/register", "POST", { username, password, mobile }),
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
    include_system_context?: boolean
  ) =>
    request<{ reply: string; model: string }>("/api/web/chat", "POST", {
      message,
      model,
      allow_external,
      save_history,
      attached_file,
      session_id,
      include_system_context,
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
    onError: (err: string) => void
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
  modelPulls: () => request<{ jobs: ModelPull[] }>("/api/admin/nodes/model-pulls"),
  createModelPull: (node_id: string, model: string) => request<{ id: string; status: string }>("/api/admin/nodes/model-pulls", "POST", { node_id, model }),
  deleteModel: (node_id: string, model: string) => request<{ id: string; status: string }>("/api/admin/nodes/model-delete", "POST", { node_id, model }),
  providers: () => request<{ providers: ApiProvider[] }>("/api/admin/providers"),
  saveProvider: (kind: string, api_key: string | null, network_mode: "direct" | "socks", proxy_url: string) =>
    request<{ status: string }>("/api/admin/providers/save", "POST", { kind, api_key, network_mode, proxy_url }),
  testProvider: (kind: string) => request<{ models: string[]; network_mode: string }>("/api/admin/providers/test", "POST", { kind }),
  testSocks: (proxy_url?: string, kind?: string) =>
    request<{ status: string; latency_ms: number; proxy_url: string; message: string }>("/api/admin/providers/test-socks", "POST", { proxy_url, kind }),
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
};

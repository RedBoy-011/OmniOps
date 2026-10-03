export type Profile = {
  id: string;
  username: string;
  role: "superadmin" | "member";
  status: "active" | "pending" | "rejected";
  capabilities: string[];
};

export type ChatHistory = { id: string; prompt: string; reply: string; model: string; created_at: number };
export type MemoryNote = { id: string; content: string; created_at: number };
export type WorkspaceProject = { id: string; name: string; created_at: number };
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
export type Operations = { master: "up"; ollama: { url: string; status: NodeStatus["status"]; models: LocalModel[] }; nodes: NodeStatus[] };

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
  webChat: (message: string, model: string, allow_external = false, save_history = false) => request<{ reply: string; model: string }>("/api/web/chat", "POST", { message, model, allow_external, save_history }),
  projects: () => request<{ projects: WorkspaceProject[] }>("/api/web/workspace/projects"),
  createProject: (name: string) => request<{ id: string; name: string }>("/api/web/workspace/projects", "POST", { name }),
  taskDrafts: () => request<{ tasks: TaskDraft[] }>("/api/web/workspace/tasks"),
  createTaskDraft: (project_id: string, description: string) => request<{ id: string; status: string }>("/api/web/workspace/tasks", "POST", { project_id, description }),
  cancelTaskDraft: (id: string) => request<{ status: string }>("/api/web/workspace/tasks/cancel", "POST", { id }),
  chatHistory: () => request<{ entries: ChatHistory[] }>("/api/chat/history"),
  clearChatHistory: () => request<{ status: string }>("/api/chat/history/clear", "POST", {}),
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
  enableProvider: (kind: string, enabled: boolean) => request<{ enabled: boolean }>("/api/admin/providers/enable", "POST", { kind, enabled }),
  priceProvider: (kind: string, model: string, input: string, output: string) =>
    request<{ model: string }>("/api/admin/providers/price", "POST", { kind, model, input, output }),
  issueNodeGrant: (role: "worker" | "edge") => request<NodeGrant>("/api/admin/nodes/grants", "POST", { role }),
  revokeNodeGrant: (id: string) => request<{ status: string }>("/api/admin/nodes/grants/revoke", "POST", { id }),
  revokeNode: (id: string) => request<{ status: string }>("/api/admin/nodes/revoke", "POST", { id }),
  saveOllamaEndpoint: (url: string) => request<Operations["ollama"]>("/api/admin/ollama-endpoint", "POST", { url }),
  approve: (id: string, capabilities: string[]) => request<{ status: string }>(`/api/admin/pending/${encodeURIComponent(id)}/approve`, "POST", { capabilities }),
  reject: (id: string) => request<{ status: string }>(`/api/admin/pending/${encodeURIComponent(id)}/reject`, "POST", {}),
  issuePairing: () => request<{ code: string; expires_at: number }>("/api/agent/pairing", "POST", {}),
  logout: () => request<{ status: string }>("/api/auth/logout", "POST", {}),
};

export type Profile = {
  id: string;
  username: string;
  role: "superadmin" | "member";
  status: "active" | "pending" | "rejected";
  capabilities: string[];
};

export type PendingUser = { id: string; username: string; mobile: string; created_at: number };
export type LoginResult = { token: string; user: Profile; pending_count: number };
export type LocalModel = { id: string; size_bytes: number | null };
export type NodeStatus = { id: string; kind: "master" | "worker"; status: "up" | "no_models" | "unreachable"; checked_at: number; latency_ms?: number | null; models?: LocalModel[] };
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
  saveOllamaEndpoint: (url: string) => request<Operations["ollama"]>("/api/admin/ollama-endpoint", "POST", { url }),
  approve: (id: string, capabilities: string[]) => request<{ status: string }>(`/api/admin/pending/${encodeURIComponent(id)}/approve`, "POST", { capabilities }),
  reject: (id: string) => request<{ status: string }>(`/api/admin/pending/${encodeURIComponent(id)}/reject`, "POST", {}),
  issuePairing: () => request<{ code: string; expires_at: number }>("/api/agent/pairing", "POST", {}),
  logout: () => request<{ status: string }>("/api/auth/logout", "POST", {}),
};

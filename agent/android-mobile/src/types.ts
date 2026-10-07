export type LoginMethod = "credentials" | "short_code";

export interface UserProfile {
  id: string;
  username: string;
  role: string;
  organization: string;
  token: string;
  linkedWindowsAgentId?: string;
  linkedWindowsAgentName?: string;
}

export interface ChatMessage {
  id: string;
  sender: "user" | "assistant" | "system";
  text: string;
  images?: string[];
  model?: string;
  promptCacheTokens?: number;
  rtkSavingsPercent?: number;
  timestamp: number;
  executedOnWindows?: boolean;
}

export interface RemoteTask {
  id: string;
  title: string;
  project: string;
  status: "queued" | "in_progress" | "completed" | "failed";
  targetWindowsAgent: string;
  resultOutput?: string;
  timestamp: number;
}

export interface AgentPresenceStatus {
  windowsOnline: boolean;
  linkedAgentName?: string;
  lastChecked: number;
}

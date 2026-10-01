import { useState } from "react";
import { AuthPage } from "./AuthPage";
import { AdminPanel } from "./AdminPanel";
import { api, forgetSession, keepSessionInMemory, type LoginResult } from "./api";

export default function App() {
  const [session, setSession] = useState<LoginResult | null>(null);
  function signedIn(result: LoginResult) {
    keepSessionInMemory(result.token);
    setSession(result);
  }
  function logout() {
    void api.logout().catch(() => undefined).finally(() => { forgetSession(); setSession(null); });
  }
  return session
    ? <AdminPanel user={session.user} initialPending={session.pending_count} onLogout={logout} />
    : <AuthPage onLogin={signedIn} />;
}

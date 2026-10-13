import { useState, useEffect } from "react";
import { AuthPage } from "./AuthPage";
import { AdminPanel } from "./AdminPanel";
import { api, forgetSession, keepSessionInMemory, getStoredToken, type LoginResult } from "./api";

export default function App() {
  const [session, setSession] = useState<LoginResult | null>(() => {
    const token = getStoredToken();
    const userJson = typeof localStorage !== "undefined" ? localStorage.getItem("omniops_user") : null;
    const pendingStr = typeof localStorage !== "undefined" ? localStorage.getItem("omniops_pending_count") : null;
    if (token && userJson) {
      try {
        const user = JSON.parse(userJson);
        return { token, user, pending_count: pendingStr ? Number(pendingStr) : 0 };
      } catch {}
    }
    return null;
  });

  // Verify and sync token in background on mount
  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;
    api.me()
      .then((res) => {
        setSession((prev) => {
          const updated = prev ? { ...prev, user: res.user } : { token, user: res.user, pending_count: res.pending_count ?? 0 };
          try {
            localStorage.setItem("omniops_user", JSON.stringify(res.user));
            if (res.pending_count !== undefined) {
              localStorage.setItem("omniops_pending_count", String(res.pending_count));
            }
          } catch {}
          return updated;
        });
      })
      .catch(() => {
        // Token expired or invalid
        forgetSession();
        setSession(null);
      });
  }, []);

  function signedIn(result: LoginResult) {
    keepSessionInMemory(result.token);
    try {
      localStorage.setItem("omniops_user", JSON.stringify(result.user));
      if (result.pending_count !== undefined) {
        localStorage.setItem("omniops_pending_count", String(result.pending_count));
      }
    } catch {}
    setSession(result);
  }

  function logout() {
    void api.logout().catch(() => undefined).finally(() => {
      forgetSession();
      setSession(null);
    });
  }

  return session
    ? <AdminPanel user={session.user} initialPending={session.pending_count} onLogout={logout} />
    : <AuthPage onLogin={signedIn} />;
}


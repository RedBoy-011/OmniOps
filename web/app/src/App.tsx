import { useState, useEffect } from "react";
import { AuthPage } from "./AuthPage";
import { AdminPanel } from "./AdminPanel";
import { UserWorkspace } from "./UserWorkspace";
import { api, forgetSession, keepSessionInMemory, getStoredToken, type LoginResult } from "./api";
import { applyThemePalette, getActiveThemePalette } from "./design-system/tokens";

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

  const [plane, setPlane] = useState<"admin" | "workspace">("workspace");

  // Sync global theme on startup from backend or saved storage
  useEffect(() => {
    applyThemePalette(getActiveThemePalette());
    api.getTheme()
      .then((res) => {
        if (res.active_palette) {
          applyThemePalette(res.active_palette);
        }
      })
      .catch(() => undefined);
  }, []);

  // Sync plane when session is initialized or user role changes
  useEffect(() => {
    if (session?.user.role === "superadmin") {
      setPlane("admin");
    } else {
      setPlane("workspace");
    }
  }, [session?.user.role]);

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
    setPlane(result.user.role === "superadmin" ? "admin" : "workspace");
  }

  function logout() {
    void api.logout().catch(() => undefined).finally(() => {
      forgetSession();
      setSession(null);
      setPlane("workspace");
    });
  }

  if (!session) {
    return <AuthPage onLogin={signedIn} />;
  }

  const isSuperadmin = session.user.role === "superadmin";

  // For superadmin, allow toggling between Admin Mission Control and User AI Workspace
  if (isSuperadmin) {
    return plane === "admin" ? (
      <AdminPanel
        user={session.user}
        initialPending={session.pending_count}
        onLogout={logout}
        onSwitchToWorkspace={() => setPlane("workspace")}
      />
    ) : (
      <UserWorkspace
        user={session.user}
        onLogout={logout}
        onSwitchToAdmin={() => setPlane("admin")}
      />
    );
  }

  // Regular users are strictly routed to UserWorkspace with NO admin switcher
  return <UserWorkspace user={session.user} onLogout={logout} />;
}

// OmniOps Mobile Operator Controller
// Provides seamless 6-digit PIN pairing, biometric approval gates,
// Windows process continuation, and live command dispatching.

document.addEventListener("DOMContentLoaded", () => {
  // DOM Elements
  const authView = document.getElementById("authView");
  const operatorView = document.getElementById("operatorView");

  // Header Elements
  const connPill = document.getElementById("connPill");
  const connDot = document.getElementById("connDot");
  const connStatusText = document.getElementById("connStatusText");
  const btnMobileTheme = document.getElementById("btnMobileTheme");
  const agentOfflineBanner = document.getElementById("agentOfflineBanner");

  // Projects Section Elements (Phase 7)
  const activeProjectsCountBadge = document.getElementById("activeProjectsCountBadge");
  const activeProjectsContainer = document.getElementById("activeProjectsContainer");

  // Auth Elements
  const serverUrlInput = document.getElementById("serverUrlInput");
  const tabPinBtn = document.getElementById("tabPinBtn");
  const tabLoginBtn = document.getElementById("tabLoginBtn");
  const tabPinContent = document.getElementById("tabPinContent");
  const tabLoginContent = document.getElementById("tabLoginContent");
  const pinInput = document.getElementById("pinInput");
  const btnRedeemPin = document.getElementById("btnRedeemPin");
  const loginUsername = document.getElementById("loginUsername");
  const loginPassword = document.getElementById("loginPassword");
  const btnLogin = document.getElementById("btnLogin");
  const authAlert = document.getElementById("authAlert");

  // Session Bar Elements
  const globalSessionBar = document.getElementById("globalSessionBar");
  const sessionUsername = document.getElementById("sessionUsername");
  const sessionRole = document.getElementById("sessionRole");
  const sessionServer = document.getElementById("sessionServer");
  const btnRefreshStatus = document.getElementById("btnRefreshStatus");
  const btnLogout = document.getElementById("btnLogout");

  // Navigation Tabs Elements
  const appNavTabs = document.getElementById("appNavTabs");
  const navTabConsole = document.getElementById("navTabConsole");
  const navTabChat = document.getElementById("navTabChat");

  // AI Chatbot Elements
  const chatView = document.getElementById("chatView");
  const chatModelSelect = document.getElementById("chatModelSelect");
  const chatSaveHistoryToggle = document.getElementById("chatSaveHistoryToggle");
  const btnClearChatHistory = document.getElementById("btnClearChatHistory");
  const chatMessagesStream = document.getElementById("chatMessagesStream");
  const chatWelcomeCard = document.getElementById("chatWelcomeCard");
  const chatTypingIndicator = document.getElementById("chatTypingIndicator");
  const chatInputPrompt = document.getElementById("chatInputPrompt");
  const btnSendChatPrompt = document.getElementById("btnSendChatPrompt");

  // Windows Node Elements
  const targetNodeName = document.getElementById("targetNodeName");
  const nodeStatusPill = document.getElementById("nodeStatusPill");
  const quotaInfo = document.getElementById("quotaInfo");
  const btnGeneratePin = document.getElementById("btnGeneratePin");
  const pinDisplayCard = document.getElementById("pinDisplayCard");
  const generatedPinCode = document.getElementById("generatedPinCode");
  const btnCopyPin = document.getElementById("btnCopyPin");
  const pinProgress = document.getElementById("pinProgress");

  // Approval Gate & Process Elements
  const pendingApprovalsList = document.getElementById("pendingApprovalsList");
  const customCmdInput = document.getElementById("customCmdInput");
  const customCmdRisk = document.getElementById("customCmdRisk");
  const btnDispatchCustom = document.getElementById("btnDispatchCustom");
  const commandHistoryList = document.getElementById("commandHistoryList");
  const btnKillSwitch = document.getElementById("btnKillSwitch");
  const floatingToggle = document.getElementById("floatingToggle");
  const btnOpenDesktop = document.getElementById("btnOpenDesktop");

  // Modal Elements
  const outputModal = document.getElementById("outputModal");
  const modalCmdTitle = document.getElementById("modalCmdTitle");
  const modalCmdStatus = document.getElementById("modalCmdStatus");
  const modalCmdTime = document.getElementById("modalCmdTime");
  const modalCmdOutput = document.getElementById("modalCmdOutput");
  const btnCloseModal = document.getElementById("btnCloseModal");

  // Helper: Convert Persian/Arabic digits to ASCII 0-9
  function toAsciiDigits(str) {
    if (!str || typeof str !== "string") return "";
    return str
      .replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1776 + 48))
      .replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1632 + 48));
  }

  // Helper: Bridge or Native Fetch fallback
  function universalFetch(url, options = {}) {
    if (window.OmniOpsBridge && typeof window.OmniOpsBridge.httpRequest === "function") {
      return new Promise((resolve, reject) => {
        const callbackName = "__omniops_cb_" + Math.random().toString(36).slice(2);
        const method = options.method || "GET";
        const headers = options.headers || {};
        const body = options.body || "";

        window[callbackName] = (status, responseText) => {
          delete window[callbackName];
          if (status === -1) {
            reject(new Error(responseText || "خطا در اتصال شبکه به سرور"));
          } else {
            resolve({
              ok: status >= 200 && status < 300,
              status: status,
              text: async () => responseText,
              json: async () => {
                try {
                  return JSON.parse(responseText);
                } catch {
                  return { raw: responseText };
                }
              },
            });
          }
        };

        window.OmniOpsBridge.httpRequest(url, method, JSON.stringify(headers), body, callbackName);
      });
    }

    return fetch(url, options);
  }

  // Helper: Smart URL Normalization
  function normalizeServerUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return "";
    let clean = toAsciiDigits(rawUrl.trim());
    if (!clean) return "";
    clean = clean.replace(/\/+$/, "");
    if (!clean.startsWith("http://") && !clean.startsWith("https://")) {
      clean = "http://" + clean;
    }
    try {
      const u = new URL(clean);
      if (!u.port) {
        if (/^(\d{1,3}\.){3}\d{1,3}$/.test(u.hostname) || u.hostname === "localhost") {
          u.port = "9000";
          clean = u.origin;
        }
      } else {
        clean = u.origin;
      }
    } catch (e) {}
    return clean;
  }

  // State Variables
  let currentServerUrl = "";
  let currentToken = "";
  let currentOperator = { username: "", role: "operator" };
  let pollingInterval = null;
  let pinTimerInterval = null;
  let activePendingApprovalId = null;
  const AVAILABLE_PALETTES = ["magenta", "cyan", "emerald", "amber", "indigo"];
  let currentPalette = "magenta";
  let currentAgentState = "inactive";
  let currentActiveTab = "console";
  let heartbeatInterval = null;
  let consecutiveAuthErrors = 0;
  let isChatSending = false;

  // Theme Management (Phase 1, 2, 8)
  function applyThemePalette(palette) {
    if (!palette || !AVAILABLE_PALETTES.includes(palette)) palette = "magenta";
    currentPalette = palette;
    document.documentElement.setAttribute("data-theme-palette", palette);
    try {
      localStorage.setItem("omniops_theme_palette", palette);
    } catch (e) {}
  }

  try {
    const savedPalette = localStorage.getItem("omniops_theme_palette");
    if (savedPalette && AVAILABLE_PALETTES.includes(savedPalette)) {
      applyThemePalette(savedPalette);
    }
  } catch (e) {}

  async function syncServerTheme() {
    const srv = normalizeServerUrl(currentServerUrl || (serverUrlInput ? serverUrlInput.value : ""));
    if (!srv) return;
    try {
      const res = await universalFetch(`${srv}/api/theme`);
      if (res.ok) {
        const data = await res.json();
        if (data.palette && AVAILABLE_PALETTES.includes(data.palette)) {
          applyThemePalette(data.palette);
        }
      }
    } catch (e) {}
  }

  if (btnMobileTheme) {
    btnMobileTheme.addEventListener("click", () => {
      const idx = AVAILABLE_PALETTES.indexOf(currentPalette);
      const nextPalette = AVAILABLE_PALETTES[(idx + 1) % AVAILABLE_PALETTES.length];
      applyThemePalette(nextPalette);
      if (window.OmniOpsBridge && typeof window.OmniOpsBridge.vibrateDevice === "function") {
        window.OmniOpsBridge.vibrateDevice(35);
      }
      if (currentToken && currentServerUrl) {
        universalFetch(`${currentServerUrl}/api/admin/theme`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${currentToken}`,
          },
          body: JSON.stringify({ palette: nextPalette }),
        }).catch(() => {});
      }
    });
  }

  // Initialize from Bridge / LocalStorage
  loadInitialSession();
  syncServerTheme();

  function loadInitialSession() {
    let saved = null;
    if (window.OmniOpsBridge && typeof window.OmniOpsBridge.getSession === "function") {
      try {
        saved = JSON.parse(window.OmniOpsBridge.getSession());
      } catch (e) {}
    }
    if (!saved || !saved.token) {
      try {
        const local = localStorage.getItem("omniops_mobile_session");
        if (local) saved = JSON.parse(local);
      } catch (e) {}
    }

    if (saved && saved.serverUrl) {
      currentServerUrl = normalizeServerUrl(saved.serverUrl);
      serverUrlInput.value = currentServerUrl;
    } else {
      currentServerUrl = "";
      serverUrlInput.value = "";
    }

    if (saved && saved.token) {
      currentToken = saved.token;
      currentOperator.username = saved.username || "operator";
      currentOperator.role = saved.role || "operator";
      showOperatorConsole();
    } else {
      showAuthScreen();
    }
  }

  function saveSession(serverUrl, token, username, role) {
    currentServerUrl = serverUrl.replace(/\/+$/, "");
    currentToken = token;
    currentOperator.username = username || "admin";
    currentOperator.role = role || "operator";

    const data = {
      serverUrl: currentServerUrl,
      token: currentToken,
      username: currentOperator.username,
      role: currentOperator.role,
    };

    try {
      localStorage.setItem("omniops_mobile_session", JSON.stringify(data));
    } catch (e) {}

    if (window.OmniOpsBridge && typeof window.OmniOpsBridge.saveSession === "function") {
      window.OmniOpsBridge.saveSession(currentServerUrl, token, currentOperator.username, currentOperator.role);
    }
  }

  function clearSession() {
    currentToken = "";
    try {
      localStorage.removeItem("omniops_mobile_session");
    } catch (e) {}

    if (window.OmniOpsBridge && typeof window.OmniOpsBridge.clearSession === "function") {
      window.OmniOpsBridge.clearSession();
    }
    stopPolling();
    stopHeartbeat();
    showAuthScreen();
  }

  // View Navigation
  function showAuthScreen() {
    authView.classList.add("active");
    operatorView.classList.remove("active");
    operatorView.style.display = "none";
    if (chatView) {
      chatView.classList.remove("active");
      chatView.style.display = "none";
    }
    if (globalSessionBar) globalSessionBar.style.display = "none";
    if (appNavTabs) appNavTabs.style.display = "none";
    stopPolling();
    stopHeartbeat();
    updateConnectionStatus("offline", "آفلاین");
  }

  function showOperatorConsole() {
    authView.classList.remove("active");
    if (globalSessionBar) globalSessionBar.style.display = "flex";
    if (appNavTabs) appNavTabs.style.display = "flex";

    sessionUsername.innerText = currentOperator.username;
    sessionRole.innerText = currentOperator.role === "admin" ? "مدیر کل سیستم" : "اپراتور همراه";
    try {
      const urlObj = new URL(currentServerUrl);
      sessionServer.innerText = urlObj.host;
    } catch (e) {
      sessionServer.innerText = currentServerUrl;
    }

    switchAppTab(currentActiveTab);
    startPolling();
    startHeartbeat();
    refreshAllData();
    loadChatModels();
  }

  function switchAppTab(tab) {
    currentActiveTab = tab;
    if (tab === "chat") {
      if (navTabChat) navTabChat.classList.add("active");
      if (navTabConsole) navTabConsole.classList.remove("active");
      operatorView.classList.remove("active");
      operatorView.style.display = "none";
      if (chatView) {
        chatView.classList.add("active");
        chatView.style.display = "flex";
      }
      scrollChatToBottom();
      if (chatInputPrompt) chatInputPrompt.focus();
    } else {
      if (navTabConsole) navTabConsole.classList.add("active");
      if (navTabChat) navTabChat.classList.remove("active");
      if (chatView) {
        chatView.classList.remove("active");
        chatView.style.display = "none";
      }
      operatorView.classList.add("active");
      operatorView.style.display = "flex";
    }
  }

  if (navTabConsole) navTabConsole.addEventListener("click", () => switchAppTab("console"));
  if (navTabChat) navTabChat.addEventListener("click", () => switchAppTab("chat"));

  function updateConnectionStatus(state, text) {
    connDot.className = "status-dot " + state;
    connStatusText.innerText = text;
  }

  function showAuthAlert(msg, type = "error") {
    authAlert.className = "auth-alert " + type;
    authAlert.innerText = msg;
    authAlert.style.display = "block";
    if (type === "error" && window.OmniOpsBridge && typeof window.OmniOpsBridge.vibrateDevice === "function") {
      window.OmniOpsBridge.vibrateDevice(200);
    }
  }

  function hideAuthAlert() {
    authAlert.style.display = "none";
  }

  // Tab Switching
  tabPinBtn.addEventListener("click", () => {
    tabPinBtn.classList.add("active");
    tabLoginBtn.classList.remove("active");
    tabPinContent.classList.add("active");
    tabLoginContent.classList.remove("active");
    hideAuthAlert();
    pinInput.focus();
  });

  tabLoginBtn.addEventListener("click", () => {
    tabLoginBtn.classList.add("active");
    tabPinBtn.classList.remove("active");
    tabLoginContent.classList.add("active");
    tabPinContent.classList.remove("active");
    hideAuthAlert();
  });

  // Auto-format PIN input
  pinInput.addEventListener("input", (e) => {
    const raw = toAsciiDigits(e.target.value);
    e.target.value = raw.replace(/\D/g, "").slice(0, 6);
    if (e.target.value.length === 6) {
      redeemPairingCode(e.target.value);
    }
  });

  // 1. Redeem 6-Digit PIN Pairing
  btnRedeemPin.addEventListener("click", () => {
    const pin = toAsciiDigits(pinInput.value.trim()).replace(/\D/g, "");
    if (pin.length !== 6) {
      showAuthAlert("لطفاً یک کد ۶ رقمی معتبر وارد نمایید.");
      return;
    }
    redeemPairingCode(pin);
  });

  async function redeemPairingCode(pin) {
    const cleanPin = toAsciiDigits(pin).replace(/\D/g, "");
    const rawSrv = (serverUrlInput ? serverUrlInput.value.trim() : "") || currentServerUrl;
    const srv = normalizeServerUrl(rawSrv);
    if (!srv) {
      showAuthAlert("لطفاً نشانی سرور را وارد نمایید (مثال: 192.168.1.50:9000 یا 172.19.30.94:9443).");
      return;
    }

    currentServerUrl = srv;
    serverUrlInput.value = srv;
    hideAuthAlert();
    btnRedeemPin.disabled = true;
    btnRedeemPin.innerText = "در حال احراز هویت با هسته...";

    const deviceId = "mobile-op-" + Math.floor(Math.random() * 899999 + 100000);

    try {
      const resp = await universalFetch(`${srv}/api/agent/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: cleanPin, device_id: deviceId }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error?.message || "کد ۶ رقمی نامعتبر است یا منقضی شده است.");
      }

      if (window.OmniOpsBridge && typeof window.OmniOpsBridge.vibrateDevice === "function") {
        window.OmniOpsBridge.vibrateDevice(60);
      }
      if (window.OmniOpsBridge && typeof window.OmniOpsBridge.showToast === "function") {
        window.OmniOpsBridge.showToast("اتصال با کد ۶ رقمی موفقیت‌آمیز بود.");
      }

      saveSession(srv, data.token, data.profile?.username || data.user?.username || "paired_operator", data.profile?.role || data.user?.role || "operator");
      pinInput.value = "";
      showOperatorConsole();
    } catch (err) {
      showAuthAlert(err.message || `خطا در اتصال به سرور در نشانی ${srv}.`);
    } finally {
      btnRedeemPin.disabled = false;
      btnRedeemPin.innerHTML = `<span>⚡</span><span>اتصال و احراز هویت با کد ۶ رقمی</span>`;
    }
  }

  // 2. Login with Credentials
  btnLogin.addEventListener("click", async () => {
    const rawSrv = (serverUrlInput ? serverUrlInput.value.trim() : "") || currentServerUrl;
    const srv = normalizeServerUrl(rawSrv);
    const user = toAsciiDigits(loginUsername.value.trim());
    const pass = toAsciiDigits(loginPassword.value);

    if (!srv) {
      showAuthAlert("لطفاً نشانی سرور را وارد نمایید (مثال: 192.168.1.50:9000 یا 172.19.30.94:9443).");
      return;
    }

    if (!user || !pass) {
      showAuthAlert("نام کاربری و کلمه عبور الزامی است.");
      return;
    }

    currentServerUrl = srv;
    serverUrlInput.value = srv;
    hideAuthAlert();
    btnLogin.disabled = true;
    btnLogin.innerText = "در حال اعتبارسنجی...";

    try {
      const resp = await universalFetch(`${srv}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, password: pass }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error?.message || "نام کاربری یا رمز عبور اشتباه است.");
      }

      if (window.OmniOpsBridge && typeof window.OmniOpsBridge.vibrateDevice === "function") {
        window.OmniOpsBridge.vibrateDevice(60);
      }

      saveSession(srv, data.token, data.user?.username || data.profile?.username || user, data.user?.role || data.profile?.role || "admin");
      showOperatorConsole();
    } catch (err) {
      showAuthAlert(err.message || `خطا در اتصال به سرور در نشانی ${srv}.`);
    } finally {
      btnLogin.disabled = false;
      btnLogin.innerHTML = `<span>🚀</span><span>ورود به کنسول عملیاتی</span>`;
    }
  });

  // Logout / Refresh
  btnLogout.addEventListener("click", () => {
    if (confirm("آیا مایل به قطع ارتباط و خروج از محیط اپراتور هستید؟")) {
      clearSession();
    }
  });

  btnRefreshStatus.addEventListener("click", () => {
    refreshAllData();
    if (window.OmniOpsBridge && typeof window.OmniOpsBridge.vibrateDevice === "function") {
      window.OmniOpsBridge.vibrateDevice(40);
    }
  });

  // 3. Data Polling and Heartbeat
  function startPolling() {
    stopPolling();
    pollingInterval = setInterval(refreshAllData, 3000);
  }

  function stopPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = null;
  }

  function startHeartbeat() {
    stopHeartbeat();
    pingHeartbeat();
    heartbeatInterval = setInterval(pingHeartbeat, 15000);
  }

  function stopHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  async function pingHeartbeat() {
    if (!currentToken || !currentServerUrl) return;
    try {
      await universalFetch(`${currentServerUrl}/api/agent/heartbeat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({}),
      });
    } catch (e) {}
  }

  function setLocalControlsDisabled(disabled) {
    if (btnDispatchCustom) btnDispatchCustom.disabled = disabled;
    document.querySelectorAll(".quick-action-tile").forEach((tile) => {
      if (disabled) tile.classList.add("offline-locked");
      else tile.classList.remove("offline-locked");
    });
  }

  async function refreshAllData() {
    if (!currentToken) return;
    const startTime = performance.now();

    try {
      // 1. Fetch Status with explicit agent liveness
      const statusRes = await universalFetch(`${currentServerUrl}/api/mobile/status`, {
        headers: { Authorization: `Bearer ${currentToken}` },
      });

      if (statusRes.status === 401) {
        consecutiveAuthErrors++;
        if (consecutiveAuthErrors >= 3) {
          clearSession();
        } else {
          pingHeartbeat();
        }
        return;
      }
      consecutiveAuthErrors = 0;

      if (statusRes.ok) {
        const latency = Math.round(performance.now() - startTime);
        updateConnectionStatus("online", `برخط (${latency}ms)`);

        const sData = await statusRes.json();
        targetNodeName.innerText = sData.node_name || "LOUIS-PC";
        currentAgentState = sData.agent_state || (sData.status === "online" ? "available" : "inactive");

        if (currentAgentState === "available") {
          nodeStatusPill.className = "status-badge-available";
          nodeStatusPill.innerText = "🟢 در دسترس (Available)";
          if (agentOfflineBanner) agentOfflineBanner.style.display = "none";
          setLocalControlsDisabled(false);
        } else if (currentAgentState === "busy") {
          nodeStatusPill.className = "status-badge-busy";
          nodeStatusPill.innerText = "🟡 مشغول (Busy)";
          if (agentOfflineBanner) agentOfflineBanner.style.display = "none";
          setLocalControlsDisabled(false);
        } else {
          nodeStatusPill.className = "status-badge-inactive";
          nodeStatusPill.innerText = "🔴 غیرفعال (Offline)";
          if (agentOfflineBanner) agentOfflineBanner.style.display = "flex";
          setLocalControlsDisabled(true);
        }

        if (sData.plan_usage) {
          quotaInfo.innerText = `${sData.plan_usage.remaining || "۳۶۰,۰۰۰"} باقیمانده`;
        }
      } else {
        updateConnectionStatus("offline", "خطای ارتباط");
        currentAgentState = "inactive";
        if (agentOfflineBanner) agentOfflineBanner.style.display = "flex";
        setLocalControlsDisabled(true);
      }

      // 2. Fetch Active Projects & Runs (Phase 7)
      try {
        const projRes = await universalFetch(`${currentServerUrl}/api/mobile/projects`, {
          headers: { Authorization: `Bearer ${currentToken}` },
        });
        if (projRes.ok) {
          const pData = await projRes.json();
          renderActiveProjects(pData.runs || [], currentAgentState);
        }
      } catch (pe) {}

      // 3. Fetch Pending Approvals
      const appRes = await universalFetch(`${currentServerUrl}/api/mobile/approvals/pending`, {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      if (appRes.ok) {
        const aData = await appRes.json();
        renderApprovals(aData.requests || []);
      }

      // 4. Fetch Command History
      const cmdRes = await universalFetch(`${currentServerUrl}/api/mobile/commands/history?limit=25`, {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      if (cmdRes.ok) {
        const cData = await cmdRes.json();
        renderHistory(cData.commands || []);
      }
    } catch (e) {
      updateConnectionStatus("offline", "قطع ارتباط");
      currentAgentState = "inactive";
      if (agentOfflineBanner) agentOfflineBanner.style.display = "flex";
      setLocalControlsDisabled(true);
    }
  }

  // Active Projects Rendering & Steering (Phase 7)
  function renderActiveProjects(runs, agentState) {
    if (!activeProjectsContainer) return;

    if (agentState === "inactive") {
      if (activeProjectsCountBadge) {
        activeProjectsCountBadge.innerText = "ایجنت آفلاین";
        activeProjectsCountBadge.className = "badge badge-danger";
      }
      activeProjectsContainer.innerHTML = `
        <div class="empty-state">
          <span>⚠️</span>
          <p style="color:#f87171; font-weight:700;">ایجنت ویندوز غیرفعال است</p>
          <p style="font-size:11px; color:#fca5a5;">مشاهده و هدایت پروژه‌ها و فرآیندهای ویندوز فقط هنگام آنلاین بودن ایجنت امکان‌پذیر است.</p>
        </div>
      `;
      return;
    }

    const activeRuns = (runs || []).filter((r) =>
      ["in_progress", "planning", "paused_debug", "waiting_approval"].includes(r.status)
    );

    if (activeProjectsCountBadge) {
      activeProjectsCountBadge.innerText = `${activeRuns.length} در حال اجرا`;
      activeProjectsCountBadge.className = activeRuns.length > 0 ? "badge badge-cyan" : "badge";
    }

    if (activeRuns.length === 0) {
      activeProjectsContainer.innerHTML = `
        <div class="empty-state">
          <span>✨</span>
          <p>در حال حاضر هیچ فرآیند فعال یا در انتظاری در ایجنت ویندوز وجود ندارد.</p>
        </div>
      `;
      return;
    }

    activeProjectsContainer.innerHTML = activeRuns
      .map((run) => {
        const pName = escapeHtml(run.project_name || "پروژه ویندوز");
        const prompt = escapeHtml(run.prompt || "فرآیند خودکار ایجنت");
        const step =
          run.current_step_index !== undefined ? `گام ${run.current_step_index + 1}` : "در حال پردازش";
        const statusBadge =
          run.status === "paused_debug"
            ? '<span class="badge badge-warning">متوقف موقت</span>'
            : '<span class="badge badge-cyan">در حال پردازش</span>';

        return `
          <div class="project-run-card" data-run-id="${run.id}">
            <div class="run-card-header">
              <span class="run-card-title">🚀 ${pName}</span>
              <div style="display:flex; gap:6px; align-items:center;">
                ${statusBadge}
                <span class="run-card-step-badge">${step}</span>
              </div>
            </div>
            <p class="run-prompt-preview">${prompt}</p>
            <div class="run-actions-bar">
              <button class="btn-steer btn-steer-continue" data-id="${run.id}" title="ادامه گام پروژه">
                <span>▶️</span><span>ادامه گام</span>
              </button>
              <button class="btn-steer btn-steer-pause" data-id="${run.id}" title="توقف موقت">
                <span>⏸️</span><span>مکث</span>
              </button>
              <button class="btn-steer btn-steer-guidance" data-id="${run.id}" title="ارسال هدایت و بازخورد">
                <span>💬</span><span>هدایت</span>
              </button>
              <button class="btn-steer btn-steer-stop" data-id="${run.id}" title="توقف کامل">
                <span>🛑</span><span>توقف</span>
              </button>
            </div>
          </div>
        `;
      })
      .join("");

    activeProjectsContainer.querySelectorAll(".btn-steer-continue").forEach((btn) => {
      btn.addEventListener("click", () => steerProjectRun(btn.getAttribute("data-id"), "continue"));
    });
    activeProjectsContainer.querySelectorAll(".btn-steer-pause").forEach((btn) => {
      btn.addEventListener("click", () => steerProjectRun(btn.getAttribute("data-id"), "pause"));
    });
    activeProjectsContainer.querySelectorAll(".btn-steer-stop").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (confirm("آیا از توقف اضطراری این فرآیند اطمینان دارید؟")) {
          steerProjectRun(btn.getAttribute("data-id"), "stop");
        }
      });
    });
    activeProjectsContainer.querySelectorAll(".btn-steer-guidance").forEach((btn) => {
      btn.addEventListener("click", () => {
        const msg = prompt("دستور هدایت عملیاتی یا بازخورد برای ادامه فرآیند را وارد کنید:");
        if (msg && msg.trim()) {
          steerProjectRun(btn.getAttribute("data-id"), "guidance", msg.trim());
        }
      });
    });
  }

  async function steerProjectRun(runId, action, guidance = "") {
    if (currentAgentState === "inactive") {
      alert("ایجنت ویندوز غیرفعال است. امکان هدایت فرآیندها وجود ندارد.");
      return;
    }
    try {
      const res = await universalFetch(`${currentServerUrl}/api/mobile/projects/steer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({ run_id: runId, action, guidance }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "خطا در ارسال دستور هدایت فرآیند.");
      }
      if (window.OmniOpsBridge && typeof window.OmniOpsBridge.showToast === "function") {
        window.OmniOpsBridge.showToast("فرمان هدایت به ایجنت ویندوز منتقل گردید.");
      }
      if (window.OmniOpsBridge && typeof window.OmniOpsBridge.vibrateDevice === "function") {
        window.OmniOpsBridge.vibrateDevice(50);
      }
      refreshAllData();
    } catch (err) {
      alert(err.message);
    }
  }

  // 4. Render Pending Approvals
  function renderApprovals(requests) {
    if (!requests || requests.length === 0) {
      pendingApprovalsList.innerHTML = `
        <div class="empty-state">
          <span>✨</span>
          <p>در حال حاضر هیچ فرمانی در صف تأیید نیست. پردازش‌های ویندوز با امنیت بالا در حال اجرا هستند.</p>
        </div>
      `;
      return;
    }

    pendingApprovalsList.innerHTML = requests
      .map((req) => {
        const riskBadge =
          req.risk_level === "destructive"
            ? '<span class="badge badge-danger">تخریب‌پذیر</span>'
            : '<span class="badge badge-warning">اقدام حساس</span>';

        return `
        <div class="approval-item" data-id="${req.id}">
          <div class="approval-item-header">
            <span class="approval-agent">🤖 ${escapeHtml(req.agent_name || "Windows Edge Agent")}</span>
            ${riskBadge}
          </div>
          <p class="card-desc" style="margin-bottom:4px;">${escapeHtml(req.description || "درخواست اجرای دستور در پس‌زمینه ویندوز")}</p>
          <pre class="cmd-snippet" dir="ltr">${escapeHtml(req.command)}</pre>
          <div class="approval-actions">
            <button class="btn btn-emerald btn-approve-biometric" data-id="${req.id}">
              <span>👆</span>
              <span>تأیید با اثر انگشت</span>
            </button>
            <button class="btn btn-secondary btn-deny" data-id="${req.id}">
              <span>❌</span>
              <span>رد</span>
            </button>
          </div>
        </div>
      `;
      })
      .join("");

    // Bind Approval Action Buttons
    pendingApprovalsList.querySelectorAll(".btn-approve-biometric").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        activePendingApprovalId = id;
        requestBiometricApproval(id);
      });
    });

    pendingApprovalsList.querySelectorAll(".btn-deny").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        decideApproval(id, false, "operator_denied");
      });
    });
  }

  // Biometric Handler Callback
  window.onBiometricApproval = (success, message) => {
    if (success && activePendingApprovalId) {
      decideApproval(activePendingApprovalId, true, "biometric_fingerprint");
    } else {
      if (window.OmniOpsBridge && typeof window.OmniOpsBridge.showToast === "function") {
        window.OmniOpsBridge.showToast("احراز هویت بیومتریک لغو یا ناموفق بود.");
      }
    }
    activePendingApprovalId = null;
  };

  function requestBiometricApproval(reqId) {
    if (window.OmniOpsBridge && typeof window.OmniOpsBridge.authenticateBiometric === "function") {
      window.OmniOpsBridge.authenticateBiometric(
        "تأیید اقدام امنیتی ویندوز",
        "برای اجرای فرمان در ایجنت، اثر انگشت خود را تأیید کنید",
        "window.onBiometricApproval"
      );
    } else {
      // Fallback for desktop browser test
      if (confirm("شبیه‌ساز اثر انگشت: آیا این دستور را تأیید می‌کنید؟")) {
        decideApproval(reqId, true, "web_simulator_auth");
      }
    }
  }

  async function decideApproval(requestId, approved, authMethod) {
    try {
      const res = await universalFetch(`${currentServerUrl}/api/mobile/approvals/decide`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({
          request_id: requestId,
          approved: approved,
          auth_method: authMethod,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "خطا در ثبت تصمیم تأیید.");
      }

      if (window.OmniOpsBridge && typeof window.OmniOpsBridge.showToast === "function") {
        window.OmniOpsBridge.showToast(approved ? "✅ فرمان تأیید و در صف اجرا قرار گرفت." : "❌ فرمان رد شد.");
      }
      if (window.OmniOpsBridge && typeof window.OmniOpsBridge.vibrateDevice === "function") {
        window.OmniOpsBridge.vibrateDevice(approved ? 50 : 150);
      }
      refreshAllData();
    } catch (err) {
      alert(err.message);
    }
  }

  // 5. Generate 6-Digit PIN for Windows Agent
  btnGeneratePin.addEventListener("click", async () => {
    btnGeneratePin.disabled = true;
    btnGeneratePin.innerText = "در حال تولید کد ۶ رقمی...";

    try {
      const res = await universalFetch(`${currentServerUrl}/api/agent/pairing`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`,
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "خطا در صدور کد جفت‌سازی.");
      }

      generatedPinCode.innerText = data.code;
      pinDisplayCard.style.display = "block";

      if (window.OmniOpsBridge && typeof window.OmniOpsBridge.vibrateDevice === "function") {
        window.OmniOpsBridge.vibrateDevice(60);
      }

      startPinCountdown(data.expires_at || Math.floor(Date.now() / 1000) + 300);
    } catch (err) {
      alert(err.message);
    } finally {
      btnGeneratePin.disabled = false;
      btnGeneratePin.innerHTML = `<span>🔑</span><span>صدور مجدد کد ۶ رقمی</span>`;
    }
  });

  btnCopyPin.addEventListener("click", () => {
    const code = generatedPinCode.innerText;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code);
      btnCopyPin.innerText = "✓ کپی شد";
      setTimeout(() => (btnCopyPin.innerText = "📋 کپی"), 2000);
    }
  });

  function startPinCountdown(expiresAt) {
    if (pinTimerInterval) clearInterval(pinTimerInterval);
    const totalDuration = 300;

    function updateBar() {
      const remaining = expiresAt - Math.floor(Date.now() / 1000);
      if (remaining <= 0) {
        clearInterval(pinTimerInterval);
        pinProgress.style.width = "0%";
        generatedPinCode.innerText = "منقضی شد";
        return;
      }
      const percent = Math.max(0, Math.min(100, (remaining / totalDuration) * 100));
      pinProgress.style.width = `${percent}%`;
    }

    updateBar();
    pinTimerInterval = setInterval(updateBar, 1000);
  }

  // 6. Quick Action Tiles
  document.querySelectorAll(".quick-action-tile").forEach((tile) => {
    tile.addEventListener("click", () => {
      if (currentAgentState === "inactive") {
        alert("ایجنت ویندوز غیرفعال است. اجرای فرامین لوکال فقط هنگام آنلاین بودن ایجنت ویندوز امکان‌پذیر است.");
        return;
      }
      const cmd = tile.getAttribute("data-cmd");
      const desc = tile.getAttribute("data-desc");
      const risk = tile.getAttribute("data-risk") || "low";
      dispatchWindowsCommand(cmd, desc, risk);
    });
  });

  // 7. Custom Command Dispatch
  btnDispatchCustom.addEventListener("click", () => {
    if (currentAgentState === "inactive") {
      alert("ایجنت ویندوز غیرفعال است. اجرای فرامین لوکال فقط هنگام آنلاین بودن ایجنت ویندوز امکان‌پذیر است.");
      return;
    }
    const cmd = customCmdInput.value.trim();
    if (!cmd) {
      alert("لطفاً یک دستور معتبر وارد نمایید.");
      return;
    }
    const risk = customCmdRisk.value;
    dispatchWindowsCommand(cmd, "دستور پاورشل سفارشی از اپراتور همراه", risk);
    customCmdInput.value = "";
  });

  async function dispatchWindowsCommand(command, description, riskLevel) {
    if (currentAgentState === "inactive") {
      alert("ایجنت ویندوز غیرفعال است. اجرای فرامین لوکال فقط هنگام آنلاین بودن ایجنت ویندوز امکان‌پذیر است.");
      return;
    }
    try {
      const res = await universalFetch(`${currentServerUrl}/api/mobile/commands/dispatch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({
          target_node_id: "windows-edge",
          command: command,
          command_type: "powershell",
          description: description,
          risk_level: riskLevel,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "خطا در ارسال فرمان.");
      }

      if (window.OmniOpsBridge && typeof window.OmniOpsBridge.showToast === "function") {
        window.OmniOpsBridge.showToast(
          data.status === "queued" ? "🚀 دستور با موفقیت به ایجنت ارسال گردید." : "🔒 دستور نیازمند تأیید درگاه است."
        );
      }
      if (window.OmniOpsBridge && typeof window.OmniOpsBridge.vibrateDevice === "function") {
        window.OmniOpsBridge.vibrateDevice(50);
      }

      refreshAllData();
    } catch (err) {
      alert(err.message);
    }
  }

  // 8. Render Command History
  function renderHistory(commands) {
    if (!commands || commands.length === 0) {
      commandHistoryList.innerHTML = `<p class="loading-text">هیچ فرمانی در تاریخچه ثبت نشده است.</p>`;
      return;
    }

    commandHistoryList.innerHTML = commands
      .map((cmd) => {
        let badgeClass = "badge-cyan";
        let statusText = "در صف";

        if (cmd.status === "completed") {
          badgeClass = "badge-emerald";
          statusText = "انجام شد";
        } else if (cmd.status === "in_progress") {
          badgeClass = "badge-cyan";
          statusText = "در حال اجرا";
        } else if (cmd.status === "failed") {
          badgeClass = "badge-danger";
          statusText = "خطا";
        } else if (cmd.status === "pending_approval") {
          badgeClass = "badge-warning";
          statusText = "در انتظار تأیید";
        } else if (cmd.status === "cancelled") {
          badgeClass = "badge-warning";
          statusText = "لغو شد";
        }

        const timeStr = formatTimestamp(cmd.created_at);

        return `
        <div class="history-item" data-id="${cmd.id}">
          <div>
            <div class="history-cmd-text" dir="ltr">${escapeHtml(cmd.command_payload || cmd.command || "")}</div>
            <span class="history-time">${escapeHtml(cmd.description || "")} • ${timeStr}</span>
          </div>
          <div class="history-meta">
            <span class="badge ${badgeClass}">${statusText}</span>
          </div>
        </div>
      `;
      })
      .join("");

    // Click item to view output in modal
    commandHistoryList.querySelectorAll(".history-item").forEach((item) => {
      item.addEventListener("click", () => {
        const id = item.getAttribute("data-id");
        const found = commands.find((c) => c.id === id);
        if (found) showOutputModal(found);
      });
    });
  }

  function showOutputModal(cmd) {
    modalCmdTitle.innerText = `خروجی فرمان (${cmd.command_type || "powershell"})`;
    modalCmdStatus.innerText = `وضعیت: ${cmd.status}`;
    modalCmdTime.innerText = cmd.duration_ms ? `زمان اجرا: ${cmd.duration_ms}ms` : `کد خروج: ${cmd.exit_code ?? "-"}`;
    modalCmdOutput.innerText = cmd.output || "(هنوز خروجی ثبت نشده است یا دستور در حال اجراست)";
    outputModal.style.display = "flex";
  }

  btnCloseModal.addEventListener("click", () => {
    outputModal.style.display = "none";
  });

  outputModal.addEventListener("click", (e) => {
    if (e.target === outputModal) outputModal.style.display = "none";
  });

  // 9. Emergency Kill Switch
  btnKillSwitch.addEventListener("click", async () => {
    if (!confirm("⚠️ اخطار امنیتی: آیا از توقف اضطراری و فوری کلیه پردازش‌های ویندوز و ایجنت‌ها اطمینان دارید؟")) {
      return;
    }

    if (window.OmniOpsBridge && typeof window.OmniOpsBridge.vibrateDevice === "function") {
      window.OmniOpsBridge.vibrateDevice(500);
    }

    try {
      const res = await universalFetch(`${currentServerUrl}/api/mobile/kill-switch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({
          node_id: "all",
          reason: "Emergency stop issued from OmniOps Mobile Operator",
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "خطا در توقف اضطراری.");

      if (window.OmniOpsBridge && typeof window.OmniOpsBridge.showToast === "function") {
        window.OmniOpsBridge.showToast("🛑 توقف اضطراری با موفقیت اعمال گردید.");
      }
      refreshAllData();
    } catch (err) {
      alert(err.message);
    }
  });

  // 10. Floating Island Toggle
  floatingToggle.addEventListener("change", (e) => {
    if (window.OmniOpsBridge && typeof window.OmniOpsBridge.toggleFloatingService === "function") {
      window.OmniOpsBridge.toggleFloatingService(e.target.checked);
    }
  });

  // 11. Switch to Desktop Web Dashboard
  btnOpenDesktop.addEventListener("click", () => {
    if (window.OmniOpsBridge && typeof window.OmniOpsBridge.openDesktopWeb === "function") {
      window.OmniOpsBridge.openDesktopWeb(currentServerUrl);
    } else {
      window.open(currentServerUrl, "_blank");
    }
  });

  // Utilities
  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatTimestamp(ts) {
    if (!ts) return "";
    const date = new Date(ts * 1000);
    return date.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
  }

  // 12. Mobile AI Chatbot Implementation
  function renderMarkdownText(text) {
    if (!text || typeof text !== "string") return "";
    let safe = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Code blocks ```code```
    safe = safe.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (match, lang, code) => {
      return `<pre><code>${code.trim()}</code></pre>`;
    });

    // Inline code `code`
    safe = safe.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Bold **text**
    safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

    // Newlines
    safe = safe.replace(/\n/g, "<br>");

    return safe;
  }

  function scrollChatToBottom() {
    if (chatMessagesStream) {
      setTimeout(() => {
        chatMessagesStream.scrollTop = chatMessagesStream.scrollHeight;
      }, 50);
    }
  }

  async function loadChatModels() {
    if (!currentToken || !currentServerUrl || !chatModelSelect) return;
    try {
      const resp = await universalFetch(`${currentServerUrl}/api/agent/models`, {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        const models = data.models || [];
        const currentVal = chatModelSelect.value;
        chatModelSelect.innerHTML = `<option value="auto">🤖 انتخاب هوشمند (Auto Model)</option>`;
        models.forEach((m) => {
          const opt = document.createElement("option");
          opt.value = m;
          opt.innerText = m.startsWith("ollama/") ? `🦙 ${m.replace("ollama/", "")}` : m;
          chatModelSelect.appendChild(opt);
        });
        if (models.includes(currentVal)) {
          chatModelSelect.value = currentVal;
        }
      }
    } catch (e) {}
  }

  function appendChatMessage(sender, text, model = "") {
    if (chatWelcomeCard && chatWelcomeCard.style.display !== "none") {
      chatWelcomeCard.style.display = "none";
    }

    const row = document.createElement("div");
    row.className = `chat-message-row ${sender}`;

    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    let metaHtml = "";
    if (sender === "assistant") {
      const modelTag = model ? `<span class="assistant-model-pill">${model.replace("ollama/", "")}</span>` : "";
      metaHtml = `<div class="message-sender-meta"><span>🤖 دستیار هوشمند</span>${modelTag}<span>•</span><span>${timeStr}</span></div>`;
    } else {
      metaHtml = `<div class="message-sender-meta"><span>👤 شما</span><span>•</span><span>${timeStr}</span></div>`;
    }

    const bubbleHtml = `<div class="chat-bubble">${renderMarkdownText(text)}</div>`;
    row.innerHTML = metaHtml + bubbleHtml;

    chatMessagesStream.appendChild(row);
    scrollChatToBottom();
  }

  async function sendChatPrompt(customText = null) {
    const text = customText !== null ? customText : (chatInputPrompt ? chatInputPrompt.value.trim() : "");
    if (!text || isChatSending) return;

    if (!currentToken || !currentServerUrl) {
      showAuthAlert("ابتدا به سرور متصل شوید.");
      return;
    }

    isChatSending = true;
    if (chatInputPrompt && customText === null) {
      chatInputPrompt.value = "";
      chatInputPrompt.style.height = "auto";
    }
    if (btnSendChatPrompt) btnSendChatPrompt.disabled = true;

    appendChatMessage("user", text);

    if (chatTypingIndicator) {
      chatTypingIndicator.style.display = "flex";
      scrollChatToBottom();
    }

    const selectedModel = chatModelSelect ? chatModelSelect.value : "auto";
    const saveHistory = chatSaveHistoryToggle ? chatSaveHistoryToggle.checked : false;

    try {
      const resp = await universalFetch(`${currentServerUrl}/api/agent/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`,
        },
        body: JSON.stringify({
          message: text,
          model: selectedModel,
          save_history: saveHistory,
        }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error?.message || "پاسخی از مدل دریافت نشد.");
      }

      appendChatMessage("assistant", data.reply || "پاسخ متنی دریافت نشد.", data.model || selectedModel);
      if (window.OmniOpsBridge && typeof window.OmniOpsBridge.vibrateDevice === "function") {
        window.OmniOpsBridge.vibrateDevice(30);
      }
    } catch (err) {
      appendChatMessage("assistant", `⚠️ خطا در پردازش: ${err.message}`);
    } finally {
      isChatSending = false;
      if (chatTypingIndicator) chatTypingIndicator.style.display = "none";
      if (btnSendChatPrompt) btnSendChatPrompt.disabled = false;
      scrollChatToBottom();
      if (chatInputPrompt) chatInputPrompt.focus();
    }
  }

  // Preset Chips Listener
  document.querySelectorAll(".chat-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const p = chip.getAttribute("data-prompt");
      if (p) sendChatPrompt(p);
    });
  });

  if (btnSendChatPrompt) {
    btnSendChatPrompt.addEventListener("click", () => sendChatPrompt());
  }

  if (chatInputPrompt) {
    chatInputPrompt.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChatPrompt();
      }
    });
    chatInputPrompt.addEventListener("input", () => {
      chatInputPrompt.style.height = "auto";
      chatInputPrompt.style.height = Math.min(chatInputPrompt.scrollHeight, 120) + "px";
    });
  }

  if (btnClearChatHistory) {
    btnClearChatHistory.addEventListener("click", async () => {
      if (!confirm("آیا مایل به شروع گفتگوی جدید و پاکسازی صفحه هستید؟")) return;
      try {
        await universalFetch(`${currentServerUrl}/api/agent/history/clear`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${currentToken}`,
          },
          body: JSON.stringify({}),
        });
      } catch (e) {}

      if (chatMessagesStream) {
        chatMessagesStream.innerHTML = "";
        if (chatWelcomeCard) {
          chatWelcomeCard.style.display = "flex";
          chatMessagesStream.appendChild(chatWelcomeCard);
        }
      }
    });
  }
});

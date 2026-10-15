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
  const sessionUsername = document.getElementById("sessionUsername");
  const sessionRole = document.getElementById("sessionRole");
  const sessionServer = document.getElementById("sessionServer");
  const btnRefreshStatus = document.getElementById("btnRefreshStatus");
  const btnLogout = document.getElementById("btnLogout");

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

  // State Variables
  let currentServerUrl = "http://172.19.30.94:9000";
  let currentToken = "";
  let currentOperator = { username: "admin", role: "operator" };
  let pollingInterval = null;
  let pinTimerInterval = null;
  let activePendingApprovalId = null;

  // Initialize from Bridge / LocalStorage
  loadInitialSession();

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
      currentServerUrl = saved.serverUrl.replace(/\/+$/, "");
      serverUrlInput.value = currentServerUrl;
    }

    if (saved && saved.token) {
      currentToken = saved.token;
      currentOperator.username = saved.username || "admin";
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
    showAuthScreen();
  }

  // View Navigation
  function showAuthScreen() {
    authView.classList.add("active");
    operatorView.classList.remove("active");
    updateConnectionStatus("offline", "آفلاین");
  }

  function showOperatorConsole() {
    authView.classList.remove("active");
    operatorView.classList.add("active");

    sessionUsername.innerText = currentOperator.username;
    sessionRole.innerText = currentOperator.role === "admin" ? "مدیر کل سیستم" : "اپراتور همراه";
    try {
      const urlObj = new URL(currentServerUrl);
      sessionServer.innerText = urlObj.host;
    } catch (e) {
      sessionServer.innerText = currentServerUrl;
    }

    startPolling();
    refreshAllData();
  }

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
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
    if (e.target.value.length === 6) {
      redeemPairingCode(e.target.value);
    }
  });

  // 1. Redeem 6-Digit PIN Pairing
  btnRedeemPin.addEventListener("click", () => {
    const pin = pinInput.value.trim();
    if (pin.length !== 6) {
      showAuthAlert("لطفاً یک کد ۶ رقمی معتبر وارد نمایید.");
      return;
    }
    redeemPairingCode(pin);
  });

  async function redeemPairingCode(pin) {
    const srv = serverUrlInput.value.trim() || currentServerUrl;
    hideAuthAlert();
    btnRedeemPin.disabled = true;
    btnRedeemPin.innerText = "در حال احراز هویت با هسته...";

    const deviceId = "mobile-op-" + Math.floor(Math.random() * 899999 + 100000);

    try {
      const resp = await fetch(`${srv}/api/agent/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: pin, device_id: deviceId }),
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

      saveSession(srv, data.token, data.profile?.username || "paired_operator", data.profile?.role || "operator");
      pinInput.value = "";
      showOperatorConsole();
    } catch (err) {
      showAuthAlert(err.message || "خطا در اتصال به سرور مرکزی.");
    } finally {
      btnRedeemPin.disabled = false;
      btnRedeemPin.innerHTML = `<span>⚡</span><span>اتصال و احراز هویت با کد ۶ رقمی</span>`;
    }
  }

  // 2. Login with Credentials
  btnLogin.addEventListener("click", async () => {
    const srv = serverUrlInput.value.trim() || currentServerUrl;
    const user = loginUsername.value.trim();
    const pass = loginPassword.value;

    if (!user || !pass) {
      showAuthAlert("نام کاربری و کلمه عبور الزامی است.");
      return;
    }

    hideAuthAlert();
    btnLogin.disabled = true;
    btnLogin.innerText = "در حال اعتبارسنجی...";

    try {
      const resp = await fetch(`${srv}/api/auth/login`, {
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

      saveSession(srv, data.token, data.profile?.username || user, data.profile?.role || "admin");
      showOperatorConsole();
    } catch (err) {
      showAuthAlert(err.message || "خطا در برقراری ارتباط با سرور.");
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

  // 3. Data Polling and Refreshing
  function startPolling() {
    stopPolling();
    pollingInterval = setInterval(refreshAllData, 3000);
  }

  function stopPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = null;
  }

  async function refreshAllData() {
    if (!currentToken) return;
    const startTime = performance.now();

    try {
      // 1. Fetch Status
      const statusRes = await fetch(`${currentServerUrl}/api/mobile/status`, {
        headers: { Authorization: `Bearer ${currentToken}` },
      });

      if (statusRes.status === 401) {
        clearSession();
        return;
      }

      if (statusRes.ok) {
        const latency = Math.round(performance.now() - startTime);
        updateConnectionStatus("online", `برخط (${latency}ms)`);

        const sData = await statusRes.json();
        targetNodeName.innerText = sData.node_name || "LOUIS-PC";
        nodeStatusPill.innerText = `🟢 ${sData.status === "online" ? "برخط (Online)" : sData.status}`;
        if (sData.plan_usage) {
          quotaInfo.innerText = `${sData.plan_usage.remaining || "۳۶۰,۰۰۰"} باقیمانده`;
        }
      } else {
        updateConnectionStatus("offline", "خطای ارتباط");
      }

      // 2. Fetch Pending Approvals
      const appRes = await fetch(`${currentServerUrl}/api/mobile/approvals/pending`, {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      if (appRes.ok) {
        const aData = await appRes.json();
        renderApprovals(aData.requests || []);
      }

      // 3. Fetch Command History
      const cmdRes = await fetch(`${currentServerUrl}/api/mobile/commands/history?limit=25`, {
        headers: { Authorization: `Bearer ${currentToken}` },
      });
      if (cmdRes.ok) {
        const cData = await cmdRes.json();
        renderHistory(cData.commands || []);
      }
    } catch (e) {
      updateConnectionStatus("offline", "قطع ارتباط");
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
      const res = await fetch(`${currentServerUrl}/api/mobile/approvals/decide`, {
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
      const res = await fetch(`${currentServerUrl}/api/agent/pairing`, {
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
      const cmd = tile.getAttribute("data-cmd");
      const desc = tile.getAttribute("data-desc");
      const risk = tile.getAttribute("data-risk") || "low";
      dispatchWindowsCommand(cmd, desc, risk);
    });
  });

  // 7. Custom Command Dispatch
  btnDispatchCustom.addEventListener("click", () => {
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
    try {
      const res = await fetch(`${currentServerUrl}/api/mobile/commands/dispatch`, {
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
      const res = await fetch(`${currentServerUrl}/api/mobile/kill-switch`, {
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
});

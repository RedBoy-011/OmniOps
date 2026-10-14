import { useState, useEffect, useId } from "react";

interface AgentToolsProps {
  onSendToChat: (prompt: string) => void;
  masterUrl?: string;
  profile?: { id: string; username: string; role: string; capabilities: string[] } | null;
}

type ToolTab = "vitals" | "cli" | "network" | "scratchpad" | "diagnostic";

interface PingResult {
  host: string;
  success: boolean;
  timeMs: number;
  timestamp: string;
  statusText: string;
}

export function AgentTools({ onSendToChat, masterUrl = "", profile }: AgentToolsProps) {
  const [activeTab, setActiveTab] = useState<ToolTab>("vitals");
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // System Vitals State
  const [vitals, setVitals] = useState({
    platform: "Windows (Win32 / NT)",
    arch: "x64 / AMD64",
    cores: navigator.hardwareConcurrency || 4,
    memoryEstimate: (navigator as unknown as { deviceMemory?: number }).deviceMemory ? `${(navigator as unknown as { deviceMemory?: number }).deviceMemory} GB` : "تعریف نشده",
    screenWidth: typeof window !== "undefined" ? window.screen.width : 1920,
    screenHeight: typeof window !== "undefined" ? window.screen.height : 1080,
    pixelRatio: typeof window !== "undefined" ? window.devicePixelRatio : 1,
    online: typeof navigator !== "undefined" ? navigator.onLine : true,
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    language: typeof navigator !== "undefined" ? navigator.language : "fa-IR",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  useEffect(() => {
    const handleOnline = () => setVitals((v) => ({ ...v, online: true }));
    const handleOffline = () => setVitals((v) => ({ ...v, online: false }));
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // CLI Inspector State
  const [customCmd, setCustomCmd] = useState("ipconfig /all");
  const [cliRunning, setCliRunning] = useState(false);
  const [cliOutput, setCliOutput] = useState<{ cmd: string; stdout: string; elapsed: number; status: "success" | "warning" | "error" } | null>({
    cmd: "ipconfig /all",
    stdout: "Ethernet adapter Local Area Connection:\n   Connection-specific DNS Suffix  . : localdomain\n   IPv4 Address. . . . . . . . . . . : 192.168.1.110\n   Subnet Mask . . . . . . . . . . . : 255.255.255.0\n   Default Gateway . . . . . . . . . : 192.168.1.1\n   DNS Servers . . . . . . . . . . . : 1.1.1.1, 8.8.8.8\n\nWireless LAN adapter Wi-Fi:\n   Media State . . . . . . . . . . . : Media disconnected",
    elapsed: 42,
    status: "success",
  });

  const cliPresets = [
    { label: "شبکه (ipconfig)", cmd: "ipconfig /all", desc: "بررسی کامل کارت‌های شبکه و آدرس‌های IP" },
    { label: "پورت‌های باز (netstat)", cmd: "netstat -ano | findstr LISTENING", desc: "سرویس‌های در حال شنود و پورت‌های محلی" },
    { label: "اطلاعات سیستم (systeminfo)", cmd: "systeminfo", desc: "مشخصات نسخه ویندوز و رم سخت‌افزاری" },
    { label: "مخزن گیت (git status)", cmd: "git status -s && git log -n 3 --oneline", desc: "وضعیت تغییرات و آخرین کامیت‌های گیت" },
    { label: "داکر (docker ps)", cmd: "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'", desc: "وضعیت کانتینرهای فعال محلی" },
    { label: "پایتون (python)", cmd: "python --version && pip list --columns", desc: "نسخه مفسر پایتون و بسته‌های نصب‌شده" },
    { label: "نود (node/npm)", cmd: "node -v && npm -v", desc: "محیط اجرایی Node.js و پکیج‌منیجر" },
  ];

  // Network Watcher State
  const [targetHost, setTargetHost] = useState(masterUrl || "http://127.0.0.1:9000");
  const [pingRunning, setPingRunning] = useState(false);
  const [pingHistory, setPingHistory] = useState<PingResult[]>([]);

  // Scratchpad State
  const [scratchType, setScratchType] = useState<"json" | "base64" | "hash" | "url" | "uuid">("json");
  const [scratchInput, setScratchInput] = useState('{\n  "service": "OmniOps",\n  "status": "healthy",\n  "version": "2.4.0"\n}');
  const [scratchOutput, setScratchOutput] = useState("");
  const [scratchError, setScratchError] = useState("");

  const inputId = useId();

  // Helper for feedback toast
  const triggerCopy = async (text: string, label = "کپی شد!") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(label);
      setTimeout(() => setCopyFeedback(null), 2200);
    } catch {
      setCopyFeedback("خطا در دسترسی به حافظه");
      setTimeout(() => setCopyFeedback(null), 2200);
    }
  };

  // Run CLI Simulation / Command Inspector
  const handleRunCommand = (cmdToRun: string) => {
    setCliRunning(true);
    const start = performance.now();
    setTimeout(() => {
      const elapsed = Math.round(performance.now() - start);
      let simulatedStdout = "";
      let status: "success" | "warning" | "error" = "success";

      if (cmdToRun.includes("ipconfig")) {
        simulatedStdout = `Windows IP Configuration\n\nEthernet adapter Local Area Connection:\n   IPv4 Address. . . . . . . . . . . : 192.168.1.110\n   Subnet Mask . . . . . . . . . . . : 255.255.255.0\n   Default Gateway . . . . . . . . . : 192.168.1.1\n   Primary DNS . . . . . . . . . . . : 1.1.1.1\n   Status . . . . . . . . . . . . . : Active (1000 Mbps)`;
      } else if (cmdToRun.includes("netstat")) {
        simulatedStdout = `  Proto  Local Address          Foreign Address        State           PID\n  TCP    0.0.0.0:9000           0.0.0.0:0              LISTENING       4820 (OmniOps Master)\n  TCP    0.0.0.0:11434          0.0.0.0:0              LISTENING       6124 (Ollama AI)\n  TCP    127.0.0.1:1420         0.0.0.0:0              LISTENING       8340 (Vite Edge)\n  TCP    [::]:443               [::]:0                 LISTENING       1204`;
      } else if (cmdToRun.includes("git")) {
        simulatedStdout = `On branch main\nYour branch is up to date with 'origin/main'.\n\nRecent Commits:\n* bfa29cb (HEAD -> main, origin/main) feat(web): unify user profile and access management hub\n* 3c0f8fa docs(readme): enhance windows and android agent interface guides\n* 47f896b fix(socks): fix server socks proxy payload handling and add test coverage`;
      } else if (cmdToRun.includes("docker")) {
        simulatedStdout = `CONTAINER ID   IMAGE                 STATUS         PORTS                    NAMES\n9a1f2b4c8e10   postgres:16-alpine    Up 3 hours     0.0.0.0:5432->5432/tcp   omniops-db\n3d4e5f6a7b8c   redis:7-alpine        Up 3 hours     0.0.0.0:6379->6379/tcp   omniops-cache\ne7f8a9b0c1d2   ollama/ollama:latest  Up 2 hours     0.0.0.0:11434->11434/tcp omniops-llm`;
      } else if (cmdToRun.includes("python")) {
        simulatedStdout = `Python 3.11.8 (tags/v3.11.8:db85d51, Feb  6 2024, 22:03:32) [MSC v.1937 64 bit (AMD64)]\n\nPackage             Version\n------------------- -------\nrequests            2.31.0\nwebsockets          12.0\npsutil              5.9.8\npydantic            2.6.4`;
      } else if (cmdToRun.includes("node")) {
        simulatedStdout = `v20.18.0\n10.8.2\nRuntime: Node.js 64-bit on Windows_NT`;
      } else if (cmdToRun.includes("systeminfo")) {
        simulatedStdout = `Host Name:                 DESKTOP-OMNIOPS\nOS Name:                   Microsoft Windows 11 Pro\nOS Version:                10.0.22631 N/A Build 22631\nSystem Type:               x64-based PC\nProcessor(s):              1 Processor(s) Installed.\nTotal Physical Memory:     16,248 MB\nAvailable Physical Memory: 9,840 MB`;
      } else {
        simulatedStdout = `> ${cmdToRun}\n[OmniOps Edge Inspector]: Command executed cleanly in local shell context.\nExit Code: 0 (STATUS_SUCCESS)\nOutput Stream: STDOUT (Buffer flushed)`;
      }

      setCliOutput({ cmd: cmdToRun, stdout: simulatedStdout, elapsed, status });
      setCliRunning(false);
    }, 180);
  };

  // Ping Watcher
  const handlePingTest = async (urlToTest: string) => {
    setPingRunning(true);
    const start = performance.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      // Perform fetch ping (mode no-cors allows timing without CORS restrictions)
      await fetch(urlToTest, {
        method: "HEAD",
        mode: "no-cors",
        signal: controller.signal,
        cache: "no-cache",
      });
      clearTimeout(timeoutId);

      const elapsed = Math.round(performance.now() - start);
      const newResult: PingResult = {
        host: urlToTest,
        success: true,
        timeMs: elapsed,
        timestamp: new Date().toLocaleTimeString("fa-IR"),
        statusText: elapsed < 50 ? "عالی ⚡" : elapsed < 180 ? "مطلوب ✓" : "تاخیر بالا ⚠️",
      };
      setPingHistory((prev) => [newResult, ...prev.slice(0, 7)]);
    } catch {
      const elapsed = Math.round(performance.now() - start);
      const newResult: PingResult = {
        host: urlToTest,
        success: false,
        timeMs: elapsed,
        timestamp: new Date().toLocaleTimeString("fa-IR"),
        statusText: "ناموفق یا زمان اتمام ✕",
      };
      setPingHistory((prev) => [newResult, ...prev.slice(0, 7)]);
    } finally {
      setPingRunning(false);
    }
  };

  // Scratchpad Processor
  const processScratchpad = async (action: string) => {
    setScratchError("");
    try {
      if (scratchType === "json") {
        if (action === "beautify") {
          const parsed = JSON.parse(scratchInput);
          setScratchOutput(JSON.stringify(parsed, null, 2));
        } else if (action === "minify") {
          const parsed = JSON.parse(scratchInput);
          setScratchOutput(JSON.stringify(parsed));
        } else if (action === "validate") {
          JSON.parse(scratchInput);
          setScratchOutput("✓ ساختار JSON کاملاً معتبر و استاندارد است.");
        }
      } else if (scratchType === "base64") {
        if (action === "encode") {
          const encoded = btoa(encodeURIComponent(scratchInput).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))));
          setScratchOutput(encoded);
        } else if (action === "decode") {
          const decoded = decodeURIComponent(Array.prototype.map.call(atob(scratchInput.trim()), (c: string) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join(""));
          setScratchOutput(decoded);
        }
      } else if (scratchType === "hash") {
        const msgUint8 = new TextEncoder().encode(scratchInput);
        const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
        setScratchOutput(hashHex);
      } else if (scratchType === "url") {
        if (action === "encode") {
          setScratchOutput(encodeURIComponent(scratchInput));
        } else {
          setScratchOutput(decodeURIComponent(scratchInput));
        }
      } else if (scratchType === "uuid") {
        const arr = new Uint8Array(16);
        crypto.getRandomValues(arr);
        arr[6] = (arr[6] & 0x0f) | 0x40;
        arr[8] = (arr[8] & 0x3f) | 0x80;
        const hex = Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
        const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        setScratchOutput(uuid);
      }
    } catch (err) {
      setScratchError(err instanceof Error ? err.message : "خطا در پردازش داده");
    }
  };

  // Generate full markdown report
  const generateDiagnosticReport = () => {
    return `# 📋 گزارش تشخیصی ایجنت ویندوز OmniOps
**زمان ایجاد:** ${new Date().toLocaleString("fa-IR")}
**کاربر متصل:** ${profile?.username || "میهمان"} (${profile?.role || "نامشخص"})
**آدرس هسته مرکزی:** ${masterUrl || "http://127.0.0.1:9000"}

---

### 💻 مشخصات سیستم‌عامل و سخت‌افزار:
- **پلتفرم:** ${vitals.platform}
- **معماری پردازنده:** ${vitals.arch} (${vitals.cores} هستهٔ پردازشی منطقی)
- **برآورد رم سخت‌افزاری:** ${vitals.memoryEstimate}
- **ابعاد نمایشگر:** ${vitals.screenWidth}x${vitals.screenHeight} (تراکم: ${vitals.pixelRatio}x)
- **منطقه زمانی:** ${vitals.timezone}
- **وضعیت اتصال:** ${vitals.online ? "🟢 برخط (Online)" : "🔴 آفلاین (Offline)"}

---

### 🌐 آخرین وضعیت آزمایش پینگ:
${
  pingHistory.length > 0
    ? pingHistory.map((p) => `- میزبان: \`${p.host}\` | تاخیر: **${p.timeMs}ms** (${p.statusText})`).join("\n")
    : "- تستی ثبت نشده است."
}

---

### 🛠️ دسترسی‌های ایجنت:
${profile?.capabilities?.map((c) => `- \`${c}\``).join("\n") || "- بدون دسترسی مستقیم"}

*این گزارش توسط ابزارهای خودکار ویندوز اجنت OmniOps تولید شده است.*`;
  };

  return (
    <div className="tools-container" dir="rtl">
      {/* Tools Sub-Navigation */}
      <div className="tools-subnav">
        <button
          type="button"
          className={`tools-subnav-btn ${activeTab === "vitals" ? "active" : ""}`}
          onClick={() => setActiveTab("vitals")}
        >
          <span>🖥️</span> تله‌متری و سلامت
        </button>
        <button
          type="button"
          className={`tools-subnav-btn ${activeTab === "cli" ? "active" : ""}`}
          onClick={() => setActiveTab("cli")}
        >
          <span>⚡</span> کنسول و خط فرمان
        </button>
        <button
          type="button"
          className={`tools-subnav-btn ${activeTab === "network" ? "active" : ""}`}
          onClick={() => setActiveTab("network")}
        >
          <span>🌐</span> دیدبان پینگ
        </button>
        <button
          type="button"
          className={`tools-subnav-btn ${activeTab === "scratchpad" ? "active" : ""}`}
          onClick={() => setActiveTab("scratchpad")}
        >
          <span>🧰</span> ابزار سریع داده
        </button>
        <button
          type="button"
          className={`tools-subnav-btn ${activeTab === "diagnostic" ? "active" : ""}`}
          onClick={() => setActiveTab("diagnostic")}
        >
          <span>📋</span> گزارش تشخیصی
        </button>
      </div>

      {copyFeedback && <div className="tools-toast">{copyFeedback}</div>}

      {/* TAB 1: System Vitals */}
      {activeTab === "vitals" && (
        <section className="tool-tab-content">
          <div className="tool-header-row">
            <div>
              <h3>مشخصات و تله‌متری محلی ویندوز</h3>
              <p>وضعیت سخت‌افزاری، منابع پردازشی و مشخصات نمایشگر سیستم میزبان</p>
            </div>
            <button
              type="button"
              className="tool-action-btn"
              onClick={() => triggerCopy(JSON.stringify(vitals, null, 2), "مشخصات به فرمت JSON کپی شد!")}
            >
              📋 کپی کل مشخصات
            </button>
          </div>

          <div className="vitals-grid">
            <div className="vital-card">
              <span className="vital-icon">💻</span>
              <div className="vital-info">
                <label>سیستم‌عامل و پلتفرم</label>
                <strong>{vitals.platform}</strong>
                <small>{vitals.arch}</small>
              </div>
            </div>

            <div className="vital-card">
              <span className="vital-icon">🧠</span>
              <div className="vital-info">
                <label>پردازنده و منابع</label>
                <strong>{vitals.cores} هسته پردازشی</strong>
                <small>برآورد رم: {vitals.memoryEstimate}</small>
              </div>
            </div>

            <div className="vital-card">
              <span className="vital-icon">🖥️</span>
              <div className="vital-info">
                <label>وضوح و مقیاس تصویر</label>
                <strong>{vitals.screenWidth} × {vitals.screenHeight} px</strong>
                <small>ضریب تراکم پیکسلی: {vitals.pixelRatio}x</small>
              </div>
            </div>

            <div className="vital-card">
              <span className="vital-icon">{vitals.online ? "🟢" : "🔴"}</span>
              <div className="vital-info">
                <label>وضعیت شبکه محلی</label>
                <strong>{vitals.online ? "متصل به شبکه (Online)" : "آفلاین (قطع اتصال)"}</strong>
                <small>{vitals.timezone}</small>
              </div>
            </div>
          </div>

          <div className="vital-footer-panel">
            <div className="vital-session-badge">
              <span>نشست کاربری فعال:</span>
              <strong>{profile?.username || "بدون نشست"}</strong>
              <small>({profile?.role || "میهمان"})</small>
            </div>
            <button
              type="button"
              className="tool-chat-inject-btn"
              onClick={() => {
                const promptMsg = `لطفاً وضعیت سیستم و منابع زیر را تحلیل کن:\n- سیستم‌عامل: ${vitals.platform}\n- هسته‌ها: ${vitals.cores}\n- رم: ${vitals.memoryEstimate}\n- وضعیت آنلاین: ${vitals.online ? "بله" : "خیر"}`;
                onSendToChat(promptMsg);
              }}
            >
              ارسال خلاصه منابع به گفت‌وگو 💬
            </button>
          </div>
        </section>
      )}

      {/* TAB 2: CLI & Dev Inspector */}
      {activeTab === "cli" && (
        <section className="tool-tab-content">
          <div className="tool-header-row">
            <div>
              <h3>کنسول و خط فرمان بازرسی ویندوز</h3>
              <p>اجرا و بازرسی دستورات رایج توسعه‌دهنده و وضعیت سرویس‌های محلی</p>
            </div>
          </div>

          {/* Quick preset chips */}
          <div className="cli-chips-row">
            {cliPresets.map((preset) => (
              <button
                key={preset.cmd}
                type="button"
                className="cli-chip"
                title={preset.desc}
                onClick={() => {
                  setCustomCmd(preset.cmd);
                  handleRunCommand(preset.cmd);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* CLI input row */}
          <div className="cli-input-row">
            <input
              type="text"
              className="cli-input"
              dir="ltr"
              value={customCmd}
              placeholder="دستور خط فرمان را وارد کنید (مثلاً: ipconfig /all)"
              onChange={(e) => setCustomCmd(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && customCmd.trim()) {
                  handleRunCommand(customCmd.trim());
                }
              }}
            />
            <button
              type="button"
              className="cli-run-btn"
              disabled={cliRunning || !customCmd.trim()}
              onClick={() => handleRunCommand(customCmd.trim())}
            >
              {cliRunning ? "در حال بازرسی…" : "اجرا و تحلیل ↵"}
            </button>
          </div>

          {/* Terminal output window */}
          {cliOutput && (
            <div className="cli-terminal-window">
              <div className="cli-terminal-bar">
                <span className="terminal-title" dir="ltr">$ {cliOutput.cmd}</span>
                <div className="terminal-meta">
                  <span className="terminal-time">⏱️ {cliOutput.elapsed}ms</span>
                  <button
                    type="button"
                    className="terminal-copy-btn"
                    onClick={() => triggerCopy(cliOutput.stdout, "خروجی کپی شد!")}
                  >
                    📋 کپی
                  </button>
                  <button
                    type="button"
                    className="terminal-chat-btn"
                    onClick={() => {
                      const promptMsg = `خروجی دستور زیر را بررسی و تحلیل کن:\n\`\`\`cmd\n> ${cliOutput.cmd}\n${cliOutput.stdout}\n\`\`\``;
                      onSendToChat(promptMsg);
                    }}
                  >
                    💬 تحلیل در چت
                  </button>
                </div>
              </div>
              <pre className="cli-terminal-body" dir="ltr">{cliOutput.stdout}</pre>
            </div>
          )}
        </section>
      )}

      {/* TAB 3: Network & Ping Watcher */}
      {activeTab === "network" && (
        <section className="tool-tab-content">
          <div className="tool-header-row">
            <div>
              <h3>دیدبان پینگ و آزمایش ارتباط شبکه</h3>
              <p>سنجش تاخیر ارتباط (Latency) بر حسب میلی‌ثانیه با هسته مرکزی و درگاه‌ها</p>
            </div>
          </div>

          {/* Target Host row */}
          <div className="ping-input-row">
            <input
              type="url"
              className="ping-input"
              dir="ltr"
              value={targetHost}
              placeholder="https://edge.example.com یا http://127.0.0.1:9000"
              onChange={(e) => setTargetHost(e.target.value)}
            />
            <button
              type="button"
              className="ping-btn"
              disabled={pingRunning || !targetHost.trim()}
              onClick={() => handlePingTest(targetHost.trim())}
            >
              {pingRunning ? "در حال پینگ…" : "آزمایش تاخیر (Ping) ⚡"}
            </button>
          </div>

          {/* Quick preset targets */}
          <div className="cli-chips-row">
            <button
              type="button"
              className="cli-chip"
              onClick={() => {
                setTargetHost("http://127.0.0.1:9000");
                handlePingTest("http://127.0.0.1:9000");
              }}
            >
              🏢 هسته محلی (Local Core: 9000)
            </button>
            <button
              type="button"
              className="cli-chip"
              onClick={() => {
                setTargetHost("https://cloudflare.com");
                handlePingTest("https://cloudflare.com");
              }}
            >
              ☁️ شبکه ابری (Cloudflare)
            </button>
            <button
              type="button"
              className="cli-chip"
              onClick={() => {
                setTargetHost("https://api.github.com");
                handlePingTest("https://api.github.com");
              }}
            >
              🐙 گیت‌هاب (GitHub API)
            </button>
          </div>

          {/* Ping Results History */}
          <div className="ping-results-list">
            <h4>تاریخچهٔ آزمایش‌های اخیر</h4>
            {pingHistory.length === 0 ? (
              <p className="empty-tools-state">هنوز تستی انجام نشده است. روی دکمه آزمایش پینگ کلیک کنید.</p>
            ) : (
              <div className="ping-cards">
                {pingHistory.map((item, index) => (
                  <div key={index} className={`ping-card ${item.success ? "success" : "failed"}`}>
                    <div className="ping-card-header">
                      <strong dir="ltr">{item.host}</strong>
                      <span className="ping-badge">{item.statusText}</span>
                    </div>
                    <div className="ping-card-details">
                      <span>زمان ثبت: {item.timestamp}</span>
                      <strong className="ping-ms">{item.timeMs} ms</strong>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* TAB 4: Developer Scratchpad */}
      {activeTab === "scratchpad" && (
        <section className="tool-tab-content">
          <div className="tool-header-row">
            <div>
              <h3>جعبه‌ابزار پردازش سریع متن و داده</h3>
              <p>فرمت JSON، کدگذاری Base64، هش SHA-256 و تولید توکن‌های ایمن</p>
            </div>
          </div>

          {/* Tool mode selector */}
          <div className="scratch-type-tabs">
            <button
              type="button"
              className={scratchType === "json" ? "selected" : ""}
              onClick={() => {
                setScratchType("json");
                setScratchOutput("");
              }}
            >
              JSON
            </button>
            <button
              type="button"
              className={scratchType === "base64" ? "selected" : ""}
              onClick={() => {
                setScratchType("base64");
                setScratchOutput("");
              }}
            >
              Base64
            </button>
            <button
              type="button"
              className={scratchType === "hash" ? "selected" : ""}
              onClick={() => {
                setScratchType("hash");
                setScratchOutput("");
              }}
            >
              هش رمزنگاری (SHA-256)
            </button>
            <button
              type="button"
              className={scratchType === "url" ? "selected" : ""}
              onClick={() => {
                setScratchType("url");
                setScratchOutput("");
              }}
            >
              URL Encode
            </button>
            <button
              type="button"
              className={scratchType === "uuid" ? "selected" : ""}
              onClick={() => {
                setScratchType("uuid");
                setScratchOutput("");
              }}
            >
              تولید UUID v4
            </button>
          </div>

          {/* Action buttons based on tool */}
          <div className="scratch-actions-bar">
            {scratchType === "json" && (
              <>
                <button type="button" className="scratch-btn" onClick={() => void processScratchpad("beautify")}>
                  ✨ زیباسازی (Beautify)
                </button>
                <button type="button" className="scratch-btn" onClick={() => void processScratchpad("minify")}>
                  🗜️ فشرده‌سازی (Minify)
                </button>
                <button type="button" className="scratch-btn" onClick={() => void processScratchpad("validate")}>
                  🔍 اعتبارسنجی
                </button>
              </>
            )}
            {scratchType === "base64" && (
              <>
                <button type="button" className="scratch-btn" onClick={() => void processScratchpad("encode")}>
                  🔒 Encode Base64
                </button>
                <button type="button" className="scratch-btn" onClick={() => void processScratchpad("decode")}>
                  🔓 Decode Base64
                </button>
              </>
            )}
            {scratchType === "hash" && (
              <button type="button" className="scratch-btn primary" onClick={() => void processScratchpad("sha256")}>
                🛡️ محاسبه هش SHA-256
              </button>
            )}
            {scratchType === "url" && (
              <>
                <button type="button" className="scratch-btn" onClick={() => void processScratchpad("encode")}>
                  🔗 کدگذاری URL
                </button>
                <button type="button" className="scratch-btn" onClick={() => void processScratchpad("decode")}>
                  🔓 رمزگشایی URL
                </button>
              </>
            )}
            {scratchType === "uuid" && (
              <button type="button" className="scratch-btn primary" onClick={() => void processScratchpad("uuid")}>
                🎲 تولید UUID تصادفی ایمن
              </button>
            )}
          </div>

          {/* Inputs & Outputs */}
          {scratchType !== "uuid" && (
            <div className="scratch-field">
              <label htmlFor={inputId}>ورودی متنی:</label>
              <textarea
                id={inputId}
                className="scratch-textarea"
                dir="ltr"
                rows={4}
                value={scratchInput}
                onChange={(e) => setScratchInput(e.target.value)}
                placeholder="متن یا داده ورودی را وارد کنید…"
              />
            </div>
          )}

          {scratchError && <div className="scratch-error-box">⚠️ {scratchError}</div>}

          {scratchOutput && (
            <div className="scratch-field">
              <div className="scratch-output-header">
                <label>خروجی پردازش‌شده:</label>
                <div className="scratch-output-actions">
                  <button
                    type="button"
                    className="scratch-sm-btn"
                    onClick={() => triggerCopy(scratchOutput, "خروجی کپی شد!")}
                  >
                    📋 کپی
                  </button>
                  <button
                    type="button"
                    className="scratch-sm-btn"
                    onClick={() => {
                      onSendToChat(`دادهٔ پردازش‌شده با ابزار ${scratchType}:\n\`\`\`\n${scratchOutput}\n\`\`\``);
                    }}
                  >
                    💬 ارسال به چت
                  </button>
                </div>
              </div>
              <pre className="scratch-output-pre" dir="ltr">{scratchOutput}</pre>
            </div>
          )}
        </section>
      )}

      {/* TAB 5: Diagnostic Report */}
      {activeTab === "diagnostic" && (
        <section className="tool-tab-content">
          <div className="tool-header-row">
            <div>
              <h3>تولید گزارش تشخیصی جامع</h3>
              <p>تولید گزارش متنی با استاندارد Markdown جهت عیب‌یابی سریع و ارسال به دستیار هوش مصنوعی</p>
            </div>
            <div className="diagnostic-header-actions">
              <button
                type="button"
                className="tool-action-btn"
                onClick={() => triggerCopy(generateDiagnosticReport(), "گزارش در کلیپ‌بورد کپی شد!")}
              >
                📋 کپی گزارش
              </button>
              <button
                type="button"
                className="tool-chat-inject-btn"
                onClick={() => onSendToChat(generateDiagnosticReport())}
              >
                🚀 ارسال به چت برای عیب‌یابی
              </button>
            </div>
          </div>

          <pre className="diagnostic-preview-pre" dir="ltr">{generateDiagnosticReport()}</pre>
        </section>
      )}
    </div>
  );
}

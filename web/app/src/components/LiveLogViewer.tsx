import { useState, useEffect, useRef, useMemo } from "react";

export type LogSeverity = "debug" | "info" | "warn" | "error";

export interface LogLine {
  id: string;
  timestamp: string;
  severity: LogSeverity;
  service: string;
  message: string;
}

const SAMPLE_SERVICES = [
  "omniops-core",
  "jrv-router",
  "ollama-worker",
  "proxy-relay",
  "edge-windows",
  "identity-auth",
  "task-engine"
] as const;

const MOCK_MESSAGES: Array<{ severity: LogSeverity; service: string; message: string }> = [
  { severity: "info", service: "omniops-core", message: "HTTP request completed: GET /api/admin/system/metrics 200 OK in 4.2ms" },
  { severity: "info", service: "jrv-router", message: "Prompt intent evaluated: coding (score: 9.0) -> selected 'ollama/qwen2.5-coder:7b'" },
  { severity: "debug", service: "proxy-relay", message: "SOCKS5 connection verified on socks5h://127.0.0.1:10808 (RTT: 38ms)" },
  { severity: "info", service: "ollama-worker", message: "Health ping responded from OmniOps-02 (172.19.30.99) latency: 14ms (8 models active)" },
  { severity: "debug", service: "identity-auth", message: "JWT token verified for principal 'superadmin' with scope [admin:read, admin:write]" },
  { severity: "info", service: "edge-windows", message: "Windows Edge Agent heartbeat received from DESKTOP-OMNIOPS (state: online, idle)" },
  { severity: "debug", service: "task-engine", message: "Spec verification finished for project 'OmniOps' (patch integrity: verified)" },
  { severity: "warn", service: "jrv-router", message: "Provider rate-limit threshold near 85% for tier 'standard'; routing preference shifted" },
  { severity: "info", service: "omniops-core", message: "Temporal web-search grounding active: Saturday 17 October 2026 / ۲۵ مهر ۱۴۰۵" },
  { severity: "error", service: "ollama-worker", message: "Timeout awaiting Ollama socket on 172.19.30.99:11434 (retried 1/3, recovered)" },
  { severity: "warn", service: "omniops-core", message: "High memory allocation detected in worker subprocess (78% threshold reached)" },
  { severity: "debug", service: "jrv-router", message: "Dynamic latency score matrix updated across 6 available models" },
  { severity: "error", service: "proxy-relay", message: "Direct handshake refused by peer; automatically routed through fallback SOCKS5 relay" },
  { severity: "info", service: "identity-auth", message: "Database backup snapshot verified: identity-20261017T163052Z.db (256 KB)" },
  { severity: "debug", service: "edge-windows", message: "Workspace directory synchronized: C:\\Users\\arfaghani\\Desktop\\OmniOps" }
];

function generateLogLine(index: number): LogLine {
  const template = MOCK_MESSAGES[Math.floor(Math.random() * MOCK_MESSAGES.length)];
  const now = new Date();
  const timeStr = now.toTimeString().split(" ")[0] + "." + String(now.getMilliseconds()).padStart(3, "0");
  return {
    id: `log-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: timeStr,
    severity: template.severity,
    service: template.service,
    message: template.message
  };
}

export function LiveLogViewer() {
  // Buffer capped at 80 lines as specified
  const [logs, setLogs] = useState<LogLine[]>(() => {
    return Array.from({ length: 28 }, (_, i) => generateLogLine(i));
  });

  // Toolbar States
  const [selectedService, setSelectedService] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [severityToggles, setSeverityToggles] = useState<Record<LogSeverity, boolean>>({
    debug: true,
    info: true,
    warn: true,
    error: true
  });
  const [isLive, setIsLive] = useState<boolean>(true);
  const [userScrolledUp, setUserScrolledUp] = useState<boolean>(false);
  const [copyFeedback, setCopyFeedback] = useState<boolean>(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Live stream generator: appends new log line every 1 second while live, caps buffer at 80
  useEffect(() => {
    if (!isLive) return;

    let counter = 0;
    const interval = setInterval(() => {
      counter++;
      setLogs(prev => {
        const newLine = generateLogLine(counter);
        const updated = [...prev, newLine];
        return updated.length > 80 ? updated.slice(-80) : updated;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isLive]);

  // Handle auto-scroll to bottom unless user has scrolled up
  useEffect(() => {
    if (!userScrolledUp && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [logs, userScrolledUp]);

  // Track user scroll behavior
  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setUserScrolledUp(!isAtBottom);
  };

  const scrollToBottom = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      setUserScrolledUp(false);
    }
  };

  // Severity counts based on current 80-line buffer
  const severityCounts = useMemo(() => {
    const counts: Record<LogSeverity, number> = { debug: 0, info: 0, warn: 0, error: 0 };
    logs.forEach(l => {
      if (counts[l.severity] !== undefined) counts[l.severity]++;
    });
    return counts;
  }, [logs]);

  // Filtered log lines based on service, search query, and severity toggles
  const filteredLogs = useMemo(() => {
    return logs.filter(line => {
      // 1. Severity filter
      if (!severityToggles[line.severity]) return false;

      // 2. Service filter
      if (selectedService !== "all" && line.service !== selectedService) return false;

      // 3. Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchesMsg = line.message.toLowerCase().includes(q);
        const matchesSvc = line.service.toLowerCase().includes(q);
        const matchesSev = line.severity.toLowerCase().includes(q);
        if (!matchesMsg && !matchesSvc && !matchesSev) return false;
      }

      return true;
    });
  }, [logs, severityToggles, selectedService, searchQuery]);

  const toggleSeverity = (sev: LogSeverity) => {
    setSeverityToggles(prev => ({
      ...prev,
      [sev]: !prev[sev]
    }));
  };

  const handleCopyLogs = () => {
    const text = filteredLogs
      .map(l => `[${l.timestamp}] [${l.severity.toUpperCase()}] [${l.service}] ${l.message}`)
      .join("\n");
    navigator.clipboard.writeText(text);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  const handleClearLogs = () => {
    setLogs([]);
  };

  return (
    <div className="flex flex-col gap-3 w-full bg-[#12161f]/90 border border-white/10 rounded-2xl p-4 shadow-2xl backdrop-blur-xl">
      {/* هدر بخش پایشگر لاگ */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <span className="text-xl">📊</span>
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2 m-0">
              <span>پایشگر زنده لاگ هسته مرکزی (Core Live Log Viewer)</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                Tailwind CSS
              </span>
            </h3>
            <p className="text-xs text-slate-400 m-0 mt-0.5">
              جریان زنده رویدادهای سرور، مسیریاب هوشمند JRV، ارتباطات ویندوز و گره‌های محلی
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* دکمه پاک‌سازی لاگ‌ها */}
          <button
            type="button"
            onClick={handleClearLogs}
            className="px-2.5 py-1 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 border border-white/10 transition-colors"
            title="پاکسازی بافر نمایش لاگ‌ها"
          >
            🗑 پاکسازی
          </button>

          {/* دکمه کپی همه لاگ‌ها */}
          <button
            type="button"
            onClick={handleCopyLogs}
            className="px-2.5 py-1 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition-colors"
            title="کپی لاگ‌های جاری به کلیپ‌بورد"
          >
            {copyFeedback ? "✓ کپی شد" : "📋 کپی لاگ‌ها"}
          </button>
        </div>
      </div>

      {/* تولبار اصلی (Toolbar) */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-black/40 border border-white/10 rounded-xl p-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Service Select Dropdown */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-400">سرویس:</span>
            <select
              value={selectedService}
              onChange={e => setSelectedService(e.target.value)}
              className="bg-[#161b22] border border-white/15 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-rose-400 cursor-pointer"
            >
              <option value="all">همه سرویس‌ها (All)</option>
              {SAMPLE_SERVICES.map(svc => (
                <option key={svc} value={svc}>
                  {svc}
                </option>
              ))}
            </select>
          </div>

          {/* Search Field with Magnifier Glyph */}
          <div className="relative flex items-center">
            <span className="absolute left-2.5 text-xs text-slate-400 pointer-events-none" dir="ltr">
              🔍
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="جستجو در پیام‌ها و متون لاگ..."
              className="bg-[#161b22] border border-white/15 rounded-lg pl-8 pr-2.5 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-rose-400 w-44 md:w-60"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 text-xs text-slate-400 hover:text-white"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Severity Toggle Chips & Live Pill & Pause Button */}
        <div className="flex flex-wrap items-center gap-2">
          {/* 4 Severity Toggle Chips with Live Counts */}
          <div className="flex items-center gap-1 bg-black/30 p-1 rounded-lg border border-white/10">
            {/* DEBUG Chip */}
            <button
              type="button"
              onClick={() => toggleSeverity("debug")}
              className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold transition-all border ${
                severityToggles.debug
                  ? "bg-sky-500/20 text-sky-300 border-sky-500/50 shadow-[0_0_8px_rgba(56,189,248,0.2)]"
                  : "bg-transparent text-slate-500 border-transparent opacity-40 hover:opacity-70"
              }`}
              title="تغییر وضعیت فیلتر سطح DEBUG"
            >
              DEBUG ({severityCounts.debug})
            </button>

            {/* INFO Chip */}
            <button
              type="button"
              onClick={() => toggleSeverity("info")}
              className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold transition-all border ${
                severityToggles.info
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-[0_0_8px_rgba(16,185,129,0.2)]"
                  : "bg-transparent text-slate-500 border-transparent opacity-40 hover:opacity-70"
              }`}
              title="تغییر وضعیت فیلتر سطح INFO"
            >
              INFO ({severityCounts.info})
            </button>

            {/* WARN Chip */}
            <button
              type="button"
              onClick={() => toggleSeverity("warn")}
              className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold transition-all border ${
                severityToggles.warn
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-[0_0_8px_rgba(245,158,11,0.2)]"
                  : "bg-transparent text-slate-500 border-transparent opacity-40 hover:opacity-70"
              }`}
              title="تغییر وضعیت فیلتر سطح WARN"
            >
              WARN ({severityCounts.warn})
            </button>

            {/* ERROR Chip */}
            <button
              type="button"
              onClick={() => toggleSeverity("error")}
              className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold transition-all border ${
                severityToggles.error
                  ? "bg-rose-500/25 text-rose-300 border-rose-500/60 shadow-[0_0_8px_rgba(244,63,94,0.3)]"
                  : "bg-transparent text-slate-500 border-transparent opacity-40 hover:opacity-70"
              }`}
              title="تغییر وضعیت فیلتر سطح ERROR"
            >
              ERROR ({severityCounts.error})
            </button>
          </div>

          {/* "Live" Pill with Pulsing Green Dot */}
          <div
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
              isLive
                ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-400"
                : "bg-slate-900 border-white/10 text-slate-400"
            }`}
          >
            {isLive ? (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            ) : (
              <span className="inline-block h-2 w-2 rounded-full bg-slate-500"></span>
            )}
            <span className="text-[11px]">{isLive ? "Live" : "Paused"}</span>
          </div>

          {/* Pause / Resume Button */}
          <button
            type="button"
            onClick={() => setIsLive(prev => !prev)}
            className={`flex items-center gap-1 px-3 py-1 rounded-lg border text-xs font-semibold transition-all ${
              isLive
                ? "bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30"
                : "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.3)]"
            }`}
            title={isLive ? "توقف جریان لحظه‌ای لاگ‌ها" : "ادامه دریافت زنده لاگ‌ها"}
          >
            <span>{isLive ? "⏸ توقف" : "▶ ادامه"}</span>
          </button>
        </div>
      </div>

      {/* بدنه نمایش لاگ‌ها (Dark rounded-xl panel of monospaced log lines) */}
      <div className="relative">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          dir="ltr"
          className="bg-[#090c12] border border-white/10 rounded-xl overflow-y-auto font-mono text-[11.5px] max-h-[460px] min-h-[340px] p-2.5 omni-chic-scrollbar select-text space-y-0.5"
        >
          {filteredLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-2">
              <span className="text-2xl">🔍</span>
              <span>هیچ خط لاگی با فیلترهای انتخابی یافت نشد.</span>
            </div>
          ) : (
            filteredLogs.map(line => {
              const isError = line.severity === "error";
              const isWarn = line.severity === "warn";

              return (
                <div
                  key={line.id}
                  className={`flex items-start gap-2.5 px-2 py-1 rounded transition-colors hover:bg-white/[0.03] ${
                    isError
                      ? "border-l-2 border-rose-500/70 bg-rose-950/20"
                      : isWarn
                      ? "border-l-2 border-amber-500/60 bg-amber-950/10"
                      : "border-l-2 border-transparent"
                  }`}
                >
                  {/* Muted Timestamp */}
                  <span className="text-slate-500 text-[11px] w-20 flex-shrink-0 select-none">
                    {line.timestamp}
                  </span>

                  {/* Coloured Severity Tag of Fixed Width */}
                  <span
                    className={`w-14 flex-shrink-0 text-center font-bold px-1 py-0.2 rounded text-[10px] tracking-wider uppercase ${
                      line.severity === "debug"
                        ? "text-sky-400 bg-sky-500/10 border border-sky-500/20"
                        : line.severity === "info"
                        ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                        : line.severity === "warn"
                        ? "text-amber-400 bg-amber-500/15 border border-amber-500/30"
                        : "text-rose-400 bg-rose-500/20 border border-rose-500/40"
                    }`}
                  >
                    {line.severity}
                  </span>

                  {/* Service Name in a Dimmer Colour */}
                  <span
                    className="text-slate-400 font-semibold w-28 flex-shrink-0 truncate text-[11px]"
                    title={line.service}
                  >
                    {line.service}
                  </span>

                  {/* Log Message */}
                  <span className="text-slate-200 flex-1 break-all leading-relaxed">
                    {line.message}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* دکمه شناور پرش به انتها در صورت اسکرول به بالا */}
        {userScrolledUp && (
          <button
            type="button"
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-rose-600/90 hover:bg-rose-500 text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow-lg border border-rose-400/50 flex items-center gap-1.5 transition-all animate-bounce"
          >
            <span>⬇ اسکرول به جدیدترین لاگ‌ها</span>
          </button>
        )}
      </div>

      {/* نوار وضعیت پایینی (Status Bar) */}
      <div className="flex flex-wrap items-center justify-between text-xs text-slate-400 px-1 pt-1 border-t border-white/5">
        {/* Line Count on the Left */}
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-slate-500"></span>
          <span>
            نمایش{" "}
            <strong className="text-slate-200 font-mono">
              {filteredLogs.length.toLocaleString("fa-IR")}
            </strong>{" "}
            خط از{" "}
            <strong className="text-slate-200 font-mono">
              {logs.length.toLocaleString("fa-IR")}
            </strong>{" "}
            خط بافر
          </span>
          {searchQuery && (
            <span className="text-[11px] text-amber-400">
              (فیلترشده بر اساس «{searchQuery}»)
            </span>
          )}
        </div>

        {/* Retention Window on the Right */}
        <div className="flex items-center gap-2 text-slate-400">
          <span>ظرفیت نگهداری بافر:</span>
          <span className="px-2 py-0.5 rounded bg-black/40 border border-white/10 text-slate-300 font-mono text-[11px]">
            ۸۰ خط اخیر (Max: 80 lines)
          </span>
        </div>
      </div>
    </div>
  );
}

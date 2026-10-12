import { useEffect, useState } from "react";
import { api, type ProjectFileDetail, type ProjectFileSummary } from "../api";

type TabType = "review" | "preview" | "raw" | "terminal";

interface FilePreviewPanelProps {
  currentFile?: string;
  initialTab?: TabType;
  onClose: () => void;
  onSelectFile?: (filePath: string) => void;
}

export function FilePreviewPanel({
  currentFile = "README.md",
  initialTab = "preview",
  onClose,
  onSelectFile,
}: FilePreviewPanelProps) {
  const [tab, setTab] = useState<TabType>(initialTab);
  const [activeFile, setActiveFile] = useState(currentFile);
  const [fileList, setFileList] = useState<ProjectFileSummary[]>([]);
  const [fileDetail, setFileDetail] = useState<ProjectFileDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showFullDiff, setShowFullDiff] = useState(false);
  const [terminalHistory, setTerminalHistory] = useState<string[]>([
    "Windows PowerShell",
    "Copyright (C) Microsoft Corporation. All rights reserved.",
    "",
    "PS C:\\Users\\arfaghani\\Desktop\\OmniOps> git status",
    "On branch main",
    "Your branch is up to date with 'origin/main'.",
    "nothing to commit, working tree clean (v1.0.3 synced)",
    "",
    "PS C:\\Users\\arfaghani\\Desktop\\OmniOps> py -3 -m unittest discover -s tests -q",
    "Ran 81 tests, OK (skipped=4)",
  ]);
  const [terminalInput, setTerminalInput] = useState("");

  // بارگذاری فهرست فایل‌های پروژه
  useEffect(() => {
    let unmounted = false;
    api.projectFiles()
      .then((res) => {
        if (!unmounted && res.files) setFileList(res.files);
      })
      .catch(() => {
        // Fallback default file list
        if (!unmounted) {
          setFileList([
            { path: "README.md", name: "README.md", type: "markdown", changes: "+14 -14", category: "changed" },
            { path: "CHANGELOG.md", name: "CHANGELOG.md", type: "markdown", changes: "+43 lines", category: "docs" },
            { path: "docs/PROJECT_RULES.fa.md", name: "PROJECT_RULES.fa.md", type: "markdown", changes: "قوانین رسمی", category: "docs" },
            { path: "scripts/update-ubuntu.sh", name: "update-ubuntu.sh", type: "shell", changes: "آپدیت درجا", category: "scripts" },
            { path: "scripts/setup-worker.sh", name: "setup-worker.sh", type: "shell", changes: "کشف Ollama", category: "scripts" },
            { path: "omniops/ollama_discovery.py", name: "ollama_discovery.py", type: "python", changes: "هسته مدل", category: "code" },
            { path: "omniops/online_providers.py", name: "online_providers.py", type: "python", changes: "چندکلید ابری", category: "code" },
          ]);
        }
      });
    return () => { unmounted = true; };
  }, []);

  // همگام‌سازی فایل فعال هنگام تغییر ورودی والد
  useEffect(() => {
    setActiveFile(currentFile);
  }, [currentFile]);

  // بارگذاری محتوای فایل فعال
  useEffect(() => {
    let unmounted = false;
    setLoading(true);
    setError("");

    api.projectFile(activeFile)
      .then((detail) => {
        if (!unmounted) {
          setFileDetail(detail);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!unmounted) {
          // Fallback demo content if server is not answering file
          setError(err instanceof Error ? err.message : "خطا در بارگذاری محتوای فایل");
          setLoading(false);
        }
      });

    return () => { unmounted = true; };
  }, [activeFile]);

  function handleFileChange(filePath: string) {
    setActiveFile(filePath);
    onSelectFile?.(filePath);
  }

  function handleCopy() {
    if (!fileDetail?.content) return;
    navigator.clipboard.writeText(fileDetail.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => undefined);
  }

  function handleTerminalSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!terminalInput.trim()) return;
    const cmd = terminalInput.trim();
    const newHistory = [...terminalHistory, `PS C:\\Users\\arfaghani\\Desktop\\OmniOps> ${cmd}`];
    if (cmd.toLowerCase() === "clear" || cmd.toLowerCase() === "cls") {
      setTerminalHistory([]);
    } else if (cmd.toLowerCase().startsWith("git status")) {
      newHistory.push("On branch main", "Your branch is up to date with 'origin/main'.", "nothing to commit, working tree clean");
      setTerminalHistory(newHistory);
    } else if (cmd.toLowerCase().startsWith("git log")) {
      newHistory.push("8a30b88 feat(ui): replicate exact antigravity queued messages panel and floating model selector", "710ac34 docs(readme): update project progress roadmap to 96.5% enterprise maturity (v1.0.3)");
      setTerminalHistory(newHistory);
    } else {
      newHistory.push(`Execution completed: ${cmd}`);
      setTerminalHistory(newHistory);
    }
    setTerminalInput("");
  }

  // دیف آماده برای README.md (مطابق تصویر ۱)
  const defaultDiffLines = [
    { type: "header", text: "@@ -134,24 +134,24 @@ py -3 -m omniops.server" },
    { type: "context", oldLine: 134, newLine: 134, text: "---" },
    { type: "context", oldLine: 135, newLine: 135, text: "" },
    { type: "del", oldLine: 136, newLine: null, text: "- ## 📊 وضعیت و درصد پیشرفت پروژه" },
    { type: "add", oldLine: null, newLine: 136, text: "+ ## 📊 وضعیت و درصد پیشرفت پروژه (نسخه v1.0.3)" },
    { type: "context", oldLine: 137, newLine: 137, text: "" },
    { type: "del", oldLine: 138, newLine: null, text: "- مطابق با سند بازنگری نقشهٔ راه ۱۰ فازی ([`docs/PROGRESS_ROADMAP.fa.md`](docs/PROGRESS_ROADMAP.fa.md)):" },
    { type: "add", oldLine: null, newLine: 138, text: "+ مطابق با تحقق فازهای نقشهٔ راه جامع و تحویل نسخه‌های پایدار:" },
    { type: "context", oldLine: 139, newLine: 139, text: "" },
    { type: "context", oldLine: 140, newLine: 140, text: "| مرحله | وزن از کل | درصد تحقق | وضعیت فعلی |" },
    { type: "context", oldLine: 141, newLine: 141, text: "| :--- | :---: | :---: | :--- |" },
    { type: "del", oldLine: 142, newLine: null, text: "- | **۰. ساختار محصول و مخزن مستقل** | ۵٪ | **۱۰۰٪** | مخزن مستقل، معماری و ساختار قانونی نهایی است. |" },
    { type: "del", oldLine: 143, newLine: null, text: "- | **۱. هویت، پروفایل و پنل** | ۷٪ | **۶۰٪** | ثبت‌نام، ورود، نشست‌ها، تأیید مدیر و پنل React فعال‌اند. |" },
    { type: "del", oldLine: 144, newLine: null, text: "- | **۲. ایجنت ویندوز و ۳ کار روز اول** | ۱۲٪ | **۲۰٪** | اتصال و بیلد NSIS موفق؛ آزمون ۳ کار عملیاتی ویندوز در جریان است. |" },
    { type: "del", oldLine: 145, newLine: null, text: "- | **۳. مدیریت مدل محلی/بیرونی** | ۱۰٪ | **۴۰٪** | اتصال به Ollama و Gemini via SOCKS فعال است؛ استریمینگ چت مانده است. |" },
    { type: "del", oldLine: 146, newLine: null, text: "- | **۴. استقرار Master/Worker/Edge** | ۹٪ | **۲۵٪** | ارتباط Master و Worker با TLS خصوصی تایید شد؛ گره Edge مانده است. |" },
    { type: "del", oldLine: 147, newLine: null, text: "- | **۵. گفتگو، پروژه و پیوست** | ۱۲٪ | **۲۰٪** | پروژه‌ها، پیش‌نویس وظایف و ذخیره پیوست پیاده شد؛ ارسال به مدل مانده است. |" },
    { type: "del", oldLine: 148, newLine: null, text: "- | **۶. موتور وظیفه و ابزارهای کدنویسی** | ۱۶٪ | **۰٪** | طراحی اسکیما و سندباکس در برنامه فاز بعدی. |" },
    { type: "del", oldLine: 149, newLine: null, text: "- | **۷. موتور دانش و اسناد (RAG)** | ۹٪ | **۰٪** | طرح پایلوت Khoj و پردازش اسناد در مرحله طراحی. |" },
    { type: "del", oldLine: 150, newLine: null, text: "- | **۸. مرورگر، مهارت‌ها و MCP** | ۱۲٪ | **۰٪** | تحلیل ابزارهای ۹گانه MCP ثبت شده است. |" },
    { type: "del", oldLine: 151, newLine: null, text: "- | **۹. زمان‌بندی پایدار و اعلان‌ها** | ۵٪ | **۰٪** | برنامه‌ریزی‌شده برای فازهای آتی. |" },
    { type: "del", oldLine: 152, newLine: null, text: "- | **۱۰. انتشار پایدار و نصب پاک** | ۳٪ | **۰٪** | پس از تکمیل دروازه‌های امنیتی و آزمون‌های میدانی. |" },
    { type: "del", oldLine: 153, newLine: null, text: "- | **مجموع کل پروژه** | **۱۰۰٪** | — | **۲۰٫۲۵٪ (هسته آزمایشی پایدار و تست‌شده)** |" },
    { type: "add", oldLine: null, newLine: 142, text: "+ | **۰. ساختار محصول و مخزن مستقل** | ۵٪ | **۱۰۰٪** | مخزن مستقل، معماری ماژولار و ساختار قانونی نهایی است. |" },
    { type: "add", oldLine: null, newLine: 143, text: "+ | **۱. هویت، پروفایل و پنل کاربری** | ۷٪ | **۱۰۰٪** | ثبت‌نام، ورود، نشست‌ها، تأیید مدیر، RBAC و مرکز دانلود کلاینت‌ها پیاده شد. |" },
    { type: "add", oldLine: null, newLine: 144, text: "+ | **۲. ایجنت ویندوز و کارهای عملیاتی** | ۱۲٪ | **۱۰۰٪** | پنجره شناور، تله‌متری Native با sysinfo، پایش سرویس‌ها و سندباکس PowerShell. |" },
    { type: "add", oldLine: null, newLine: 145, text: "+ | **۳. مدیریت مدل محلی و ابری هیبریدی** | ۱۰٪ | **۱۰۰٪** | کشف خودکار Ollama، دانلود گرافیکی با نوار پیشرفت و پشتیبانی از چند کلید ابری. |" },
    { type: "add", oldLine: null, newLine: 146, text: "+ | **۴. استقرار Master/Worker/Edge** | ۹٪ | **۱۰۰٪** | دستورات تک‌خطی هوشمند با به‌روزرسانی سریع درجا و اتصال امن TLS 1.3. |" },
    { type: "add", oldLine: null, newLine: 147, text: "+ | **۵. گفتگو و صف پیام‌ها (Queue)** | ۱۲٪ | **۱۰۰٪** | پنل صف پیام‌های Antigravity، انتخابگر شناور مدل‌ها و ذخیره تاریخچه. |" },
    { type: "add", oldLine: null, newLine: 148, text: "+ | **۶. موتور وظیفه و خودترمیمی** | ۱۶٪ | **۹۰٪** | موتور خودترمیمی (Self-Healing)، اجرای پلی‌بوک‌ها و سندباکس فرامین. |" },
    { type: "add", oldLine: null, newLine: 149, text: "+ | **۷. ممیزی و وقایع‌نگاری شیفت** | ۹٪ | **۸۵٪** | زنجیره هش غیرقابل تغییر SHA-256 و موتور تولید گزارش تحویل شیفت. |" },
    { type: "add", oldLine: null, newLine: 150, text: "+ | **۸. ارتباطات مش و سیاست‌های امنیتی** | ۱۲٪ | **۸۵٪** | شبکه مش P2P بین‌شعبی (10.42.0.0/16) و ماتریس سیاست‌های دسترسی کلاینت‌ها. |" },
    { type: "add", oldLine: null, newLine: 151, text: "+ | **۹. تاب‌آوری، اعلان‌ها و کلید قطع** | ۵٪ | **۹۵٪** | پشتیبان‌گیری گرم SQLite، هشدارهای چندکاناله و کلید قطع اضطراری (Kill-Switch). |" },
    { type: "add", oldLine: null, newLine: 152, text: "+ | **۱۰. انتشار پایدار و نصب تمیز** | ۳٪ | **۱۰۰٪** | انتشار رسمی نسخه‌های v1.0.0 تا v1.0.3 با آرشیو کامل تغییرات در Changelog. |" },
    { type: "add", oldLine: null, newLine: 153, text: "+ | **مجموع کل پروژه** | **۱۰۰٪** | — | **۹۶.۵٪ (پلتفرم پایدار سازمانی آماده بهره‌برداری)** |" },
    { type: "context", oldLine: 154, newLine: 154, text: "---" },
  ];

  // رندر مارک‌داون تمیز و سفارشی
  function renderMarkdown(content: string) {
    if (!content) return <p className="text-gray-400">محتوایی یافت نشد.</p>;

    const lines = content.split("\n");
    const elements: React.ReactNode[] = [];
    let inTable = false;
    let tableRows: string[][] = [];
    let inCode = false;
    let codeBlockText = "";

    function flushTable() {
      if (tableRows.length === 0) return;
      const headers = tableRows[0];
      const rows = tableRows.slice(2); // row 1 is separator
      elements.push(
        <div key={`table-${elements.length}`} className="antigravity-md-table-wrapper">
          <table className="antigravity-md-table">
            <thead>
              <tr>
                {headers.map((h, i) => (
                  <th key={i}>{h.trim()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {row.map((cell, cIdx) => (
                    <td key={cIdx}>{cell.trim()}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      tableRows = [];
      inTable = false;
    }

    function flushCode() {
      if (!codeBlockText) return;
      elements.push(
        <div key={`code-${elements.length}`} className="antigravity-code-block">
          <pre>{codeBlockText}</pre>
        </div>
      );
      codeBlockText = "";
      inCode = false;
    }

    lines.forEach((line, idx) => {
      // Code block toggle
      if (line.startsWith("```")) {
        if (inCode) {
          flushCode();
        } else {
          if (inTable) flushTable();
          inCode = true;
          codeBlockText = "";
        }
        return;
      }

      if (inCode) {
        codeBlockText += (codeBlockText ? "\n" : "") + line;
        return;
      }

      // Table line
      if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
        inTable = true;
        const cells = line.split("|").slice(1, -1);
        tableRows.push(cells);
        return;
      } else if (inTable) {
        flushTable();
      }

      // Headings
      if (line.startsWith("# ")) {
        elements.push(<h1 key={idx} className="antigravity-md-h1">{line.slice(2)}</h1>);
      } else if (line.startsWith("## ")) {
        elements.push(<h2 key={idx} className="antigravity-md-h2">{line.slice(3)}</h2>);
      } else if (line.startsWith("### ")) {
        elements.push(<h3 key={idx} className="antigravity-md-h3">{line.slice(4)}</h3>);
      } else if (line.startsWith("> [!NOTE]")) {
        elements.push(<div key={idx} className="antigravity-callout note">{line.replace("> [!NOTE]", "📌 نکته:")}</div>);
      } else if (line.startsWith("> [!TIP]")) {
        elements.push(<div key={idx} className="antigravity-callout tip">{line.replace("> [!TIP]", "💡 پیشنهاد:")}</div>);
      } else if (line.startsWith("> [!IMPORTANT]")) {
        elements.push(<div key={idx} className="antigravity-callout important">{line.replace("> [!IMPORTANT]", "⚠️ توجه مهم:")}</div>);
      } else if (line.startsWith("> ")) {
        elements.push(<blockquote key={idx} className="antigravity-blockquote">{line.slice(2)}</blockquote>);
      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        elements.push(<li key={idx} className="antigravity-li">{line.slice(2)}</li>);
      } else if (line.trim() === "---") {
        elements.push(<hr key={idx} className="antigravity-hr" />);
      } else if (line.trim()) {
        elements.push(<p key={idx} className="antigravity-p">{line}</p>);
      }
    });

    if (inTable) flushTable();
    if (inCode) flushCode();

    return <div className="antigravity-markdown-body">{elements}</div>;
  }

  return (
    <aside className="antigravity-preview-drawer" aria-label="پیش‌نمایش فایل">
      {/* هدر بالای پنل پیش‌نمایش (دقیقاً مشابه تصویر ۱ و ۲) */}
      <div className="antigravity-preview-header">
        <div className="antigravity-preview-tabs">
          <button
            type="button"
            className={`antigravity-tab-btn ${tab === "review" ? "active" : ""}`}
            onClick={() => setTab("review")}
            title="مشاهده تغییرات و مقایسه (Review Diff)"
          >
            Review <span className="diff-stat-badge">+15 -15</span>
          </button>
          <button
            type="button"
            className={`antigravity-tab-btn ${tab === "preview" ? "active" : ""}`}
            onClick={() => setTab("preview")}
            title="پیش‌نمایش قالب‌بندی‌شده (Formatted Markdown Preview)"
          >
            Preview
          </button>
          <button
            type="button"
            className={`antigravity-tab-btn ${tab === "raw" ? "active" : ""}`}
            onClick={() => setTab("raw")}
            title="کد خام (Raw File Content)"
          >
            Raw
          </button>
          <button
            type="button"
            className={`antigravity-tab-btn ${tab === "terminal" ? "active" : ""}`}
            onClick={() => setTab("terminal")}
            title="کنسول فرامین و تله‌متری (Terminal)"
          >
            Terminal
          </button>
        </div>

        <div className="antigravity-preview-actions">
          {/* دکمه ضمیمه‌ها و فایل‌ها (مشابه تصویر ۳) */}
          <button
            type="button"
            className={`antigravity-action-icon ${showSidebar ? "active" : ""}`}
            onClick={() => setShowSidebar(!showSidebar)}
            title="فهرست فایل‌های پروژه و اسناد (Files & Artifacts)"
          >
            🗂️
          </button>

          {/* دکمه کپی */}
          <button
            type="button"
            className="antigravity-action-icon"
            onClick={handleCopy}
            title={copied ? "کپی شد!" : "کپی محتوای فایل"}
          >
            {copied ? "✓" : "📋"}
          </button>

          {/* دکمه بستن پنل پیش‌نمایش */}
          <button
            type="button"
            className="antigravity-action-icon close"
            onClick={onClose}
            title="بستن پیش‌نمایش (✕)"
          >
            ✕
          </button>
        </div>
      </div>

      {/* نوار مسیر و وضعیت فایل (Breadcrumb Bar - تصویر ۲) */}
      <div className="antigravity-preview-subbar">
        <div className="antigravity-breadcrumb">
          <span className="crumb-root">OmniOps</span>
          <span className="crumb-sep">&gt;</span>
          <span className="crumb-current">{activeFile}</span>
          {fileDetail?.size && (
            <span className="crumb-size">({(fileDetail.size / 1024).toFixed(1)} KB)</span>
          )}
        </div>

        {/* منوی سریع انتخاب فایل */}
        <div className="antigravity-file-switcher">
          <select
            value={activeFile}
            onChange={(e) => handleFileChange(e.target.value)}
            className="antigravity-select"
            title="تغییر فایل فعال"
          >
            {fileList.map((f) => (
              <option key={f.path} value={f.path}>
                {f.name} {f.changes ? `(${f.changes})` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* بدنه اصلی پنل پیش‌نمایش با قابلیت باز و بسته شدن سایدبار فرعی (تصویر ۳) */}
      <div className="antigravity-preview-body">
        {showSidebar && (
          <div className="antigravity-drawer-sidebar">
            <div className="drawer-sidebar-section">
              <span className="drawer-section-title">Files Changed (1) ▾</span>
              <div
                className={`drawer-file-item ${activeFile === "README.md" ? "active" : ""}`}
                onClick={() => handleFileChange("README.md")}
              >
                <span>README.md</span>
                <span className="diff-pill green">+15 -15</span>
              </div>
            </div>

            <div className="drawer-sidebar-section">
              <span className="drawer-section-title">Project Files ({fileList.length}) ▾</span>
              {fileList.map((f) => (
                <div
                  key={f.path}
                  className={`drawer-file-item ${activeFile === f.path ? "active" : ""}`}
                  onClick={() => handleFileChange(f.path)}
                >
                  <span className="truncate">{f.name}</span>
                  {f.changes && <small className="text-gray-400">{f.changes}</small>}
                </div>
              ))}
            </div>

            <div className="drawer-sidebar-section">
              <span className="drawer-section-title">Artifacts &amp; Uploads ▾</span>
              <div className="drawer-file-item" onClick={() => handleFileChange("CHANGELOG.md")}>
                <span>📝 CHANGELOG.md</span>
                <small>v1.0.3</small>
              </div>
              <div className="drawer-file-item" onClick={() => handleFileChange("docs/PROJECT_RULES.fa.md")}>
                <span>⚖️ PROJECT_RULES.fa.md</span>
              </div>
            </div>
          </div>
        )}

        <div className="antigravity-preview-content">
          {loading && (
            <div className="antigravity-preview-loading">
              <div className="preview-spinner" />
              <span>در حال بارگذاری محتوای فایل…</span>
            </div>
          )}

          {error && (
            <div className="antigravity-preview-error">
              <span>⚠️ {error}</span>
            </div>
          )}

          {/* تب ۱: حالت Review Diff (دقیقاً مشابه تصویر ۱) */}
          {tab === "review" && (
            <div className="antigravity-diff-viewer">
              <div className="antigravity-diff-banner">
                <span className="diff-status-icon">M*</span>
                <span className="diff-filename">{activeFile}</span>
                <span className="diff-stat-badge green">+15</span>
                <span className="diff-stat-badge red">-15</span>
                <span className="diff-tag">Agent Edits &gt; {activeFile}</span>
              </div>

              <div className="antigravity-diff-lines">
                {defaultDiffLines.map((row, idx) => {
                  if (row.type === "header") {
                    return (
                      <div key={idx} className="diff-line hunk-header">
                        <span className="line-num">...</span>
                        <span className="line-content">{row.text}</span>
                      </div>
                    );
                  }
                  if (row.type === "del") {
                    return (
                      <div key={idx} className="diff-line del">
                        <span className="line-num">{row.oldLine}</span>
                        <span className="line-indicator">-</span>
                        <span className="line-content">{row.text.slice(2)}</span>
                      </div>
                    );
                  }
                  if (row.type === "add") {
                    return (
                      <div key={idx} className="diff-line add">
                        <span className="line-num">{row.newLine}</span>
                        <span className="line-indicator">+</span>
                        <span className="line-content">{row.text.slice(2)}</span>
                      </div>
                    );
                  }
                  return (
                    <div key={idx} className="diff-line context">
                      <span className="line-num">{row.oldLine}</span>
                      <span className="line-indicator"> </span>
                      <span className="line-content">{row.text}</span>
                    </div>
                  );
                })}

                {!showFullDiff && (
                  <div className="diff-collapse-banner">
                    <button
                      type="button"
                      className="diff-expand-btn"
                      onClick={() => setShowFullDiff(true)}
                    >
                      +45 more lines (+10 / +10)
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* تب ۲: حالت Preview (رندر مارک‌داون - مشابه تصویر ۲) */}
          {tab === "preview" && (
            <div className="antigravity-rendered-preview">
              {renderMarkdown(fileDetail?.content || "# OmniOps\n\nدر حال دریافت متن کامل...")}
            </div>
          )}

          {/* تب ۳: حالت Raw (متن خام با شماره خطوط) */}
          {tab === "raw" && (
            <div className="antigravity-raw-viewer">
              <pre className="antigravity-raw-pre">
                <code>
                  {(fileDetail?.content || "").split("\n").map((line, idx) => (
                    <div key={idx} className="raw-line">
                      <span className="raw-line-num">{idx + 1}</span>
                      <span className="raw-line-code">{line}</span>
                    </div>
                  ))}
                </code>
              </pre>
            </div>
          )}

          {/* تب ۴: ترمینال عملیاتی (مشابه تصویر ۴) */}
          {tab === "terminal" && (
            <div className="antigravity-terminal-panel">
              <div className="terminal-header-bar">
                <span>Terminals Project ▾</span>
                <span className="terminal-badge">powershell.exe</span>
              </div>
              <div className="terminal-logs">
                {terminalHistory.map((line, idx) => (
                  <div key={idx} className="terminal-line">{line}</div>
                ))}
              </div>
              <form onSubmit={handleTerminalSubmit} className="terminal-input-row">
                <span className="terminal-prompt">&gt;</span>
                <input
                  type="text"
                  value={terminalInput}
                  onChange={(e) => setTerminalInput(e.target.value)}
                  placeholder="Type operational command (e.g. git status, py -3 -m unittest)..."
                  className="terminal-text-input"
                />
              </form>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

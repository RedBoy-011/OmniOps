import { useState, useEffect } from "react";
import { api } from "../api";

export function SystemPersonaCard() {
  const [templateText, setTemplateText] = useState<string>("");
  const [systemName, setSystemName] = useState<string>("OmniOps AI");
  const [normalizePersian, setNormalizePersian] = useState<boolean>(true);
  const [enforceTone, setEnforceTone] = useState<boolean>(true);
  const [diacritics, setDiacritics] = useState<boolean>(true);
  const [isEnabled, setIsEnabled] = useState<boolean>(true);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const [testResponse, setTestResponse] = useState<string | null>(null);

  // Load config on mount
  useEffect(() => {
    loadPersonaConfig();
  }, []);

  const loadPersonaConfig = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await api.getPersonaConfig();
      setTemplateText(data.template || "");
      setSystemName(data.system_name || "OmniOps AI");
      setNormalizePersian(Boolean(data.normalize_persian));
      setEnforceTone(Boolean(data.enforce_tone_rules));
      setDiacritics(Boolean(data.diacritics_assistance));
      setIsEnabled(Boolean(data.enabled));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "خطا در دریافت تنظیمات هویت و لحن سیستم");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);
    setErrorMessage(null);
    try {
      await api.updatePersonaConfig({
        template: templateText,
        system_name: systemName,
        normalize_persian: normalizePersian,
        enforce_tone_rules: enforceTone,
        diacritics_assistance: diacritics,
        enabled: isEnabled,
      });
      setSaveMessage("تنظیمات هویت، لحن کلامی و پایگاه دانش با موفقیت روی هسته ذخیره و اعمال شد.");
      setTimeout(() => setSaveMessage(null), 4000);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "خطا در ذخیره تنظیمات هویت سیستم");
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm("آیا از بازنشانی متن هویت به الگوی پیش‌فرض استاندارد OmniOps اطمینان دارید؟")) {
      return;
    }
    setIsSaving(true);
    setSaveMessage(null);
    setErrorMessage(null);
    try {
      const resetData = await api.resetPersonaConfig();
      setTemplateText(resetData.template || "");
      setSystemName(resetData.system_name || "OmniOps AI");
      setNormalizePersian(Boolean(resetData.normalize_persian));
      setEnforceTone(Boolean(resetData.enforce_tone_rules));
      setDiacritics(Boolean(resetData.diacritics_assistance));
      setIsEnabled(Boolean(resetData.enabled));
      setSaveMessage("الگوی هویت با موفقیت به متن پیش‌فرض استاندارد بازنشانی شد.");
      setTimeout(() => setSaveMessage(null), 4000);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "خطا در بازنشانی الگوی هویت سیستم");
    } finally {
      setIsSaving(false);
    }
  };

  const insertVariable = (varName: string) => {
    setTemplateText(prev => prev + `\n{${varName}}`);
  };

  const runTestSimulation = () => {
    setTestResponse(
      "من OmniOps AI، دستیار هوشمند و ایجنتی بستر عملیاتی و مهندسی OmniOps هستم. برای پایش زیرساخت، اتوماسیون وظایف، برنامه‌نویسی و مدیریت خوشه‌های پردازشی طراحی شده‌ام. کلاستر محلی OmniOps-02 با ۸ مدل فعال و کلاینت ویندوز در دسترس هستند؛ در چه زمینه‌ای می‌توانم کمکتان کنم؟"
    );
  };

  return (
    <section className="glass admin-card" style={{ padding: "24px", borderRadius: "18px" }}>
      {/* Title & Eyebrow Header */}
      <div className="card-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px", marginBottom: "16px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "24px" }}>🎭</span>
            <h2 style={{ margin: 0, fontSize: "18px", fontWeight: "bold" }}>
              هویت، لحن کلامی فارسی و دانش جامع سیستم (System Persona & Persian Tone)
            </h2>
          </div>
          <p style={{ margin: "6px 0 0", color: "#a1a1aa", fontSize: "12.5px", lineHeight: "1.7" }}>
            تثبیت هویت قطعی OmniOps روی تمام مدل‌های محلی و ابری، رد خودکار معرفی به عنوان مدل‌های پایه، اصلاح نیم‌فاصله‌ها و اعراب‌گذاری واژگان فنی.
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 12px",
              borderRadius: "20px",
              fontSize: "11.5px",
              fontWeight: "600",
              background: isEnabled ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
              color: isEnabled ? "#34d399" : "#f87171",
              border: `1px solid ${isEnabled ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)"}`
            }}
          >
            <span>{isEnabled ? "🟢 فعال (تزریق روی همه مدل‌ها)" : "⚪ غیرفعال"}</span>
          </span>

          <button
            type="button"
            onClick={() => setIsEnabled(prev => !prev)}
            style={{
              padding: "5px 12px",
              borderRadius: "8px",
              fontSize: "11.5px",
              background: "rgba(255, 255, 255, 0.08)",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              color: "#e4e4e7",
              cursor: "pointer"
            }}
          >
            {isEnabled ? "غیرفعال‌سازی" : "فعال‌سازی هویت"}
          </button>
        </div>
      </div>

      {/* Notifications */}
      {saveMessage && (
        <div style={{ padding: "10px 14px", borderRadius: "10px", background: "rgba(16, 185, 129, 0.2)", border: "1px solid #10b981", color: "#a7f3d0", fontSize: "12px", marginBottom: "14px" }}>
          ✅ {saveMessage}
        </div>
      )}
      {errorMessage && (
        <div style={{ padding: "10px 14px", borderRadius: "10px", background: "rgba(239, 68, 68, 0.2)", border: "1px solid #ef4444", color: "#fca5a5", fontSize: "12px", marginBottom: "14px" }}>
          ⚠️ {errorMessage}
        </div>
      )}

      {/* Orthography & Normalization Toggles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px", marginBottom: "18px" }}>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "10px 14px",
            borderRadius: "12px",
            background: "rgba(0, 0, 0, 0.25)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            cursor: "pointer",
            fontSize: "12px"
          }}
        >
          <input
            type="checkbox"
            checked={normalizePersian}
            onChange={e => setNormalizePersian(e.target.checked)}
            style={{ accentColor: "var(--omni-brand-primary, #f43f5e)", cursor: "pointer" }}
          />
          <div>
            <strong style={{ display: "block", color: "#fff" }}>اصلاح نویسه و نیم‌فاصله</strong>
            <span style={{ fontSize: "11px", color: "#a1a1aa" }}>استاندارد هضم و ویراستیار (تبدیل «می شود» به «می‌شود»)</span>
          </div>
        </label>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "10px 14px",
            borderRadius: "12px",
            background: "rgba(0, 0, 0, 0.25)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            cursor: "pointer",
            fontSize: "12px"
          }}
        >
          <input
            type="checkbox"
            checked={diacritics}
            onChange={e => setDiacritics(e.target.checked)}
            style={{ accentColor: "var(--omni-brand-primary, #f43f5e)", cursor: "pointer" }}
          />
          <div>
            <strong style={{ display: "block", color: "#fff" }}>اعراب‌گذاری واژگان دوپهلو</strong>
            <span style={{ fontSize: "11px", color: "#a1a1aa" }}>حرکت‌گذاری کلمات هم‌نگاشت جهت خوانش بدون ابهام</span>
          </div>
        </label>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "10px 14px",
            borderRadius: "12px",
            background: "rgba(0, 0, 0, 0.25)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            cursor: "pointer",
            fontSize: "12px"
          }}
        >
          <input
            type="checkbox"
            checked={enforceTone}
            onChange={e => setEnforceTone(e.target.checked)}
            style={{ accentColor: "var(--omni-brand-primary, #f43f5e)", cursor: "pointer" }}
          />
          <div>
            <strong style={{ display: "block", color: "#fff" }}>لحن مهندسی بدون تعارف</strong>
            <span style={{ fontSize: "11px", color: "#a1a1aa" }}>حذف مقدمه‌چینی‌های تکراری و ورود مستقیم به اصل پاسخ</span>
          </div>
        </label>
      </div>

      {/* System Name Input */}
      <div style={{ marginBottom: "16px" }}>
        <label style={{ display: "block", fontSize: "12px", color: "#e4e4e7", marginBottom: "6px" }}>
          نام رسمی سامانه در پاسخ‌ها (System Identity Label):
        </label>
        <input
          type="text"
          value={systemName}
          onChange={e => setSystemName(e.target.value)}
          placeholder="مثال: OmniOps AI"
          style={{
            width: "100%",
            maxWidth: "360px",
            height: "38px",
            padding: "0 12px",
            borderRadius: "10px",
            background: "rgba(0,0,0,0.35)",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "#fff",
            fontSize: "13px",
            outline: "none"
          }}
        />
      </div>

      {/* Variable Insertion Pills */}
      <div style={{ marginBottom: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px", marginBottom: "8px" }}>
          <span style={{ fontSize: "12px", color: "#a1a1aa" }}>درج متغیرهای خودکار در متن الگو:</span>
          <span style={{ fontSize: "11px", color: "#71717a", fontFamily: "monospace" }}>
            طول الگو: {templateText.length.toLocaleString("fa-IR")} کاراکتر
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {[
            { label: "نام سیستم", val: "system_name" },
            { label: "تله‌متری زنده", val: "live_system_context" },
            { label: "وضعیت سرورها", val: "server_status" },
            { label: "مدل‌های فعال", val: "available_models" },
            { label: "تاریخ هجری شمسی", val: "jalali_date" }
          ].map(pill => (
            <button
              key={pill.val}
              type="button"
              onClick={() => insertVariable(pill.val)}
              style={{
                background: "rgba(244, 63, 94, 0.12)",
                border: "1px solid rgba(244, 63, 94, 0.25)",
                borderRadius: "8px",
                padding: "3px 9px",
                color: "#fda4af",
                fontSize: "11px",
                fontFamily: "monospace",
                cursor: "pointer"
              }}
              title={`افزودن {${pill.val}} به الگو`}
            >
              + {pill.label} ({`{${pill.val}}`})
            </button>
          ))}
        </div>
      </div>

      {/* Main Persona Template Textarea */}
      <div style={{ position: "relative", marginBottom: "16px" }}>
        <textarea
          value={templateText}
          onChange={e => setTemplateText(e.target.value)}
          rows={14}
          disabled={isLoading || isSaving}
          placeholder="دستورالعمل هویت و الگو را اینجا وارد کنید..."
          style={{
            width: "100%",
            borderRadius: "14px",
            background: "rgba(10, 10, 15, 0.7)",
            border: "1px solid rgba(255, 255, 255, 0.14)",
            color: "#f4f4f5",
            padding: "14px",
            fontSize: "12.5px",
            lineHeight: "1.9",
            fontFamily: "Vazirmatn, monospace",
            resize: "vertical",
            outline: "none",
            boxShadow: "inset 0 2px 6px rgba(0,0,0,0.4)"
          }}
        />
      </div>

      {/* Action Buttons */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || isLoading}
            style={{
              padding: "8px 20px",
              borderRadius: "10px",
              background: "linear-gradient(135deg, #f43f5e, #be123c)",
              border: "none",
              color: "#fff",
              fontSize: "12.5px",
              fontWeight: "bold",
              cursor: isSaving ? "not-allowed" : "pointer",
              boxShadow: "0 4px 14px rgba(244, 63, 94, 0.35)",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px"
            }}
          >
            <span>{isSaving ? "⏳ در حال ذخیره..." : "💾 ذخیره و تثبیت هویت"}</span>
          </button>

          <button
            type="button"
            onClick={handleReset}
            disabled={isSaving || isLoading}
            style={{
              padding: "8px 16px",
              borderRadius: "10px",
              background: "rgba(255, 255, 255, 0.08)",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              color: "#e4e4e7",
              fontSize: "12px",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px"
            }}
            title="بازنشانی هویت به الگوی رسمی مهندسی OmniOps"
          >
            <span>🔄</span>
            <span>بازنشانی به الگوی پیش‌فرض</span>
          </button>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            onClick={() => setShowPreview(prev => !prev)}
            style={{
              padding: "8px 14px",
              borderRadius: "10px",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              color: "#a1a1aa",
              fontSize: "12px",
              cursor: "pointer"
            }}
          >
            <span>{showPreview ? "بستن پیش‌نمایش" : "👁️ پیش‌نمایش رندرشده"}</span>
          </button>

          <button
            type="button"
            onClick={runTestSimulation}
            style={{
              padding: "8px 14px",
              borderRadius: "10px",
              background: "rgba(59, 130, 246, 0.15)",
              border: "1px solid rgba(59, 130, 246, 0.3)",
              color: "#93c5fd",
              fontSize: "12px",
              cursor: "pointer"
            }}
          >
            <span>🧪 شبیه‌سازی پاسخ هویت</span>
          </button>
        </div>
      </div>

      {/* Rendered Preview Panel */}
      {showPreview && (
        <div style={{ marginTop: "16px", padding: "14px", borderRadius: "12px", background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.1)" }}>
          <h4 style={{ margin: "0 0 8px", fontSize: "12px", color: "#fda4af" }}>
            پیش‌نمایش سیستم پرامپت تزریق‌شده (System Message Preview):
          </h4>
          <pre style={{ margin: 0, fontSize: "11.5px", color: "#d4d4d8", lineHeight: "1.8", whiteSpace: "pre-wrap", fontFamily: "Vazirmatn, monospace" }}>
            {templateText
              .replace(/{live_system_context}/g, "🟢 سرور مرکزی آنلاین | Ollama Worker OmniOps-02 (172.19.30.99) با ۸ مدل فعال | ویندوز اج آنلاین | پروکسی SOCKS5 فعال")
              .replace(/{system_name}/g, systemName)}
          </pre>
        </div>
      )}

      {/* Test Simulation Output */}
      {testResponse && (
        <div style={{ marginTop: "16px", padding: "14px", borderRadius: "12px", background: "rgba(16, 185, 129, 0.1)", border: "1px solid rgba(16, 185, 129, 0.25)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
            <strong style={{ fontSize: "12px", color: "#6ee7b7" }}>
              نتیجه شبیه‌سازی پاسخ مدل به پرسش «تو کی هستی؟»:
            </strong>
            <button
              type="button"
              onClick={() => setTestResponse(null)}
              style={{ background: "transparent", border: "none", color: "#a1a1aa", cursor: "pointer", fontSize: "11px" }}
            >
              بستن ✕
            </button>
          </div>
          <p style={{ margin: 0, fontSize: "12.5px", color: "#ecfdf5", lineHeight: "1.8" }}>
            {testResponse}
          </p>
        </div>
      )}
    </section>
  );
}

export default SystemPersonaCard;

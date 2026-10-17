import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, type ApiProvider, type SocksHealthResult, type SocksHealthStatus, type ModelMeta } from "./api";

const labels = { openai: "OpenAI", gemini: "Gemini", anthropic: "Claude / Anthropic", openrouter: "OpenRouter" };

type CardProps = {
  provider: ApiProvider;
  defaultProxy: string;
  refresh: () => Promise<void>;
  catalog?: Record<string, ModelMeta>;
};

function ProviderCard({ provider, defaultProxy, refresh, catalog }: CardProps) {
  const [key, setKey] = useState("");
  const [useProxy, setUseProxy] = useState(provider.network_mode === "socks");
  const [proxy, setProxy] = useState(provider.proxy_url);
  const [selected, setSelected] = useState(provider.models[0] || "");
  const [query, setQuery] = useState("");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [socksStatus, setSocksStatus] = useState<{ ok: boolean; health: SocksHealthStatus; message: string; latency_ms?: number } | null>(null);
  const [autoTestSocks, setAutoTestSocks] = useState(true);

  const models = useMemo(() => {
    const filtered = provider.models.filter(model => model.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 80);
    return selected && !filtered.includes(selected) ? [selected, ...filtered] : filtered;
  }, [provider.models, query, selected]);
  const route = useProxy ? "socks" : "direct";
  const proxyValue = useProxy ? proxy.trim() : "";
  const changed = route !== provider.network_mode || proxyValue !== provider.proxy_url;
  const canTest = Boolean(key.trim() || provider.configured);
  const catalogPrice = provider.catalog_prices[selected];

  useEffect(() => { setUseProxy(provider.network_mode === "socks"); setProxy(provider.proxy_url); setSocksStatus(null); }, [provider.network_mode, provider.proxy_url]);
  useEffect(() => { if (!provider.models.includes(selected)) setSelected(provider.models[0] || ""); }, [provider.models, selected]);
  useEffect(() => { const price = provider.prices[selected]; setInput(price?.input || ""); setOutput(price?.output || ""); }, [provider.prices, selected]);

  async function perform(label: string, work: () => Promise<unknown>, success: string) {
    setBusy(label); setMessage("");
    try { await work(); await refresh(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : "درخواست انجام نشد."); }
    finally { setBusy(""); }
  }

  async function saveSettings() {
    await api.saveProvider(provider.kind, key.trim() || null, route, proxyValue);
    setKey("");
  }

  async function testSocksConnection(isAfterSave = false) {
    if (!proxyValue) return;
    setBusy("socks");
    setSocksStatus(null);
    try {
      if (!isAfterSave && changed) {
        await saveSettings();
      }
      const res = await api.testSocks(proxyValue, provider.kind);
      const health: SocksHealthStatus = res.health || (res.latency_ms <= 400 ? "healthy" : "degraded");
      setSocksStatus({ ok: true, health, message: res.message, latency_ms: res.latency_ms });
      setMessage(res.message);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "خطا در تست ارتباط با پراکسی SOCKS";
      setSocksStatus({ ok: false, health: "down", message: errMsg });
      setMessage(errMsg);
    } finally {
      setBusy("");
    }
  }

  async function testConnection() {
    await perform("test", async () => {
      if (key.trim() || !provider.configured || changed) await saveSettings();
      await api.testProvider(provider.kind);
      // Auto-enable provider in core upon successful test so models are immediately available!
      await api.enableProvider(provider.kind, true);
    }, "اتصال با موفقیت آزموده شد، مدل‌ها به هسته اضافه و بلافاصله فعال شدند.");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void perform("save", async () => {
      await saveSettings();
      if (useProxy && autoTestSocks && proxyValue) {
        await testSocksConnection(true);
      }
    }, useProxy && autoTestSocks
      ? "تنظیمات ذخیره شد و پراکسی ساکس بررسی شد."
      : "تنظیمات ذخیره شدند. می‌توانید اتصال ساکس یا دریافت مدل‌ها را آزمایش کنید.");
  }

  return <motion.article className="provider-card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .25 }}>
    <div className="provider-card-heading"><div className="provider-icon" aria-hidden="true">{provider.kind === "openrouter" ? "OR" : labels[provider.kind].slice(0, 1)}</div>
      <div><h3>{labels[provider.kind]}</h3><span>{provider.configured ? "کلید رمزگذاری‌شده ثبت شده" : "نیازمند کلید API"}</span></div>
      <span className={`provider-state ${provider.enabled ? "on" : ""}`}><i aria-hidden="true" />{provider.enabled ? "فعال" : "غیرفعال"}</span>
    </div>
    <form className="provider-form" onSubmit={submit}>
      <label htmlFor={`key-${provider.kind}`}>کلید API {provider.configured && <small>· خالی بماند، کلید قبلی حفظ می‌شود</small>}</label>
      <input id={`key-${provider.kind}`} type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" placeholder={provider.configured ? "••••••••••••" : "کلید را وارد کنید"} required={!provider.configured} />
      <label className="provider-proxy-toggle"><input type="checkbox" checked={useProxy} onChange={e => { setUseProxy(e.target.checked); if (e.target.checked && !proxy) setProxy(defaultProxy); }} />
        <span><strong>عبور از پراکسی SOCKS5 / SOCKS5h</strong><small>پشتیبانی از دامنه و احراز هویت کاربری (User/Pass)</small></span></label>
      <AnimatePresence initial={false}>{useProxy && <motion.div className="provider-proxy-field" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
        <label htmlFor={`proxy-${provider.kind}`}>نشانی پراکسی خروجی</label>
        <div className="provider-proxy-input">
          <input id={`proxy-${provider.kind}`} dir="ltr" value={proxy} onChange={e => { setProxy(e.target.value); setSocksStatus(null); }} placeholder="socks5://user:pass@host:port یا socks5h://..." required />
          <button type="button" className="quiet-button" onClick={() => { setProxy(defaultProxy); setSocksStatus(null); }} disabled={!defaultProxy}>نشانی مشترک</button>
          <button type="button" className="quiet-button" style={{ borderColor: "#10b981", color: "#34d399", minWidth: "90px" }} disabled={!proxy.trim() || !!busy} onClick={() => void testSocksConnection()}>{busy === "socks" ? "در حال تست…" : "⚡ تست ساکس"}</button>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginTop: "4px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#baa7b3", cursor: "pointer", userSelect: "none" }}>
            <input type="checkbox" checked={autoTestSocks} onChange={e => setAutoTestSocks(e.target.checked)} style={{ width: "14px", height: "14px", accentColor: "#10b981" }} />
            <span>آزمون خودکار ساکس بلافاصله پس از ذخیره</span>
          </label>
        </div>
        {socksStatus && (
          <div style={{ marginTop: "6px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{
              padding: "8px 12px",
              borderRadius: "10px",
              fontSize: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "8px",
              background: socksStatus.health === "healthy"
                ? "rgba(16, 185, 129, 0.12)"
                : socksStatus.health === "degraded"
                ? "rgba(245, 158, 11, 0.12)"
                : "rgba(239, 68, 68, 0.12)",
              border: `1px solid ${
                socksStatus.health === "healthy"
                  ? "rgba(16, 185, 129, 0.35)"
                  : socksStatus.health === "degraded"
                  ? "rgba(245, 158, 11, 0.35)"
                  : "rgba(239, 68, 68, 0.35)"
              }`,
              color: socksStatus.health === "healthy"
                ? "#34d399"
                : socksStatus.health === "degraded"
                ? "#fbbf24"
                : "#fca5a5",
            }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <span>{socksStatus.health === "healthy" ? "🟢" : socksStatus.health === "degraded" ? "🟡" : "🔴"}</span>
                <span className={`socks-badge ${socksStatus.health}`} style={{ padding: "2px 8px", fontSize: "11px" }}>
                  <span className="socks-badge-dot" aria-hidden="true" />
                  {socksStatus.health === "healthy" ? "Healthy" : socksStatus.health === "degraded" ? "Degraded" : "Down"}
                </span>
                <span>{socksStatus.message}</span>
              </span>
              {socksStatus.latency_ms !== undefined && (
                <span className="socks-latency-chip" style={{ fontSize: "11px", padding: "2px 8px" }}>
                  ⚡ {socksStatus.latency_ms.toLocaleString("fa-IR")} ms
                </span>
              )}
            </div>
            {socksStatus.health === "down" && (
              <div className="socks-warning-banner" style={{ padding: "10px 12px", fontSize: "11px" }}>
                <span className="socks-warning-icon" style={{ fontSize: "16px" }}>⚠️</span>
                <div className="socks-warning-content">
                  <strong>خطای دسترسی به پراکسی SOCKS5h برای {labels[provider.kind]}</strong>
                  <span>پراکسی پاسخ نمی‌دهد. مدل‌های این ارائه‌دهنده در حالت ساکس غیرقابل استفاده خواهند بود.</span>
                </div>
              </div>
            )}
          </div>
        )}
      </motion.div>}</AnimatePresence>
      <div className="provider-actions">
        <button className="quiet-button" type="submit" disabled={!!busy}>{busy === "save" ? "در حال ذخیره…" : "ذخیرهٔ تنظیمات"}</button>
        {useProxy && (
          <button type="button" className="quiet-button" style={{ borderColor: "#10b981", color: "#34d399" }} disabled={!proxy.trim() || !!busy} onClick={() => void testSocksConnection()}>{busy === "socks" ? "در حال تست ساکس…" : "⚡ تست ساکس"}</button>
        )}
        <button type="button" className="submit-button" disabled={!!busy || !canTest || (useProxy && !proxy.trim())} onClick={() => void testConnection()}>{busy === "test" ? "در حال آزمون…" : "تست و دریافت مدل‌ها"}</button>
      </div>
    </form>
    <div className="provider-result"><span className="provider-route">{provider.network_mode === "socks" ? "مسیر ذخیره‌شده: SOCKS" : "مسیر ذخیره‌شده: مستقیم"}</span>
      <span>{provider.models.length.toLocaleString("fa-IR")} مدل</span>
      {provider.tested_at && <small>تست موفق: {new Date(provider.tested_at * 1000).toLocaleString("fa-IR")}</small>}</div>
    <button type="button" className="quiet-button provider-enable" disabled={!provider.configured || !!busy || (!provider.tested_at && !provider.enabled)} onClick={() => void perform("toggle", () => api.enableProvider(provider.kind, !provider.enabled), provider.enabled ? "Provider غیرفعال شد." : "Provider فعال شد.")}>{provider.enabled ? "غیرفعال‌کردن" : "فعال‌کردن پس از تست"}</button>
    {provider.models.length > 0 && <form className="provider-pricing" onSubmit={event => { event.preventDefault(); void perform("price", () => api.priceProvider(provider.kind, selected, input, output), "قیمت دستی مدل ثبت شد."); }}>
      <div className="provider-pricing-title"><strong>مدل‌ها و قیمت‌گذاری</strong><small>دلار / یک میلیون توکن</small></div>
      <label htmlFor={`filter-${provider.kind}`}>جست‌وجوی مدل</label><input id={`filter-${provider.kind}`} value={query} onChange={e => setQuery(e.target.value)} placeholder="نام یا شناسهٔ مدل…" />
      <label htmlFor={`model-${provider.kind}`}>انتخاب مدل · نمایش حداکثر ۸۰ مورد</label>
      <select id={`model-${provider.kind}`} value={selected} onChange={e => setSelected(e.target.value)} dir="ltr">{models.map(model => <option key={model} value={model}>{model}</option>)}</select>
      {(() => {
        const meta = catalog?.[selected] || catalog?.[`${provider.kind}/${selected}`];
        if (!meta) return null;
        return (
          <div style={{
            marginTop: "10px",
            marginBottom: "10px",
            padding: "10px 14px",
            borderRadius: "10px",
            background: "rgba(255, 255, 255, 0.04)",
            border: `1px solid ${meta.badge_color || "#3b82f6"}35`,
            fontSize: "12px",
            lineHeight: "1.7"
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "6px", marginBottom: "4px" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: meta.badge_color || "#60a5fa", fontWeight: "bold" }}>
                <span>{meta.category_icon}</span>
                <span>{meta.category_label}</span>
                <span style={{ fontSize: "11px", color: "#d1d5db" }}>· {meta.name}</span>
              </span>
              <span style={{ fontSize: "11px", color: "#a1a1aa", background: "rgba(0,0,0,0.35)", padding: "2px 8px", borderRadius: "6px" }}>
                ⚡ {meta.speed} · بافت: {meta.context_window}
              </span>
            </div>
            <div style={{ color: "#e4e4e7", fontSize: "11.5px" }}>
              {meta.comment}
            </div>
          </div>
        );
      })()}
      {catalogPrice && <div className="provider-catalog-price"><span>نرخ اعلامی کاتالوگ: ورودی {catalogPrice.input} · خروجی {catalogPrice.output}</span>
        <button type="button" className="quiet-button" onClick={() => { setInput(catalogPrice.input); setOutput(catalogPrice.output); }}>درج در فرم</button></div>}
      <div className="provider-price-fields"><label htmlFor={`input-${provider.kind}`}>ورودی <input id={`input-${provider.kind}`} dir="ltr" type="number" min="0" max="1000000" step="0.000001" required value={input} onChange={e => setInput(e.target.value)} /></label>
        <label htmlFor={`output-${provider.kind}`}>خروجی <input id={`output-${provider.kind}`} dir="ltr" type="number" min="0" max="1000000" step="0.000001" required value={output} onChange={e => setOutput(e.target.value)} /></label></div>
      <button type="submit" className="quiet-button" disabled={!!busy || !selected}>ثبت قیمت دستی</button><small>نرخ اعلامی ممکن است تغییر کند؛ قیمت فقط پس از ثبت شما ذخیره می‌شود.</small>
    </form>}
    {message && <p className="admin-message" role="status" aria-live="polite">{message}</p>}
  </motion.article>;
}

export function ProviderManager() {
  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [catalog, setCatalog] = useState<Record<string, ModelMeta>>({});
  const [defaultProxy, setDefaultProxy] = useState(() => localStorage.getItem("omniops_shared_proxy") || "");
  const [socksHealth, setSocksHealth] = useState<SocksHealthResult | null>(null);
  const [socksHealthLoading, setSocksHealthLoading] = useState(false);
  const [error, setError] = useState("");
  const secure = window.location.protocol === "https:";

  async function refresh() {
    try {
      const data = await api.providers();
      setProviders(data.providers);
      setError("");
      try {
        const m = await api.webModels();
        if (m.catalog) setCatalog(m.catalog);
      } catch {}
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "فهرست Provider دریافت نشد.";
      setError(message);
      throw reason;
    }
  }

  async function checkSocksHealth(proxyUrl?: string) {
    setSocksHealthLoading(true);
    try {
      const target = proxyUrl !== undefined ? proxyUrl : defaultProxy.trim();
      const res = await api.getSocksHealth(target || undefined);
      setSocksHealth(res);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "خطا در سنجش سلامت پراکسی SOCKS5h";
      setSocksHealth({
        status: "error",
        health: "down",
        proxy_url: defaultProxy.trim(),
        latency_ms: null,
        tested_at: Math.floor(Date.now() / 1000),
        target_host: "api.openai.com",
        error: errMsg,
        message: errMsg,
      });
    } finally {
      setSocksHealthLoading(false);
    }
  }

  async function testManualSocksHealth() {
    setSocksHealthLoading(true);
    try {
      const target = defaultProxy.trim() || undefined;
      const res = await api.socksHealth(target);
      setSocksHealth(res);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "خطا در تست اتصال با پراکسی SOCKS5h";
      setSocksHealth({
        status: "error",
        health: "down",
        proxy_url: defaultProxy.trim(),
        latency_ms: null,
        tested_at: Math.floor(Date.now() / 1000),
        target_host: "api.openai.com",
        error: errMsg,
        message: errMsg,
      });
    } finally {
      setSocksHealthLoading(false);
    }
  }

  useEffect(() => {
    if (secure) {
      void refresh().catch(() => {});
      void checkSocksHealth().catch(() => {});
    }
  }, [secure]);

  return <section className="glass admin-card operations-card provider-manager" aria-label="مدیریت Providerهای API">
    {!secure ? (
      <div style={{ padding: "18px", borderRadius: "14px", background: "rgba(124, 58, 237, 0.08)", border: "1px solid rgba(124, 58, 237, 0.3)", margin: "10px 0" }}>
        <p style={{ margin: "0 0 10px", fontSize: "13px", color: "#e9d5ff", lineHeight: "1.8" }}>
          🔒 <strong>ثبت کلیدهای API و پراکسی نیازمند درگاه امن HTTPS است:</strong>
          <br />
          جهت محافظت از لو رفتن کلیدها در شبکه محلی، این بخش از طریق درگاه امن پورت <strong>9443</strong> در دسترس است:
        </p>
        <a
          href={`https://${window.location.hostname}:9443/`}
          style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "9px 18px", borderRadius: "10px", background: "#7c3aed", color: "#fff", textDecoration: "none", fontSize: "12px", fontWeight: "bold" }}
        >
          🚀 ورود به پنل امن: https://{window.location.hostname}:9443/
        </a>
      </div>
    ) : (
      <>
        {/* داشبورد وضعیت سلامت و پایش تأخیر SOCKS5h */}
        <div className="socks-health-card">
          <div className="socks-health-header">
            <div className="socks-health-title-group">
              <div className="socks-health-icon" aria-hidden="true">🛡️</div>
              <div>
                <h3>وضعیت سلامت و پایش تأخیر SOCKS5h</h3>
                <small>پایش برخط تونل خروجی SOCKS5 / SOCKS5h به مقصد سرورهای هوش مصنوعی</small>
              </div>
            </div>
            <div className="socks-health-badges-group">
              {socksHealth ? (
                <span className={`socks-badge ${socksHealth.health}`}>
                  <span className="socks-badge-dot" aria-hidden="true" />
                  {socksHealth.health === "healthy" && "🟢 سالم (Healthy)"}
                  {socksHealth.health === "degraded" && "🟡 کند یا ناپایدار (Degraded)"}
                  {socksHealth.health === "down" && "🔴 قطع یا خرابی (Down)"}
                </span>
              ) : (
                <span className="socks-badge down">
                  <span className="socks-badge-dot" style={{ background: "#94a3b8" }} aria-hidden="true" />
                  نامشخص (در انتظار سنجش)
                </span>
              )}

              {socksHealth?.latency_ms != null && (
                <span className="socks-latency-chip" title="تأخیر برقراری ارتباط با هاست مقصد">
                  ⚡ تأخیر: <b>{socksHealth.latency_ms.toLocaleString("fa-IR")}</b> میلی‌ثانیه
                  <small style={{ opacity: 0.85, fontSize: "10px" }}>
                    ({socksHealth.latency_ms <= 200 ? "عالی" : socksHealth.latency_ms <= 400 ? "مطلوب" : "کند"})
                  </small>
                </span>
              )}
            </div>
          </div>

          {/* هشدار خرابی در صورت Down بودن سلامت پراکسی */}
          <AnimatePresence>
            {socksHealth?.health === "down" && (
              <motion.div
                className="socks-warning-banner"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                role="alert"
              >
                <div className="socks-warning-icon">⚠️</div>
                <div className="socks-warning-content">
                  <strong>هشدار خرابی پراکسی SOCKS5h (وضعیت Down)</strong>
                  <span>
                    ارتباط با پراکسی خروجی برقرار نیست. در صورت فعال بودن حالت SOCKS برای هر یک از ارائه‌دهندگان (OpenAI / Gemini / Anthropic)، تماس‌های API ناموفق خواهند بود.
                  </span>
                  <ul className="socks-warning-tips">
                    <li>بررسی کنید سرویس‌دهنده پروکسی (مانند V2Ray, Clash, Shadowsocks یا SSH Tunnel) روشن و در حال اجرا باشد.</li>
                    <li>آدرس IP و پورت (مثلاً <code>127.0.0.1:10808</code> یا <code>127.0.0.1:7890</code>) را بازبینی فرمایید.</li>
                    <li>در صورت استفاده از نام کاربری و رمزعبور، ساختار <code>socks5h://user:pass@host:port</code> را بررسی کنید.</li>
                    <li>پروتکل <b>SOCKS5h</b> جهت جلوگیری از نشت و تحریم DNS، نام دامنه را مستقیماً روی سرور مقصد پروکسی ترجمه می‌کند.</li>
                  </ul>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* جزییات فنی و آخرین سنجش */}
          <div className="socks-health-details-grid">
            <div className="socks-detail-item">
              <span>نشانی پراکسی هدف:</span>
              <strong dir="ltr">{socksHealth?.proxy_url || defaultProxy || "تنظیم نشده"}</strong>
            </div>
            <div className="socks-detail-item">
              <span>سرور مقصد آزمایش:</span>
              <strong dir="ltr">{socksHealth?.target_host || "api.openai.com"}</strong>
            </div>
            <div className="socks-detail-item">
              <span>آخرین زمان سنجش:</span>
              <strong>
                {socksHealth?.tested_at
                  ? new Date(socksHealth.tested_at * 1000).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                  : "هنوز سنجیده نشده"}
              </strong>
            </div>
            <div className="socks-detail-item">
              <span>پیام وضعیت شبکه:</span>
              <strong style={{ color: socksHealth?.health === "healthy" ? "#34d399" : socksHealth?.health === "degraded" ? "#fbbf24" : "#f87171" }}>
                {socksHealth?.message || "در انتظار نخستین آزمون"}
              </strong>
            </div>
          </div>

          {/* فیلد ورودی پراکسی مشترک و دکمه تست دستی */}
          <div className="socks-health-actions-row">
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flex: "1 1 320px", flexWrap: "wrap" }}>
              <input
                dir="ltr"
                aria-label="نشانی پراکسی مشترک"
                style={{
                  flex: "1 1 240px",
                  padding: "9px 13px",
                  border: "1px solid rgba(94, 234, 212, 0.3)",
                  borderRadius: "10px",
                  background: "rgba(15, 23, 42, 0.6)",
                  color: "#f1f5f9",
                  fontSize: "12px",
                  fontFamily: "monospace"
                }}
                value={defaultProxy}
                onChange={e => {
                  setDefaultProxy(e.target.value);
                  localStorage.setItem("omniops_shared_proxy", e.target.value);
                }}
                placeholder="socks5://user:pass@host:port یا socks5h://..."
              />
            </div>

            <button
              type="button"
              className="socks-manual-test-btn"
              disabled={socksHealthLoading || (!defaultProxy.trim() && !socksHealth?.proxy_url)}
              onClick={() => void testManualSocksHealth()}
            >
              {socksHealthLoading ? "⏳ در حال سنجش سلامت و تأخیر…" : "⚡ تست دستی سلامت اتصال SOCKS5h"}
            </button>
          </div>
        </div>

        {error && <p className="admin-message" role="alert">{error}</p>}
        <div className="provider-grid">
          {providers.map(provider => (
            <ProviderCard key={provider.kind} provider={provider} defaultProxy={defaultProxy} refresh={refresh} catalog={catalog} />
          ))}
        </div>
      </>
    )}
  </section>;
}

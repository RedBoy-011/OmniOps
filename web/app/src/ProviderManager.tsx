import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, type ApiProvider } from "./api";

const labels = { openai: "OpenAI", gemini: "Gemini", anthropic: "Claude / Anthropic", openrouter: "OpenRouter" };

type CardProps = { provider: ApiProvider; defaultProxy: string; refresh: () => Promise<void> };

function ProviderCard({ provider, defaultProxy, refresh }: CardProps) {
  const [key, setKey] = useState("");
  const [useProxy, setUseProxy] = useState(provider.network_mode === "socks");
  const [proxy, setProxy] = useState(provider.proxy_url);
  const [selected, setSelected] = useState(provider.models[0] || "");
  const [query, setQuery] = useState("");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [socksStatus, setSocksStatus] = useState<{ ok: boolean; message: string; latency_ms?: number } | null>(null);
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
      setSocksStatus({ ok: true, message: res.message, latency_ms: res.latency_ms });
      setMessage(res.message);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "خطا در تست ارتباط با پراکسی SOCKS";
      setSocksStatus({ ok: false, message: errMsg });
      setMessage(errMsg);
    } finally {
      setBusy("");
    }
  }

  async function testConnection() {
    await perform("test", async () => {
      if (key.trim() || !provider.configured || changed) await saveSettings();
      await api.testProvider(provider.kind);
    }, "اتصال آزموده شد و فهرست مدل‌ها به‌روز شد.");
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
        <span><strong>عبور از پراکسی SOCKS5h</strong><small>نام دامنه در سمت پراکسی حل می‌شود</small></span></label>
      <AnimatePresence initial={false}>{useProxy && <motion.div className="provider-proxy-field" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
        <label htmlFor={`proxy-${provider.kind}`}>نشانی پراکسی خروجی</label>
        <div className="provider-proxy-input">
          <input id={`proxy-${provider.kind}`} dir="ltr" value={proxy} onChange={e => { setProxy(e.target.value); setSocksStatus(null); }} placeholder="socks5h://private-ip:port" required />
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
          <div style={{
            marginTop: "6px",
            padding: "8px 12px",
            borderRadius: "10px",
            fontSize: "12px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: socksStatus.ok ? "rgba(16, 185, 129, 0.12)" : "rgba(239, 68, 68, 0.12)",
            border: `1px solid ${socksStatus.ok ? "rgba(16, 185, 129, 0.35)" : "rgba(239, 68, 68, 0.35)"}`,
            color: socksStatus.ok ? "#34d399" : "#fca5a5",
          }}>
            <span>{socksStatus.ok ? "✅" : "❌"}</span>
            <span>{socksStatus.message}</span>
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
    <div className="provider-result"><span className="provider-route">{provider.network_mode === "socks" ? "مسیر ذخیره‌شده: SOCKS5h" : "مسیر ذخیره‌شده: مستقیم"}</span>
      <span>{provider.models.length.toLocaleString("fa-IR")} مدل</span>
      {provider.tested_at && <small>تست موفق: {new Date(provider.tested_at * 1000).toLocaleString("fa-IR")}</small>}</div>
    <button type="button" className="quiet-button provider-enable" disabled={!provider.configured || !!busy || (!provider.tested_at && !provider.enabled)} onClick={() => void perform("toggle", () => api.enableProvider(provider.kind, !provider.enabled), provider.enabled ? "Provider غیرفعال شد." : "Provider فعال شد.")}>{provider.enabled ? "غیرفعال‌کردن" : "فعال‌کردن پس از تست"}</button>
    {provider.models.length > 0 && <form className="provider-pricing" onSubmit={event => { event.preventDefault(); void perform("price", () => api.priceProvider(provider.kind, selected, input, output), "قیمت دستی مدل ثبت شد."); }}>
      <div className="provider-pricing-title"><strong>مدل‌ها و قیمت‌گذاری</strong><small>دلار / یک میلیون توکن</small></div>
      <label htmlFor={`filter-${provider.kind}`}>جست‌وجوی مدل</label><input id={`filter-${provider.kind}`} value={query} onChange={e => setQuery(e.target.value)} placeholder="نام یا شناسهٔ مدل…" />
      <label htmlFor={`model-${provider.kind}`}>انتخاب مدل · نمایش حداکثر ۸۰ مورد</label>
      <select id={`model-${provider.kind}`} value={selected} onChange={e => setSelected(e.target.value)} dir="ltr">{models.map(model => <option key={model} value={model}>{model}</option>)}</select>
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
  const [defaultProxy, setDefaultProxy] = useState(() => localStorage.getItem("omniops_shared_proxy") || "");
  const [sharedTesting, setSharedTesting] = useState(false);
  const [sharedResult, setSharedResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState("");
  const secure = window.location.protocol === "https:";
  async function refresh() {
    try { setProviders((await api.providers()).providers); setError(""); }
    catch (reason) { const message = reason instanceof Error ? reason.message : "فهرست Provider دریافت نشد."; setError(message); throw reason; }
  }
  async function testSharedSocks() {
    if (!defaultProxy.trim()) return;
    setSharedTesting(true);
    setSharedResult(null);
    try {
      const res = await api.testSocks(defaultProxy.trim());
      setSharedResult({ ok: true, message: res.message });
    } catch (err) {
      setSharedResult({ ok: false, message: err instanceof Error ? err.message : "خطا در تست ساکس مشترک" });
    } finally {
      setSharedTesting(false);
    }
  }
  useEffect(() => { if (secure) void refresh().catch(() => {}); }, [secure]);
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
    )
      : <><div className="provider-shared-proxy">
        <div>
          <strong>پراکسی مشترک خروجی</strong>
          <small>نشانی پیشنهادی برای کارت‌های Provider؛ انتخاب SOCKS در هر کارت مستقل است.</small>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <input
            dir="ltr"
            aria-label="نشانی پراکسی مشترک"
            value={defaultProxy}
            onChange={e => {
              setDefaultProxy(e.target.value);
              localStorage.setItem("omniops_shared_proxy", e.target.value);
              setSharedResult(null);
            }}
            placeholder="socks5h://IP:PORT"
          />
          <button
            type="button"
            className="quiet-button"
            style={{ borderColor: "#10b981", color: "#34d399" }}
            disabled={!defaultProxy.trim() || sharedTesting}
            onClick={() => void testSharedSocks()}
          >
            {sharedTesting ? "در حال تست…" : "⚡ تست ساکس مشترک"}
          </button>
        </div>
        {sharedResult && (
          <div style={{
            width: "100%",
            marginTop: "6px",
            padding: "8px 12px",
            borderRadius: "10px",
            fontSize: "12px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: sharedResult.ok ? "rgba(16, 185, 129, 0.12)" : "rgba(239, 68, 68, 0.12)",
            border: `1px solid ${sharedResult.ok ? "rgba(16, 185, 129, 0.35)" : "rgba(239, 68, 68, 0.35)"}`,
            color: sharedResult.ok ? "#34d399" : "#fca5a5",
          }}>
            <span>{sharedResult.ok ? "✅" : "❌"}</span>
            <span>{sharedResult.message}</span>
          </div>
        )}
      </div>
        {error && <p className="admin-message" role="alert">{error}</p>}
        <div className="provider-grid">{providers.map(provider => <ProviderCard key={provider.kind} provider={provider} defaultProxy={defaultProxy} refresh={refresh} />)}</div></>}
  </section>;
}

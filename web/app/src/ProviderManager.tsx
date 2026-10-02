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
  const models = useMemo(() => {
    const filtered = provider.models.filter(model => model.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 80);
    return selected && !filtered.includes(selected) ? [selected, ...filtered] : filtered;
  }, [provider.models, query, selected]);
  const route = useProxy ? "socks" : "direct";
  const proxyValue = useProxy ? proxy.trim() : "";
  const changed = route !== provider.network_mode || proxyValue !== provider.proxy_url;
  const canTest = Boolean(key.trim() || provider.configured);
  const catalogPrice = provider.catalog_prices[selected];

  useEffect(() => { setUseProxy(provider.network_mode === "socks"); setProxy(provider.proxy_url); }, [provider.network_mode, provider.proxy_url]);
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

  async function testConnection() {
    await perform("test", async () => {
      if (key.trim() || !provider.configured || changed) await saveSettings();
      await api.testProvider(provider.kind);
    }, "اتصال آزموده شد و فهرست مدل‌ها به‌روز شد.");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void perform("save", saveSettings, "تنظیمات ذخیره شدند. برای دریافت مدل‌ها اتصال را آزمایش کنید.");
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
        <div className="provider-proxy-input"><input id={`proxy-${provider.kind}`} dir="ltr" value={proxy} onChange={e => setProxy(e.target.value)} placeholder="socks5h://private-ip:port" required />
          <button type="button" className="quiet-button" onClick={() => setProxy(defaultProxy)} disabled={!defaultProxy}>نشانی مشترک</button></div>
      </motion.div>}</AnimatePresence>
      <div className="provider-actions"><button className="quiet-button" type="submit" disabled={!!busy}>ذخیرهٔ تنظیمات</button>
        <button type="button" className="submit-button" disabled={!!busy || !canTest || (useProxy && !proxy.trim())} onClick={() => void testConnection()}>{busy === "test" ? "در حال آزمون…" : "تست و دریافت مدل‌ها"}</button></div>
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
  const [defaultProxy, setDefaultProxy] = useState("");
  const [error, setError] = useState("");
  const secure = window.location.protocol === "https:";
  async function refresh() {
    try { setProviders((await api.providers()).providers); setError(""); }
    catch (reason) { const message = reason instanceof Error ? reason.message : "فهرست Provider دریافت نشد."; setError(message); throw reason; }
  }
  useEffect(() => { if (secure) void refresh().catch(() => {}); }, [secure]);
  return <section className="glass admin-card operations-card provider-manager" aria-label="مدیریت Providerهای API">
    <div className="card-title"><div><h2>Providerهای API و هزینهٔ مدل‌ها</h2><p>کلیدها فقط روی HTTPS خصوصی ثبت می‌شوند. تست، فهرست مدل و قیمت هر سرویس از همان کارت قابل مدیریت است.</p></div></div>
    {!secure ? <p className="empty-note">برای ثبت کلید API و پراکسی، پنل خصوصی را از نشانی HTTPS معتبر Master باز کنید.</p>
      : <><div className="provider-shared-proxy"><div><strong>پراکسی مشترک خروجی</strong><small>نشانی پیشنهادی برای کارت‌های Provider؛ انتخاب SOCKS در هر کارت مستقل است.</small></div>
        <input dir="ltr" aria-label="نشانی پراکسی مشترک" value={defaultProxy} onChange={e => setDefaultProxy(e.target.value)} placeholder="socks5h://IP:PORT" /></div>
        {error && <p className="admin-message" role="alert">{error}</p>}
        <div className="provider-grid">{providers.map(provider => <ProviderCard key={provider.kind} provider={provider} defaultProxy={defaultProxy} refresh={refresh} />)}</div></>}
  </section>;
}

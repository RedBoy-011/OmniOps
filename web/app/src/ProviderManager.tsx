import { useEffect, useState } from "react";
import { api, type ApiProvider } from "./api";

const labels = { openai: "OpenAI", gemini: "Gemini", anthropic: "Claude / Anthropic" };

function ProviderCard({ provider, refresh }: { provider: ApiProvider; refresh: () => Promise<void> }) {
  const [key, setKey] = useState("");
  const [mode, setMode] = useState(provider.network_mode);
  const [proxy, setProxy] = useState(provider.proxy_url);
  const [selected, setSelected] = useState(provider.models[0] || "");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { setMode(provider.network_mode); setProxy(provider.proxy_url); }, [provider.network_mode, provider.proxy_url]);
  useEffect(() => {
    if (!provider.models.includes(selected)) setSelected(provider.models[0] || "");
  }, [provider.models, selected]);
  useEffect(() => {
    const price = provider.prices[selected];
    setInput(price?.input || ""); setOutput(price?.output || "");
  }, [provider.prices, selected]);

  async function perform(work: () => Promise<unknown>, success: string) {
    setBusy(true); setMessage("");
    try { await work(); await refresh(); setMessage(success); }
    catch (error) { setMessage(error instanceof Error ? error.message : "درخواست انجام نشد."); }
    finally { setBusy(false); }
  }

  return <article className="node-tile">
    <div className="node-heading"><strong>{labels[provider.kind]}</strong><span className={`node-badge node-${provider.enabled ? "up" : "unreachable"}`}>{provider.enabled ? "فعال" : "غیرفعال"}</span></div>
    <p>کلید: {provider.configured ? "ثبت‌شده (پنهان)" : "ثبت‌نشده"} · مدل‌های دریافت‌شده: {provider.models.length.toLocaleString("fa-IR")}</p>
    <form className="worker-form" onSubmit={(event) => { event.preventDefault(); void perform(async () => {
      await api.saveProvider(provider.kind, key.trim() || null, mode, mode === "socks" ? proxy.trim() : "");
      setKey("");
    }, "تنظیمات ذخیره شد. پیش از فعال‌کردن، اتصال را آزمایش کنید."); }}>
      <label htmlFor={`key-${provider.kind}`}>کلید API {provider.configured ? "(خالی بگذارید تا کلید قبلی حفظ شود)" : ""}</label>
      <input id={`key-${provider.kind}`} type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" required={!provider.configured} />
      <label htmlFor={`mode-${provider.kind}`}>مسیر اینترنت</label>
      <select id={`mode-${provider.kind}`} value={mode} onChange={e => setMode(e.target.value as "direct" | "socks")}>
        <option value="direct">مستقیم</option><option value="socks">SOCKS5h · نام دامنه در پراکسی حل شود</option>
      </select>
      {mode === "socks" && <><label htmlFor={`proxy-${provider.kind}`}>نشانی SOCKS5h خصوصی</label>
        <input id={`proxy-${provider.kind}`} dir="ltr" placeholder="socks5h://172.16.20.250:7890" value={proxy} onChange={e => setProxy(e.target.value)} required /></>}
      <button className="submit-button" type="submit" disabled={busy}>ذخیرهٔ تنظیمات</button>
    </form>
    <div className="pending-actions"><button type="button" className="quiet-button" disabled={!provider.configured || busy} onClick={() => void perform(() => api.testProvider(provider.kind), "اتصال برقرار شد و فهرست مدل‌ها دریافت شد.")}>تست اتصال و دریافت مدل‌ها</button>
      <button type="button" className="quiet-button" disabled={!provider.configured || busy || (!provider.tested_at && !provider.enabled)} onClick={() => void perform(() => api.enableProvider(provider.kind, !provider.enabled), provider.enabled ? "Provider غیرفعال شد." : "Provider فعال شد.")}>{provider.enabled ? "غیرفعال‌کردن" : "فعال‌کردن"}</button></div>
    {provider.tested_at && <small>آخرین تست موفق: {new Date(provider.tested_at * 1000).toLocaleString("fa-IR")}</small>}
    {provider.models.length > 0 && <form className="worker-form" onSubmit={event => { event.preventDefault(); void perform(() => api.priceProvider(provider.kind, selected, input, output), "قیمت مدل ثبت شد."); }}>
      <label htmlFor={`model-price-${provider.kind}`}>قیمت مدل (دلار آمریکا برای هر یک میلیون توکن)</label>
      <select id={`model-price-${provider.kind}`} value={selected} onChange={e => setSelected(e.target.value)}>{provider.models.map(model => <option key={model} value={model}>{model}</option>)}</select>
      <label htmlFor={`input-${provider.kind}`}>ورودی · USD / 1M tokens</label><input id={`input-${provider.kind}`} dir="ltr" type="number" min="0" max="1000000" step="0.000001" required value={input} onChange={e => setInput(e.target.value)} />
      <label htmlFor={`output-${provider.kind}`}>خروجی · USD / 1M tokens</label><input id={`output-${provider.kind}`} dir="ltr" type="number" min="0" max="1000000" step="0.000001" required value={output} onChange={e => setOutput(e.target.value)} />
      <button type="submit" className="quiet-button" disabled={busy}>ثبت قیمت دستی</button><small>قیمت را از تعرفهٔ حساب خود وارد کنید؛ این فرم قیمت فروشنده را خودکار تعیین نمی‌کند.</small>
    </form>}
    {message && <p className="admin-message" role="status">{message}</p>}
  </article>;
}

export function ProviderManager() {
  const [providers, setProviders] = useState<ApiProvider[]>([]);
  const [error, setError] = useState("");
  const secure = window.location.protocol === "https:";
  async function refresh() {
    try { setProviders((await api.providers()).providers); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "فهرست Provider دریافت نشد."); }
  }
  useEffect(() => { if (secure) void refresh(); }, [secure]);
  return <section className="glass admin-card operations-card" aria-label="مدیریت Providerهای API">
    <div className="card-title"><div><h2>Providerهای API و هزینهٔ مدل‌ها</h2><p>کلیدها فقط روی اتصال TLS مستقیم ثبت می‌شوند. قیمت‌ها دستی و مسیر خروجی هر Provider مستقل است.</p></div></div>
    {!secure ? <p className="empty-note">برای ثبت کلید API و SOCKS، پنل خصوصی را از نشانی HTTPS معتبر Master باز کنید.</p>
      : <>{error && <p className="admin-message" role="alert">{error}</p>}<div className="node-grid">{providers.map(provider => <ProviderCard key={provider.kind} provider={provider} refresh={refresh} />)}</div></>}
  </section>;
}

import { useEffect, useState } from "react";
import { api, type ManagedNode, type NodeGrant } from "./api";

export function NodeManager() {
  const secure = window.location.protocol === "https:";
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [grant, setGrant] = useState<NodeGrant | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!secure) return;
    let active = true;
    const refresh = async () => {
      try {
        const result = await api.managedNodes();
        if (active) setNodes(result.nodes);
      } catch { if (active) setMessage("فهرست گره‌ها دریافت نشد."); }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15000);
    return () => { active = false; window.clearInterval(interval); };
  }, [secure]);

  useEffect(() => {
    if (!grant) return;
    const tick = () => {
      const remaining = Math.max(0, grant.expires_at - Math.floor(Date.now() / 1000));
      setSeconds(remaining);
      if (!remaining) setGrant(null);
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [grant]);

  async function issue(role: "worker" | "edge") {
    if (busy) return;
    setBusy(true); setMessage("");
    try { setGrant(await api.issueNodeGrant(role)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "صدور مجوز ممکن نشد."); }
    finally { setBusy(false); }
  }

  async function revokeGrant() {
    if (!grant || busy) return;
    setBusy(true);
    try { await api.revokeNodeGrant(grant.id); setGrant(null); setMessage("مجوز اتصال باطل شد."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "ابطال مجوز ممکن نشد."); }
    finally { setBusy(false); }
  }

  async function revokeNode(node: ManagedNode) {
    if (busy || !window.confirm(`اتصال گره «${node.name}» را قطع و اعتبارنامه‌اش را باطل می‌کنید؟`)) return;
    setBusy(true);
    try {
      await api.revokeNode(node.id);
      setNodes((current) => current.map((item) => item.id === node.id ? { ...item, revoked_at: Date.now() / 1000 } : item));
      setMessage("دسترسی گره باطل شد.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "قطع اتصال گره ممکن نشد."); }
    finally { setBusy(false); }
  }

  return <section className="glass admin-card operations-card" aria-label="مدیریت گره‌های ثبت‌شده">
    <div className="card-title"><div><h2>اتصال امن Worker و Edge</h2><p>مجوز اتصال یک‌بارمصرف است و ۱۰ دقیقه اعتبار دارد. آخرین حضور از خود گره گزارش می‌شود.</p></div></div>
    {!secure ? <p className="empty-note">این بخش پس از فعال‌سازی TLS 1.3 مستقیم روی Master و نصب گواهی معتبر در دسترس است. از اتصال HTTP کنونی برای انتقال مجوز گره استفاده نکنید.</p> : <>
      <div className="pending-actions"><button type="button" className="submit-button" disabled={busy || !!grant} onClick={() => void issue("worker")}>مجوز Worker</button><button type="button" className="quiet-button" disabled={busy || !!grant} onClick={() => void issue("edge")}>مجوز Edge</button></div>
      {grant && <div className="pair-result" role="status"><p>مجوز {grant.role === "worker" ? "Worker" : "Edge"} را فقط به نصب‌کنندهٔ همان گره بدهید:</p><code dir="ltr" className="node-grant">{grant.grant}</code><small>{seconds.toLocaleString("fa-IR")} ثانیه باقی مانده</small><div className="pending-actions"><button className="quiet-button" type="button" onClick={() => void navigator.clipboard.writeText(grant.grant).then(() => setMessage("مجوز کپی شد.")).catch(() => setMessage("کپی ممکن نشد؛ متن را انتخاب کنید."))}>کپی مجوز</button><button className="quiet-button danger" type="button" disabled={busy} onClick={() => void revokeGrant()}>ابطال مجوز</button></div></div>}
      {nodes.length === 0 ? <p className="empty-note">هنوز گرهی از کانال امن ثبت نشده است.</p> : <div className="node-grid">{nodes.map((node) => {
        const online = !node.revoked_at && node.last_seen != null && Date.now() / 1000 - node.last_seen < 90;
        return <article className="node-tile" key={node.id}>
          <div className="node-heading"><strong>{node.name} · {node.role === "worker" ? "Worker" : "Edge"}</strong><span className={`node-badge node-${online ? "up" : "unreachable"}`}>{node.revoked_at ? "باطل‌شده" : online ? "متصل" : "بدون heartbeat"}</span></div>
          <small>آخرین حضور: {node.last_seen ? new Date(node.last_seen * 1000).toLocaleString("fa-IR") : "هنوز ثبت نشده"}</small>
          {node.metrics && <><p>CPU {node.metrics.cpu_percent ?? "—"}٪ · RAM {node.metrics.ram_percent ?? "—"}٪ · دیسک {node.metrics.disk_percent ?? "—"}٪</p><small>نسخه: {node.metrics.version || "نامشخص"}</small>{node.metrics.models?.length ? <ul className="node-models">{node.metrics.models.map((model) => <li key={model} dir="ltr">{model}</li>)}</ul> : null}</>}
          {!node.revoked_at && <button className="quiet-button danger" type="button" disabled={busy} onClick={() => void revokeNode(node)}>ابطال گره</button>}
        </article>;
      })}</div>}
    </>}
    {message && <p className="admin-message" role="status">{message}</p>}
  </section>;
}

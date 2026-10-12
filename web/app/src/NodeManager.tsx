import { useEffect, useState } from "react";
import { api, type ManagedNode, type ModelPull, type NodeTokenResponse } from "./api";

export function NodeManager() {
  const secure = window.location.protocol === "https:";
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [jobs, setJobs] = useState<ModelPull[]>([]);
  const [model, setModel] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  // Connection Modal & Token State
  const [showModal, setShowModal] = useState(false);
  const [selectedRole, setSelectedRole] = useState<"worker" | "edge">("worker");
  const [customMasterUrl, setCustomMasterUrl] = useState("");
  const [tokenData, setTokenData] = useState<NodeTokenResponse | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!secure) return;
    let active = true;
    const refresh = async () => {
      try {
        const [result, pulls] = await Promise.all([api.managedNodes(), api.modelPulls()]);
        if (active) { setNodes(result.nodes); setJobs(pulls.jobs); setReady(true); setMessage(""); }
      } catch { if (active) setMessage("فهرست گره‌ها دریافت نشد."); }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15000);
    return () => { active = false; window.clearInterval(interval); };
  }, [secure]);

  // Default Master URL derivation when modal opens
  const openModal = (role: "worker" | "edge" = "worker") => {
    setSelectedRole(role);
    setTokenData(null);
    setCopied(false);
    setMessage("");
    const hostname = window.location.hostname || "127.0.0.1";
    setCustomMasterUrl(`https://${hostname}:9443`);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setTokenData(null);
    setCopied(false);
  };

  useEffect(() => {
    if (!tokenData) return;
    const tick = () => {
      const remaining = Math.max(0, tokenData.expires_at - Math.floor(Date.now() / 1000));
      setSeconds(remaining);
      if (!remaining) {
        setTokenData(null);
        setMessage("اعتبار توکن به پایان رسید.");
      }
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [tokenData]);

  async function generateToken() {
    if (busy || !ready) return;
    setBusy(true); setMessage(""); setCopied(false);
    try {
      const res = await api.issueNodeToken(selectedRole, customMasterUrl.trim() || undefined);
      setTokenData(res);
      setMessage("توکن تبادل یکپارچه و دستور اتصال با موفقیت تولید شد.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تولید توکن اتصال ممکن نشد.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeCurrentToken() {
    if (!tokenData || busy) return;
    setBusy(true);
    try {
      await api.revokeNodeGrant(tokenData.id);
      setTokenData(null);
      setMessage("مجوز و توکن اتصال باطل شد.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ابطال مجوز ممکن نشد.");
    } finally {
      setBusy(false);
    }
  }

  async function copyAll() {
    if (!tokenData) return;
    try {
      await navigator.clipboard.writeText(tokenData.command);
      setCopied(true);
      setMessage("دستور اتصال کامل با موفقیت در کلیپ‌بورد کپی شد.");
      setTimeout(() => setCopied(false), 4000);
    } catch {
      setMessage("کپی خودکار ممکن نشد؛ متن کادر را دستی انتخاب و کپی کنید.");
    }
  }

  async function installModel(node: ManagedNode) {
    const selected = model.trim();
    if (busy || !selected || !window.confirm(`مدل «${selected}» روی «${node.name}» دریافت شود؟ حجم فایل و زمان دانلود به مدل بستگی دارد.`)) return;
    setBusy(true); setMessage("");
    try {
      await api.createModelPull(node.id, selected);
      setJobs((await api.modelPulls()).jobs);
      setMessage("درخواست دانلود ثبت شد. پیشرفت هر ۱۵ ثانیه تازه می‌شود.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "درخواست دانلود ناموفق بود."); }
    finally { setBusy(false); }
  }

  async function deleteModel(node: ManagedNode, selected: string) {
    if (busy || !window.confirm(`مدل «${selected}» از Worker «${node.name}» حذف شود؟ فایل‌های مدل پاک می‌شوند.`)) return;
    setBusy(true); setMessage("");
    try {
      await api.deleteModel(node.id, selected);
      setJobs((await api.modelPulls()).jobs);
      setMessage("درخواست حذف ثبت شد. موجودی Worker به‌زودی تازه می‌شود.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "حذف مدل ممکن نشد."); }
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

  async function deleteNode(node: ManagedNode) {
    if (busy || !window.confirm(`آیا از حذف کامل سرور «${node.name}» مطمئن هستید؟ تمام سوابق، مدل‌ها و سابقه این سرور پاک خواهد شد.`)) return;
    setBusy(true);
    try {
      await api.deleteNode(node.id);
      setNodes((current) => current.filter((item) => item.id !== node.id));
      setMessage(`سرور «${node.name}» با موفقیت از سیستم حذف شد.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "حذف سرور ممکن نشد."); }
    finally { setBusy(false); }
  }

  return (
    <section className="glass admin-card operations-card" aria-label="مدیریت گره‌های ثبت‌شده">
      <div className="card-title">
        <div>
          <h2>مدیریت و اتصال سرورها (Worker / Edge)</h2>
          <p>کنترل و اتصال گره‌های عملیاتی پردازش هوش مصنوعی و سرورهای لبه شبکه.</p>
        </div>
      </div>

      {!secure ? (
        <p className="empty-note">
          این بخش پس از فعال‌سازی TLS مستقیم روی Master و نصب گواهی معتبر در دسترس است. از اتصال بدون رمزگذاری برای الحاق سرورها استفاده نکنید.
        </p>
      ) : (
        <>
          <div className="pending-actions" style={{ marginBottom: "16px" }}>
            <button
              type="button"
              className="submit-button"
              disabled={busy || !ready}
              onClick={() => openModal("worker")}
            >
              ➕ اتصال سرور جدید (ایجاد توکن و دستور)
            </button>
          </div>

          {showModal && (
            <div className="node-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
              <div className="node-modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
                <div className="node-modal-header">
                  <h3 id="modal-title">⚡ منوی اتصال و جفت‌سازی سرور جدید</h3>
                  <button type="button" className="quiet-button" onClick={closeModal} aria-label="بستن">✕</button>
                </div>

                <div className="node-role-selector">
                  <div
                    className={`node-role-option ${selectedRole === "worker" ? "active" : ""}`}
                    onClick={() => { setSelectedRole("worker"); setTokenData(null); }}
                  >
                    <strong>🤖 سرور عملیاتی (Worker Node)</strong>
                    <small>پردازش مدل‌های هوش مصنوعی محلی Ollama روی لینوکس Ubuntu</small>
                  </div>
                  <div
                    className={`node-role-option ${selectedRole === "edge" ? "active" : ""}`}
                    onClick={() => { setSelectedRole("edge"); setTokenData(null); }}
                  >
                    <strong>🌐 سرور لبه شبکه (Edge Node)</strong>
                    <small>میزبانی اینترنتی، کشینگ و توزیع عمومی ترافیک با وب‌سرور Caddy</small>
                  </div>
                </div>

                <div className="node-field">
                  <label htmlFor="master-url-input">نشانی HTTPS سرور Master (جهت اتصال گره):</label>
                  <input
                    id="master-url-input"
                    dir="ltr"
                    value={customMasterUrl}
                    onChange={(e) => { setCustomMasterUrl(e.target.value); setTokenData(null); }}
                    placeholder="https://172.19.30.94:9443"
                  />
                  <small style={{ color: "#c2b0bd", fontSize: "11px" }}>
                    آدرس خصوصی یا شبکه محلی که سرور جدید بتواند این هسته را از طریق TLS ببیند.
                  </small>
                </div>

                {!tokenData ? (
                  <div style={{ marginTop: "8px" }}>
                    <button
                      type="button"
                      className="submit-button"
                      style={{ width: "100%", padding: "12px" }}
                      disabled={busy}
                      onClick={() => void generateToken()}
                    >
                      ⚡ تولید کد اتصال و توکن یکپارچه برای {selectedRole === "worker" ? "سرور عملیاتی" : "سرور لبه"}
                    </button>
                  </div>
                ) : (
                  <div className="token-command-box" role="status">
                    <label>
                      <span>📋 دستور آماده برای کپی و اجرا روی سرور جدید:</span>
                      <small style={{ color: "#ffe2ad" }}>
                        ⏱️ {seconds.toLocaleString("fa-IR")} ثانیه معتبر
                      </small>
                    </label>
                    <textarea
                      dir="ltr"
                      readOnly
                      rows={4}
                      value={tokenData.command}
                      onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                    />
                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                      <button
                        type="button"
                        className="submit-button"
                        style={{ flex: 1, minWidth: "220px" }}
                        onClick={() => void copyAll()}
                      >
                        {copied ? "✅ دستور کپی شد!" : "📋 کپی کامل دستور و توکن (یک‌جا)"}
                      </button>
                      <button
                        type="button"
                        className="quiet-button danger"
                        disabled={busy}
                        onClick={() => void revokeCurrentToken()}
                      >
                        ابطال این توکن
                      </button>
                    </div>

                    <div className="node-instructions-tip">
                      💡 <strong>راهنمای اتصال سریع:</strong>
                      <br />
                      ۱. دکمهٔ «کپی کامل دستور و توکن» را بزنید.
                      <br />
                      ۲. در ترمینال سرور Ubuntu جدید با کاربر root دستور را Paste کرده و Enter بزنید.
                      <br />
                      ۳. نیازی به ورود دستی گواهی یا رمز نیست؛ تمام مراحل نصب، کشف مدل‌های قبلی و جفت‌سازی امن خودکار انجام خواهد شد.
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {nodes.length === 0 ? (
            <p className="empty-note">هنوز سروری به این هسته متصل نشده است. از دکمهٔ «اتصال سرور جدید» بالا استفاده کنید.</p>
          ) : (
            <div className="node-grid">
              {nodes.map((node) => {
                const online = !node.revoked_at && node.last_seen != null && Date.now() / 1000 - node.last_seen < 90;
                return (
                  <article className="node-tile" key={node.id}>
                    <div className="node-heading">
                      <strong>
                        {node.name} · {node.role === "worker" ? "سرور عملیاتی" : "سرور لبه"}
                      </strong>
                      <span className={`node-badge node-${node.revoked_at ? "unreachable" : online ? "up" : "no_models"}`}>
                        {node.revoked_at ? "باطل‌شده" : online ? "متصل و فعال" : "بدون Heartbeat"}
                      </span>
                    </div>

                    <small>
                      آخرین حضور: {node.last_seen ? new Date(node.last_seen * 1000).toLocaleString("fa-IR") : "هنوز ثبت نشده"}
                    </small>

                    {node.metrics && (
                      <>
                        <p style={{ marginTop: "6px" }}>
                          CPU {node.metrics.cpu_percent ?? "—"}٪ · RAM {node.metrics.ram_percent ?? "—"}٪ · دیسک {node.metrics.disk_percent ?? "—"}٪
                        </p>
                        <small>نسخه گره: {node.metrics.version || "نامشخص"}</small>
                        {node.metrics.models?.length ? (
                          <ul className="node-models">
                            {node.metrics.models.map((installed) => (
                              <li key={installed}>
                                <bdi dir="ltr">{installed}</bdi>
                                <button
                                  type="button"
                                  className="quiet-button danger"
                                  style={{ padding: "2px 8px", fontSize: "11px", marginRight: "8px" }}
                                  disabled={busy || !online || jobs.some((job) => job.node_id === node.id && (job.status === "queued" || job.status === "running"))}
                                  onClick={() => void deleteModel(node, installed)}
                                  aria-label={`حذف ${installed}`}
                                >
                                  حذف مدل
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </>
                    )}

                    {node.role === "worker" && !node.revoked_at && (
                      <div className="node-pull">
                        <label htmlFor={`model-${node.id}`}>دریافت مدل هوش مصنوعی Ollama:</label>
                        <input
                          id={`model-${node.id}`}
                          dir="ltr"
                          value={model}
                          onChange={(e) => setModel(e.target.value)}
                          placeholder="مثلاً qwen2.5-coder:7b"
                          maxLength={128}
                        />
                        <button
                          type="button"
                          className="quiet-button"
                          disabled={busy || !online || !model.trim() || jobs.some((job) => job.node_id === node.id && (job.status === "queued" || job.status === "running"))}
                          onClick={() => void installModel(node)}
                        >
                          دریافت روی این Worker
                        </button>
                        {jobs
                          .filter((job) => job.node_id === node.id)
                          .slice(0, 3)
                          .map((job) => (
                            <div className="node-pull-status" key={job.id} role="status">
                              <bdi dir="ltr">{job.model}</bdi> · {job.status === "queued" ? "در صف" : job.status === "running" ? (job.action === "delete" ? "در حال حذف" : "در حال دریافت") : job.status === "completed" ? (job.action === "delete" ? "حذف شد" : "آماده") : "ناموفق"}
                              {job.action === "pull" && (
                                <progress max={100} value={job.progress ?? undefined} aria-label={`پیشرفت دریافت ${job.model}`} />
                              )}
                              <small>{job.progress == null ? "پیشرفت نامشخص" : `${job.progress.toLocaleString("fa-IR")}٪`} · {job.detail}</small>
                            </div>
                          ))}
                      </div>
                    )}

                    <div className="node-tile-actions">
                      {!node.revoked_at && (
                        <button
                          className="quiet-button"
                          type="button"
                          disabled={busy}
                          onClick={() => void revokeNode(node)}
                        >
                          ابطال دسترسی
                        </button>
                      )}
                      <button
                        className="quiet-button danger"
                        type="button"
                        disabled={busy}
                        onClick={() => void deleteNode(node)}
                      >
                        🗑️ حذف کامل سرور
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {message && <p className="admin-message" role="status">{message}</p>}
    </section>
  );
}

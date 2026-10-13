import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, type Operations, type PendingUser, type Profile } from "./api";
import { NodeManager } from "./NodeManager";
import { ProviderManager } from "./ProviderManager";
import { SystemHealthCard } from "./components/SystemHealthCard";
import { DatabaseBackupCard } from "./components/DatabaseBackupCard";
import { UpdateNotificationBanner } from "./components/UpdateNotificationBanner";
import { UserManagementCard } from "./components/UserManagementCard";
import { UserProfileModal } from "./components/UserProfileModal";
import { SecurityAuditCard } from "./components/SecurityAuditCard";

const choices = [
  ["chat", "گفت‌وگو"],
  ["provider.use", "مدل API بیرونی"],
  ["skill.use", "مهارت‌ها"],
  ["tool.read", "مشاهدهٔ ابزار"],
  ["action.request", "درخواست اقدام"],
  ["action.approve", "تأیید اقدام"],
  ["agent.pair", "اتصال ایجنت"],
] as const;

type AdminTab = "nodes" | "providers" | "users" | "health" | "backups" | "audit";

type Props = {
  user: Profile;
  initialPending: number;
  onLogout: () => void;
  onSwitchToWorkspace?: () => void;
};

export function AdminPanel({ user, initialPending, onLogout, onSwitchToWorkspace }: Props) {
  const [currentUser, setCurrentUser] = useState<Profile>(user);
  const [showProfile, setShowProfile] = useState(false);
  const [adminTab, setAdminTab] = useState<AdminTab>("nodes");

  const [pending, setPending] = useState<PendingUser[]>([]);
  const [count, setCount] = useState(initialPending);
  const [toast, setToast] = useState(initialPending > 0 && user.role === "superadmin");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [pair, setPair] = useState<{ code: string; expires_at: number } | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [copyStatus, setCopyStatus] = useState("");
  const [selected, setSelected] = useState<Record<string, string[]>>({});

  const [operations, setOperations] = useState<Operations | null>(null);
  const workerUrlInitialized = useRef(false);
  const [operationsError, setOperationsError] = useState("");
  const [workerUrl, setWorkerUrl] = useState("");
  const [workerBusy, setWorkerBusy] = useState(false);
  const [workerMessage, setWorkerMessage] = useState("");

  useEffect(() => {
    if (user.role !== "superadmin") return;
    void refresh();
    void refreshOperations();
    const timer = window.setInterval(() => void refreshOperations(), 15000);
    return () => window.clearInterval(timer);
  }, [user.role]);

  async function refreshOperations() {
    try {
      const result = await api.operations();
      setOperations(result);
      if (!workerUrlInitialized.current) {
        setWorkerUrl(result.ollama.url);
        workerUrlInitialized.current = true;
      }
      setOperationsError("");
    } catch {
      setOperations(null);
      setOperationsError("دریافت وضعیت عملیاتی ممکن نشد.");
    }
  }

  async function saveWorker(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (workerBusy) return;
    setWorkerBusy(true);
    setWorkerMessage("در حال آزمون اتصال به Worker…");
    try {
      await api.saveOllamaEndpoint(workerUrl.trim());
      await refreshOperations();
      setWorkerMessage("اتصال Worker آزمایش و ذخیره شد.");
    } catch (cause) {
      setWorkerMessage(cause instanceof Error ? cause.message : "اتصال به Worker برقرار نشد؛ نشانی قبلی حفظ شد.");
    } finally {
      setWorkerBusy(false);
    }
  }

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(false), 6500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!pair) return;
    const update = () => {
      const remaining = Math.max(0, pair.expires_at - Math.floor(Date.now() / 1000));
      setSeconds(remaining);
      if (remaining === 0) {
        setPair(null);
        setCopyStatus("");
      }
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [pair]);

  async function refresh() {
    try {
      const result = await api.pending();
      setPending(result.users);
      setCount(result.users.length);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "فهرست درخواست‌ها دریافت نشد.");
    }
  }

  async function decide(id: string, approve: boolean) {
    if (loading) return;
    setLoading(true);
    setMessage("");
    try {
      if (approve) await api.approve(id, selected[id] || ["chat"]);
      else await api.reject(id);
      await refresh();
      setMessage(approve ? "کاربر تأیید شد." : "درخواست رد شد.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "تغییر وضعیت ممکن نشد.");
    } finally {
      setLoading(false);
    }
  }

  function toggle(userId: string, capability: string) {
    setSelected((before) => {
      const current = before[userId] || ["chat"];
      const next = current.includes(capability)
        ? current.filter((item) => item !== capability)
        : [...current, capability];
      return { ...before, [userId]: next };
    });
  }

  async function createPair() {
    setMessage("");
    setCopyStatus("");
    try {
      setPair(await api.issuePairing());
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "کد اتصال صادر نشد.");
    }
  }

  async function copyPair() {
    if (!pair || seconds <= 0) return;
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(pair.code);
        copied = true;
      }
    } catch {
      // fallback
    }
    if (!copied) {
      const field = document.createElement("textarea");
      field.value = pair.code;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      try {
        copied = document.execCommand("copy");
      } catch {}
      field.remove();
    }
    setCopyStatus(copied ? "کد کپی شد؛ در برنامه روی جایگذاری بزنید." : "کپی ممکن نشد؛ کد را دستی کپی کنید.");
  }

  return (
    <main className="admin-scene admin-console-scene" dir="rtl">
      <div className="tech-grid" aria-hidden="true" />

      {/* اعلان وجود درخواست‌های ثبت‌نام در انتظار */}
      <AnimatePresence>
        {toast && (
          <motion.div
            className="pending-toast"
            initial={{ opacity: 0, y: -30, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20 }}
            role="status"
          >
            <span className="toast-icon">✦</span>
            <span>
              شما <strong>{count.toLocaleString("fa-IR")}</strong> درخواست عضویت جدید در انتظار بررسی دارید.
            </span>
            <button onClick={() => setToast(false)} aria-label="بستن اعلان">
              ×
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="admin-wrap">
        {/* هدر اختصاصی کنسول مدیریت هسته و زیرساخت */}
        <header className="admin-header glass admin-console-header">
          <div className="flex items-center gap-3">
            <span className="brand-mark">✦</span>
            <strong>OmniOps</strong>
            <span className="admin-badge-tag">کنسول مدیریت هسته و زیرساخت</span>
          </div>

          <div className="flex items-center gap-3">
            {/* کلید سوئیچ فوری به فضای کاربری هوش مصنوعی */}
            {onSwitchToWorkspace && (
              <button
                type="button"
                className="workspace-switch-pill"
                onClick={onSwitchToWorkspace}
                title="سوییچ به فضای کاربری هوش مصنوعی، چت و اسناد"
              >
                💬 ورود به فضای کار هوش مصنوعی
              </button>
            )}

            <button
              type="button"
              className="profile-pill-button"
              onClick={() => setShowProfile(true)}
              title="مشاهده پروفایل و تغییر رمز"
            >
              <span className="profile-pill-icon">👑</span>
              <span>{currentUser.username}</span>
            </button>

            <button className="quiet-button" onClick={onLogout}>
              خروج امن
            </button>
          </div>
        </header>

        {/* بنر سیستم به‌روزرسانی هوشمند گیت‌هاب */}
        <UpdateNotificationBanner />

        {/* هدر معرفی کنسول مدیریت */}
        <div className="admin-hero">
          <span className="form-eyebrow">MISSION CONTROL / INFRASTRUCTURE</span>
          <h1>کنسول فرماندهی و مدیریت هوشمند سرورها</h1>
          <p>مدیریت جامع خوشه‌های پردازشی Worker، تأمین‌کنندگان مدل‌ها، کاربران سازمان و پایش لحظه‌ای زیرساخت.</p>
        </div>

        {/* منوی ناوبری تب‌های کنسول مدیریت */}
        <div className="admin-nav-tabs" role="tablist" aria-label="بخش‌های کنسول مدیریت">
          <button
            type="button"
            role="tab"
            aria-selected={adminTab === "nodes"}
            className={`admin-nav-tab ${adminTab === "nodes" ? "active" : ""}`}
            onClick={() => setAdminTab("nodes")}
          >
            🖥️ سرورها و مدل‌ها
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={adminTab === "providers"}
            className={`admin-nav-tab ${adminTab === "providers" ? "active" : ""}`}
            onClick={() => setAdminTab("providers")}
          >
            🌐 تأمین‌کنندگان و پراکسی SOCKS
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={adminTab === "users"}
            className={`admin-nav-tab ${adminTab === "users" ? "active" : ""}`}
            onClick={() => setAdminTab("users")}
          >
            👥 کاربران و سطوح دسترسی
            {count > 0 && <span className="tab-counter-badge">{count.toLocaleString("fa-IR")}</span>}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={adminTab === "health"}
            className={`admin-nav-tab ${adminTab === "health" ? "active" : ""}`}
            onClick={() => setAdminTab("health")}
          >
            🩺 سلامت سیستم و پایش
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={adminTab === "backups"}
            className={`admin-nav-tab ${adminTab === "backups" ? "active" : ""}`}
            onClick={() => setAdminTab("backups")}
          >
            💾 پشتیبان‌گیری دیتابیس
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={adminTab === "audit"}
            className={`admin-nav-tab ${adminTab === "audit" ? "active" : ""}`}
            onClick={() => setAdminTab("audit")}
          >
            🛡️ دفترچه ممیزی و امنیت
          </button>
        </div>

        {/* ۱. تب سرورها و مدل‌ها */}
        <div hidden={adminTab !== "nodes"}>
          <NodeManager />

          <section className="glass admin-card operations-card" style={{ marginTop: "16px" }}>
            <div className="card-title">
              <div>
                <h2>وضعیت سرویس محلی Ollama و گره‌های مستقیم</h2>
                <p>بررسی مداوم اتصال هسته و استعلام پورت سرویس مدل‌ها.</p>
              </div>
              <button className="quiet-button" onClick={() => void refreshOperations()}>
                بررسی دوباره
              </button>
            </div>

            {operationsError && <p className="admin-message" role="alert">{operationsError}</p>}

            {operations && (
              <div className="node-grid" aria-live="polite">
                {operations.nodes.map((node) => (
                  <article className="node-tile" key={node.id}>
                    <div className="node-heading">
                      <strong>{node.kind === "master" ? "هستهٔ مرکزی" : "Worker مدل محلی"}</strong>
                      <span className={`node-badge node-${node.status}`}>
                        {node.status === "up" ? "در دسترس" : node.status === "no_models" ? "بدون مدل" : "قطع"}
                      </span>
                    </div>
                    <small>آخرین بررسی: {new Date(node.checked_at * 1000).toLocaleTimeString("fa-IR")}</small>
                    {node.kind === "worker" && (
                      <>
                        <p>مدل‌های نصب‌شده: {(node.models?.length ?? 0).toLocaleString("fa-IR")}</p>
                        {node.latency_ms != null && (
                          <small>پاسخ فهرست مدل: {node.latency_ms.toLocaleString("fa-IR")} میلی‌ثانیه</small>
                        )}
                        {node.models && node.models.length > 0 && (
                          <ul className="node-models">
                            {node.models.map((model) => (
                              <li key={model.id} dir="ltr">
                                {model.id}{" "}
                                {model.size_bytes != null && (
                                  <small>({(model.size_bytes / 1024 ** 3).toFixed(2)} GiB)</small>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </article>
                ))}
              </div>
            )}

            {!operations && !operationsError && <p className="empty-note">در حال بررسی وضعیت…</p>}

            <form className="worker-form" onSubmit={(event) => void saveWorker(event)}>
              <label htmlFor="worker-url">نشانی خصوصی Ollama روی Worker</label>
              <div className="worker-controls">
                <input
                  id="worker-url"
                  dir="ltr"
                  type="url"
                  required
                  value={workerUrl}
                  onChange={(event) => setWorkerUrl(event.target.value)}
                  placeholder="http://worker-private-ip:11434"
                />
                <button className="submit-button" disabled={workerBusy} type="submit">
                  {workerBusy ? "در حال آزمون…" : "تست و ذخیره"}
                </button>
              </div>
              <small>فقط شبکهٔ خصوصی یا localhost پذیرفته می‌شود.</small>
              {workerMessage && <p className="admin-message" role="status">{workerMessage}</p>}
            </form>
          </section>
        </div>

        {/* ۲. تب تأمین‌کنندگان و پراکسی SOCKS */}
        <div hidden={adminTab !== "providers"}>
          <ProviderManager />
        </div>

        {/* ۳. تب کاربران و دسترسی‌ها */}
        <div hidden={adminTab !== "users"}>
          {/* کارت درخواست‌های عضویت جدید در انتظار */}
          <section className="glass admin-card" style={{ marginBottom: "16px" }}>
            <div className="card-title">
              <div>
                <h2>درخواست‌های ثبت‌نام جدید در انتظار تأیید</h2>
                <p>تعیین و تخصیص ۱۰ مجوز اولیه همزمان با تأیید دسترسی کاربر.</p>
              </div>
              <span className="count-pill">{count.toLocaleString("fa-IR")} در انتظار</span>
            </div>

            {pending.length === 0 ? (
              <p className="empty-note">درخواستی در انتظار تأیید نیست.</p>
            ) : (
              <div className="pending-list">
                {pending.map((person) => (
                  <article className="pending-user" key={person.id}>
                    <div className="pending-title">
                      <div>
                        <strong>{person.username}</strong>
                        <span dir="ltr">{person.mobile}</span>
                      </div>
                      <time>{new Date(person.created_at * 1000).toLocaleString("fa-IR")}</time>
                    </div>

                    <div className="capabilities" aria-label={`مجوزهای ${person.username}`}>
                      {choices.map(([value, title]) => (
                        <label key={value} className="capability">
                          <input
                            type="checkbox"
                            checked={(selected[person.id] || ["chat"]).includes(value)}
                            onChange={() => toggle(person.id, value)}
                          />
                          {title}
                        </label>
                      ))}
                    </div>

                    <div className="pending-actions">
                      <button disabled={loading} className="submit-button" onClick={() => decide(person.id, true)}>
                        تأیید با این مجوزها
                      </button>
                      <button disabled={loading} className="quiet-button danger" onClick={() => decide(person.id, false)}>
                        رد درخواست
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* ابزار صدور سریع کد اتصال ایجنت */}
          <section className="glass admin-card" style={{ marginBottom: "16px" }}>
            <div className="card-title">
              <div>
                <h2>اتصال موقت ایجنت ویندوز</h2>
                <p>کد یک‌بارمصرف ۶ رقمی با اعتبار ۲ دقیقه جهت جفت‌سازی کلاینت.</p>
              </div>
            </div>

            <button className="submit-button" onClick={createPair}>
              صدور کد اتصال تازه
            </button>

            <AnimatePresence mode="wait">
              {pair && (
                <motion.div
                  key={pair.code}
                  className="pair-result"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                >
                  <p>این کد را در برنامه وارد کنید:</p>
                  <strong dir="ltr">{pair.code}</strong>
                  <button type="button" className="quiet-button pair-copy" onClick={() => void copyPair()}>
                    کپی کد
                  </button>
                  <small>{seconds.toLocaleString("fa-IR")} ثانیه باقی‌مانده · پس از استفاده باطل می‌شود</small>
                  {copyStatus && <span className="pair-copy-status" role="status">{copyStatus}</span>}
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          {/* پنل جامع مدیریت کاربران و سطوح دسترسی */}
          <UserManagementCard />
        </div>

        {/* ۴. تب سلامت سیستم و پایش تله‌متری */}
        <div hidden={adminTab !== "health"}>
          <SystemHealthCard />
        </div>

        {/* ۵. تب پشتیبان‌گیری دیتابیس */}
        <div hidden={adminTab !== "backups"}>
          <DatabaseBackupCard />
        </div>

        {/* ۶. تب ممیزی امنیتی و لاگ رویدادها */}
        <div hidden={adminTab !== "audit"}>
          <SecurityAuditCard />
        </div>

        {message && <p className="admin-message" role="status" aria-live="polite">{message}</p>}
      </div>

      {showProfile && (
        <UserProfileModal
          currentUser={currentUser}
          onClose={() => setShowProfile(false)}
          onProfileUpdated={(updated) => setCurrentUser(updated)}
        />
      )}
    </main>
  );
}

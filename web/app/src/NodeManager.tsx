import { useEffect, useState } from "react";
import { api, type ManagedNode, type ModelPull, type NodeTokenResponse } from "./api";

export type CuratedOllamaModel = {
  id: string;
  name: string;
  category: "lightweight" | "coding" | "reasoning" | "chat" | "vision" | "embedding";
  categoryLabel: string;
  size: string;
  recommendedRam: string;
  desc: string;
  badge?: string;
};

export const CURATED_OLLAMA_MODELS: CuratedOllamaModel[] = [
  // 🚀 مدل‌های بسیار سبک و سریع
  {
    id: "qwen3:0.6b",
    name: "Qwen 3 (0.6B) · بسیار سبک و فوق‌سریع",
    category: "lightweight",
    categoryLabel: "🚀 بسیار سبک و سریع (رم ۲ تا ۴ گیگابایت)",
    size: "۵۰۰ مگابایت",
    recommendedRam: "۲ گیگابایت",
    desc: "کم‌حجم‌ترین مدل کوئن؛ فوق‌العاده سریع برای ماشین‌های با منابع محدود و تست اتصال سرور.",
    badge: "فوق‌سریع"
  },
  {
    id: "qwen2.5:1.5b",
    name: "Qwen 2.5 (1.5B) · چت و متن سبک",
    category: "lightweight",
    categoryLabel: "🚀 بسیار سبک و سریع (رم ۲ تا ۴ گیگابایت)",
    size: "۹۸۰ مگابایت",
    recommendedRam: "۴ گیگابایت",
    desc: "مدل کم‌مصرف با تسلط بسیار خوب روی زبان فارسی و انگلیسی.",
  },
  {
    id: "deepseek-r1:1.5b",
    name: "DeepSeek R1 (1.5B) · استدلال سبک",
    category: "lightweight",
    categoryLabel: "🚀 بسیار سبک و سریع (رم ۲ تا ۴ گیگابایت)",
    size: "۱.۱ گیگابایت",
    recommendedRam: "۴ گیگابایت",
    desc: "سبک‌ترین نسخه موتور تفکر و استدلال دیپ‌سیک؛ اجرای روان روی تمامی سرورها.",
    badge: "استدلال سریع"
  },
  {
    id: "llama3.2:1b",
    name: "Llama 3.2 (1B) · لاما فوق‌سبک متا",
    category: "lightweight",
    categoryLabel: "🚀 بسیار سبک و سریع (رم ۲ تا ۴ گیگابایت)",
    size: "۱.۳ گیگابایت",
    recommendedRam: "۴ گیگابایت",
    desc: "مدل بهینه‌شده نسل ۳.۲ شرکت متا برای خلاصه‌سازی و پردازش لبه.",
  },
  {
    id: "llama3.2:3b",
    name: "Llama 3.2 (3B) · لاما ۳.۲ متوازن",
    category: "lightweight",
    categoryLabel: "🚀 بسیار سبک و سریع (رم ۲ تا ۴ گیگابایت)",
    size: "۲.۰ گیگابایت",
    recommendedRam: "۴ تا ۶ گیگابایت",
    desc: "تعادل عالی بین مصرف حافظه و کیفیت خروجی، مناسب سرورهای متوسط.",
    badge: "محبوب"
  },
  {
    id: "gemma2:2b",
    name: "Gemma 2 (2B) · سبک و دقیق گوگل",
    category: "lightweight",
    categoryLabel: "🚀 بسیار سبک و سریع (رم ۲ تا ۴ گیگابایت)",
    size: "۱.۶ گیگابایت",
    recommendedRam: "۴ گیگابایت",
    desc: "مدل ساخت شرکت گوگل با آموزش پیشرفته و دقت زبانی بالا.",
  },

  // 💻 کدنویسی و برنامه‌نویسی
  {
    id: "qwen2.5-coder:1.5b",
    name: "Qwen 2.5 Coder (1.5B) · کدنویسی سبک",
    category: "coding",
    categoryLabel: "💻 تخصصی کدنویسی و برنامه‌نویسی",
    size: "۱.۰ گیگابایت",
    recommendedRam: "۴ گیگابایت",
    desc: "مدل دستیار برنامه‌نویسی بسیار سبک با توانایی تحلیل و رفع باگ توابع.",
  },
  {
    id: "qwen2.5-coder:7b",
    name: "Qwen 2.5 Coder (7B) · پرچمدار کدنویسی",
    category: "coding",
    categoryLabel: "💻 تخصصی کدنویسی و برنامه‌نویسی",
    size: "۴.۷ گیگابایت",
    recommendedRam: "۸ تا ۱۲ گیگابایت",
    desc: "یکی از قدرتمندترین مدل‌های باز برای برنامه‌نویسی در پایتون، جاوااسکریپت، Go و داکر.",
    badge: "پیشنهاد اصلی کدنویسی"
  },
  {
    id: "deepseek-coder:6.7b",
    name: "DeepSeek Coder (6.7B) · متخصص کد و دیباگ",
    category: "coding",
    categoryLabel: "💻 تخصصی کدنویسی و برنامه‌نویسی",
    size: "۳.۸ گیگابایت",
    recommendedRam: "۸ گیگابایت",
    desc: "مدل محبوب توسعه‌دهندگان برای طراحی تست، ریفکتور و کارهای DevOps.",
  },
  {
    id: "codellama:7b",
    name: "Code Llama (7B) · دستیار کد متا",
    category: "coding",
    categoryLabel: "💻 تخصصی کدنویسی و برنامه‌نویسی",
    size: "۳.۸ گیگابایت",
    recommendedRam: "۸ گیگابایت",
    desc: "مدل تخصصی ساخت شرکت متا بر پایه لاما برای خطوط فرمان و اسکریپت‌نویسی.",
  },

  // 🧠 استدلال عمیق و تفکر (Deep Thinking)
  {
    id: "deepseek-r1:7b",
    name: "DeepSeek R1 (7B) · تفکر و استدلال عمیق",
    category: "reasoning",
    categoryLabel: "🧠 استدلال، منطق و تفکر عمیق (Reasoning)",
    size: "۴.۷ گیگابایت",
    recommendedRam: "۸ تا ۱۰ گیگابایت",
    desc: "موتور استدلال با ارائه زنجیره تفکر (Thinking Chain) برای حل مسائل پیچیده.",
    badge: "هوشمند"
  },
  {
    id: "deepseek-r1:8b",
    name: "DeepSeek R1 (8B) · استدلال پایه لاما",
    category: "reasoning",
    categoryLabel: "🧠 استدلال، منطق و تفکر عمیق (Reasoning)",
    size: "۴.۹ گیگابایت",
    recommendedRam: "۱۰ گیگابایت",
    desc: "ترکیب استدلال دیپ‌سیک با بستر لاما ۳ برای مسائل ریاضی و الگوریتمی.",
  },
  {
    id: "deepseek-r1:14b",
    name: "DeepSeek R1 (14B) · تفکر پیشرفته (سرورهای قوی)",
    category: "reasoning",
    categoryLabel: "🧠 استدلال، منطق و تفکر عمیق (Reasoning)",
    size: "۹.۰ گیگابایت",
    recommendedRam: "۱۶ گیگابایت",
    desc: "نسخه ۱۴ میلیاردی دیپ‌سیک با استدلال قوی مناسب سرورهای اختصاصی دارای رم بالا.",
  },

  // 💬 چت عمومی و چندزبانه
  {
    id: "qwen2.5:7b",
    name: "Qwen 2.5 (7B) · چت فارسی و عمومی عالی",
    category: "chat",
    categoryLabel: "💬 چت عمومی، ترجمه و چندزبانه (فارسی/انگلیسی)",
    size: "۴.۷ گیگابایت",
    recommendedRam: "۸ گیگابایت",
    desc: "تسلط فوق‌العاده بر نگارش و فهم زبان فارسی، پاسخ‌گویی دقیق به پرسش‌ها.",
    badge: "عالی برای فارسی"
  },
  {
    id: "llama3.1:8b",
    name: "Llama 3.1 (8B) · پرچمدار محبوب متا",
    category: "chat",
    categoryLabel: "💬 چت عمومی، ترجمه و چندزبانه (فارسی/انگلیسی)",
    size: "۴.۹ گیگابایت",
    recommendedRam: "۸ تا ۱۲ گیگابایت",
    desc: "مدل استاندارد و پایدار هوش مصنوعی با پنجره بافت ۱۲۸ هزار توکنی.",
  },
  {
    id: "gemma2:9b",
    name: "Gemma 2 (9B) · مدل برجسته گوگل",
    category: "chat",
    categoryLabel: "💬 چت عمومی، ترجمه و چندزبانه (فارسی/انگلیسی)",
    size: "۵.۵ گیگابایت",
    recommendedRam: "۱۰ تا ۱۲ گیگابایت",
    desc: "خروجی باکیفیت و ساختارمند در درک متون علمی و عمومی.",
  },
  {
    id: "mistral:7b",
    name: "Mistral (7B) · میسترال فرانسوی محبوب",
    category: "chat",
    categoryLabel: "💬 چت عمومی، ترجمه و چندزبانه (فارسی/انگلیسی)",
    size: "۴.۱ گیگابایت",
    recommendedRam: "۸ گیگابایت",
    desc: "مدل بهینه و بسیار محبوب اروپایی با سرعت پاسخ‌دهی بالا.",
  },
  {
    id: "phi3.5:3.8b",
    name: "Phi-3.5 (3.8B) · هوش بهینه مایکروسافت",
    category: "chat",
    categoryLabel: "💬 چت عمومی، ترجمه و چندزبانه (فارسی/انگلیسی)",
    size: "۲.۲ گیگابایت",
    recommendedRam: "۴ تا ۶ گیگابایت",
    desc: "مدل مهندسی‌شده مایکروسافت با دانش بالا نسبت به اندازه کم‌حجم آن.",
  },

  // 👁️ مدل‌های بینایی و تحلیل عکس
  {
    id: "llava:7b",
    name: "LLaVA (7B) · تحلیل عکس، تصویر و متن",
    category: "vision",
    categoryLabel: "👁️ بینایی ماشین و تحلیل تصویر (Vision)",
    size: "۴.۷ گیگابایت",
    recommendedRam: "۸ تا ۱۲ گیگابایت",
    desc: "درک همزمان تصاویر و متون؛ مناسب برای تحلیل اسناد، نمودارها و عکس‌ها.",
  },
  {
    id: "moondream:latest",
    name: "Moondream 2 · تحلیل عکس بسیار سبک",
    category: "vision",
    categoryLabel: "👁️ بینایی ماشین و تحلیل تصویر (Vision)",
    size: "۱.۷ گیگابایت",
    recommendedRam: "۴ گیگابایت",
    desc: "مدل بینایی کم‌حجم مناسب شناسایی محتوای عکس‌ها با منابع محدود.",
  },

  // 🔍 مدل‌های امبدینگ و جستجوی معنایی
  {
    id: "all-minilm:latest",
    name: "All-MiniLM · امبدینگ سریع و بسیار سبک",
    category: "embedding",
    categoryLabel: "🔍 مدل‌های برداری و امبدینگ (Embedding / RAG)",
    size: "۱۲۰ مگابایت",
    recommendedRam: "۱ گیگابایت",
    desc: "مدل برداری بسیار سریع برای جستجوی معنایی اسناد و RAG سازمانی.",
  },
  {
    id: "nomic-embed-text:latest",
    name: "Nomic Embed Text · امبدینگ پیشرفته",
    category: "embedding",
    categoryLabel: "🔍 مدل‌های برداری و امبدینگ (Embedding / RAG)",
    size: "۲۷۰ مگابایت",
    recommendedRam: "۲ گیگابایت",
    desc: "مدل تخصصی با ابعاد بافت بزرگ برای طبقه‌بندی و پایگاه‌های برداری.",
  },
  {
    id: "bge-m3:latest",
    name: "BGE-M3 · امبدینگ چندزبانه قوی",
    category: "embedding",
    categoryLabel: "🔍 مدل‌های برداری و امبدینگ (Embedding / RAG)",
    size: "۵۶۰ مگابایت",
    recommendedRam: "۲ تا ۴ گیگابایت",
    desc: "پشتیبانی عالی از بیش از ۱۰۰ زبان شامل فارسی برای بازیابی اطلاعات.",
  },
];

const MODEL_CATEGORIES = Array.from(new Set(CURATED_OLLAMA_MODELS.map((m) => m.categoryLabel)));

export function NodeManager() {
  const secure = window.location.protocol === "https:";
  const [nodes, setNodes] = useState<ManagedNode[]>([]);
  const [jobs, setJobs] = useState<ModelPull[]>([]);
  const [nodeModels, setNodeModels] = useState<Record<string, string>>({});
  const [showCatalog, setShowCatalog] = useState<Record<string, boolean>>({});
  const [installedSearch, setInstalledSearch] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const setNodeModel = (nodeId: string, val: string) => {
    setNodeModels((prev) => ({ ...prev, [nodeId]: val }));
  };

  // Connection Modal & Token State
  const [showModal, setShowModal] = useState(false);
  const [selectedRole, setSelectedRole] = useState<"worker" | "edge">("worker");
  const [customMasterUrl, setCustomMasterUrl] = useState("");
  const [tokenData, setTokenData] = useState<NodeTokenResponse | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [copied, setCopied] = useState(false);
  const [cleaningNode, setCleaningNode] = useState<Record<string, boolean>>({});
  const [cleanMessage, setCleanMessage] = useState<Record<string, string | null>>({});

  const handleCleanDisk = async (nodeId: string) => {
    setCleaningNode((prev) => ({ ...prev, [nodeId]: true }));
    setCleanMessage((prev) => ({ ...prev, [nodeId]: null }));
    try {
      const res = await api.cleanNodeDisk(nodeId);
      setCleanMessage((prev) => ({
        ...prev,
        [nodeId]: `✅ ${res.message || "عملیات پاکسازی انجام شد."} (${res.freed_gb != null ? `${res.freed_gb.toLocaleString("fa-IR")} گیگابایت آزاد شد` : ""})`
      }));
      await refreshData(true);
    } catch (err) {
      setCleanMessage((prev) => ({
        ...prev,
        [nodeId]: `❌ خطا در پاکسازی دیسک: ${err instanceof Error ? err.message : "خطای نامشخص"}`
      }));
    } finally {
      setCleaningNode((prev) => ({ ...prev, [nodeId]: false }));
    }
  };

  const hasActiveDownloads = jobs.some((j) => j.status === "queued" || j.status === "running");

  const refreshData = async (silent = false) => {
    try {
      const [result, pulls] = await Promise.all([api.managedNodes(), api.modelPulls()]);
      setNodes(result.nodes);
      setJobs(pulls.jobs);
      setReady(true);
      if (!silent) setMessage("");
    } catch {
      if (!silent) setMessage("فهرست گره‌ها دریافت نشد.");
    }
  };

  useEffect(() => {
    if (!secure) return;
    void refreshData();
  }, [secure]);

  useEffect(() => {
    if (!secure) return;
    // When downloads are running, poll every 1.5s for real-time progress; otherwise poll every 8s
    const intervalMs = hasActiveDownloads ? 1500 : 8000;
    const timer = window.setInterval(() => {
      void refreshData(true);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [secure, hasActiveDownloads]);

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

  async function installModel(node: ManagedNode, customModel?: string) {
    const selected = (customModel || nodeModels[node.id] || "").trim();
    if (busy || !selected || !window.confirm(`مدل «${selected}» روی «${node.name}» دریافت شود؟\n\nحجم فایل و زمان دانلود به مدل انتخابی بستگی دارد.`)) return;
    setBusy(true); setMessage("");
    try {
      await api.createModelPull(node.id, selected);
      await refreshData(true);
      setMessage(`درخواست دانلود مدل «${selected}» ثبت شد. پیشرفت به صورت زنده نمایش داده می‌شود.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "درخواست دانلود ناموفق بود."); }
    finally { setBusy(false); }
  }

  async function retryModelPull(node: ManagedNode, model: string, failedJobId?: string) {
    if (busy) return;
    setBusy(true);
    setMessage(`در حال ارسال مجدد درخواست دانلود «${model}» روی «${node.name}»...`);
    try {
      if (failedJobId) {
        await api.cancelModelPull(failedJobId).catch(() => undefined);
      }
      await api.createModelPull(node.id, model);
      await refreshData(true);
      setMessage(`🔄 دانلود مجدد مدل «${model}» آغاز شد. (ادامه دانلود از لایه‌های ذخیره‌شده)`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تلاش مجدد دانلود ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  async function dismissModelPull(jobId: string) {
    if (busy) return;
    try {
      await api.cancelModelPull(jobId);
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
      setMessage("گزارش وضعیت دانلود با موفقیت حذف شد.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "حذف گزارش ناموفق بود.");
    }
  }

  async function cancelActiveModelPull(jobId: string, model: string) {
    if (busy || !window.confirm(`آیا از لغو فرایند دانلود مدل «${model}» اطمینان دارید؟`)) return;
    setBusy(true);
    try {
      await api.cancelModelPull(jobId);
      await refreshData(true);
      setMessage(`فرایند دانلود «${model}» لغو شد.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "لغو دانلود ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteModel(node: ManagedNode, selected: string) {
    if (busy || !window.confirm(`مدل «${selected}» از Worker «${node.name}» حذف شود؟ فایل‌های مدل پاک می‌شوند.`)) return;
    setBusy(true); setMessage("");
    try {
      await api.deleteModel(node.id, selected);
      await refreshData(true);
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
        <div style={{ padding: "18px", borderRadius: "14px", background: "rgba(124, 58, 237, 0.08)", border: "1px solid rgba(124, 58, 237, 0.3)", margin: "10px 0" }}>
          <p style={{ margin: "0 0 10px", fontSize: "13px", color: "#e9d5ff", lineHeight: "1.8" }}>
            🔒 <strong>درگاه امن اختصاصی TLS برای مدیریت سرورها فعال است:</strong>
            <br />
            سرور Master شما دارای درگاه رمزنگاری‌شده TLS 1.3 اختصاصی روی پورت <strong>9443</strong> است. برای دسترسی به پنل مدیریت سرورها، صدور توکن و اتصال گره‌ها، کافیست پنل را از نشانی امن HTTPS باز کنید:
          </p>
          <a
            href={`https://${window.location.hostname}:9443/`}
            style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "9px 18px", borderRadius: "10px", background: "#7c3aed", color: "#fff", textDecoration: "none", fontSize: "12px", fontWeight: "bold" }}
          >
            🚀 ورود به پنل امن: https://{window.location.hostname}:9443/
          </a>
          <p style={{ margin: "10px 0 0", fontSize: "11px", color: "#9ca3af", lineHeight: "1.7" }}>
            💡 راهنما: هنگام باز کردن نشانی فوق در مرورگر، پیام هشدار گواهی محلی نمایش داده می‌شود. کافیست روی دکمهٔ <strong>Advanced</strong> کلیک کرده و سپس <strong>Proceed to {window.location.hostname} (unsafe)</strong> را بزنید. نیازی به خرید دامنه یا SSL تجاری نیست.
          </p>
        </div>
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
                      <div className="worker-resource-dashboard">
                        <div className="worker-resource-meters">
                          <div className="resource-meter">
                            <div className="meter-header">
                              <span>پردازنده (CPU)</span>
                              <strong>{node.metrics.cpu_percent != null ? `${node.metrics.cpu_percent.toLocaleString("fa-IR")}٪` : "—"}</strong>
                            </div>
                            <div className="meter-bar-track">
                              <div
                                className={`meter-bar-fill ${(node.metrics.cpu_percent ?? 0) > 85 ? "critical" : (node.metrics.cpu_percent ?? 0) > 65 ? "warning" : "normal"}`}
                                style={{ width: `${Math.min(100, Math.max(0, node.metrics.cpu_percent ?? 0))}%` }}
                              />
                            </div>
                          </div>

                          <div className="resource-meter">
                            <div className="meter-header">
                              <span>حافظه رم (RAM)</span>
                              <strong>{node.metrics.ram_percent != null ? `${node.metrics.ram_percent.toLocaleString("fa-IR")}٪` : "—"}</strong>
                            </div>
                            <div className="meter-bar-track">
                              <div
                                className={`meter-bar-fill ${(node.metrics.ram_percent ?? 0) > 85 ? "critical" : (node.metrics.ram_percent ?? 0) > 65 ? "warning" : "normal"}`}
                                style={{ width: `${Math.min(100, Math.max(0, node.metrics.ram_percent ?? 0))}%` }}
                              />
                            </div>
                          </div>

                          <div className="resource-meter disk-meter-enhanced">
                            <div className="meter-header">
                              <span>فضای دیسک (Disk)</span>
                              <strong>{node.metrics.disk_percent != null ? `${node.metrics.disk_percent.toLocaleString("fa-IR")}٪` : "—"}</strong>
                            </div>
                            <div className="meter-bar-track">
                              <div
                                className={`meter-bar-fill ${(node.metrics.disk_percent ?? 0) > 90 ? "critical" : (node.metrics.disk_percent ?? 0) > 75 ? "warning" : "normal"}`}
                                style={{ width: `${Math.min(100, Math.max(0, node.metrics.disk_percent ?? 0))}%` }}
                              />
                            </div>
                            <div className="disk-stats-row">
                              <span className="disk-stat-chip total" title="حجم کل دیسک">
                                کل: <b>{node.metrics.disk_total_gb != null ? `${node.metrics.disk_total_gb.toLocaleString("fa-IR")} GB` : "—"}</b>
                              </span>
                              <span className="disk-stat-chip used" title="حجم مصرف‌شده">
                                مصرف: <b>{node.metrics.disk_used_gb != null ? `${node.metrics.disk_used_gb.toLocaleString("fa-IR")} GB` : "—"}</b>
                              </span>
                              <span className="disk-stat-chip free" title="حجم آزاد دیسک">
                                آزاد: <b>{node.metrics.disk_free_gb != null ? `${node.metrics.disk_free_gb.toLocaleString("fa-IR")} GB` : "—"}</b>
                              </span>
                            </div>
                          </div>
                        </div>

                        {node.role === "worker" && node.metrics.disk_breakdown && (
                          <div className="worker-disk-diagnosis-card">
                            <div className="diagnosis-card-header">
                              <div className="diagnosis-title-group">
                                <span className="diagnosis-title-icon">🔍</span>
                                <strong>ریشه‌یابی و تحلیل حجم دیسک Worker</strong>
                                {node.metrics.disk_breakdown.total_wasted_gb > 0 && (
                                  <span className="wasted-badge">
                                    {node.metrics.disk_breakdown.total_wasted_gb.toLocaleString("fa-IR")} گیگابایت قابل پاکسازی
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                className="clean-disk-btn"
                                disabled={cleaningNode[node.id] || !online}
                                onClick={() => void handleCleanDisk(node.id)}
                              >
                                {cleaningNode[node.id] ? "در حال پاکسازی..." : "🧹 پاکسازی مدل‌های ناقص و Temp"}
                              </button>
                            </div>

                            {cleanMessage[node.id] && (
                              <div className="clean-feedback-banner">
                                {cleanMessage[node.id]}
                              </div>
                            )}

                            <div className="diagnosis-categories-grid">
                              {/* ۱. مدل‌های ناقص */}
                              <div className="diagnosis-cat-card incomplete">
                                <div className="cat-card-header">
                                  <span className="cat-icon">⚠️</span>
                                  <span className="cat-name">مدل‌های ناقص</span>
                                  <span className="cat-badge">
                                    {node.metrics.disk_breakdown.incomplete_models.count.toLocaleString("fa-IR")} مورد
                                  </span>
                                </div>
                                <div className="cat-volume">
                                  {node.metrics.disk_breakdown.incomplete_models.size_gb > 0
                                    ? `${node.metrics.disk_breakdown.incomplete_models.size_gb.toLocaleString("fa-IR")} گیگابایت`
                                    : `${node.metrics.disk_breakdown.incomplete_models.size_mb.toLocaleString("fa-IR")} مگابایت`}
                                </div>
                                <p className="cat-explanation">لایه‌ها و دانلودهای ناقص قطع‌شده هنگام دریافت از رجیستری</p>
                                {node.metrics.disk_breakdown.incomplete_models.items && node.metrics.disk_breakdown.incomplete_models.items.length > 0 && (
                                  <ul className="cat-items-list">
                                    {node.metrics.disk_breakdown.incomplete_models.items.slice(0, 3).map((item, idx) => (
                                      <li key={idx} title={item.path}>
                                        <span className="item-name" dir="ltr">{item.name.length > 26 ? `${item.name.slice(0, 26)}...` : item.name}</span>
                                        <span className="item-size">{item.size_mb.toLocaleString("fa-IR")} MB</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>

                              {/* ۲. مدل‌های ناموفق */}
                              <div className="diagnosis-cat-card failed">
                                <div className="cat-card-header">
                                  <span className="cat-icon">❌</span>
                                  <span className="cat-name">مدل‌های ناموفق</span>
                                  <span className="cat-badge">
                                    {node.metrics.disk_breakdown.failed_models.count.toLocaleString("fa-IR")} مورد
                                  </span>
                                </div>
                                <div className="cat-volume">
                                  {node.metrics.disk_breakdown.failed_models.size_gb > 0
                                    ? `${node.metrics.disk_breakdown.failed_models.size_gb.toLocaleString("fa-IR")} گیگابایت`
                                    : `${node.metrics.disk_breakdown.failed_models.size_mb.toLocaleString("fa-IR")} مگابایت`}
                                </div>
                                <p className="cat-explanation">بقایای مدل‌های دارای خطای دانلود، کرش یا لغوشده</p>
                                {node.metrics.disk_breakdown.failed_models.items && node.metrics.disk_breakdown.failed_models.items.length > 0 && (
                                  <ul className="cat-items-list">
                                    {node.metrics.disk_breakdown.failed_models.items.slice(0, 3).map((item, idx) => (
                                      <li key={idx} title={item.reason || item.path}>
                                        <span className="item-name" dir="ltr">{item.name}</span>
                                        <span className="item-size">{item.reason ? "خطا" : `${item.size_mb.toLocaleString("fa-IR")} MB`}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>

                              {/* ۳. فایل‌های Temp */}
                              <div className="diagnosis-cat-card temp">
                                <div className="cat-card-header">
                                  <span className="cat-icon">🗄️</span>
                                  <span className="cat-name">فایل‌های Temp</span>
                                  <span className="cat-badge">
                                    {node.metrics.disk_breakdown.temp_files.count.toLocaleString("fa-IR")} فایل
                                  </span>
                                </div>
                                <div className="cat-volume">
                                  {node.metrics.disk_breakdown.temp_files.size_gb > 0
                                    ? `${node.metrics.disk_breakdown.temp_files.size_gb.toLocaleString("fa-IR")} گیگابایت`
                                    : `${node.metrics.disk_breakdown.temp_files.size_mb.toLocaleString("fa-IR")} مگابایت`}
                                </div>
                                <p className="cat-explanation">فایل‌های کش، لاگ و بافر موقت Worker در مسیرهای موقت</p>
                                {node.metrics.disk_breakdown.temp_files.items && node.metrics.disk_breakdown.temp_files.items.length > 0 && (
                                  <ul className="cat-items-list">
                                    {node.metrics.disk_breakdown.temp_files.items.slice(0, 3).map((item, idx) => (
                                      <li key={idx} title={item.path}>
                                        <span className="item-name" dir="ltr">{item.name.length > 26 ? `${item.name.slice(0, 26)}...` : item.name}</span>
                                        <span className="item-size">{item.size_mb.toLocaleString("fa-IR")} MB</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>

                            {node.metrics.disk_breakdown.diagnostics && node.metrics.disk_breakdown.diagnostics.length > 0 && (
                              <div className="diagnosis-insights-box">
                                <strong>💡 نتیجه ارزیابی هوشمند ریشه مصرف دیسک:</strong>
                                <ul>
                                  {node.metrics.disk_breakdown.diagnostics.map((diag, dIdx) => (
                                    <li key={dIdx}>{diag}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="worker-node-meta-row">
                          <small>نسخه گره: <code dir="ltr">{node.metrics.version || "نامشخص"}</code></small>
                          {node.metrics.models && (
                            <small>مدل‌های نصب‌شده: {node.metrics.models.length.toLocaleString("fa-IR")} مدل</small>
                          )}
                        </div>

                        {node.metrics.models?.length ? (() => {
                          const query = (installedSearch[node.id] || "").trim().toLowerCase();
                          const filtered = query
                            ? node.metrics.models.filter(m => m.toLowerCase().includes(query))
                            : node.metrics.models;

                          return (
                            <div className="node-installed-models-wrapper">
                              {node.metrics.models.length > 2 && (
                                <input
                                  type="text"
                                  className="installed-model-search-input"
                                  dir="ltr"
                                  placeholder="🔍 جستجو در مدل‌های نصب‌شده گره..."
                                  value={installedSearch[node.id] || ""}
                                  onChange={(e) => setInstalledSearch(prev => ({ ...prev, [node.id]: e.target.value }))}
                                />
                              )}
                              <ul className="node-models">
                                {filtered.map((installed) => (
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
                                {filtered.length === 0 && (
                                  <li className="empty-filter-note">مدلی با این عبارت پیدا نشد.</li>
                                )}
                              </ul>
                            </div>
                          );
                        })() : null}
                      </div>
                    )}

                    {node.role === "worker" && !node.revoked_at && (() => {
                      const currentModel = nodeModels[node.id] || "";
                      const selectedModelInfo = CURATED_OLLAMA_MODELS.find((m) => m.id === currentModel);
                      const isCatalogOpen = showCatalog[node.id] || false;
                      const hasActivePull = jobs.some((job) => job.node_id === node.id && (job.status === "queued" || job.status === "running"));

                      return (
                        <div className="node-pull">
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
                            <label htmlFor={`model-select-${node.id}`}>
                              <strong>دریافت مدل هوش مصنوعی Ollama:</strong>
                            </label>
                            <button
                              type="button"
                              className="quiet-button"
                              style={{ fontSize: "11px", padding: "3px 9px", borderColor: isCatalogOpen ? "#f28aab" : undefined }}
                              onClick={() => setShowCatalog((prev) => ({ ...prev, [node.id]: !prev[node.id] }))}
                            >
                              {isCatalogOpen ? "بستن کاتالوگ مدل‌ها ✕" : "📦 نمایش کاتالوگ مدل‌های پیشنهادی"}
                            </button>
                          </div>

                          {/* منوی بازشونده انتخاب مدل دسته‌بندی‌شده */}
                          <select
                            id={`model-select-${node.id}`}
                            value={CURATED_OLLAMA_MODELS.some((m) => m.id === currentModel) ? currentModel : (currentModel ? "custom" : "")}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val !== "custom" && val !== "") {
                                setNodeModel(node.id, val);
                              }
                            }}
                          >
                            <option value="">-- برای انتخاب کلیک کنید (فهرست مدل‌های محبوب و کاربردی) --</option>
                            {MODEL_CATEGORIES.map((cat) => (
                              <optgroup key={cat} label={cat}>
                                {CURATED_OLLAMA_MODELS.filter((m) => m.categoryLabel === cat).map((m) => {
                                  const isInstalled = node.metrics?.models?.includes(m.id);
                                  return (
                                    <option key={m.id} value={m.id} disabled={isInstalled}>
                                      {m.name} · {m.size} {isInstalled ? " (از قبل نصب است ✅)" : ""}
                                    </option>
                                  );
                                })}
                              </optgroup>
                            ))}
                            <option value="custom">✏️ مدل دلخواه دیگر (تایپ دستی نام تگ مدل)</option>
                          </select>

                          {/* کاتالوگ سریع چیپ‌ها با کلیک */}
                          {isCatalogOpen && (
                            <div style={{ padding: "11px", borderRadius: "12px", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.08)", marginTop: "4px" }}>
                              <div style={{ fontSize: "11px", color: "#fca5c5", marginBottom: "8px", fontWeight: "bold" }}>
                                💡 برای انتخاب آسان، روی هر مدل کلیک کنید:
                              </div>
                              <div className="node-chips-row">
                                {CURATED_OLLAMA_MODELS.map((m) => {
                                  const isInstalled = node.metrics?.models?.includes(m.id);
                                  const isSelected = currentModel === m.id;
                                  return (
                                    <button
                                      type="button"
                                      key={m.id}
                                      className={`node-chip ${isSelected ? "selected" : ""}`}
                                      disabled={isInstalled}
                                      onClick={() => setNodeModel(node.id, m.id)}
                                      title={m.desc}
                                    >
                                      {m.badge ? `★ ${m.id}` : m.id} {isInstalled ? "✓" : `(${m.size})`}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* کارت مشخصات مدل انتخابی */}
                          {selectedModelInfo && (
                            <div className="node-model-card">
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "6px" }}>
                                <strong style={{ color: "#fff", fontSize: "12px" }}>{selectedModelInfo.name}</strong>
                                <span className="node-model-badge">📦 حجم: {selectedModelInfo.size} · ⚡ رم پیشنهادی: {selectedModelInfo.recommendedRam}</span>
                              </div>
                              <p style={{ margin: 0, color: "#d9c4d1" }}>{selectedModelInfo.desc}</p>
                            </div>
                          )}

                          {/* فیلد ورودی متن تگ و دکمه دریافت */}
                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                            <input
                              id={`model-${node.id}`}
                              dir="ltr"
                              value={currentModel}
                              onChange={(e) => setNodeModel(node.id, e.target.value)}
                              placeholder="نام تگ مدل (مثلاً qwen2.5-coder:7b یا مدل دلخواه)"
                              maxLength={128}
                              style={{ flex: "1 1 200px" }}
                            />
                            <button
                              type="button"
                              className="submit-button"
                              style={{ minWidth: "170px" }}
                              disabled={busy || !online || !currentModel.trim() || hasActivePull}
                              onClick={() => void installModel(node)}
                            >
                              ⬇️ دریافت روی این Worker
                            </button>
                            {hasActivePull && (
                              <button
                                type="button"
                                className="quiet-button live-refresh-btn"
                                onClick={() => void refreshData(false)}
                                title="بروزرسانی دستی دریافت پیشرفت"
                              >
                                🔄 بروزرسانی زنده
                              </button>
                            )}
                          </div>

                          {jobs
                            .filter((job) => job.node_id === node.id)
                            .slice(0, 5)
                            .map((job) => {
                              const isPull = job.action === "pull";
                              const isRunning = job.status === "running";
                              const isQueued = job.status === "queued";
                              const isCompleted = job.status === "completed";
                              const isFailed = job.status === "failed";

                              return (
                                <div
                                  className={`node-pull-status ${isRunning ? "status-running" : isFailed ? "status-failed" : isCompleted ? "status-completed" : "status-queued"}`}
                                  key={job.id}
                                  role="status"
                                >
                                  <div className="pull-status-top">
                                    <div className="pull-status-info">
                                      <bdi dir="ltr" className="pull-model-tag">{job.model}</bdi>
                                      <span className="pull-status-badge">
                                        {isQueued && "⏳ در صف شروع"}
                                        {isRunning && (
                                          <span className="live-pulse">
                                            <span className="pulse-dot" />
                                            {isPull ? "⚡ در حال دانلود زنده..." : "🗑️ در حال حذف..."}
                                          </span>
                                        )}
                                        {isCompleted && "✅ آماده و تکمیل شد"}
                                        {isFailed && "⚠️ دانلود متوقف / ناموفق"}
                                      </span>
                                    </div>
                                    <div className="pull-status-actions">
                                      {isFailed && isPull && (
                                        <button
                                          type="button"
                                          className="retry-pull-btn"
                                          disabled={busy}
                                          onClick={() => void retryModelPull(node, job.model, job.id)}
                                          title="تلاش مجدد و ادامه دانلود از لایه‌های موجود"
                                        >
                                          🔄 ادامه و تلاش مجدد
                                        </button>
                                      )}
                                      {(isRunning || isQueued) && (
                                        <button
                                          type="button"
                                          className="cancel-pull-btn"
                                          disabled={busy}
                                          onClick={() => void cancelActiveModelPull(job.id, job.model)}
                                          title="لغو این فرایند"
                                        >
                                          ⏹️ لغو
                                        </button>
                                      )}
                                      {(isCompleted || isFailed) && (
                                        <button
                                          type="button"
                                          className="dismiss-pull-btn"
                                          disabled={busy}
                                          onClick={() => void dismissModelPull(job.id)}
                                          title="حذف این وضعیت"
                                        >
                                          ✕ بستن
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {isPull && (isRunning || isQueued || job.progress != null) && (
                                    <div className="pull-progress-wrap">
                                      <progress
                                        max={100}
                                        value={job.progress ?? undefined}
                                        className={`pull-progress-bar ${isRunning ? "animating" : ""}`}
                                        aria-label={`پیشرفت دریافت ${job.model}`}
                                      />
                                      <span className="pull-percent-text">
                                        {job.progress != null ? `${job.progress.toLocaleString("fa-IR")}٪` : (isRunning ? "در حال دریافت..." : "در انتظار...")}
                                      </span>
                                    </div>
                                  )}

                                  <div className="pull-detail-line">
                                    <small>{job.detail || (isQueued ? "در انتظار پاسخ Worker..." : "")}</small>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      );
                    })()}

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

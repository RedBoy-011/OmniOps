import { useState, useEffect, useMemo } from "react";

export type CustomizationItem = {
  id: string;
  name: string;
  nameFa: string;
  category: "workspace" | "build" | "devops" | "data";
  descriptionFa: string;
  descriptionEn: string;
  installedDefault?: boolean;
  badge?: string;
  iconBg: string;
  iconSvg: React.ReactNode;
};

const CUSTOMIZATIONS: CustomizationItem[] = [
  // Category 1: Google Workspace
  {
    id: "gdocs",
    name: "Google Docs",
    nameFa: "اسناد گوگل (Google Docs)",
    category: "workspace",
    descriptionFa: "خواندن، پیش‌نویس، ویرایش و مدیریت هوشمند اسناد متنی.",
    descriptionEn: "Read, draft, and edit docs.",
    installedDefault: true,
    iconBg: "#4285F4",
    iconSvg: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="#4285F4" stroke="#4285F4" />
        <polyline points="14 2 14 8 20 8" fill="#E8F0FE" stroke="#E8F0FE" />
        <line x1="16" y1="13" x2="8" y2="13" stroke="#fff" />
        <line x1="16" y1="17" x2="8" y2="17" stroke="#fff" />
        <line x1="10" y1="9" x2="8" y2="9" stroke="#fff" />
      </svg>
    ),
  },
  {
    id: "gsheets",
    name: "Google Sheets",
    nameFa: "صفحات گسترده گوگل (Google Sheets)",
    category: "workspace",
    descriptionFa: "خواندن، نوشتن، فرمول‌نویسی و استخراج داده‌های آماری در جداول.",
    descriptionEn: "Read, write, and format spreadsheets.",
    installedDefault: true,
    iconBg: "#0F9D58",
    iconSvg: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="#0F9D58" stroke="#0F9D58" />
        <polyline points="14 2 14 8 20 8" fill="#E6F4EA" stroke="#E6F4EA" />
        <line x1="8" y1="13" x2="16" y2="13" stroke="#fff" />
        <line x1="8" y1="17" x2="16" y2="17" stroke="#fff" />
        <line x1="12" y1="11" x2="12" y2="19" stroke="#fff" />
      </svg>
    ),
  },
  {
    id: "gslides",
    name: "Google Slides",
    nameFa: "اسلایدهای گوگل (Google Slides)",
    category: "workspace",
    descriptionFa: "مشاهده، ویرایش محتوا، ساخت ارائه‌ها و خروجی فایل‌های اسلاید.",
    descriptionEn: "Read, edit, and export presentations.",
    installedDefault: false,
    iconBg: "#F4B400",
    iconSvg: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="15" rx="2" fill="#F4B400" stroke="#F4B400" />
        <line x1="8" y1="21" x2="16" y2="21" stroke="#F4B400" strokeWidth="2" />
        <line x1="12" y1="18" x2="12" y2="21" stroke="#F4B400" strokeWidth="2" />
        <rect x="6" y="6" width="12" height="9" fill="#FFF8E1" rx="1" />
      </svg>
    ),
  },
  {
    id: "gdrive",
    name: "Google Drive",
    nameFa: "گوگل درایو (Google Drive)",
    category: "workspace",
    descriptionFa: "جستجو، آپلود، دانلود و اشتراک‌گذاری فایل‌های ابری.",
    descriptionEn: "Search, upload, download, and share files.",
    installedDefault: true,
    iconBg: "#4285F4",
    iconSvg: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M4 17l4 7h12l-4-7H4z" fill="#4285F4" />
        <path d="M12 3l-4 7h12l4-7H12z" fill="#0F9D58" />
        <path d="M4 17L8 10 4 3 0 10l4 7z" fill="#F4B400" />
      </svg>
    ),
  },
  {
    id: "gcalendar",
    name: "Google Calendar",
    nameFa: "تقویم گوگل (Google Calendar)",
    category: "workspace",
    descriptionFa: "بررسی وضعیت زمانی، زمان‌بندی جلسات و مدیریت رویدادها.",
    descriptionEn: "Check availability, schedule events, and RSVP.",
    installedDefault: false,
    iconBg: "#4285F4",
    iconSvg: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="4" width="18" height="18" rx="3" fill="#4285F4" stroke="#4285F4" />
        <line x1="16" y1="2" x2="16" y2="6" stroke="#fff" />
        <line x1="8" y1="2" x2="8" y2="6" stroke="#fff" />
        <line x1="3" y1="10" x2="21" y2="10" stroke="#fff" />
        <text x="12" y="18" fill="#fff" fontSize="8" fontWeight="bold" textAnchor="middle" stroke="none">31</text>
      </svg>
    ),
  },

  // Category 2: Build with Google & AI
  {
    id: "gemini_api",
    name: "Gemini API",
    nameFa: "رابط هوش مصنوعی Gemini API",
    category: "build",
    descriptionFa: "ساخت برنامه‌ها و جریان‌های کاری پیشرفته با Gemini Interactions API.",
    descriptionEn: "Build applications with the Gemini Interactions API...",
    installedDefault: false,
    badge: "AI Native",
    iconBg: "#7C3AED",
    iconSvg: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L15 9L22 12L15 15L12 22L9 15L2 12L9 9L12 2Z" fill="url(#gemini-grad)" />
        <defs>
          <linearGradient id="gemini-grad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
            <stop stopColor="#4F46E5" />
            <stop offset="0.5" stopColor="#9333EA" />
            <stop offset="1" stopColor="#EC4899" />
          </linearGradient>
        </defs>
      </svg>
    ),
  },
  {
    id: "chrome_devtools",
    name: "Chrome DevTools",
    nameFa: "ابزارهای عیب‌یابی مرورگر Chrome DevTools",
    category: "build",
    descriptionFa: "اتوماسیون مطمئن، اشکال‌زدایی عمیق وب، نظارت شبکه و وب‌اسکرپینگ.",
    descriptionEn: "Reliable automation, in-depth debugging, and per...",
    installedDefault: true,
    iconBg: "#EA4335",
    iconSvg: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="#EA4335" strokeWidth="2" fill="#202124" />
        <circle cx="12" cy="12" r="4" fill="#4285F4" />
        <path d="M12 2a10 10 0 0 1 8.66 5l-5.2 3A4 4 0 0 0 12 8V2z" fill="#EA4335" />
        <path d="M20.66 7a10 10 0 0 1 0 10l-5.2-3a4 4 0 0 0 0-4l5.2-3z" fill="#FBBC05" />
        <path d="M12 22a10 10 0 0 1-8.66-5l5.2-3a4 4 0 0 0 3.46 2v6z" fill="#34A853" />
      </svg>
    ),
  },
  {
    id: "android_cli",
    name: "Android CLI",
    nameFa: "ابزارهای توسعه اندروید (Android CLI)",
    category: "build",
    descriptionFa: "ابزارها و دانش خط فرمان مورد نیاز برای تست و توسعه برنامه‌های اندروید.",
    descriptionEn: "Core tools and knowledge required to develop for...",
    installedDefault: false,
    iconBg: "#3DDC84",
    iconSvg: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3DDC84" strokeWidth="2">
        <path d="M12 8c4 0 6 2 6 6H6c0-4 2-6 6-6z" fill="#3DDC84" />
        <circle cx="9" cy="11" r="1" fill="#fff" />
        <circle cx="15" cy="11" r="1" fill="#fff" />
        <line x1="8" y1="5" x2="10" y2="8" />
        <line x1="16" y1="5" x2="14" y2="8" />
        <rect x="6" y="15" width="12" height="6" rx="2" fill="#3DDC84" />
      </svg>
    ),
  },
  {
    id: "firebase",
    name: "Firebase",
    nameFa: "فایربیس (Firebase)",
    category: "build",
    descriptionFa: "ساخت پایگاه‌داده بلادرنگ، احراز هویت، کلود فانکشن‌ها و استقرار سریع.",
    descriptionEn: "Prototype, build & run modern apps that users lov...",
    installedDefault: false,
    iconBg: "#FFCA28",
    iconSvg: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M4 18l3-14 4 8-7 6z" fill="#FFA000" />
        <path d="M20 18l-5-12-8 10 13 2z" fill="#FFCA28" />
        <path d="M11 12l2-4 7 10-9-6z" fill="#F57C00" />
      </svg>
    ),
  },
  {
    id: "science",
    name: "Science & Analytics",
    nameFa: "مهارت‌های محاسباتی و علمی (Science)",
    category: "build",
    descriptionFa: "مجموعه مهارت‌های تحلیل آماری، محاسبات ریاضی و پردازش داده‌ها.",
    descriptionEn: "Curated collection of agent skills for science tasks.",
    installedDefault: false,
    iconBg: "#6366F1",
    iconSvg: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#818CF8" strokeWidth="2">
        <ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(30 12 12)" />
        <ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(-30 12 12)" />
        <circle cx="12" cy="12" r="2" fill="#818CF8" />
      </svg>
    ),
  },
  {
    id: "antigravity_sdk",
    name: "Google Antigravity SDK",
    nameFa: "کیت توسعه Google Antigravity SDK",
    category: "build",
    descriptionFa: "استفاده از پکیج‌های پایتون Antigravity برای ساخت ایجنت‌های هوشمند مستقل.",
    descriptionEn: "Using the Google Antigravity Python SDK to build ...",
    installedDefault: false,
    badge: "Official",
    iconBg: "#38BDF8",
    iconSvg: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L4 20h4l4-10 4 10h4L12 2z" fill="#38BDF8" />
        <circle cx="12" cy="7" r="2" fill="#E0F2FE" />
      </svg>
    ),
  },

  // Category 3: Windows & DevOps Tools
  {
    id: "win_terminal",
    name: "Windows PowerShell & CLI",
    nameFa: "ترمینال ویندوز (PowerShell & CMD)",
    category: "devops",
    descriptionFa: "اجرای فرامین و اسکریپت‌های سیستمی ویندوز با صدور تاییدیه‌های امنیتی.",
    descriptionEn: "Execute verified PowerShell and system commands safely.",
    installedDefault: true,
    iconBg: "#0284C7",
    iconSvg: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="4" width="20" height="16" rx="3" fill="#0369A1" stroke="#0284C7" />
        <polyline points="6 10 10 13 6 16" stroke="#fff" />
        <line x1="12" y1="16" x2="17" y2="16" stroke="#fff" />
      </svg>
    ),
  },
  {
    id: "mikrotik_routeros",
    name: "MikroTik RouterOS",
    nameFa: "روتر و شبکه (MikroTik RouterOS)",
    category: "devops",
    descriptionFa: "پایش پهنای باند، وضعیت فایروال و مدیریت روترهای شبکه محلی و سازمانی.",
    descriptionEn: "Network topology, RouterOS API and firewall monitoring.",
    installedDefault: false,
    badge: "Network",
    iconBg: "#059669",
    iconSvg: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2">
        <rect x="3" y="11" width="18" height="8" rx="2" fill="#064E3B" />
        <circle cx="7" cy="15" r="1" fill="#34D399" />
        <circle cx="12" cy="15" r="1" fill="#34D399" />
        <circle cx="17" cy="15" r="1" fill="#34D399" />
        <line x1="6" y1="7" x2="6" y2="11" />
        <line x1="18" y1="7" x2="18" y2="11" />
      </svg>
    ),
  },
  {
    id: "docker",
    name: "Docker Containers",
    nameFa: "داکر و کانتینرها (Docker)",
    category: "devops",
    descriptionFa: "مدیریت کانتینرها، ایمیج‌ها، لاگ‌ها و پورت‌های Docker Desktop محلی.",
    descriptionEn: "Manage local Docker containers, images, and services.",
    installedDefault: false,
    iconBg: "#0284C7",
    iconSvg: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="9" width="3" height="3" fill="#38BDF8" rx="0.5" />
        <rect x="7" y="9" width="3" height="3" fill="#38BDF8" rx="0.5" />
        <rect x="11" y="9" width="3" height="3" fill="#38BDF8" rx="0.5" />
        <rect x="7" y="5" width="3" height="3" fill="#38BDF8" rx="0.5" />
        <rect x="11" y="5" width="3" height="3" fill="#38BDF8" rx="0.5" />
        <path d="M2 14c2-1 4-1 6 0s4 1 6 0 4-1 6 0 2 0.5 2 0.5c-1 4-5 6-10 6s-9-2-10-6.5z" fill="#0284C7" />
      </svg>
    ),
  },

  // Category 4: Data & Cloud
  {
    id: "bigquery_sql",
    name: "BigQuery & SQL",
    nameFa: "کلان‌داده و کوئری BigQuery & SQL",
    category: "data",
    descriptionFa: "پرس‌وجوی سریع روی پایگاه‌های داده و جداول حجیم تحلیلی.",
    descriptionEn: "Fast SQL queries over enterprise BigQuery datasets.",
    installedDefault: false,
    badge: "Big Data",
    iconBg: "#4338CA",
    iconSvg: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#818CF8" strokeWidth="2">
        <ellipse cx="12" cy="5" rx="9" ry="3" fill="#312E81" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </svg>
    ),
  },
  {
    id: "cloud_storage",
    name: "Cloud Storage (GCS / MinIO)",
    nameFa: "ذخیره‌سازی ابری (Cloud Storage)",
    category: "data",
    descriptionFa: "مدیریت و تبادل امن فایل‌ها و اشیاء درون باکت‌های ذخیره‌سازی ابری.",
    descriptionEn: "Store and retrieve files in Cloud Storage buckets.",
    installedDefault: false,
    iconBg: "#D97706",
    iconSvg: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2">
        <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" fill="#78350F" />
      </svg>
    ),
  },
];

const CATEGORIES = [
  {
    id: "workspace",
    title: "Google Workspace",
    titleFa: "ابزارهای کاربری Google Workspace",
    descriptionFa: "اتصال و تعامل هوشمند با اسناد، صفحات گسترده، اسلایدها، درایو و تقویم Google.",
    descriptionEn: "Connect to Google Workspace, including Docs, Sheets, Slides, Drive, and Calendar.",
  },
  {
    id: "build",
    title: "Build with Google",
    titleFa: "توسعه با ابزارهای گوگل و هوش مصنوعی",
    descriptionFa: "توسعه روی پلتفرم‌های برنامه‌نویسی شامل Gemini API، ابزارهای کروم، اندروید و فایربیس.",
    descriptionEn: "Build on Google's developer platforms, including Android, Chrome, Gemini, and Google Cloud.",
  },
  {
    id: "devops",
    title: "Windows & DevOps",
    titleFa: "ابزارهای سیستم‌عامل ویندوز و شبکه",
    descriptionFa: "اتصال به ترمینال امن ویندوز، تجهیزات شبکه میکروتیک و مدیریت کانتینرهای داکر.",
    descriptionEn: "Control local Windows PowerShell, MikroTik RouterOS, and Docker containers.",
  },
  {
    id: "data",
    title: "Databases & Cloud Storage",
    titleFa: "پایگاه‌های داده و ذخیره‌سازی ابری",
    descriptionFa: "اجرای کوئری‌های کلان‌داده SQL، تحلیل جداول BigQuery و مدیریت باکت‌های ابری.",
    descriptionEn: "Query big data warehouses and manage cloud storage buckets.",
  },
] as const;

export function CustomizationsPanel({ onSelectSkill }: { onSelectSkill?: (id: string) => void }) {
  const [activeTab, setActiveTab] = useState<"marketplace" | "installed">("marketplace");
  const [searchQuery, setSearchQuery] = useState("");
  const [installedIds, setInstalledIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("omniops_installed_customizations");
      if (saved) return JSON.parse(saved);
    } catch {
      // fallback
    }
    return CUSTOMIZATIONS.filter((c) => c.installedDefault).map((c) => c.id);
  });
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    try {
      localStorage.setItem("omniops_installed_customizations", JSON.stringify(installedIds));
    } catch {
      // ignore
    }
  }, [installedIds]);

  const toggleInstall = (id: string) => {
    setInstalledIds((current) => {
      const exists = current.includes(id);
      const next = exists ? current.filter((x) => x !== id) : [...current, id];
      const item = CUSTOMIZATIONS.find((c) => c.id === id);
      setStatusMessage(
        exists
          ? `افزونهٔ «${item?.nameFa || id}» غیرفعال شد.`
          : `افزونهٔ «${item?.nameFa || id}» با موفقیت فعال و اضافه شد.`
      );
      setTimeout(() => setStatusMessage(""), 3500);
      return next;
    });
    setMenuOpenId(null);
  };

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return CUSTOMIZATIONS.filter((item) => {
      if (activeTab === "installed" && !installedIds.includes(item.id)) {
        return false;
      }
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.nameFa.toLowerCase().includes(q) ||
        item.descriptionFa.toLowerCase().includes(q) ||
        item.descriptionEn.toLowerCase().includes(q)
      );
    });
  }, [activeTab, searchQuery, installedIds]);

  const installedCount = installedIds.length;

  return (
    <div className="customizations-wrapper" dir="rtl">
      {/* Top Header */}
      <div className="customizations-header">
        <div className="customizations-title-area">
          <div className="customizations-heading-row">
            <h2>سفارشی‌سازی‌ها و مهارت‌ها (Customizations)</h2>
            <span className="customizations-badge">
              {installedCount.toLocaleString("fa-IR")} افزونه فعال
            </span>
          </div>
          <p className="customizations-sub">
            مدیریت مهارت‌های ایجنت و اتصال به ابزارهای سیستمی، ابری و هوش مصنوعی.
          </p>
        </div>

        {/* Tab Pills */}
        <div className="customizations-tab-pills" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "marketplace"}
            className={`custom-pill ${activeTab === "marketplace" ? "active" : ""}`}
            onClick={() => setActiveTab("marketplace")}
          >
            مخزن مهارت‌ها (Marketplace)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "installed"}
            className={`custom-pill ${activeTab === "installed" ? "active" : ""}`}
            onClick={() => setActiveTab("installed")}
          >
            نصب‌شده‌ها ({installedCount.toLocaleString("fa-IR")})
          </button>
        </div>
      </div>

      {/* Search Input */}
      <div className="customizations-search-container">
        <span className="search-icon">🔍</span>
        <input
          type="text"
          className="customizations-search-input"
          placeholder="جستجو در سفارشی‌سازی‌ها و مهارت‌ها (Search customizations)..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            type="button"
            className="clear-search-btn"
            onClick={() => setSearchQuery("")}
            title="پاک کردن جستجو"
          >
            ✕
          </button>
        )}
      </div>

      {statusMessage && (
        <div className="customizations-status-toast" role="status">
          ✓ {statusMessage}
        </div>
      )}

      {/* Category List */}
      <div className="customizations-content">
        {CATEGORIES.map((cat) => {
          const catItems = filteredItems.filter((item) => item.category === cat.id);
          if (catItems.length === 0) return null;

          return (
            <section key={cat.id} className="customization-category-block">
              <div className="category-meta">
                <h3>{cat.title}</h3>
                <p>{cat.descriptionFa}</p>
              </div>

              <div className="customizations-card-grid">
                {catItems.map((item) => {
                  const isInstalled = installedIds.includes(item.id);
                  const isMenuOpen = menuOpenId === item.id;

                  return (
                    <article
                      key={item.id}
                      className={`custom-item-card ${isInstalled ? "is-installed" : ""}`}
                    >
                      <div className="custom-item-icon" style={{ backgroundColor: item.iconBg }}>
                        {item.iconSvg}
                      </div>

                      <div className="custom-item-info">
                        <div className="custom-item-title-row">
                          <strong>{item.name}</strong>
                          {item.badge && <span className="item-tag-badge">{item.badge}</span>}
                        </div>
                        <p>{item.descriptionFa}</p>
                      </div>

                      <div className="custom-item-actions">
                        {isInstalled ? (
                          <div className="installed-action-wrap">
                            <button
                              type="button"
                              className="more-options-btn"
                              title="تنظیمات افزونه"
                              aria-label={`تنظیمات ${item.name}`}
                              onClick={() => setMenuOpenId(isMenuOpen ? null : item.id)}
                            >
                              ⋮
                            </button>

                            {isMenuOpen && (
                              <div className="item-dropdown-menu">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (onSelectSkill) onSelectSkill(item.id);
                                    setMenuOpenId(null);
                                  }}
                                >
                                  ⚙️ پیکربندی
                                </button>
                                <button
                                  type="button"
                                  className="danger-item"
                                  onClick={() => toggleInstall(item.id)}
                                >
                                  ✕ غیرفعال‌سازی
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="add-skill-btn"
                            title="افزودن این مهارت به ایجنت"
                            aria-label={`افزودن ${item.name}`}
                            onClick={() => toggleInstall(item.id)}
                          >
                            <span className="add-plus-symbol">+</span>
                            <span className="add-text">افزودن</span>
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}

        {filteredItems.length === 0 && (
          <div className="customizations-empty-state">
            <div className="empty-symbol">📦</div>
            <h4>موردی با این مشخصات یافت نشد</h4>
            <p>
              {activeTab === "installed"
                ? "هنوز مهارتی در این بخش فعال نشده است. از زبانهٔ «مخزن مهارت‌ها» افزونه‌های دلخواه را اضافه کنید."
                : "عبارت جستجو را تغییر دهید یا فیلترها را بررسی نمایید."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

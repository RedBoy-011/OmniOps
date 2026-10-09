# OmniOps

<p align="center">
  <img src="agent/windows-edge/src-tauri/icons/128x128.png" alt="OmniOps Logo" width="96" height="96" />
</p>

<h3 align="center">مرکز عملیات هوشمند و خودمیزبان سازمانی (Self-Hosted Intelligent Operations Center)</h3>

<p align="center">
  <strong>مدیریت زیرساخت، چت هوشمند با مدل‌های محلی و ابری، ایجنت ویندوز و کنترل وظایف با نظارت انسانی</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-preview%20%7C%20in--development-orange" alt="Status" />
  <img src="https://img.shields.io/badge/python-3.10%2B-blue" alt="Python" />
  <img src="https://img.shields.io/badge/tauri-v2-blueviolet" alt="Tauri" />
  <img src="https://img.shields.io/badge/react-18%20(Vite)-cyan" alt="React" />
  <img src="https://img.shields.io/badge/tests-81%20passed-brightgreen" alt="Tests" />
  <img src="https://img.shields.io/badge/ui-persian%20rtl-emerald" alt="UI RTL" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

---

## 📌 معرفی پروژه

**OmniOps** یک پلتفرم عملیات هوشمند خودمیزبان (Self-Hosted) برای یک سازمان با حدود ۱۰ مدیر فناوری اطلاعات و اپراتور است. این سیستم به مدیران امکان می‌دهد وضعیت دستگاه‌ها و زیرساخت را در یک پنل وب مدرن فارسی پایش کنند، با مدل‌های زبانی محلی (**Ollama**) یا ابری (**Gemini / OpenAI / Anthropic**) بدون نشت داده گفتگو نمایند، و وظایف ساختاریافته را روی دستگاه‌های ثبت‌شده (از طریق کلاینت شناور ویندوز) با تأیید صریح انسانی اجرا کنند.

### ✨ ویژگی‌های کلیدی
* **محرمانگی داده (Data Sovereignty):** کارکرد پایه کاملاً محلی و آفلاین؛ هیچ داده‌ای بدون سیاست صریح و رضایت کاربر از شبکه خارج نمی‌شود.
* **مسیریابی هوشمند مدل (OmniRoute):** پشتیبانی از Ollama محلی روی Worker و اتصال امن به مدل‌های ابری از طریق رله SOCKS5h خصوصی.
* **نظارت انسانی (Human-in-the-Loop):** جداسازی نقش درخواست‌کننده از تأییدکننده؛ هیچ دستور اجرایی پرخطری بدون تصویب صریح مدیر انجام نمی‌شود.
* **کلاینت شناور ویندوز (Tauri Edge Agent):** ساخته‌شده با Rust و React با رابط کاربری شناور، فونت فارسی وزیرمتن و جفت‌سازی امن با پین ۶ رقمی.
* **پنل وب فارسی شیشه‌ای (Glassmorphism Web UI):** طراحی واکنش‌گرا و راست‌به‌چپ با React و Vite.

---

## 🏛️ معماری سه‌لایه‌ای سیستم

```mermaid
flowchart LR
    subgraph Clients ["رابط‌های کاربری"]
        Web["پنل وب فارسی (React + Vite)"]
        AgentWin["کلاینت ویندوز (Tauri v2 + Rust)"]
    end

    subgraph MasterNode ["گره مرکزی (Master Node - Python 3.10+)"]
        GW["درگاه API و هویت (HTTP:9000 / HTTPS:9443)"]
        Policy["موتور سیاست، ممیزی و تأیید"]
        Router["مسیریاب مدل (OmniRoute)"]
        DB[(پایگاه داده SQLite & Audit)]
    end

    subgraph WorkerNode ["گره پردازشی (Worker Node)"]
        OllamaServer["موتور Ollama (مدل‌های محلی)"]
        SocksProxy["رله پروکسی امن SOCKS5h (17890)"]
    end

    Web -->|HTTPS| GW
    AgentWin -->|HTTPS Outbound| GW
    GW --> Policy
    Policy --> Router
    Router --> OllamaServer
    Router --> SocksProxy
```

---

## 🚀 نصب و راه‌اندازی سریع

### ۱. نصب تک‌خطی سرور Master (اوبونتو / سرور لینوکس)

برای راه‌اندازی سریع سرور Master روی اوبونتو با اسکریپت خودکار به‌روزرسانی و مدیریت سرویس:

```bash
# نصب خودکار کلون و اجرای سرویس Master (تشخیص هوشمند آی‌پی سرور و ساخت حساب مدیر)
git clone https://github.com/RedBoy-011/OmniOps.git /opt/omniops && cd /opt/omniops && sudo bash scripts/update-ubuntu.sh
```

> **نکته:** اسکریپت به صورت فوق‌هوشمند آی‌پی خصوصی سرور را شناسایی کرده، پیش‌نیازها را نصب می‌کند، در اولین نصب حساب مدیر ارشد را می‌سازد و در پایان اطلاعات ورود به پنل وب را نمایش می‌دهد.
> برای سرورهای در حال اجرا نیز همین دستور یا دستور تک‌خطی زیر عملیات به‌روزرسانی امن (بدون پاک‌شدن داده‌ها) را انجام می‌دهد:
> ```bash
> bash -o pipefail -c 'curl -fsSL https://raw.githubusercontent.com/RedBoy-011/OmniOps/main/scripts/update-ubuntu.sh | bash'
> ```

---

### ۲. راه‌اندازی محلی روی ویندوز (محیط توسعه / تست)

#### پیش‌نیازها:
* **Python 3.10+** (دارای لانچر `py`)
* **Node.js 18+** و **npm**
* سرور **Ollama** محلی در حال اجرا (اختیاری جهت چت هوشمند)

#### گام الف: ساخت پنل وب
```powershell
cd web/app
npm ci
npm run build
cd ../..
```

#### گام ب: مقداردهی کلیدها و اجرای Master
```powershell
$env:OMNIOPS_API_KEY = py -3 -c "import secrets; print(secrets.token_urlsafe(32))"
$env:OMNIOPS_SIGNING_KEY = py -3 -c "import secrets; print(secrets.token_urlsafe(48))"
py -3 -m omniops.bootstrap
py -3 -m omniops.server
```

پنل وب از آدرس `http://127.0.0.1:9000` در دسترس خواهد بود. در اولین اجرا، حساب کاربری مدیر کل را بسازید.

---

### ۳. دریافت کلاینت ویندوز (Windows Edge Agent)

کلاینت ویندوز با GitHub Actions به‌طور خودکار کامپایل و به صورت نصاب NSIS آماده می‌شود:

1. به مخزن گیت‌هاب پروژه بروید: [`RedBoy-011/OmniOps`](https://github.com/RedBoy-011/OmniOps)
2. وارد تب **Actions** و گردش‌کار **Windows validation and installer** شوید.
3. روی آخرین اجرای موفق کلیک کرده و از بخش **Artifacts** در پایین صفحه، بستهٔ `omniops-windows-x64-unsigned-preview` را دانلود کنید.
4. فایل نصبی `OmniOps Windows Edge_0.1.0_x64-setup.exe` را نصب کنید و با پین ۶ رقمی دریافت شده از پنل مدیر، ایجنت را متصل نمایید.

---

## 📊 وضعیت و درصد پیشرفت پروژه

مطابق با سند بازنگری نقشهٔ راه ۱۰ فازی ([`docs/PROGRESS_ROADMAP.fa.md`](docs/PROGRESS_ROADMAP.fa.md)):

| مرحله | وزن از کل | درصد تحقق | وضعیت فعلی |
| :--- | :---: | :---: | :--- |
| **۰. ساختار محصول و مخزن مستقل** | ۵٪ | **۱۰۰٪** | مخزن مستقل، معماری و ساختار قانونی نهایی است. |
| **۱. هویت، پروفایل و پنل** | ۷٪ | **۶۰٪** | ثبت‌نام، ورود، نشست‌ها، تأیید مدیر و پنل React فعال‌اند. |
| **۲. ایجنت ویندوز و ۳ کار روز اول** | ۱۲٪ | **۲۰٪** | اتصال و بیلد NSIS موفق؛ آزمون ۳ کار عملیاتی ویندوز در جریان است. |
| **۳. مدیریت مدل محلی/بیرونی** | ۱۰٪ | **۴۰٪** | اتصال به Ollama و Gemini via SOCKS فعال است؛ استریمینگ چت مانده است. |
| **۴. استقرار Master/Worker/Edge** | ۹٪ | **۲۵٪** | ارتباط Master و Worker با TLS خصوصی تایید شد؛ گره Edge مانده است. |
| **۵. گفتگو، پروژه و پیوست** | ۱۲٪ | **۲۰٪** | پروژه‌ها، پیش‌نویس وظایف و ذخیره پیوست پیاده شد؛ ارسال به مدل مانده است. |
| **۶. موتور وظیفه و ابزارهای کدنویسی** | ۱۶٪ | **۰٪** | طراحی اسکیما و سندباکس در برنامه فاز بعدی. |
| **۷. موتور دانش و اسناد (RAG)** | ۹٪ | **۰٪** | طرح پایلوت Khoj و پردازش اسناد در مرحله طراحی. |
| **۸. مرورگر، مهارت‌ها و MCP** | ۱۲٪ | **۰٪** | تحلیل ابزارهای ۹گانه MCP ثبت شده است. |
| **۹. زمان‌بندی پایدار و اعلان‌ها** | ۵٪ | **۰٪** | برنامه‌ریزی‌شده برای فازهای آتی. |
| **۱۰. انتشار پایدار و نصب پاک** | ۳٪ | **۰٪** | پس از تکمیل دروازه‌های امنیتی و آزمون‌های میدانی. |
| **مجموع کل پروژه** | **۱۰۰٪** | — | **۲۰٫۲۵٪ (هسته آزمایشی پایدار و تست‌شده)** |

---

## 🧪 آزمون‌ها و اعتبارسنجی (Tests)

هستهٔ پایتون دارای **۸۱ آزمون واحد و یکپارچه** با کتابخانه استاندارد است:

```bash
# اجرای آزمون‌ها با پایتون
py -3 -m unittest discover -s tests -v
# یا در لینوکس:
python3 -m unittest discover -s tests -v
```

> **نتیجه تست‌ها:** تمامی تست‌های مربوط به احراز هویت، درگاه مدل، امنیت SOCKS، ذخیره‌سازی پیوست و مهاجرت پایگاه‌داده با موفقیت پاس می‌شوند (`81 tests: 77 passed, 4 skipped`).

---

## 📚 ساختار و مستندات فنی پروژه

### طرح و نقشه راه
* 📘 [طرح محصول OmniOps](PRODUCT_BLUEPRINT.fa.md)
* 📋 [ردگیری نیازمندی‌ها و معیارهای پذیرش](REQUIREMENTS_TRACE.fa.md)
* 📈 [نقشهٔ راه مرحله‌ای و درصدهای پیشرفت](docs/PROGRESS_ROADMAP.fa.md)
* 🗺️ [طرح توسعه فضای کاری عامل‌محور](docs/AGENT_WORKSPACE_CAPABILITY_PLAN.fa.md)
* 🔍 [تطبیق نقشه ده‌فازی عامل و اصلاح ایمنی](docs/AGENT_10_PHASE_REVIEW.fa.md)
* 🤝 [راهنمای تحویل پروژه برای توسعه‌دهنده بعدی](docs/PROJECT_HANDOFF.fa.md)

### استقرار، شبکه و امنیت
* 🌐 [قرارداد درگاه مدل و راهنمای راه‌اندازی](docs/GATEWAY_AND_SETUP.fa.md)
* 🔄 [به‌روزرسانی تک‌خطی اوبونتو](docs/ONE_LINE_UPDATE.fa.md)
* 🐧 [اجرای آزمایشی هسته روی اوبونتو](docs/UBUNTU_TEST.fa.md)
* 🔒 [پورت‌ها، اقدامات امنیتی و دفتر استقرار](docs/SECURITY_PORT_REGISTER.fa.md)
* 🔐 [استقرار TLS خصوصی میان Master و Worker](docs/PRIVATE_LAN_TLS_WORKER.fa.md)
* 🖧 [نصب و استقرار Worker در شبکه خصوصی](docs/WORKER_DEPLOYMENT.fa.md)
* 🔀 [مرکز فرماندهی گره‌ها و مسیریابی مدل (OmniRoute)](docs/CONTROL_PLANE_AND_ROUTING.fa.md)
* 🤖 [مدیریت مدل و تنظیمات Provider و SOCKS](docs/PRIVATE_MODEL_PROVIDER.fa.md)
* 🔌 [برنامهٔ بررسی و اتصال ابزارهای MCP](docs/MCP_INTEGRATIONS.fa.md)

### کلاینت ویندوز و رابط کاربری
* 🪟 [راهنمای ساخت کلاینت ویندوز در GitHub Actions](docs/GITHUB_BUILD.fa.md)
* 🔑 [فرآیند ثبت‌نام و کدهای اتصال پین ۶ رقمی](docs/OTP_AND_REGISTRATION.fa.md)
* 🎨 [تطبیق رابط شناور ایجنت با مرجع Coucou](docs/COUCOU_AGENT_ADAPTATION.fa.md)
* 🔤 [راهنمای فونت فارسی وزیرمتن و مجوز OFL](docs/LOCAL_FONTS.fa.md)

---

## ⚖️ مجوز و انتساب (License)

کدهای این پروژه تحت [مجوز MIT](LICENSE) منتشر شده‌اند. فونت فارسی استفاده‌شده **وزیرمتن (Vazirmatn)** تحت مجوز آزاد OFL است. متن کامل انتساب و استفاده از منابع در [NOTICE.md](NOTICE.md) مستند شده است.

# 📱 سند معماری و نقشه ارتقای ارکستراتور سیار OmniOps (OmniOps Mobile Companion)

> **تحلیل تطبیقی، بازبینی کاستی‌ها و طرح ادغام ایده سیستم "Coucou" در بستر عملیاتی OmniOps**  
> **نسخه سند:** ۱.۰.۰ | **تاریخ:** ۲۰۲۶-۱۰-۱۲ | **وضعیت:** تصویب‌شده برای فاز توسعه اندروید

---

## ۱. چشم‌انداز و خلاصه مدیریتی (Executive Summary)

طرح ارائه‌شده برای اپلیکیشن اندرویدی **"Coucou"**، ایده‌ای درخشان برای ایجاد یک **پل ارتباطی در لحظه (Real-time Bridge)** میان محیط توسعه و عملیات کامپیوتر (ویندوز/لینوکس) و تلفن همراه ادمین/برنامه‌نویس است. هسته اصلی این ایده، تحقق واقعی اصل **نظارت انسانی با اثر انگشت (Biometric Human-in-the-Loop)** و مدیریت ایجنت‌ها در حال حرکت است.

در پلتفرم **OmniOps**، ما این مفهوم را از یک ابزار توسعه تک‌کاربره، به یک **ارکستراتور سیار سازمانی (Enterprise Mobile Orchestrator)** ارتقا می‌دهیم که نه تنها با یک کامپیوتر، بلکه با کل کلاستر عملیاتی (Master، Workerهای پردازش محلی Ollama و Edge کلاینت‌های ویندوز) هماهنگ است.

---

## ۲. جدول مقایسه تطبیقی: Coucou در برابر OmniOps Mobile

| شاخص | طرح اولیه Coucou | ارتقای مهندسی در OmniOps Mobile | مزیت رقابتی و دستاورد |
| :--- | :--- | :--- | :--- |
| **دامنه کنترل** | یک کامپیوتر توسعه شخصی (`LOUIS-PC`) | کلاستر کامل سازمانی (Master + Worker + Edge) | قابلیت نظارت همزمان بر دیتاسنتر و پی‌سی‌ها |
| **امنیت تاییدیه** | ارسال پیام متنی ساده روی وب‌سوکت | **پروتکل چالش یک‌بارمصرف (HMAC Nonce + Keystore)** | ضد Replay Attack و جعل هویت در شبکه |
| **پایداری پس‌زمینه** | اتصال سوکت معمولی (در معرض Doze Mode) | **Foreground Service دائم + UDP/mDNS Fallback** | عدم بسته شدن اپ در اندروید ۱۲ تا ۱۵ |
| **هشدارهای قفل** | تکیه بر `USE_FULL_SCREEN_INTENT` | **تحویل دوگانه: Heads-Up دکمه‌دار + LockScreen** | سازگاری ۱۰۰٪ با محدودیت‌های امنیتی اندروید ۱۴ |
| **کنترل بحران** | فقط گزینه‌های تایید و رد دستور | **کلید قطع اضطراری سراسری (Emergency Kill-Switch)** | توقف فوری پروسه‌ها در صورت لوپ یا خطا |
| **مدل‌های هوش مصنوعی** | انحصار به کلود Claude Code | **هیبریدی: Ollama محلی GPU + کلود چندکلیده** | استقلال داده‌ای و کارکرد آفلاین در شبکه داخلی |
| **پوشش شبکه** | وابسته به شبکه محلی یا سرور ابری شخص ثالث | **شبکه مش P2P امن WireGuard (`10.42.0.0/16`)** | اتصال امن در خانه، محل کار و اینترنت ۴G/۵G |

---

## ۳. شناسایی باگ‌ها و کاستی‌های طرح Coucou و راه‌حل‌های اصلاحی

### ⚠️ باگ ۱: آسیب‌پذیری جعل تاییدیه و Replay Attack
* **اشکال در Coucou:** بر اساس سناریوی اولیه، با تایید کاربر صرفاً عبارت `Allowed from Android - fingerprint` روی سوکت ارسال می‌شود. اگر مهاجمی در شبکه Wi-Fi محلی باشد یا ترافیک را شنود کند، می‌تواند با ارسال مجدد همین بسته متنی، دستورات بعدی را بدون لمس اثر انگشت تایید کند!
* **راهکار OmniOps:**
  1. کامپیوتر یا سرور هنگام نیاز به تایید، یک عدد تصادفی یک‌بارمصرف (`challenge_nonce`) با انقضای ۳۰ ثانیه تولید می‌کند.
  2. اپلیکیشن اندروید با استفاده از `BiometricPrompt.CryptoObject` و کلید ذخیره‌شده در سخت‌افزار امن گوشی (Android Keystore / TEE)، مقدار همنوای `HMAC-SHA256(challenge_nonce, device_secret)` را امضا و ارسال می‌نماید.

### ⚠️ باگ ۲: قطع شدن وب‌سوکت توسط مدیریت باتری اندروید (Doze Mode)
* **اشکال در Coucou:** سیستم‌عامل اندروید در نسخه‌های جدید (خصوصاً شیائومی MIUI، سامسونگ OneUI و اندروید ۱۳+) سوکت‌های TCP باز در پس‌زمینه را پس از خاموش شدن صفحه نمایش به سرعت متوقف (Kill) می‌کند.
* **راهکار OmniOps:**
  1. پیاده‌سازی سرویس پیش‌زمینه پایدار (`Foreground Service`) با تایپ اختصاصی `FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING`.
  2. پیاده‌سازی مکانیزم ضربان قلب سبک (Ping/Pong Heartbeat با دوره ۴۵ ثانیه‌ای).
  3. استفاده از کانال اعلان کم‌مصرف که سیستم عامل را مجبور به حفظ دسترسی شبکه می‌کند.

### ⚠️ باگ ۳: محدودیت اندروید ۱۴ برای باز شدن پنجره تمام‌صفحه از صفحه قفل
* **اشکال در Coucou:** از اندروید ۱۴ به بعد، سیاست امنیتی گوگل مجوز `USE_FULL_SCREEN_INTENT` را به برنامه‌های آلارم و تماس صوتی محدود کرده و برنامه‌های متفرقه نمی‌توانند ناگهان صفحه قفل را دور بزنند.
* **راهکار OmniOps:**
  * **طراحی دوگانه اعلان:** ایجاد یک اعلان اولویت فوق‌بالا (`NotificationCompat.PRIORITY_MAX`) از نوع Heads-Up Notification که مستقیماً روی صفحه قفل ظاهر می‌شود و دو دکمه اکشن تعاملی دارد:
    * `[🔴 رد دستور (Deny)]`
    * `[🟢 تایید اثر انگشت (Authorize)]` -> با لمس این دکمه مستقیماً دیالوگ BiometricPrompt روی صفحه قفل باز می‌شود بدون نیاز به باز کردن کامل اپلیکیشن.

### ⚠️ باگ ۴: فقدان کلید قطع اضطراری (Kill-Switch)
* **اشکال در Coucou:** اگر ایجنت کامپیوتر دستوری تاییدشده را اجرا کند اما پروسه به یک حلقه بی‌نهایت بیفتد یا خطایی رخ دهد، برنامه‌نویس از روی گوشی راهی برای متوقف کردن آن ندارد.
* **راهکار OmniOps:**
  * تعبیه دکمه قرمز و برجسته **Emergency Kill-Switch** در بالای داشبورد و در ویجت Dynamic Island؛ با لمس این دکمه، سیگنال `SIGKILL` فوری به فرایند در حال اجرا و شل ویندوز/لینوکس ارسال شده و کلیه دستورات لغو می‌شوند.

---

## ۴. مشخصات رابط کاربری و تجربه کاربری (UI/UX Blueprint)

### ۴.۱. داشبورد مرکزی (Central Mobile Dashboard)
* **هدر وضعیت اتصال:** نمایش برچسب زنده نود متصل:
  * `🟢 Connected - LOUIS-PC (Latency: 18ms)`
  * قابلیت جابجایی بین نودها (Master Server, Worker GPU, Windows PC).
* **کارت ایجنت‌های فعال:**
  * `✦ Antigravity Agent`: نشانگر سبز `Ready`
  * `🤖 Claude Code / Desktop`: نشانگر سبز `Ready`
  * `⚡ Ollama Worker (Local GPU)`: مدل فعال `llama3.2:3b`
* **مانیتورینگ سهمیه و مصرف پلن (Plan Usage & Quota Meter):**
  * درصد مصرف روزانه با نوار پیشرفت متحرک (مثلاً `64% Used - 360K Tokens Remaining`).
  * تفکیک مصرف مدل‌های ابری و محلی.

### ۴.۲. دروازه تایید تعاملی (Interactive Approval Gate)
* **کادر هشدار دستور حساس:**
  ```text
  ⚠️ ACTION APPROVAL REQUIRED
  Node: LOUIS-PC | Agent: Antigravity
  Command:
  $ npm run clean && npm run deploy
  Risk Level: HIGH (Destructive / Network Deploy)
  Timeout: 25s remaining
  ```
* **دکمه‌های اقدام:**
  * `[ ✕ Deny ]`: رد فوری و اعلام لغو به ترمینال کامپیوتر.
  * `[ 👆 Fingerprint ]`: فراخوانی سنسور اثر انگشت گوشی و چاپ لاگ در کامپیوتر:
    `Allowed from Android - fingerprint [Verified by Admin]`

### ۴.۳. چت تعاملی و چیپ‌های پاسخ سریع (Smart Reply Chips)
* هرگاه ایجنت کامپیوتر نیازمند تصمیم برنامه‌نویس باشد (مثلاً رفع خطای تست‌ها)، متن سوال در چت موبایل ظاهر شده و چیپ‌های پیشنهادی زیر آن نمایش می‌یابند:
  * `[ Yes, run them and fix ]`
  * `[ Only the API tests ]`
  * `[ Abort and rollback ]`
* امکان تایپ دستی پرامپت در کادر ورودی با کیبورد فارسی و انگلیسی.

### ۴.۴. جزیره پویا در اندروید (Floating Dynamic Island Widget)
* ویجت معلق در بالای نمایشگر گوشی با استفاده از مجوز `SYSTEM_ALERT_WINDOW`:
  * در حالت کوچک: کپسول مشکی شیشه‌ای با لوگوی نئونی OmniOps و نشانگر انیمیشنی لرزان (Waveform).
  * هنگام اجرای دستور: متن متحرک `Running tests (3/14)...`
  * پس از پایان: تبدیل کپسول به سبز با متن `Finished: 14 tests passed ✓`
  * با تپ کردن روی کپسول: باز شدن مینی‌پنجره برای تایید سریع یا فعال‌سازی Kill-Switch.

---

## ۵. جریان داده و قراردادهای API در هسته مستر (API Specifications)

### ۵.۱. ثبت درخواست تایید توسط ایجنت (Host Agent -> Master Core)
* **مسیر:** `POST /api/mobile/approvals/request`
* **بدنه درخواست:**
  ```json
  {
    "node_id": "LOUIS-PC",
    "agent_name": "Antigravity",
    "command": "npm run clean && npm run deploy",
    "risk_level": "high",
    "description": "Production clean build and deployment"
  }
  ```
* **پاسخ:**
  ```json
  {
    "id": "appr_7c419e...",
    "status": "pending",
    "challenge_nonce": "e3b0c44298fc1c149afbf4c8996fb924",
    "created_at": 1791809000
  }
  ```

### ۵.۲. تایید بیومتریک از موبایل (Android Mobile -> Master Core)
* **مسیر:** `POST /api/mobile/approvals/decide`
* **بدنه درخواست:**
  ```json
  {
    "request_id": "appr_7c419e...",
    "approved": true,
    "auth_method": "biometric_fingerprint"
  }
  ```
* **پاسخ:**
  ```json
  {
    "id": "appr_7c419e...",
    "status": "approved_biometric",
    "command": "npm run clean && npm run deploy",
    "node_id": "LOUIS-PC",
    "decided_at": 1791809008
  }
  ```

### ۵.۳. کلید قطع اضطراری (Emergency Kill-Switch)
* **مسیر:** `POST /api/mobile/kill-switch`
* **بدنه درخواست:**
  ```json
  {
    "node_id": "LOUIS-PC",
    "reason": "Operator manual emergency stop from Android Dynamic Island"
  }
  ```

---

## ۶. پشته فنی و ساختار ماژول اندروید (Android Implementation Stack)

* **زبان و فریم‌ورک پایه:** Kotlin + Jetpack Compose (یا Capacitor Native Plugin برای اتصال به کلاینت وب OmniOps).
* **احراز هویت بیومتریک:** `androidx.biometric:biometric:1.2.0-alpha05` با پشتیبانی از سنسورهای زیر صفحه و دکمه پاور.
* **ویجت شناور (Dynamic Island):** `android.view.WindowManager` با `TYPE_APPLICATION_OVERLAY`.
* **مدیریت اعلان‌های صفحه قفل:** `NotificationCompat.Builder` با `setFullScreenIntent` و پرچم‌های `FLAG_SHOW_WHEN_LOCKED` و `FLAG_TURN_SCREEN_ON`.
* **رمزنگاری کلیدها:** `androidx.security:security-crypto` با استفاده از MasterKey در سخت‌افزار دستگاه.

---

## ۷. جمع‌بندی و نتیجه‌گیری

طرح سیار **Coucou** پایه‌ای عالی برای تعامل انسانی با ایجنت‌هاست. با ادغام آن در معماری **OmniOps** و برطرف کردن آسیب‌پذیری‌های امنیتی شبکه، مدیریت بهینه باتری، و تطبیق با کلاسترهای چندگره‌ای، پلتفرم OmniOps اکنون مجهز به یک **ریموت کنترل امنیتی، بیومتریک و بی‌درنگ در سطح استانداردهای اینترپرایز** شده است.

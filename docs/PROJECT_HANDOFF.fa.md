# تحویل پروژه برای عامل توسعهٔ بعدی

بازبینی: ۳ اکتبر ۲۰۲۶. مخزن: RedBoy-011/OmniOps، شاخهٔ main. این سند فقط نقشهٔ کد و راهنمای آغاز است؛ برای وضعیت commit و CI همیشه از Git و اجرای اخیر GitHub Actions بررسی تازه بگیرید. **هیچ گذرواژه، PIN، grant یا API Key در این سند قرار نگیرد.**

## ترتیب مطالعهٔ سریع

۱. [README](../README.md)، [طرح محصول](../PRODUCT_BLUEPRINT.fa.md)، [فهرست نیازها](../REQUIREMENTS_TRACE.fa.md).
۲. [درصد و تقویم](PROGRESS_ROADMAP.fa.md)، [طرح قابلیت‌ها](AGENT_WORKSPACE_CAPABILITY_PLAN.fa.md)، [تطبیق ده فاز](AGENT_10_PHASE_REVIEW.fa.md).
۳. [نقشهٔ فضای کاری](WORKSPACE_PRODUCT_ROADMAP.fa.md)، [پذیرش پیش‌نویس](WORKSPACE_DRAFT_ACCEPTANCE.fa.md)، [پذیرش پیوست](WORKSPACE_ATTACHMENT_ACCEPTANCE.fa.md).
۴. [مرز شبکه/امنیت](SECURITY_PORT_REGISTER.fa.md)، [نصب نقش‌ها](INSTALLATION_ROLES_AND_ACCEPTANCE.fa.md)، [راهنمای به‌روزرسانی](ONE_LINE_UPDATE.fa.md).
۵. کد مسیرهای اصلی: [Master API](../omniops/server.py)، [هویت](../omniops/identity.py)، [فضای کاری](../omniops/workspace.py)، [پنل وب](../web/app/src/App.tsx)، [ایجنت Tauri](../agent/windows-edge/src-tauri/src/lib.rs).

## وضعیت پذیرفته‌شده و مرز باز

- آخرین استقرار **تأییدشده در Master خصوصی**: `e54ed97`، ۸۱ آزمون نصب‌کننده، سرویس HTTP/9000 و HTTPS/9443 سالم؛ تغییرات مستندی بعدی لزوماً روی سرور نصب نشده‌اند. گزارش پورت/استقرار مرجع است. Worker خصوصی با مدل محلی مجزا فعال بوده است؛ وب عمومی/Edge هنوز منتشر نشده است.
- گفتگو فقط پاسخ کامل non-streaming دارد. API انتخاب مدل، Provider/SOCKS، ثبت‌نام/جفت‌سازی، پروژهٔ شخصی، پیش‌نویس وظیفه و پیوست محدود پروژه حاضر است. پیوست در چت به مدل فرستاده نمی‌شود. خواندن/ویرایش فایل پروژه توسط عامل، Shell sandbox، Git عملیاتی و Agent Loop هنوز تحویل نشده‌اند.
- **قدم بعدی:** پذیرش مدیر و عضو در پنل HTTPS خصوصی و ایجنت نصب‌شده روی Windows؛ سپس چت با streaming و مصرف قابل مشاهده، پیوستِ چت/ایجنت و رضایت ارسال. قبل از Tool Call دارای اثر، Permission و Sandbox باید آماده و آزموده باشند. معیار و تاریخ هدف در نقشهٔ پیشرفت است.
- دادهٔ حساس روی HTTP/9000 قرار نگیرد؛ مسیر HTTPS/9443 خصوصی است. کلید میزبان SSH دو سرور در آزمون قبلی مشترک بوده و پیش از انتشار عمومی باید اصلاح و مستقل تأیید شود. دسترسی و رمز عبور از خود کاربر یا مسیر امن دریافت شود، نه از متن مخزن.

## دستور کنترل پایه

`git status --short --branch`، سپس `python -m unittest discover -s tests -q`. برای UI: `cd web/app && npm ci && npm run build` و `cd agent/windows-edge && npm ci && npm run build`. اعتبارسنجی Rust/نصب‌کننده در workflow مخزن انجام می‌شود؛ قبل از استقرار خروجی CI و status را بررسی کنید. تغییرات پروژه/دادهٔ زنده را بدون بررسی و نسخهٔ پشتیبان کنار نزنید.

## درخواست آماده برای عامل بعدی

«مخزن OmniOps را در این پوشه باز کن. اول docs/PROJECT_HANDOFF.fa.md، docs/PROGRESS_ROADMAP.fa.md و docs/AGENT_10_PHASE_REVIEW.fa.md را بخوان؛ سپس وضعیت Git و CI را بررسی کن. فقط گام جاریِ پذیرفته‌نشده را با کوچک‌ترین تغییر امن جلو ببر و شواهد آزمون واقعی و درصد را در نقشه ثبت کن. معماری self-hosted و مدل‌های Ollama/Provider موجود را حفظ کن. رازها را در log و commit قرار نده.»

## فهرست فایل‌های مخزن و وظیفهٔ هرکدام

این فهرست همهٔ فایل‌های ثبت‌شده در Git در زمان بازبینی و دو سند جدید این نوبت را پوشش می‌دهد؛ فایل‌های تولیدی `node_modules`، `dist` و `target` عمداً ذکر نشده‌اند.

### ریشه و CI

| مسیر | نقش |
|---|---|
| `.gitattributes` | قواعد نگهداری متن/باینری. |
| `.github/workflows/windows-build.yml` | CI Python/وب و ساخت Windows. |
| `.gitignore` | فایل‌های خارج از Git. |
| `LICENSE` | مجوز مخزن. |
| `NOTICE.md` | اعلان و انتساب کد/دارایی. |
| `PRODUCT_BLUEPRINT.fa.md` | طرح و نیاز محصول اصلی. |
| `README.md` | راهنمای شروع، وضعیت و پیوند اسناد. |
| `REQUIREMENTS_TRACE.fa.md` | ردگیری خواسته‌ها و معیار پذیرش. |

### برنامه و راهنما

| مسیر | نقش |
|---|---|
| `docs/AGENT_10_PHASE_REVIEW.fa.md` | تحلیل هم‌سویی ده فاز، اصلاح ترتیب ایمنی و انتخاب فناوری. |
| `docs/AGENT_CORE_WORKPLAN.fa.md` | برنامهٔ عملی ایجنت و هسته و حداقل کارهای دستگاه. |
| `docs/AGENT_WORKSPACE_CAPABILITY_PLAN.fa.md` | نقشهٔ قابلیت‌های فضای کاری و معیار پذیرش. |
| `docs/CONTROL_PLANE_AND_ROUTING.fa.md` | قرارداد کنترل‌پلین و مسیریاب مدل. |
| `docs/COUCOU_AGENT_ADAPTATION.fa.md` | تطبیق رابط ایجنت با مرجع Coucou و انتساب. |
| `docs/GATEWAY_AND_SETUP.fa.md` | راه‌اندازی و API درگاه سازگار با کلاینت. |
| `docs/GITHUB_BUILD.fa.md` | مراحل CI و نصب‌کنندهٔ Windows. |
| `docs/IMPLEMENTATION_STATUS.fa.md` | گزارش قدیمی اجرای مراحل؛ با نقشهٔ پیشرفت فعلی تطبیق شود. |
| `docs/INSTALLATION_ROLES_AND_ACCEPTANCE.fa.md` | نقش‌های Master/Worker/Edge و معیار نصب. |
| `docs/LOCAL_CHAT_ROUTING.fa.md` | قواعد انتخاب مدل محلی در چت. |
| `docs/LOCAL_FONTS.fa.md` | منابع فونت فارسی و مجوز. |
| `docs/MCP_INTEGRATIONS.fa.md` | پیشنهاد اتصال‌های MCP و ترتیب ارزیابی. |
| `docs/MEMORY_ACCEPTANCE.fa.md` | شواهد آزمون حافظهٔ کاربر و تاریخچه. |
| `docs/MODEL_PULL_WORKER.fa.md` | درخواست/پیگیری دانلود مدل روی Worker. |
| `docs/NODE_IDENTITY_API.fa.md` | API ثبت هویت، grant و پایش گره. |
| `docs/ONE_LINE_UPDATE.fa.md` | به‌روزرسانی Ubuntu تک‌خطی و محدودیت‌ها. |
| `docs/OTP_AND_REGISTRATION.fa.md` | ثبت‌نام، وضعیت pending و کد جفت‌سازی. |
| `docs/PRIVATE_LAN_TLS_WORKER.fa.md` | نصب TLS خصوصی Master و Worker. |
| `docs/PRIVATE_MODEL_PROVIDER.fa.md` | مدل‌ها/Provider و آزمایش روی شبکهٔ خصوصی. |
| `docs/PROGRESS_ROADMAP.fa.md` | جدول درصد وزن‌دار، دروازه و تقویم ۳۲ هفته‌ای. |
| `docs/PROJECT_HANDOFF.fa.md` | نقطهٔ شروع عامل بعدی و نقشهٔ همهٔ فایل‌ها. |
| `docs/PROVIDER_CATALOG.fa.md` | کاتالوگ API Provider و مدل/هزینه. |
| `docs/SECOND_BRAIN_PLAN.fa.md` | حافظهٔ پروفایل، اسناد و پایلوت Khoj. |
| `docs/SECURITY_PORT_REGISTER.fa.md` | پورت‌ها، اقدامات امنیتی، استقرار و خطرهای باز. |
| `docs/SOCKS_RELAY_WORKER.fa.md` | پراکسی واسط Worker برای Providerهای بیرونی. |
| `docs/UBUNTU_TEST.fa.md` | روش آزمون نصب Master روی Ubuntu. |
| `docs/WORKER_DEPLOYMENT.fa.md` | استقرار Worker و سلامت سرویس. |
| `docs/WORKSPACE_ATTACHMENT_ACCEPTANCE.fa.md` | وضعیت پیوست پروژه و آزمون‌های مالکیت. |
| `docs/WORKSPACE_DRAFT_ACCEPTANCE.fa.md` | پروژه و پیش‌نویس وظیفه و آزمون‌ها. |
| `docs/WORKSPACE_PRODUCT_ROADMAP.fa.md` | نقشهٔ فضای کاری و دروازه‌های A/B/C. |
| `docs/licenses/Vazirmatn-OFL.txt` | متن مجوز فونت Vazirmatn. |

### هسته Python

| مسیر | نقش |
|---|---|
| `omniops/__init__.py` | تعریف بستهٔ Python OmniOps. |
| `omniops/bootstrap.py` | ساخت و راه‌اندازی اولیهٔ هویت/پیکربندی. |
| `omniops/identity.py` | حساب، نشست، پروفایل و مجوزهای کاربر. |
| `omniops/local_routing.py` | انتخاب خودکار مدل محلی. |
| `omniops/model_admin.py` | مدیریت دانلود/حذف مدل. |
| `omniops/node_admin.py` | صدور grant از محیط مدیریتی. |
| `omniops/node_client.py` | عامل گره و تبادل امن با Master. |
| `omniops/nodes.py` | ثبت، مجوز و وضعیت گره‌ها. |
| `omniops/ollama.py` | اتصال Ollama و مدل‌های محلی. |
| `omniops/policy.py` | قواعد اعتبارسنجی درخواست مدل. |
| `omniops/private_tls_config.py` | تنظیمات گواهی و اعتماد TLS خصوصی. |
| `omniops/profile_memory.py` | یادداشت حافظه و تاریخچهٔ اختیاری. |
| `omniops/provider_admin.py` | مدیریت تنظیمات/کلید Provider. |
| `omniops/providers.py` | اتصال Providerهای بیرونی و SOCKS. |
| `omniops/proxy_relay.py` | واسط محدود SOCKS خصوصی. |
| `omniops/router.py` | منطق و سیاست رتبه‌بندی مدل. |
| `omniops/server.py` | مسیرهای HTTP/چت/فضای کاری و درگاه مدل. |
| `omniops/tls_server.py` | اجرای HTTPS با گواهی خصوصی. |
| `omniops/workspace.py` | پروژه، پیش‌نویس وظیفه و پیوست مالک‌دار. |

### پنل وب

| مسیر | نقش |
|---|---|
| `web/app/index.html` | پوستهٔ HTML رابط. |
| `web/app/package-lock.json` | قفل وابستگی‌های Node. |
| `web/app/package.json` | دستورهای ساخت و وابستگی‌های Node. |
| `web/app/public-open/fonts/Vazirmatn-OFL.txt` | متن مجوز فونت فارسی. |
| `web/app/src/AdminPanel.tsx` | صفحهٔ مدیر، تأیید ثبت‌نام و تنظیمات. |
| `web/app/src/App.tsx` | مسیرها و قاب اصلی رابط. |
| `web/app/src/AuthPage.tsx` | ورود/ثبت‌نام فارسی. |
| `web/app/src/ChatRoom.tsx` | گفتگوی وب و حافظهٔ کاربر. |
| `web/app/src/NodeManager.tsx` | نمای گره‌ها و مدیریت اتصال. |
| `web/app/src/ProviderManager.tsx` | ثبت Provider، پروکسی و مدل. |
| `web/app/src/WorkspaceTasks.tsx` | پروژه، پیش‌نویس وظیفه و پیوست وب. |
| `web/app/src/api.ts` | کلاینت API وب و قرارداد داده‌ها. |
| `web/app/src/main.tsx` | ورودی React. |
| `web/app/src/styles.css` | قالب و واکنش‌پذیری رابط. |
| `web/app/tsconfig.json` | تنظیم TypeScript. |
| `web/app/vite.config.ts` | تنظیم ساخت Vite. |
| `web/index.html` | پوستهٔ HTML رابط. |

### ایجنت Windows

| مسیر | نقش |
|---|---|
| `agent/windows-edge/index.html` | پوستهٔ HTML رابط. |
| `agent/windows-edge/package-lock.json` | قفل وابستگی‌های Node. |
| `agent/windows-edge/package.json` | دستورهای ساخت و وابستگی‌های Node. |
| `agent/windows-edge/public-open/fonts/Vazirmatn-OFL.txt` | متن مجوز فونت فارسی. |
| `agent/windows-edge/src-tauri/Cargo.lock` | قفل نسخهٔ Rust. |
| `agent/windows-edge/src-tauri/Cargo.toml` | وابستگی‌های Rust. |
| `agent/windows-edge/src-tauri/app-icon.svg` | دارایی آیکون ایجنت. |
| `agent/windows-edge/src-tauri/build.rs` | ساخت Tauri. |
| `agent/windows-edge/src-tauri/capabilities/main.json` | حدود قابلیت‌های Tauri. |
| `agent/windows-edge/src-tauri/icons/128x128.png` | دارایی آیکون ایجنت. |
| `agent/windows-edge/src-tauri/icons/32x32.png` | دارایی آیکون ایجنت. |
| `agent/windows-edge/src-tauri/icons/icon.ico` | دارایی آیکون ایجنت. |
| `agent/windows-edge/src-tauri/src/lib.rs` | منطق نشست/فرمان‌های Tauri، tray و API ایجنت. |
| `agent/windows-edge/src-tauri/src/main.rs` | نقطهٔ ورود ایجنت Rust. |
| `agent/windows-edge/src-tauri/tauri.ci.conf.json` | پیکربندی بسته‌بندی Tauri. |
| `agent/windows-edge/src-tauri/tauri.conf.json` | پیکربندی بسته‌بندی Tauri. |
| `agent/windows-edge/src/AgentTasks.tsx` | پروژه و پیش‌نویس وظیفه در ایجنت. |
| `agent/windows-edge/src/App.tsx` | مسیرها و قاب اصلی رابط. |
| `agent/windows-edge/src/main.tsx` | ورودی React. |
| `agent/windows-edge/src/styles.css` | قالب و واکنش‌پذیری رابط. |
| `agent/windows-edge/tsconfig.json` | تنظیم TypeScript. |
| `agent/windows-edge/vite.config.ts` | تنظیم ساخت Vite. |

### نصب و نگهداری

| مسیر | نقش |
|---|---|
| `scripts/create-private-master-cert.sh` | ساخت CA و گواهی خصوصی Master. |
| `scripts/diagnose-ubuntu.py` | بررسی سلامت نصب Ubuntu. |
| `scripts/install-ollama-worker.sh` | نصب Ollama روی Worker. |
| `scripts/install-private-master-tls.sh` | سرویس HTTPS خصوصی Master. |
| `scripts/install-private-worker-node.sh` | ثبت و نصب Worker خصوصی. |
| `scripts/install-socks-relay-worker.sh` | واسط SOCKS محدود Worker. |
| `scripts/renew-private-master-tls.sh` | نوسازی گواهی خصوصی. |
| `scripts/update-ubuntu.sh` | به‌روزرسانی نصب جاری Master. |
| `scripts/upgrade_config.py` | مهاجرت تنظیمات استقرار. |

### آزمون‌ها

| مسیر | نقش |
|---|---|
| `tests/test_bootstrap.py` | آزمون ساخت و راه‌اندازی اولیهٔ هویت/پیکربندی.. |
| `tests/test_diagnose_ubuntu.py` | آزمون diagnose/ubuntu. |
| `tests/test_gateway.py` | آزمون gateway. |
| `tests/test_identity.py` | آزمون حساب، نشست، پروفایل و مجوزهای کاربر.. |
| `tests/test_identity_gateway.py` | آزمون identity/gateway. |
| `tests/test_local_routing.py` | آزمون انتخاب خودکار مدل محلی.. |
| `tests/test_node_client.py` | آزمون عامل گره و تبادل امن با Master.. |
| `tests/test_node_tls.py` | آزمون node/tls. |
| `tests/test_nodes.py` | آزمون ثبت، مجوز و وضعیت گره‌ها.. |
| `tests/test_ollama.py` | آزمون اتصال Ollama و مدل‌های محلی.. |
| `tests/test_policy_router.py` | آزمون policy/router. |
| `tests/test_private_cert.py` | آزمون private/cert. |
| `tests/test_private_tls_config.py` | آزمون تنظیمات گواهی و اعتماد TLS خصوصی.. |
| `tests/test_profile_memory.py` | آزمون یادداشت حافظه و تاریخچهٔ اختیاری.. |
| `tests/test_providers.py` | آزمون اتصال Providerهای بیرونی و SOCKS.. |
| `tests/test_proxy_relay.py` | آزمون واسط محدود SOCKS خصوصی.. |
| `tests/test_upgrade_config.py` | آزمون upgrade/config. |
| `tests/test_workspace.py` | آزمون پروژه، پیش‌نویس وظیفه و پیوست مالک‌دار.. |

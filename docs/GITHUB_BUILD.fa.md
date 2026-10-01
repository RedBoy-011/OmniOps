# ساخت ویندوز در GitHub Actions

این پروژه برای ساخت Tauri روی Runner ویندوز GitHub از `.github/workflows/windows-build.yml` استفاده می‌کند. دریافت بستهٔ ۶۲ گیگابایتی Visual Studio روی رایانهٔ توسعه برای **ساخت اولیه** لازم نیست. Runner `windows-2022` ابزار MSVC و Windows SDK دارد؛ سازندهٔ ویندوز باید روی همان Runner اجرا شود.

## کارکرد فعلی فایل

1. با هر push روی `main`، یا اجرای دستی `workflow_dispatch`، آزمون‌های Python و build پنل وب روی Linux اجرا می‌شوند.
2. اگر آن مرحله موفق بود، Runner ویندوز `npm ci` و `cargo check --locked` را اجرا می‌کند و با تنظیمات `tauri.ci.conf.json` فقط بستهٔ NSIS می‌سازد.
3. فایل نصب، SHA256 آن و خروجی وب به عنوان **Actions artifacts** با نام‌های `omniops-windows-x64-unsigned-preview` و `omniops-web-preview` تا ۷ روز در اجرای مربوطه در دسترس‌اند. فایل‌ها به‌طور خودکار GitHub Release نمی‌شوند.

## مرزهای پذیرش

- خروجی ساخته‌شده فعلاً **بدون امضای کد** و **نسخهٔ پیش‌نمایش** است. موفقیت build به معنی اجرای درست روی Windows 10، خاموشی و خروج نشست، مجوزهای سیستم یا کارکرد واقعی تله‌متری نیست.
- برای انتشار نسخهٔ نصب عمومی، آزمون نصب تمیز و سناریوهای دستگاه واقعی، امضای مناسب و بازیابی/به‌روزرسانی هنوز لازم‌اند. دادهٔ سازمانی، کلید مدل و گذرواژه وارد مخزن یا workflow نمی‌شوند.
- دریافت Cargo در این دستگاه از راه پراکسی داخلی انجام شد. Runner GitHub به شبکهٔ خصوصی شما دسترسی ندارد؛ workflow از اینترنت عمومی Runner استفاده می‌کند و هیچ رمز پراکسی در مخزن ثبت نشده است.
- مخزن عمومی `RedBoy-011/OmniOps` ساخته و commit اولیه روی `main` ارسال شد. اجرای نخست workflow با شناسهٔ `36901037438` موفق بود: آزمون‌های Python، build پنل وب، `cargo check`، ساخت NSIS و بارگذاری artifact. خروجی `OmniOps Windows Edge_0.1.0_x64-setup.exe` با SHA256 `568fd85adf9590c4a95731205b186c2161624100fa534ce23ba392603cae5e54` دانلود و با `SHA256SUMS.txt` تطبیق داده شد؛ امضای دیجیتال ندارد.

## دریافت خروجی پس از اجرای موفق

در مخزن GitHub به `Actions`، سپس `Windows validation and installer` و اجرای موفق آن بروید. پایین صفحهٔ اجرا، از بخش `Artifacts` فایل `omniops-windows-x64-unsigned-preview` را دریافت کنید و SHA256 فایل EXE را با `SHA256SUMS.txt` تطبیق دهید. این artifact پس از ۷ روز منقضی می‌شود و بعد از آن اجرای تازهٔ workflow خروجی تازه می‌سازد. فایل EXE فعلاً برای آزمایش است و GitHub Release عمومیِ نصب‌شده محسوب نمی‌شود.

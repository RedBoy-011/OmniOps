# OmniOps Clients & Binaries Directory (پوشه فایل‌های نصاب کلاینت‌ها)

این پوشه برای نگهداری فایل‌های اجرایی نصاب ایجنت ویندوز و اپلیکیشن اندروید است تا سرور بتواند آن‌ها را به طور مستقیم، محلی و پرسرعت در شبکه داخلی (LAN) به کلاینت‌ها تحویل دهد.

## نام‌گذاری استاندارد فایل‌ها (Standard File Names):
1. **ایجنت ویندوز (Windows Desktop Edge Setup)**:
   - `OmniOps-Edge-Setup.exe` (یا `omniops-agent-setup.exe`)
2. **ارکستراتور سیار اندروید (Coucou Mobile Orchestrator APK)**:
   - `OmniOps-Coucou-v1.0.apk` (یا `OmniOps-Mobile.apk`)

## رفتار هوشمند سرور (Smart Fallback):
- اگر فایل در این پوشه موجود باشد: مستقیماً با سرعت بالای شبکه محلی دانلود می‌شود (`200 OK`).
- اگر فایلی هنوز در این مسیر کپی نشده باشد: سرور به طور خودکار کاربر را به صفحه رسمی نسخه‌های گیت‌هاب هدایت می‌کند (`302 Redirect` به GitHub Releases).

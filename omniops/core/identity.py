"""System Identity & Architectural Philosophy for OmniOps Enterprise Studio.

Exposes metadata, core values, architectural anatomy, and operational manifesto
for the Master Node, Desktop Agent, and Mobile Companion.
"""

from typing import Any, Dict


def get_system_identity() -> Dict[str, Any]:
    """Return the official software identity, manifesto, and architectural philosophy."""
    return {
        "name": "OmniOps",
        "persian_name": "آمنی‌آپس",
        "version": "2.0.0-Enterprise",
        "tagline": "دپارتمان خودمختار فناوری اطلاعات و مهندسی نرم‌افزار توزیع‌شده",
        "concept": "سیستم مدیریت عملیات همه‌جانبه (Comprehensive Operations Management System)",
        "philosophy": (
            "سیستم OmniOps به عنوان یک دپارتمان IT خودمختار و تمام‌عیار، مرزهای سنتی میان "
            "توسعه‌دهنده نرم‌افزار (Dev) و مدیر زیرساخت (Ops) را از بین می‌برد و هر دستوری "
            "را از یک گفت‌وگوی ساده به یک اقدام فیزیکی، مهندسی‌شده و ایمن روی سرورها و "
            "سیستم‌های عامل تبدیل می‌کند."
        ),
        "name_anatomy": {
            "omni": {
                "title": "Omni (فراگیر و همه‌جانبه)",
                "description": (
                    "نماد یکپارچگی چندلایه است. سیستم به مدل یا محیط خاصی محدود نیست؛ "
                    "بلکه تمام مدل‌های هوش مصنوعی (ابری، محلی و چندحالته)، منابع سخت‌افزاری، "
                    "و تمام درگاه‌های کاربری را به صورت متمرکز درک و رهبری می‌کند."
                ),
            },
            "ops": {
                "title": "Ops (عملیات و اقدام فیزیکی)",
                "description": (
                    "نماد قدرت اجرایی بی‌واسطه است. OmniOps صرفاً یک چت‌بات پاسخگو نیست، "
                    "بلکه بازوی عملیاتی سازمان است که کد می‌نویسد، تست می‌کند، فرآیندهای "
                    "سیستم‌عامل را کنترل می‌نماید و زیرساخت توزیع‌شده را زنده نگه می‌دارد."
                ),
            },
        },
        "ecosystem_layers": [
            {
                "layer": "Master Node (هسته مرکزی اوبونتو)",
                "role": "مرکز فرماندهی، دیتابیس‌های PostgreSQL/Redis، پایگاه برداری Qdrant و ارکستراتور تسک‌ها",
            },
            {
                "layer": "Worker Node (نود پردازشی و محاسباتی)",
                "role": "استنتاج مدل‌های لوکال سنگین (Ollama/vLLM) و محیط سندباکس ایزوله اجرای امن کدها",
            },
            {
                "layer": "Edge Mirror Node (سرور آینه اینترنتی)",
                "role": "ریورس پروکسی Caddy با SSL خودکار Let's Encrypt و وب‌سوکت آنی و بدون بافرینگ",
            },
            {
                "layer": "Windows Desktop Agent (اتاق فرمان دسکتاپ)",
                "role": "داشبورد شیشه‌ای بومی (Tauri v2 + Rust) با گیت تایید ۳ حالته و کنترل بومی سیستم‌عامل",
            },
            {
                "layer": "Mobile Companion Node (کلاینت همراه اندروید)",
                "role": "پل ارتباطی از راه دور با چراغ LED زنده وضعیت و رله مستقیم دستورات به ویندوز",
            },
        ],
        "cognitive_pillars": {
            "prompt_caching": "کش هوشمند پرامپت با اثر انگشت SHA256 جهت افزایش سرعت و کاهش هزینه",
            "rtk_compression": "فشرده‌سازی خروجی ابزارها با ذخیره‌ساز توکن RTK (صرفه‌جویی ۲۰٪ الی ۴۰٪)",
            "cascade_router": "آبشار هوشمند ۴ لایه: اشتراک‌ها → ارزان‌قیمت → مدل‌های رایگان نامحدود → مدل‌های لوکال",
            "seamless_handoff": "انتقال بدون وقفه و ادامه‌دار وظایف بین موبایل، ویندوز و کلاستر سرورها",
        },
    }

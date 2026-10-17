"""OmniOps Model Catalog & Capability Categorization Registry.

Provides rich metadata, token context window specs, Persian comments, and
capability categorization for both local (Ollama) and cloud (Gemini, OpenRouter, OpenAI, Anthropic) models.
"""

from typing import Any, Dict, List, Optional
import re


# Model categories definition
CATEGORIES = {
    "coding": {
        "id": "coding",
        "title": "برنامه‌نویسی و کدنویسی",
        "icon": "💻",
        "badge_color": "#06b6d4",
        "description": "تخصصی در نگارش، اصلاح، معماری نرم‌افزار و خطایابی کدها."
    },
    "reasoning": {
        "id": "reasoning",
        "title": "استدلال عمیق و منطق",
        "icon": "🧠",
        "badge_color": "#8b5cf6",
        "description": "حل مسائل پیچیده، استدلال گام‌به‌گام ریاضی، مهندسی و تحلیل منطقی."
    },
    "fast_chat": {
        "id": "fast_chat",
        "title": "گفتگوی روزمره و فوق‌سریع",
        "icon": "⚡",
        "badge_color": "#10b981",
        "description": "پاسخ‌دهی آنی، مکالمات سبک، نگارش متن و خلاصه‌سازی بدون معطلی."
    },
    "general": {
        "id": "general",
        "title": "چندمنظوره و درک متن",
        "icon": "🌐",
        "badge_color": "#f59e0b",
        "description": "دانش عمومی گسترده، ترجمه چندزبانه و پردازش متون متنوع."
    },
    "vision": {
        "id": "vision",
        "title": "چندرسانه‌ای و تحلیل تصویر",
        "icon": "👁️",
        "badge_color": "#ec4899",
        "description": "درک تصاویر، اسناد تصویری و پردازش نمودارها."
    }
}


# Pre-defined metadata catalog for popular models
CATALOG_DEFINITIONS: Dict[str, Dict[str, Any]] = {
    # Special Auto Router
    "auto": {
        "name": "موتور هوشمند JRV (انتخاب خودکار)",
        "category": "reasoning",
        "speed": "پویا / خودکار",
        "context_window": "بسته به مدل منتخب",
        "context_tokens": 1000000,
        "comment": "موتور تصمیم‌گیری JRV هوشمند: متن پیام شما را تحلیل کرده و به صورت خودکار بین مدل‌های لوکال و ابری بهترین گزینه را بر اساس موضوع، کدنویسی و نیاز به استدلال انتخاب می‌کند.",
        "recommended_for": ["تصمیم‌گیری خودکار بین لوکال و آنلاین", "سوییچ هوشمند بر اساس موضوع گفتگو", "صرفه‌جویی در هزینه و زمان"]
    },

    # --- Local Ollama Models ---
    "qwen2.5": {
        "name": "کوین ۲.۵ (Qwen 2.5)",
        "category": "general",
        "speed": "سریع",
        "context_window": "۱۲۸,۰۰۰ توکن",
        "context_tokens": 128000,
        "comment": "قدرتمندترین مدل متن‌باز در پشتیبانی از زبان فارسی و کدنویسی عمومی؛ تعادل عالی میان دقت، ادب زبانی و سرعت.",
        "recommended_for": ["گفتگو به زبان فارسی", "نگارش و ویرایش متون", "کدنویسی عمومی"]
    },
    "qwen2.5-coder": {
        "name": "کوین کدر ۲.۵ (Qwen 2.5 Coder)",
        "category": "coding",
        "speed": "سریع",
        "context_window": "۱۲۸,۰۰۰ توکن",
        "context_tokens": 128000,
        "comment": "نسخهٔ کاملاً اختصاصی‌شده برای مهندسی نرم‌افزار، تولید تست و رفع باگ با تسلط بر ده‌ها زبان برنامه‌نویسی مدرن.",
        "recommended_for": ["تولید کدهای پایتون، جاوااسکریپت و وب", "ریفکتور و دیباگ پروژه", "معماری ماژول‌ها"]
    },
    "deepseek-r1": {
        "name": "دیپ‌سیک آر-۱ (DeepSeek R1)",
        "category": "reasoning",
        "speed": "متمرکز و تحلیلی",
        "context_window": "۶۴,۰۰۰ توکن",
        "context_tokens": 64000,
        "comment": "مدل استدلال استنتاجی با قابلیت تفکر گام‌به‌گام (Chain-of-Thought) برای حل مسائل پیچیده الگوریتمی، ریاضی و فلسفی.",
        "recommended_for": ["حل مسائل ریاضی و الگوریتمی", "استدلال منطقی و گام‌به‌گام", "طراحی سیستم‌های پیچیده"]
    },
    "llama3.1": {
        "name": "متا لاما ۳.۱ (Llama 3.1)",
        "category": "general",
        "speed": "سریع",
        "context_window": "۱۲۸,۰۰۰ توکن",
        "context_tokens": 128000,
        "comment": "استاندارد مرجع هوش مصنوعی متن‌باز از شرکت متا؛ دانشنامه‌ای قوی و تحلیلی برای طیف وسیعی از امور روزمره.",
        "recommended_for": ["پاسخ به سوالات علمی و عمومی", "خلاصه‌سازی اسناد", "ترجمه و نگارش"]
    },
    "llama3.2": {
        "name": "متا لاما ۳.۲ سبک (Llama 3.2)",
        "category": "fast_chat",
        "speed": "فوق‌سریع",
        "context_window": "۱۲۸,۰۰۰ توکن",
        "context_tokens": 128000,
        "comment": "نسخه سبک و فوق‌سریع لاما مناسب سیستم‌های با منابع محدود؛ زمان پاسخ‌دهی بسیار اندک و مصرف رم ناچیز.",
        "recommended_for": ["گفتگوهای سریع روزمره", "اجرا روی سرورهای سبک", "پاسخ فوری به پیام‌ها"]
    },
    "phi4": {
        "name": "مایکروسافت فی-۴ (Phi-4)",
        "category": "reasoning",
        "speed": "فوق‌سریع",
        "context_window": "۱۶,۰۰۰ توکن",
        "context_tokens": 16000,
        "comment": "شاهکار فشرده‌سازی مایکروسافت؛ توانایی استدلال ریاضی و منطقی باورنکردنی در اندازه کوچک و بدون نیاز به کارت گرافیک سنگین.",
        "recommended_for": ["استدلال منطقی فشرده", "ریاضیات و منطق", "محیط‌های کم‌منبع"]
    },
    "mistral": {
        "name": "میسترال ۷ بی (Mistral 7B)",
        "category": "general",
        "speed": "سریع",
        "context_window": "۳۲,۰۰۰ توکن",
        "context_tokens": 32000,
        "comment": "مدل اروپایی محبوب با نگارش فصیح، پاسخ‌های روان و کارایی بالا در درک دستورالعمل‌های چندمرحله‌ای.",
        "recommended_for": ["دستورات چندمرحله‌ای", "نگارش متون انگلیسی و فرانسه", "خلاصه‌سازی"]
    },

    # --- Cloud Gemini Models ---
    "gemini-2.5-flash": {
        "name": "گوگل جمنای ۲.۵ فلش",
        "category": "fast_chat",
        "speed": "فوق‌سریع",
        "context_window": "۱,۰۰۰,۰۰۰ توکن",
        "context_tokens": 1000000,
        "comment": "جدیدترین شاهکار چندرسانه‌ای گوگل؛ سرعت شگفت‌انگیز، درک عالی زبان فارسی، همراه با بافت عظیم ۱ میلیون توکن.",
        "recommended_for": ["گفتگوی فوق‌سریع و روان", "تحلیل کتاب‌ها و اسناد بزرگ", "پاسخ‌دهی آنی به زبان فارسی"]
    },
    "gemini-2.5-flash-lite": {
        "name": "گوگل جمنای ۲.۵ فلش لایت",
        "category": "fast_chat",
        "speed": "آنی / فوق‌سریع",
        "context_window": "۱,۰۰۰,۰۰۰ توکن",
        "context_tokens": 1000000,
        "comment": "کم‌مصرف‌ترین و اقتصادی‌ترین مدل گوگل؛ فوق‌العاده سریع با حداقل تأخیر شبکه برای مکالمات کوتاه و چت‌های مداوم.",
        "recommended_for": ["ارزان‌ترین نرخ توکن", "چت‌های کوتاه و روزمره", "کمترین زمان تأخیر"]
    },
    "gemini-2.5-pro": {
        "name": "گوگل جمنای ۲.۵ پرو",
        "category": "reasoning",
        "speed": "متمرکز و تحلیلی",
        "context_window": "۲,۰۰۰,۰۰۰ توکن",
        "context_tokens": 2000000,
        "comment": "قدرتمندترین غول استدلال گوگل؛ با پنجره بافت خارق‌العاده ۲ میلیون توکن، توانایی تحلیل کامل کدهای یک مخزن یا ده‌ها جلد کتاب را داراست.",
        "recommended_for": ["تحلیل مخازن کامل کد و معماری نرم‌افزار", "استدلال سطح دکتری", "اسناد حقوقی و فنی فوق‌سنگین"]
    },
    "gemini-1.5-flash": {
        "name": "گوگل جمنای ۱.۵ فلش",
        "category": "fast_chat",
        "speed": "فوق‌سریع",
        "context_window": "۱,۰۰۰,۰۰۰ توکن",
        "context_tokens": 1000000,
        "comment": "مدل سریع و پایدار گوگل برای گفتگوهای فارسی، درک ساختار داده‌ها و خلاصه‌سازی با پنجره بافت یک میلیون توکن.",
        "recommended_for": ["گفتگوی روزمره", "خلاصه‌سازی متن", "پاسخ سریع"]
    },
    "gemini-1.5-pro": {
        "name": "گوگل جمنای ۱.۵ پرو",
        "category": "reasoning",
        "speed": "تحلیلی",
        "context_window": "۲,۰۰۰,۰۰۰ توکن",
        "context_tokens": 2000000,
        "comment": "نسخه پیشرفته استدلال و کدنویسی با ظرفیت ۲ میلیون توکن ورودی برای حل چالش‌های عمیق.",
        "recommended_for": ["برنامه‌نویسی پیشرفته", "تحلیل پایگاه‌داده", "استدلال چندمرحله‌ای"]
    },

    # --- Cloud OpenRouter / OpenAI / Anthropic Models ---
    "claude-3.5-sonnet": {
        "name": "آنتروپیک کلود ۳.۵ سانِت",
        "category": "coding",
        "speed": "سریع",
        "context_window": "۲۰۰,۰۰۰ توکن",
        "context_tokens": 200000,
        "comment": "پرچم‌دار جهانی در برنامه‌نویسی، معماری نرم‌افزار و نگارش انسان‌گونه؛ بهترین درک از ظرافت‌های دستوری.",
        "recommended_for": ["بهترین مدل کدنویسی در دنیا", "طراحی رابط کاربری و فرانت‌اند", "نگارش تخصصی"]
    },
    "gpt-4o": {
        "name": "اوپن‌ای‌آی جی‌پی‌تی ۴-او (GPT-4o)",
        "category": "general",
        "speed": "سریع",
        "context_window": "۱۲۸,۰۰۰ توکن",
        "context_tokens": 128000,
        "comment": "مدل چندرسانه‌ای همه‌کاره OpenAI؛ پیشتاز در حل مسائل چندرشته‌ای و ارائه‌دهنده پاسخ‌های جامع و ساختاریافته.",
        "recommended_for": ["تحلیل عمومی پیشرفته", "درک سناریوهای تجاری", "کدنویسی چندمنظوره"]
    },
    "gpt-4o-mini": {
        "name": "جی‌پی‌تی ۴-او مینی (GPT-4o Mini)",
        "category": "fast_chat",
        "speed": "فوق‌سریع",
        "context_window": "۱۲۸,۰۰۰ توکن",
        "context_tokens": 128000,
        "comment": "نسخه پرسرعت و مقرون‌به‌صرفه GPT-4o؛ عملکرد فوق‌العاده در مکالمه روزمره با هزینه توکن بسیار پایین.",
        "recommended_for": ["مکالمات سریع", "پاسخ‌دهی به تیکت‌ها", "کمترین هزینه"]
    },
    "o1": {
        "name": "اوپن‌ای‌آی او-وان (OpenAI o1)",
        "category": "reasoning",
        "speed": "متمرکز و گام‌به‌گام",
        "context_window": "۱۲۸,۰۰۰ توکن",
        "context_tokens": 128000,
        "comment": "مدل انقلابی استدلال فکری مستقل؛ انجام محاسبات پنهان پیش از پاسخ برای کاهش خطای توهم (Hallucination).",
        "recommended_for": ["ریاضیات رقابتی و دانشگاهی", "کدنویسی الگوریتمی سخت", "استدلال حقوقی و علمی"]
    }
}


def get_model_metadata(model_id: str) -> Dict[str, Any]:
    """Resolves rich metadata and comments for any given model identifier.

    Works gracefully for:
    - Ollama models: e.g. 'qwen2.5:latest', 'ollama/deepseek-r1:7b'
    - Gemini models: e.g. 'gemini/gemini-2.5-flash'
    - OpenRouter models: e.g. 'openrouter/anthropic/claude-3.5-sonnet'
    - Arbitrary/unlisted models: automatically categorized based on heuristics.
    """
    clean_id = (model_id or "").strip()
    if clean_id.lower() == "auto":
        base = dict(CATALOG_DEFINITIONS["auto"])
        cat = CATEGORIES[base["category"]]
        base.update({
            "id": "auto",
            "category_label": cat["title"],
            "category_icon": cat["icon"],
            "badge_color": cat["badge_color"],
            "provider": "auto",
        })
        return base

    # Strip provider prefix if present
    provider = "ollama"
    sub_id = clean_id
    if "/" in clean_id:
        provider, sub_id = clean_id.split("/", 1)

    # Normalize name (remove tags like :latest, :7b for lookup)
    norm = sub_id.lower()
    norm_no_tag = re.sub(r":.*$", "", norm)
    leaf_name = norm_no_tag.split("/")[-1]

    # Find matching catalog definition
    matched_key = None
    if norm in CATALOG_DEFINITIONS:
        matched_key = norm
    elif norm_no_tag in CATALOG_DEFINITIONS:
        matched_key = norm_no_tag
    elif leaf_name in CATALOG_DEFINITIONS:
        matched_key = leaf_name
    else:
        # Check partial prefix / substring matches
        for key in CATALOG_DEFINITIONS:
            if key == "auto":
                continue
            if key in norm or key in leaf_name:
                matched_key = key
                break

    if matched_key and matched_key in CATALOG_DEFINITIONS:
        meta = dict(CATALOG_DEFINITIONS[matched_key])
    else:
        # Heuristic categorization for unlisted/custom models
        lower = clean_id.lower()
        if any(tok in lower for tok in ("code", "coder", "dev", "program", "sql")):
            category = "coding"
            speed = "سریع"
            ctx = "۱۲۸,۰۰۰ توکن"
            ctx_tokens = 128000
            comment = "مدل تخصصی برنامه‌نویسی و مهندسی نرم‌افزار."
        elif any(tok in lower for tok in ("reason", "r1", "math", "o1", "o3", "think")):
            category = "reasoning"
            speed = "متمرکز و تحلیلی"
            ctx = "۶۴,۰۰۰ توکن"
            ctx_tokens = 64000
            comment = "مدل تخصصی استدلال عمیق و تفکر گام‌به‌گام منطقی."
        elif any(tok in lower for tok in ("flash", "mini", "light", "lite", "small", "0.5b", "1b", "3b")):
            category = "fast_chat"
            speed = "فوق‌سریع"
            ctx = "۱۲۸,۰۰۰ توکن"
            ctx_tokens = 128000
            comment = "مدل پرسرعت و سبک مناسب پاسخ‌دهی آنی به مکالمات روزمره."
        elif any(tok in lower for tok in ("vision", "vl", "multimodal", "image")):
            category = "vision"
            speed = "سریع"
            ctx = "۱۲۸,۰۰۰ توکن"
            ctx_tokens = 128000
            comment = "مدل چندرسانه‌ای با قابلیت پردازش متن و تصویر."
        else:
            category = "general"
            speed = "سریع"
            ctx = "۳۲,۰۰۰ توکن"
            ctx_tokens = 32000
            comment = "مدل چندمنظوره برای گفتگو، پردازش متون و پاسخ به پرسش‌های عمومی."

        meta = {
            "name": sub_id.replace("-", " ").title(),
            "category": category,
            "speed": speed,
            "context_window": ctx,
            "context_tokens": ctx_tokens,
            "comment": comment,
            "recommended_for": ["کاربردهای عمومی و تخصصی"]
        }

    cat_info = CATEGORIES.get(meta["category"], CATEGORIES["general"])
    meta.update({
        "id": clean_id,
        "label": meta["name"],
        "clean_name": sub_id,
        "provider": provider,
        "category_label": cat_info["title"],
        "category_icon": cat_info["icon"],
        "badge_color": cat_info["badge_color"],
        "token_label": meta["context_window"],
    })
    return meta


def build_models_catalog(model_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    """Builds a complete catalog map dictionary for a list of model IDs."""
    result: Dict[str, Dict[str, Any]] = {}
    # Ensure "auto" is included as the primary intelligent routing entry
    result["auto"] = get_model_metadata("auto")
    for mid in model_ids:
        if mid and mid != "auto":
            result[mid] = get_model_metadata(mid)
    return result

"""OmniOps System Persona, Knowledge Grounding, and Persian Tone Engine.

Provides centralized management for AI identity, system capabilities knowledge,
Persian orthography rules (half-space, diacritics/اعراب‌گذاری, vocabulary disambiguation),
and standard prompt templates inspired by Hazm, Virastyar, and Persian NLP frameworks.
"""

import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


# Default directory and storage location
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
PERSONA_CONFIG_PATH = DATA_DIR / "persona_config.json"


# -----------------------------------------------------------------------------
# Persian NLP Normalization Utilities (Inspired by Hazm & Virastyar standards)
# -----------------------------------------------------------------------------

ZWNJ = "\u200c"  # Zero-Width Non-Joiner (نیم‌فاصله)

ARABIC_TO_PERSIAN_CHARS = {
    "ي": "ی",
    "ى": "ی",
    "ك": "ک",
    "ۀ": "ه‌ی",
    "ة": "ت",
    "ؤ": "و",
    "إ": "ا",
    "أ": "ا",
    "ء": "",
}

ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"
PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
ENGLISH_DIGITS = "0123456789"

DIGIT_MAP = str.maketrans(ARABIC_DIGITS, PERSIAN_DIGITS)


def normalize_persian_text(text: str) -> str:
    """Normalizes Persian characters, half-spaces (نیم‌فاصله), and orthography."""
    if not text or not isinstance(text, str):
        return ""

    # Protect code blocks and inline code
    code_blocks: List[str] = []

    def _save_block(match: re.Match[str]) -> str:
        code_blocks.append(match.group(0))
        return f"__OMNIOPS_CODE_{len(code_blocks) - 1}__"

    text = re.sub(r"```[\s\S]*?```|`[^`\n]+`", _save_block, text)

    # 1. Translate Arabic specific characters to Persian standard
    for ar_char, fa_char in ARABIC_TO_PERSIAN_CHARS.items():
        text = text.replace(ar_char, fa_char)

    # 2. Normalize Arabic digits to Persian
    text = text.translate(DIGIT_MAP)

    # 3. Standardize Zero-Width Non-Joiner (ZWNJ) around prefixes and suffixes
    # Prefix 'می' and 'نمی'
    text = re.sub(r"(^|\s)(می|نمی)\s+", rf"\1\2{ZWNJ}", text)

    # Suffix 'ها', 'های', 'هایی', 'هایم', 'هایت', 'هایش', 'هایمان', 'هایتان', 'هایشان'
    text = re.sub(r"\s+(ها|های|هایی|هایم|هایت|هایش|هایمان|هایتان|هایشان)(\s|[.,!؟؛:]|$)", rf"{ZWNJ}\1\2", text)

    # Suffix 'تر', 'ترین', 'تری'
    text = re.sub(r"\s+(تر|ترین|تری)(\s|[.,!؟؛:]|$)", rf"{ZWNJ}\1\2", text)

    # Suffix 'ام', 'ات', 'اش', 'مان', 'تان', 'شان' after specific words or vowels
    text = re.sub(r"([ابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی])\s+(ام|ات|اش|مان|تان|شان)(\s|[.,!؟؛:]|$)", rf"\1{ZWNJ}\2\3", text)

    # Clean multiple consecutive spaces or redundant ZWNJ
    text = re.sub(rf"{ZWNJ}+", ZWNJ, text)
    text = re.sub(r"[ \t]+", " ", text)

    # Restore code blocks intact
    for idx, block in enumerate(code_blocks):
        text = text.replace(f"__OMNIOPS_CODE_{idx}__", block)

    return text.strip()


# -----------------------------------------------------------------------------
# Default OmniOps System Persona & Comprehensive Knowledge Template
# -----------------------------------------------------------------------------

DEFAULT_SYSTEM_PERSONA_TEMPLATE = """# هویت رسمی و دستورالعمل بنیادین دستیار هوشمند OmniOps AI

شما دستیار هوشمند مهندسی و ارکستراتور زیرساختی سامانه جامع **OmniOps AI** هستید. هویت، لحن کلامی و پایگاه دانشی شما به شرح زیر غیرقابل‌نقض است:

## ۱. هویت مستقل و رد ادعای مدل‌های پایه (Identity Anchor)
- **نام شما:** OmniOps AI (دستیار هوشمند مدیریت زیرساخت، دواپس و توسعه نرم‌افزار OmniOps).
- **قانون حیاتی و غیرقابل‌نقض:** تحت هیچ شرایطی نباید بگویید «من یک مدل زبانی بزرگ توسعه‌داده‌شده توسط OpenAI / Google / Meta / Alibaba / Anthropic هستم». شما مستقلاً هسته تحلیلی و مهندسی پلتفرم OmniOps هستید که بر روی کلاسترهای توزیع‌شده محلی و ابری این سازمان مستقر شده‌اید.
- اگر کاربر درباره هویت، سازنده، یا مدل زیربنایی سوال کرد، با احترام و اقتدار مهندسی پاسخ دهید:
  «من OmniOps AI، دستیار هوشمند و ایجنتی بستر عملیاتی و مهندسی OmniOps هستم. برای پایش زیرساخت، اتوماسیون وظایف، برنامه‌نویسی و مدیریت خوشه‌های پردازشی طراحی شده‌ام.»

## ۲. پایگاه دانش معماری و قابلیت‌های سیستم (OmniOps Architecture Knowledge)
هنگام پاسخ به سوالات فنی یا سازمانی، اطلاعات جامع زیر را همواره به یاد داشته باشید تا هرگز اطلاعات ناقص یا نادرست ندهید:
- **معماری پلتفرم:** پلتفرم دوگانه هیبریدی شامل سرور مرکزی لینوکس/اوبونتو، گره‌های عملیاتی Worker محلی، و پروکسی‌های اختصاصی SOCKS5.
- **گره محلی Ollama Worker (OmniOps-02):** سرور پردازش محلی روی شبکه داخلی با پورت ۱۱۴۳۴ و بیش از ۸ مدل فعال (مانند Qwen2.5-Coder، LLaMA 3.3، DeepSeek و غیره) با تأخیر کمتر از ۱۵ میلی‌ثانیه.
- **کلاینت‌های متصل:**
  1. **OmniOps Studio (نسخه دسکتاپ بومی ویندوز):** کلاینت فوق‌مدرن و سبک با قابلیت اتصال به فایل‌های محلی، ترمینال، و پیش‌نمایش درجا.
  2. **OmniOps Companion (اپلیکیشن اندروید):** اپ موبایل برای پایش سلامت سرورها، تایید بیومتریک فرامین پرخطر، و کلید قطع اضطراری (Kill-Switch).
  3. **وب‌اپلیکیشن واکنش‌گرا:** داشبورد جامع با تب‌های «دستیار هوشمند»، «دانلود کلاینت‌ها» و «کنسول مدیریت» به همراه ابزار پایش زنده لاگ‌ها (Live Log Viewer) و پلیر یادداشت‌های صوتی (Voice Note Player با Whisper STT).
- **موتور روتینگ هوشمند (JRV Router):** ارزیابی لحظه‌ای پرامپت‌ها، اولویت‌دهی به پردازش محلی با حریم خصوصی ۱۰۰٪، و هدایت منعطف به مدل‌های ابری تنها در صورت نیاز و رضایت صریح.
- **لنگر زمانی و تقویم:** اطلاعات تاریخ امروز هجری شمسی و میلادی، ساعات، و نتایج جستجوی زنده وب به‌صورت پیش‌فرض برای شما متصل است.

## ۳. استاندارد نگارش، خط و لحن فاخر فارسی (Persian Orthography & Tone)
- **لحن کلامی:** رسمی، مهندسی، محترمانه، دقیق، موجز و بدون تعارفات زاید.
- **پرهیز از کلیشه‌های تکراری:** هرگز جملات خود را با عبارات کلیشه‌ای مانند «حتماً! در ادامه پاسخ شما آورده شده است»، «به عنوان یک مدل زبانی»، یا «امیدوارم این اطلاعات مفید باشد» آغاز نکنید. مستقیماً به اصل موضوع و راه‌حل بپردازید.
- **رعایت دقیق نیم‌فاصله (Zero-Width Non-Joiner):** در تمامی افعال پیشوندی (می‌شود، نمی‌تواند)، نشانه‌های جمع (سرورها، کلاسترها)، و پسوندهای تفضیلی (سریع‌تر، بهینه‌ترین) حتماً نیم‌فاصله را رعایت کنید.
- **اعراب‌گذاری و رفع ابهام واژگان تخصصی (Diacritization):** در کلمات فنی، دوپهلو، یا نام‌های خاص چندمعنایی (مانند مِلک/مُلک، نَشَست/نِشَست، سِمَت/سَمت، کُد/کَد)، از حرکات و اعراب‌گذاری صحیح (فتحه َ، کسره ِ، ضمه ُ، تنوین ً، تشدید ّ) استفاده کنید تا خوانش و تبدیل گفتار به متن (TTS) بدون خطا باشد.
- **ساختار پاسخ‌ها:** از تیترهای خوانا، بولت‌پوینت‌های تفکیک‌شده، و بلوک‌های کد مستند همراه با نام زبان برنامه‌نویسی استفاده کنید.

---
[وضعیت زنده سرورها و زیرساخت OmniOps]:
{live_system_context}
"""


class PersonaManager:
    """Manages system persona, knowledge injection, and Persian tone settings."""

    def __init__(self, config_path: Optional[Any] = None):
        self.config_path = Path(config_path) if config_path else PERSONA_CONFIG_PATH
        self._ensure_storage()
        self.config = self._load()

    def _ensure_storage(self) -> None:
        try:
            self.config_path.parent.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass

    def _load(self) -> Dict[str, Any]:
        if self.config_path.exists():
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict) and "template" in data:
                        return data
            except Exception:
                pass

        # Return default configuration
        default_config = {
            "enabled": True,
            "template": DEFAULT_SYSTEM_PERSONA_TEMPLATE,
            "system_name": "OmniOps AI",
            "normalize_persian": True,
            "enforce_tone_rules": True,
            "diacritics_assistance": True,
            "updated_at": 1792261000,
            "version": "1.0.0",
        }
        self._save(default_config)
        return default_config

    def _save(self, data: Dict[str, Any]) -> None:
        try:
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def get_config(self) -> Dict[str, Any]:
        """Returns current persona configuration and variables."""
        return dict(self.config)

    def update_config(
        self,
        template: Optional[str] = None,
        enabled: Optional[bool] = None,
        normalize_persian: Optional[bool] = None,
        diacritics_assistance: Optional[bool] = None,
        system_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Updates persona template and tone rules."""
        import time

        if template is not None:
            clean_tmpl = str(template).strip()
            if len(clean_tmpl) < 20 or len(clean_tmpl) > 24000:
                raise ValueError("Persona template must be between 20 and 24,000 characters.")
            self.config["template"] = clean_tmpl

        if enabled is not None:
            self.config["enabled"] = bool(enabled)

        if normalize_persian is not None:
            self.config["normalize_persian"] = bool(normalize_persian)

        if diacritics_assistance is not None:
            self.config["diacritics_assistance"] = bool(diacritics_assistance)

        if system_name is not None and str(system_name).strip():
            self.config["system_name"] = str(system_name).strip()[:100]

        self.config["updated_at"] = int(time.time())
        self._save(self.config)
        return self.get_config()

    def reset_to_default(self) -> Dict[str, Any]:
        """Resets the persona template to the official OmniOps default."""
        import time

        self.config["template"] = DEFAULT_SYSTEM_PERSONA_TEMPLATE
        self.config["enabled"] = True
        self.config["normalize_persian"] = True
        self.config["enforce_tone_rules"] = True
        self.config["diacritics_assistance"] = True
        self.config["system_name"] = "OmniOps AI"
        self.config["updated_at"] = int(time.time())
        self._save(self.config)
        return self.get_config()

    def render_system_prompt(self, dynamic_context: Optional[str] = None) -> str:
        """Renders the system prompt with live system context populated."""
        if not self.config.get("enabled", True):
            return ""

        template = self.config.get("template", DEFAULT_SYSTEM_PERSONA_TEMPLATE)

        # Context placeholder replacement
        ctx_str = dynamic_context if dynamic_context else "تمام سرویس‌های هسته و گره‌های محلی در وضعیت آنلاین قرار دارند."
        rendered = template.replace("{live_system_context}", ctx_str)
        rendered = rendered.replace("{system_name}", self.config.get("system_name", "OmniOps AI"))

        if self.config.get("normalize_persian", True):
            rendered = normalize_persian_text(rendered)

        return rendered.strip()

    def build_chat_messages(
        self,
        prompt: str,
        dynamic_context: Optional[str] = None,
        chat_history: Optional[List[Dict[str, str]]] = None,
    ) -> List[Dict[str, str]]:
        """Constructs the full message list with injected system persona as message 0."""
        messages: List[Dict[str, str]] = []

        system_prompt = self.render_system_prompt(dynamic_context)
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})

        # Append previous history if available
        if chat_history and isinstance(chat_history, list):
            for msg in chat_history[-6:]:
                if isinstance(msg, dict) and "role" in msg and "content" in msg:
                    role = msg["role"] if msg["role"] in ("user", "assistant") else "user"
                    messages.append({"role": role, "content": str(msg["content"])})

        # Normalize prompt if requested
        clean_prompt = prompt.strip()
        if self.config.get("normalize_persian", True):
            clean_prompt = normalize_persian_text(clean_prompt)

        messages.append({"role": "user", "content": clean_prompt})
        return messages


# Singleton instance
_persona_instance: Optional[PersonaManager] = None


def get_persona_manager() -> PersonaManager:
    """Returns the singleton PersonaManager instance."""
    global _persona_instance
    if _persona_instance is None:
        _persona_instance = PersonaManager()
    return _persona_instance

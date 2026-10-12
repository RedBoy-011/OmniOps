"""
OmniOps Multi-Provider & Multi-Key Online AI Gateway
مدیریت ارائه‌دهندگان ابری، چرخش خودکار کلیدها (Key Rotation) و سوئیچ در صورت خطا
"""
import time
import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional

logger = logging.getLogger("omniops.ai_gateway")

@dataclass
class ApiKeyEntry:
    key_id: str
    api_key: str
    label: str               # مثلا "اکانت اصلی مالی" یا "کلید پشتیبان ۲"
    is_active: bool = True
    usage_count: int = 0
    failure_count: int = 0
    last_used: float = 0.0

@dataclass
class OnlineProvider:
    provider_id: str         # "deepseek" | "openai" | "anthropic" | "gemini" | "custom"
    name: str
    base_url: str
    available_models: List[str]
    default_model: str
    keys: List[ApiKeyEntry] = field(default_factory=list)
    current_key_index: int = 0

class OnlineAIManager:
    def __init__(self):
        self.providers: Dict[str, OnlineProvider] = {
            "deepseek": OnlineProvider(
                provider_id="deepseek",
                name="DeepSeek Cloud API",
                base_url="https://api.deepseek.com/v1",
                available_models=["deepseek-chat", "deepseek-reasoner"],
                default_model="deepseek-chat",
            ),
            "openai": OnlineProvider(
                provider_id="openai",
                name="OpenAI Official",
                base_url="https://api.openai.com/v1",
                available_models=["gpt-4o", "gpt-4o-mini", "o1-preview"],
                default_model="gpt-4o-mini",
            ),
            "gemini": OnlineProvider(
                provider_id="gemini",
                name="Google Gemini AI",
                base_url="https://generativelanguage.googleapis.com/v1beta/openai",
                available_models=["gemini-1.5-flash", "gemini-1.5-pro"],
                default_model="gemini-1.5-flash",
            ),
            "openrouter": OnlineProvider(
                provider_id="openrouter",
                name="OpenRouter Multi-Model",
                base_url="https://openrouter.ai/api/v1",
                available_models=["anthropic/claude-3.5-sonnet", "meta-llama/llama-3.1-70b-instruct"],
                default_model="anthropic/claude-3.5-sonnet",
            ),
        }

    def add_api_key(self, provider_id: str, api_key: str, label: str) -> bool:
        """افزودن یک کلید جدید به لیست کلیدهای یک ارائه‌دهنده"""
        if provider_id not in self.providers:
            return False
        
        provider = self.providers[provider_id]
        key_entry = ApiKeyEntry(
            key_id=f"key_{len(provider.keys) + 1}",
            api_key=api_key,
            label=label,
        )
        provider.keys.append(key_entry)
        logger.info(f"کلید جدید '{label}' برای ارائه‌دهنده {provider.name} افزوده شد.")
        return True

    def get_active_key_and_rotate(self, provider_id: str) -> Optional[str]:
        """
        استخراج کلید فعال با مکانیزم چرخش هوشمند و رد کردن کلیدهای خراب
        """
        provider = self.providers.get(provider_id)
        if not provider or not provider.keys:
            return None

        # جستجوی کلید سالم با چرخش گردشی (Round-Robin)
        total_keys = len(provider.keys)
        for _ in range(total_keys):
            idx = provider.current_key_index % total_keys
            candidate = provider.keys[idx]
            provider.current_key_index = (provider.current_key_index + 1) % total_keys

            if candidate.is_active and candidate.failure_count < 3:
                candidate.usage_count += 1
                candidate.last_used = time.time()
                return candidate.api_key

        logger.error(f"تمامی کلیدهای ارائه‌دهنده {provider.name} منقضی شده یا با خطای سهمیه مواجه شده‌اند!")
        return None

    def mark_key_failed(self, provider_id: str, failed_key: str):
        """علامت‌گذاری کلید با خطا جهت سوئیچ فوری به کلید بعدی"""
        provider = self.providers.get(provider_id)
        if provider:
            for k in provider.keys:
                if k.api_key == failed_key:
                    k.failure_count += 1
                    logger.warning(f"کلید '{k.label}' از {provider.name} با خطا مواجه شد. خطای شماره {k.failure_count}")
                    if k.failure_count >= 3:
                        k.is_active = False
                        logger.critical(f"کلید '{k.label}' به دلیل خطاهای مکرر موقتاً غیرفعال شد.")

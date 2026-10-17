"""OmniOps JRV Intelligent Decision Engine & Multi-Provider Router.

Intelligently analyzes conversation prompt intent (coding, deep reasoning,
lightweight chat, long-context documents), scores local vs. cloud models,
and routes to the best model with full Persian explanations and resilient failover.
"""

from dataclasses import dataclass
from enum import Enum
from urllib.parse import urlsplit
from typing import Any, Dict, List, Optional, Tuple
import re

from .model_catalog import get_model_metadata


class ProviderKind(str, Enum):
    LOCAL = "local"
    EXTERNAL = "external"


class NetworkMode(str, Enum):
    INTERNAL = "internal"
    DIRECT = "direct"
    SOCKS = "socks"


@dataclass(frozen=True)
class Provider:
    provider_id: str
    kind: ProviderKind
    network_mode: NetworkMode
    enabled: bool = True
    healthy: bool = True
    socks_url: str | None = None


@dataclass(frozen=True)
class Model:
    model_id: str
    provider_id: str
    capabilities: frozenset[str]
    quality: int
    latency_ms: int
    cost_per_million: float
    enabled: bool = True
    healthy: bool = True


@dataclass(frozen=True)
class RoutingRequest:
    required_capabilities: frozenset[str] = frozenset({"text"})
    local_only: bool = True
    allow_external: bool = False
    require_socks_for_external: bool = False
    prefer_local: bool = True


class NoEligibleModel(ValueError):
    pass


def _valid_socks_url(url: str | None) -> bool:
    if not url:
        return False
    parsed = urlsplit(url)
    try:
        return parsed.scheme in ("socks5", "socks5h") and bool(parsed.hostname) and bool(parsed.port)
    except ValueError:
        return False


def _provider_eligible(provider: Provider, request: RoutingRequest) -> bool:
    if not provider.enabled or not provider.healthy:
        return False
    if provider.kind is ProviderKind.LOCAL:
        return provider.network_mode is NetworkMode.INTERNAL
    if request.local_only or not request.allow_external:
        return False
    if provider.network_mode is NetworkMode.SOCKS:
        return _valid_socks_url(provider.socks_url)
    return provider.network_mode is NetworkMode.DIRECT and not request.require_socks_for_external


def choose_model(
    providers: tuple[Provider, ...], models: tuple[Model, ...], request: RoutingRequest
) -> Model:
    """Az modelhaye mojaz va salem entekhab mikonad; dar gheyr-e in soorat khata midahad."""
    provider_index = {provider.provider_id: provider for provider in providers}
    eligible: list[tuple[int, Model]] = []
    for model in models:
        provider = provider_index.get(model.provider_id)
        if (
            provider is None
            or not model.enabled
            or not model.healthy
            or not request.required_capabilities.issubset(model.capabilities)
            or not _provider_eligible(provider, request)
        ):
            continue
        local_bonus = 30 if request.prefer_local and provider.kind is ProviderKind.LOCAL else 0
        score = model.quality * 10 + local_bonus - model.latency_ms // 100 - int(
            model.cost_per_million * 2
        )
        eligible.append((score, model))
    if not eligible:
        raise NoEligibleModel("No healthy model satisfies the data and network policy")
    eligible.sort(key=lambda item: (-item[0], item[1].model_id))
    return eligible[0][1]



# Regexes and keywords for intent classification
CODE_PATTERNS = [
    r"```[a-zA-Z0-9_-]*\n",
    r"\b(def|class|function|import|return|async|await|const|let|var)\b",
    r"\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|GROUP BY)\b",
    r"\b(docker|kubectl|systemctl|nginx|git|npm|pip|cargo)\b",
    r"(\{|\}|=>|===|!==|;|\[\]|\(\))",
    r"\b(error|traceback|exception|bug|syntaxerror|nullpointer|failed)\b",
]

CODE_PERSIAN_KEYWORDS = [
    "کد", "برنامه", "اسکریپت", "تابع", "ریفکتور", "دیباگ", "خطایاب", "کامپایل",
    "پایتون", "جاوااسکریپت", "تایپ‌اسکریپت", "سی‌شارپ", "فرانت‌اند", "بک‌اند",
    "کوئری", "دیتابیس", "الگوریتم", "گیت", "داکر", "ای‌پی‌آی", "api", "html", "css"
]

REASONING_PATTERNS = [
    r"\\(int|sum|prod|frac|sqrt|partial|alpha|beta|theta)",
    r"\b(prove|theorem|lemma|hypothesis|equation|derivative|integral)\b",
    r"[0-9]+\s*[\+\-\*\/\^]\s*[0-9]+",
]

REASONING_PERSIAN_KEYWORDS = [
    "اثبات", "معادله", "فرمول", "مسئله", "ریاضی", "حل کن", "چرا دقیقاً",
    "استدلال", "منطق", "گام‌به‌گام", "گام به گام", "ریشه", "احتمال", "تحلیل عمیق",
    "برهان", "فلسفه", "مقایسه فلسفی", "استنتاج", "محاسبه کن"
]

LIGHTWEIGHT_PERSIAN_KEYWORDS = [
    "سلام", "درود", "خوبی", "چطوری", "صبح بخیر", "عصر بخیر", "شب بخیر",
    "خسته نباشی", "تو کی هستی", "معرفی کن", "تشکر", "ممنون", "مرسی",
    "خلاصه کوتاه", "یک جمله بگو", "تعریف کن"
]

REALTIME_SEARCH_KEYWORDS = [
    "امروز", "الان", "تاریخ", "ساعت", "قیمت", "دلار", "ارز", "طلا", "سکه",
    "بیت‌کوین", "بیت کوین", "اخبار", "جدیدترین", "لحظه‌ای", "آب و هوا",
    "وضعیت بازار", "آخرین نرخ", "قیمت روز", "نرخ روز", "today", "news", "price"
]


class JRVRouter:
    """Intelligent multi-provider routing and arbitration engine."""

    @staticmethod
    def ground_prompt(prompt: str) -> Tuple[str, Dict[str, Any]]:
        """Augments prompt with live temporal and web grounding context."""
        from .web_search import build_grounded_context
        return build_grounded_context(prompt)

    @staticmethod
    def classify_intent(prompt: str) -> Dict[str, Any]:
        text = (prompt or "").strip()
        lower = text.lower()
        length = len(text)

        signals: List[str] = []
        code_score = 0
        reasoning_score = 0
        lightweight_score = 0
        search_score = 0

        # Code detection
        for pat in CODE_PATTERNS:
            matches = re.findall(pat, text, re.IGNORECASE)
            if matches:
                code_score += min(len(matches), 3) * 1.5
        for kw in CODE_PERSIAN_KEYWORDS:
            if kw in lower:
                code_score += 1.5

        if code_score >= 2:
            signals.append("تشخیص عناصر برنامه‌نویسی و ساختار کد")

        # Reasoning detection
        for pat in REASONING_PATTERNS:
            matches = re.findall(pat, text, re.IGNORECASE)
            if matches:
                reasoning_score += min(len(matches), 3) * 1.5
        for kw in REASONING_PERSIAN_KEYWORDS:
            if kw in lower:
                reasoning_score += 1.5

        if reasoning_score >= 2:
            signals.append("تشخیص نیازمندی به تفکر منطقی و محاسباتی")

        # Real-time search & temporal detection
        for kw in REALTIME_SEARCH_KEYWORDS:
            if kw in lower:
                search_score += 2
        if search_score >= 2:
            signals.append("نیاز به اطلاعات زنده، تاریخ/ساعت یا وب‌سرچ")

        # Long document detection
        is_long = length >= 3500
        if is_long:
            signals.append(f"طول بافت حجیم ({length:,} کاراکتر)")

        # Fast/Lightweight detection
        for kw in LIGHTWEIGHT_PERSIAN_KEYWORDS:
            if kw in lower:
                lightweight_score += 2
        if lightweight_score >= 2:
            signals.append("پیام کوتاه و گفتگوی روزمره")

        # Determine dominant intent
        if is_long:
            intent = "long_context"
        elif code_score >= 2 and code_score >= reasoning_score and code_score >= search_score:
            intent = "coding"
        elif reasoning_score >= 2 and reasoning_score >= search_score:
            intent = "reasoning"
        elif lightweight_score >= 4 and lightweight_score > search_score:
            intent = "fast_chat"
        elif search_score >= 2:
            intent = "realtime_search"
        elif lightweight_score >= 2 or (length <= 60 and code_score == 0 and reasoning_score == 0 and search_score == 0):
            intent = "fast_chat"
        else:
            intent = "general"

        return {
            "intent": intent,
            "code_score": code_score,
            "reasoning_score": reasoning_score,
            "search_score": search_score,
            "lightweight_score": lightweight_score,
            "length": length,
            "signals": signals
        }

    @classmethod
    def choose_model(
        cls,
        prompt: str,
        available_models: List[str],
        allow_external: bool = True
    ) -> Tuple[str, str, List[str]]:
        """Selects the best model given the prompt and available models.

        Returns:
            Tuple of (selected_model_id, routing_explanation_fa, fallback_chain)
        """
        # Filter out "auto" from consideration list
        candidates = [m for m in available_models if m and m != "auto"]
        if not candidates:
            raise ValueError("هیچ مدلی (لوکال یا ابری) در دسترس نیست.")

        # If only one candidate is installed/enabled, return it directly
        if len(candidates) == 1:
            meta = get_model_metadata(candidates[0])
            return (
                candidates[0],
                f"تنها یک مدل فعال است: {meta['name']} ({meta['category_label']})",
                []
            )

        analysis = cls.classify_intent(prompt)
        intent = analysis["intent"]

        # Score every available model based on intent and properties
        scored: List[Tuple[float, str, Dict[str, Any]]] = []

        for model_id in candidates:
            meta = get_model_metadata(model_id)
            score = 0.0
            is_cloud = model_id.startswith(("gemini/", "openrouter/", "openai/", "anthropic/"))

            # If user hasn't allowed cloud models, penalize cloud to zero
            if is_cloud and not allow_external:
                continue

            cat = meta.get("category", "general")
            speed = meta.get("speed", "سریع")
            tokens = meta.get("context_tokens", 32000)

            # Intent alignment
            if intent == "coding":
                if cat == "coding":
                    score += 100.0
                elif cat == "reasoning":
                    score += 60.0
                elif cat == "general":
                    score += 30.0

                # Specific renowned coding models get boost
                if "sonnet" in model_id.lower() or "coder" in model_id.lower():
                    score += 25.0

            elif intent == "reasoning":
                if cat == "reasoning":
                    score += 100.0
                elif cat == "general":
                    score += 40.0
                elif cat == "coding":
                    score += 30.0

                if "r1" in model_id.lower() or "o1" in model_id.lower() or "pro" in model_id.lower():
                    score += 25.0

            elif intent == "long_context":
                if tokens >= 1000000:
                    score += 120.0
                elif tokens >= 128000:
                    score += 70.0
                else:
                    score += 10.0

            elif intent == "fast_chat":
                if "فوق‌سریع" in speed or "آنی" in speed:
                    score += 100.0
                elif speed == "سریع":
                    score += 60.0

                # Local models get privacy/latency boost for fast chat
                if not is_cloud:
                    score += 20.0
                elif "flash" in model_id.lower() or "mini" in model_id.lower():
                    score += 30.0

            elif intent == "realtime_search":
                if is_cloud:
                    score += 90.0
                    if "gemini" in model_id.lower():
                        score += 30.0
                    elif "flash" in model_id.lower():
                        score += 25.0
                else:
                    score += 50.0

            else:  # general
                if cat == "general":
                    score += 70.0
                elif cat == "fast_chat":
                    score += 60.0
                elif cat == "coding":
                    score += 40.0

            # Local privacy and zero-cost advantage when scores are comparable
            if not is_cloud:
                score += 10.0

            scored.append((score, model_id, meta))

        if not scored:
            # Fallback to first available candidate
            meta = get_model_metadata(candidates[0])
            return candidates[0], f"مسیریابی پیش‌فرض به {meta['name']}", candidates[1:]

        # Sort descending by score
        scored.sort(key=lambda x: x[0], reverse=True)
        best_score, best_id, best_meta = scored[0]

        # Generate friendly Persian reasoning explanation
        intent_fa_map = {
            "coding": "موضوع برنامه‌نویسی و کدهای نرم‌افزاری",
            "reasoning": "مسئله منطقی، ریاضی یا استدلال عمیق",
            "long_context": "متن طولانی با نیاز به پنجره بافت بالا",
            "fast_chat": "گفتگوی روزمره و پرسش سبک",
            "realtime_search": "اطلاعات زنده بستر، تاریخ/ساعت یا وب‌سرچ",
            "general": "موضوع عمومی و چندمنظوره"
        }
        intent_label = intent_fa_map.get(intent, "گفتگو")
        cloud_label = "سرویس ابری" if best_id.startswith(("gemini/", "openrouter/", "openai/", "anthropic/")) else "سرور محلی (Local)"

        explanation = (
            f"✨ انتخاب هوشمند موتور JRV: {intent_label} تشخیص داده شد. "
            f"مدل «{best_meta['name']}» از {cloud_label} "
            f"با سرعت «{best_meta.get('speed', 'سریع')}» و بافت «{best_meta.get('context_window', '')}» برگزیده شد."
        )

        fallback_chain = [item[1] for item in scored[1:]]
        return best_id, explanation, fallback_chain

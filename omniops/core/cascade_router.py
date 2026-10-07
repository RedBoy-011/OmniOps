"""Smart Cascade Router: routes queries intelligently across Multi-Tier Provider Chains:
Layer 1: Subscription / Premium (Claude Code / Sonnet 3.5, OpenAI Codex, Gemini Pro)
Layer 2: Low-Cost High-Yield (GLM-5, MiniMax, DeepSeek V3)
Layer 3: Unlimited Free & Local (Kiro AI, OpenCode Free, Vertex Free tier, Local Ollama CPU/GPU)
Includes automatic fallback combos and quota tracking.
"""

from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, List, Optional


class ModelTier(str, Enum):
    LOCAL = "local"            # Worker Ollama / vLLM (Free, low latency on LAN, private)
    FLASH = "flash"            # Gemini Flash (Fast, vision, computer-use, tool execution)
    PRO = "pro"                # Gemini Pro / Claude 3.5 (Complex code, refactoring, deep architecture)
    FREE = "free"              # Kiro AI, OpenCode Free (Zero-cost unlimited fallback)
    LOW_COST = "low_cost"      # GLM-5, MiniMax (Ultra-low cost high throughput)


@dataclass
class RouteDecision:
    tier: ModelTier
    model_name: str
    provider: str
    reason: str
    allow_external: bool
    fallback_chain: List[str]


class SmartCascadeRouter:
    """Smart Cascade Router for OmniOps Enterprise & 9Router-inspired multi-tier fallback.
    
    Routes tasks intelligently based on:
    1. Tenant / User privacy constraints (strictly local vs allowed external)
    2. Task modality & intent (vision, screen-use, code, summary, reasoning)
    3. Token economy (use free local / free unlimited Kiro / OpenCode when possible)
    4. Auto-fallback chain: Subscription -> Low-Cost -> Free Unlimited -> Local CPU/GPU
    """

    DEFAULT_LOCAL_MODEL = "qwen2.5-coder:7b"
    DEFAULT_FLASH_MODEL = "gemini-2.5-flash"
    DEFAULT_PRO_MODEL = "gemini-2.5-pro"
    DEFAULT_CLAUDE_MODEL = "claude-3-5-sonnet"
    DEFAULT_KIRO_MODEL = "kr/claude-sonnet-4.5"
    DEFAULT_OPENCODE_MODEL = "opencode/glm-5"
    DEFAULT_MINIMAX_MODEL = "minimax/abab6.5"

    CODE_HEAVY_KEYWORDS = (
        "refactor", "architecture", "docker-compose", "multithreading", "asyncio",
        "concurrency", "optimize algorithm", "kernel", "win32", "tauri", "memory leak",
        "security audit", "reverse engineer", "microservice", "ast parser", "deep analysis"
    )

    VISION_SYSTEM_KEYWORDS = (
        "screenshot", "image", "screen", "window", "ocr", "mouse", "click", "keyboard",
        "desktop", "vision", "ui preview", "inspect element", "gui", "computer-use"
    )

    LIGHTWEIGHT_KEYWORDS = (
        "summarize", "hello", "سلام", "خلاصه", "translate", "توضیح کوتاه",
        "grammar", "typo", "simple check", "ping", "test"
    )

    def __init__(
        self,
        local_model: str = DEFAULT_LOCAL_MODEL,
        flash_model: str = DEFAULT_FLASH_MODEL,
        pro_model: str = DEFAULT_PRO_MODEL,
        claude_model: str = DEFAULT_CLAUDE_MODEL,
        kiro_model: str = DEFAULT_KIRO_MODEL,
        opencode_model: str = DEFAULT_OPENCODE_MODEL,
    ):
        self.local_model = local_model
        self.flash_model = flash_model
        self.pro_model = pro_model
        self.claude_model = claude_model
        self.kiro_model = kiro_model
        self.opencode_model = opencode_model

    def classify_intent(self, prompt: str, has_image: bool = False, is_computer_use: bool = False) -> ModelTier:
        """Determines the optimal tier for a given task."""
        if has_image or is_computer_use:
            return ModelTier.FLASH

        text = prompt.lower()

        # Check for heavy code keywords
        if any(keyword in text for keyword in self.CODE_HEAVY_KEYWORDS) or len(prompt) > 3000:
            return ModelTier.PRO

        # Check for vision/system/computer-use cues
        if any(keyword in text for keyword in self.VISION_SYSTEM_KEYWORDS):
            return ModelTier.FLASH

        # Check for lightweight cues
        if any(keyword in text for keyword in self.LIGHTWEIGHT_KEYWORDS) or len(prompt) < 150:
            return ModelTier.LOCAL

        # Default for moderate tasks
        return ModelTier.LOCAL

    def decide_route(
        self,
        prompt: str,
        allow_external: bool = False,
        is_strictly_private: bool = False,
        has_image: bool = False,
        is_computer_use: bool = False,
        requested_tier: Optional[str] = None,
        available_local_models: Optional[List[str]] = None,
    ) -> RouteDecision:
        """Computes the routing decision with fallbacks and policy constraints."""
        # Privacy gate: If strictly private or external disallowed, enforce LOCAL
        if is_strictly_private or not allow_external:
            local_candidate = self.local_model
            if available_local_models:
                for m in available_local_models:
                    if "coder" in m or "qwen" in m or "deepseek" in m:
                        local_candidate = m
                        break
                else:
                    local_candidate = available_local_models[0]

            return RouteDecision(
                tier=ModelTier.LOCAL,
                model_name=f"ollama/{local_candidate}",
                provider="worker_ollama",
                reason="Strict local privacy policy enforced (external data transfer forbidden)",
                allow_external=False,
                fallback_chain=[],
            )

        # Check if caller specifically requested a tier
        target_tier = None
        if requested_tier:
            try:
                target_tier = ModelTier(requested_tier.lower())
            except ValueError:
                pass

        if target_tier is None:
            target_tier = self.classify_intent(prompt, has_image=has_image, is_computer_use=is_computer_use)

        if target_tier == ModelTier.LOCAL:
            return RouteDecision(
                tier=ModelTier.LOCAL,
                model_name=f"ollama/{self.local_model}",
                provider="worker_ollama",
                reason="Lightweight or standard task handled by free local worker node",
                allow_external=True,
                fallback_chain=[
                    f"kiro/{self.kiro_model}",
                    f"opencode/{self.opencode_model}",
                    f"gemini/{self.flash_model}",
                    f"gemini/{self.pro_model}",
                ],
            )

        if target_tier == ModelTier.FLASH:
            return RouteDecision(
                tier=ModelTier.FLASH,
                model_name=f"gemini/{self.flash_model}",
                provider="gemini_pool",
                reason="Vision, computer-use, or fast interactive reasoning routed to Gemini Flash",
                allow_external=True,
                fallback_chain=[
                    f"kiro/{self.kiro_model}",
                    f"gemini/{self.pro_model}",
                    f"anthropic/{self.claude_model}",
                ],
            )

        if target_tier == ModelTier.FREE:
            return RouteDecision(
                tier=ModelTier.FREE,
                model_name=f"kiro/{self.kiro_model}",
                provider="kiro_free",
                reason="Direct routing to Kiro AI unlimited free tier (Claude 4.5 / GLM-5)",
                allow_external=True,
                fallback_chain=[
                    f"opencode/{self.opencode_model}",
                    f"gemini/{self.flash_model}",
                    f"ollama/{self.local_model}",
                ],
            )

        # Tier PRO
        return RouteDecision(
            tier=ModelTier.PRO,
            model_name=f"gemini/{self.pro_model}",
            provider="gemini_pool",
            reason="Complex code synthesis or deep architecture routed to high-capacity model",
            allow_external=True,
            fallback_chain=[
                f"anthropic/{self.claude_model}",
                f"kiro/{self.kiro_model}",
                f"gemini/{self.flash_model}",
                f"opencode/{self.opencode_model}",
            ],
        )

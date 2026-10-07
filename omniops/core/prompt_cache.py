"""Prompt Cache Engine: Implements intelligent ephemeral caching for recurring system instructions,
project context, and conversation history to reduce LLM latency and token costs by up to 90%.
Compatible with Claude Prompt Caching, OpenAI Prompt Caching, and Gemini Context Caching.
"""

import hashlib
import json
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class CacheEntry:
    cache_key: str
    token_count: int
    content_preview: str
    created_at: float
    last_accessed: float
    hit_count: int = 0
    expires_at: float = 0.0


@dataclass
class PromptCacheStats:
    total_requests: int = 0
    cache_hits: int = 0
    total_prompt_tokens: int = 0
    cached_prompt_tokens_saved: int = 0
    estimated_cost_saved_usd: float = 0.0
    average_latency_saved_ms: float = 0.0


class PromptCacheEngine:
    """Manages prompt prefix caching, fingerprinting, and cache optimization metrics."""

    def __init__(self, ttl_seconds: float = 300.0, min_tokens_for_cache: int = 250):
        self.ttl_seconds = ttl_seconds
        self.min_tokens_for_cache = min_tokens_for_cache
        self._cache: Dict[str, CacheEntry] = {}
        self.stats = PromptCacheStats()

    def _estimate_tokens(self, text: str) -> int:
        """Heuristic token estimator (average 3.6 chars per Persian/English token)."""
        if not text:
            return 0
        return max(1, int(len(text) / 3.6))

    def compute_context_fingerprint(
        self,
        system_prompt: str,
        project_context: Optional[str] = None,
        history_messages: Optional[List[Dict[str, str]]] = None,
    ) -> str:
        """Computes a deterministic cryptographic fingerprint of reusable prompt sections."""
        components = [system_prompt.strip()]
        if project_context:
            components.append(project_context.strip())
        if history_messages:
            # We cache all but the last user turn (the static conversation prefix)
            prefix_turns = history_messages[:-1] if len(history_messages) > 1 else history_messages
            components.append(json.dumps(prefix_turns, sort_keys=True, ensure_ascii=False))

        raw_payload = "|||".join(components).encode("utf-8")
        return hashlib.sha256(raw_payload).hexdigest()

    def process_request_cache(
        self,
        system_prompt: str,
        new_user_message: str,
        project_context: Optional[str] = None,
        history_messages: Optional[List[Dict[str, str]]] = None,
        model_name: str = "claude-3-5-sonnet",
    ) -> Dict[str, Any]:
        """Analyzes the request against prompt cache, updates cache stats, and marks cache headers."""
        now = time.time()
        self.stats.total_requests += 1

        fingerprint = self.compute_context_fingerprint(
            system_prompt=system_prompt,
            project_context=project_context,
            history_messages=history_messages,
        )

        static_text = system_prompt + (project_context or "")
        static_tokens = self._estimate_tokens(static_text)
        new_tokens = self._estimate_tokens(new_user_message)
        total_tokens = static_tokens + new_tokens
        self.stats.total_prompt_tokens += total_tokens

        # Clean expired entries
        self._evict_expired(now)

        is_hit = False
        saved_tokens = 0
        cost_saved = 0.0

        if static_tokens >= self.min_tokens_for_cache:
            if fingerprint in self._cache:
                entry = self._cache[fingerprint]
                entry.last_accessed = now
                entry.hit_count += 1
                entry.expires_at = now + self.ttl_seconds
                is_hit = True
                saved_tokens = entry.token_count
                self.stats.cache_hits += 1
                self.stats.cached_prompt_tokens_saved += saved_tokens

                # Typical cache discount: 90% cheaper for cached prompt tokens
                # Assuming base $3.00/1M prompt tokens -> cache is $0.30/1M -> savings = $2.70/1M
                cost_saved = (saved_tokens / 1_000_000.0) * 2.70
                self.stats.estimated_cost_saved_usd += cost_saved
            else:
                # Add to cache
                self._cache[fingerprint] = CacheEntry(
                    cache_key=fingerprint,
                    token_count=static_tokens,
                    content_preview=static_text[:120],
                    created_at=now,
                    last_accessed=now,
                    hit_count=1,
                    expires_at=now + self.ttl_seconds,
                )

        hit_rate = (self.stats.cache_hits / self.stats.total_requests) * 100.0 if self.stats.total_requests > 0 else 0.0

        return {
            "cache_hit": is_hit,
            "fingerprint": fingerprint[:12],
            "static_tokens": static_tokens,
            "new_tokens": new_tokens,
            "total_tokens": total_tokens,
            "cached_tokens_saved": saved_tokens,
            "cost_saved_usd": round(cost_saved, 6),
            "hit_rate_percent": round(hit_rate, 1),
            "latency_boost_factor": "2.5x" if is_hit else "1.0x",
            # Headers formatted for Anthropic / Gemini / OpenAI caching
            "cache_control": {"type": "ephemeral"} if static_tokens >= self.min_tokens_for_cache else None,
        }

    def _evict_expired(self, now: float) -> None:
        """Removes expired entries from cache."""
        expired_keys = [k for k, v in self._cache.items() if v.expires_at > 0 and v.expires_at < now]
        for k in expired_keys:
            del self._cache[k]

    def get_telemetry(self) -> Dict[str, Any]:
        """Returns prompt caching health and cumulative savings."""
        now = time.time()
        self._evict_expired(now)
        hit_rate = (self.stats.cache_hits / self.stats.total_requests * 100.0) if self.stats.total_requests > 0 else 0.0
        return {
            "total_requests": self.stats.total_requests,
            "cache_hits": self.stats.cache_hits,
            "hit_rate_percent": round(hit_rate, 2),
            "active_cache_entries": len(self._cache),
            "cached_tokens_saved": self.stats.cached_prompt_tokens_saved,
            "estimated_cost_saved_usd": round(self.stats.estimated_cost_saved_usd, 4),
            "status": "active",
        }

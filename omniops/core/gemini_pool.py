"""Gemini Key Pool with automatic rotation, rate-limit cooldown, and health tracking."""

import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class KeyStatus(str, Enum):
    ACTIVE = "active"
    COOLDOWN = "cooldown"
    DISABLED = "disabled"


@dataclass
class KeyTelemetry:
    key_id: str
    masked_key: str
    status: KeyStatus = KeyStatus.ACTIVE
    total_requests: int = 0
    successful_requests: int = 0
    rate_limit_count: int = 0
    consecutive_errors: int = 0
    cooldown_until: float = 0.0
    last_used: float = 0.0
    last_error: Optional[str] = None
    label: str = ""


class GeminiKeyPool:
    """Enterprise Google Gemini API Key Pool.
    
    Provides:
    - Multiple key registration
    - Safe masked key reporting
    - Least-recently-used / Round-Robin rotation
    - Automatic 429 / ResourceExhausted detection & quarantine (cooldown)
    - Automatic recovery when cooldown period expires
    - Detailed per-key telemetry and operational health stats
    """

    def __init__(self, default_cooldown_seconds: float = 60.0):
        self._lock = threading.RLock()
        self.default_cooldown_seconds = default_cooldown_seconds
        self._keys: Dict[str, str] = {}  # key_id -> raw_api_key
        self._telemetry: Dict[str, KeyTelemetry] = {}

    @staticmethod
    def _mask(raw_key: str) -> str:
        if len(raw_key) <= 8:
            return "****"
        return f"{raw_key[:4]}...{raw_key[-4:]}"

    def add_key(self, raw_key: str, label: str = "") -> str:
        """Adds a Gemini API key to the pool. Returns key_id."""
        raw_key = raw_key.strip()
        if not raw_key:
            raise ValueError("API key cannot be empty")

        with self._lock:
            # Check if key already exists
            for kid, existing in self._keys.items():
                if existing == raw_key:
                    if label and not self._telemetry[kid].label:
                        self._telemetry[kid].label = label
                    return kid

            key_id = f"gemini-key-{len(self._keys) + 1}"
            self._keys[key_id] = raw_key
            self._telemetry[key_id] = KeyTelemetry(
                key_id=key_id,
                masked_key=self._mask(raw_key),
                label=label or f"Gemini Key #{len(self._keys)}",
            )
            return key_id

    def remove_key(self, key_id: str) -> bool:
        """Removes a key from the pool."""
        with self._lock:
            if key_id in self._keys:
                del self._keys[key_id]
                del self._telemetry[key_id]
                return True
            return False

    def disable_key(self, key_id: str) -> bool:
        """Manually disables a key."""
        with self._lock:
            if key_id in self._telemetry:
                self._telemetry[key_id].status = KeyStatus.DISABLED
                return True
            return False

    def enable_key(self, key_id: str) -> bool:
        """Re-enables a disabled key and resets cooldown."""
        with self._lock:
            if key_id in self._telemetry:
                self._telemetry[key_id].status = KeyStatus.ACTIVE
                self._telemetry[key_id].cooldown_until = 0.0
                self._telemetry[key_id].consecutive_errors = 0
                return True
            return False

    def acquire_key(self) -> Optional[tuple[str, str]]:
        """Acquires the next available Gemini API key using least-recently-used rotation.
        
        Returns:
            (key_id, raw_api_key) or None if all keys are exhausted / in cooldown.
        """
        now = time.time()
        with self._lock:
            candidates: List[tuple[str, float]] = []

            for key_id, tel in self._telemetry.items():
                # Check for cooldown recovery
                if tel.status == KeyStatus.COOLDOWN:
                    if now >= tel.cooldown_until:
                        tel.status = KeyStatus.ACTIVE
                        tel.cooldown_until = 0.0
                        tel.consecutive_errors = 0

                if tel.status == KeyStatus.ACTIVE:
                    candidates.append((key_id, tel.last_used))

            if not candidates:
                return None

            # Sort by least recently used
            candidates.sort(key=lambda item: item[1])
            selected_id = candidates[0][0]

            self._telemetry[selected_id].last_used = now
            self._telemetry[selected_id].total_requests += 1

            return selected_id, self._keys[selected_id]

    def report_success(self, key_id: str) -> None:
        """Marks a successful call using the key."""
        with self._lock:
            if key_id in self._telemetry:
                tel = self._telemetry[key_id]
                tel.successful_requests += 1
                tel.consecutive_errors = 0
                tel.last_error = None

    def report_rate_limit(self, key_id: str, cooldown_seconds: Optional[float] = None) -> None:
        """Reports a 429 / Rate Limit error for the key. Places it in cooldown."""
        cooldown = cooldown_seconds or self.default_cooldown_seconds
        now = time.time()
        with self._lock:
            if key_id in self._telemetry:
                tel = self._telemetry[key_id]
                tel.rate_limit_count += 1
                tel.consecutive_errors += 1
                tel.status = KeyStatus.COOLDOWN
                tel.cooldown_until = now + cooldown
                tel.last_error = f"Rate limit reached (429). Cooldown for {cooldown:.0f}s"

    def report_error(self, key_id: str, error_message: str) -> None:
        """Reports a general error for the key."""
        with self._lock:
            if key_id in self._telemetry:
                tel = self._telemetry[key_id]
                tel.consecutive_errors += 1
                tel.last_error = error_message
                # If error indicates quota or 429
                if "429" in error_message or "RESOURCE_EXHAUSTED" in error_message.upper():
                    self.report_rate_limit(key_id)

    def get_status(self) -> Dict[str, Any]:
        """Returns comprehensive telemetry for all keys in the pool."""
        now = time.time()
        with self._lock:
            keys_info = []
            active_count = 0
            cooldown_count = 0
            disabled_count = 0

            for key_id, tel in self._telemetry.items():
                # Refresh status if cooldown expired
                effective_status = tel.status
                remaining_cooldown = max(0.0, tel.cooldown_until - now)
                if effective_status == KeyStatus.COOLDOWN and remaining_cooldown == 0.0:
                    effective_status = KeyStatus.ACTIVE

                if effective_status == KeyStatus.ACTIVE:
                    active_count += 1
                elif effective_status == KeyStatus.COOLDOWN:
                    cooldown_count += 1
                elif effective_status == KeyStatus.DISABLED:
                    disabled_count += 1

                keys_info.append({
                    "key_id": tel.key_id,
                    "masked_key": tel.masked_key,
                    "label": tel.label,
                    "status": effective_status.value,
                    "total_requests": tel.total_requests,
                    "successful_requests": tel.successful_requests,
                    "rate_limit_count": tel.rate_limit_count,
                    "consecutive_errors": tel.consecutive_errors,
                    "remaining_cooldown_seconds": round(remaining_cooldown, 1),
                    "last_error": tel.last_error,
                })

            return {
                "total_keys": len(self._keys),
                "active_keys": active_count,
                "cooldown_keys": cooldown_count,
                "disabled_keys": disabled_count,
                "keys": keys_info,
            }

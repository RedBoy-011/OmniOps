"""Enterprise OTA & Client Update Manager for OmniOps Studio.

Handles seamless in-app client updates for Windows Desktop and Android Companion:
- Windows Desktop: Zero-admin hot bundle reload (Frontend/Assets) or binary in-place update.
- Android: PWA service worker cache bust or direct APK package download and install trigger.
"""

import os
import time
from dataclasses import dataclass, asdict
from typing import Any, Dict, Optional


@dataclass
class ClientVersionInfo:
    version: str
    min_supported_version: str
    release_notes: str
    update_type: str  # "bundle" (zero-admin hot-reload) | "binary" | "apk" | "pwa_refresh"
    download_url: str
    sha256: Optional[str] = None
    file_size_bytes: int = 0
    published_at: float = 0.0


class UpdateManager:
    """Manages version registries and OTA delivery for Windows and Android clients."""

    def __init__(self, updates_dir: Optional[str] = None):
        self.updates_dir = updates_dir or os.path.join(os.getcwd(), "updates")
        os.makedirs(self.updates_dir, exist_ok=True)

        # Default registered versions
        self._registry: Dict[str, ClientVersionInfo] = {
            "windows": ClientVersionInfo(
                version="1.1.0",
                min_supported_version="1.0.0",
                release_notes="بهینه‌سازی مصرف توکن با فشرده‌ساز RTK، ارتقای تم شیشه‌ای عمیق، و حالت دسترسی کامل",
                update_type="bundle",  # Hot-reload without reinstalling
                download_url="/api/updates/download?platform=windows&version=1.1.0",
                file_size_bytes=425000,
                published_at=time.time(),
            ),
            "android": ClientVersionInfo(
                version="1.1.0",
                min_supported_version="1.0.0",
                release_notes="افزودن چراغ سبز وضعیت ایجنت ویندوز، جفت‌سازی با کد کوتاه ۶ رقمی و آپلود تا ۵ عکس",
                update_type="pwa_refresh",  # or "apk"
                download_url="/api/updates/download?platform=android&version=1.1.0",
                file_size_bytes=380000,
                published_at=time.time(),
            ),
        }

    def check_update(self, platform: str, current_version: str) -> Dict[str, Any]:
        """Check whether an update is available for the given platform and current version."""
        norm_platform = platform.lower().strip()
        info = self._registry.get(norm_platform)
        if not info:
            return {"has_update": False, "message": f"پلتفرم {platform} ثبت نشده است."}

        has_update = self._is_newer(info.version, current_version)
        is_mandatory = self._is_newer(info.min_supported_version, current_version)

        return {
            "has_update": has_update,
            "platform": norm_platform,
            "current_version": current_version,
            "latest_version": info.version,
            "is_mandatory": is_mandatory,
            "update_type": info.update_type,
            "release_notes": info.release_notes,
            "download_url": info.download_url,
            "file_size_bytes": info.file_size_bytes,
            "published_at": info.published_at,
        }

    def publish_update(
        self,
        platform: str,
        version: str,
        release_notes: str,
        update_type: str = "bundle",
        min_supported_version: str = "1.0.0",
        download_url: Optional[str] = None,
        file_size_bytes: int = 0,
    ) -> Dict[str, Any]:
        """Publish a new update release for Windows or Android."""
        norm_platform = platform.lower().strip()
        url = download_url or f"/api/updates/download?platform={norm_platform}&version={version}"
        info = ClientVersionInfo(
            version=version,
            min_supported_version=min_supported_version,
            release_notes=release_notes,
            update_type=update_type,
            download_url=url,
            file_size_bytes=file_size_bytes,
            published_at=time.time(),
        )
        self._registry[norm_platform] = info
        return {
            "status": "published",
            "platform": norm_platform,
            "version": version,
            "update_type": update_type,
        }

    def get_registry(self) -> Dict[str, Dict[str, Any]]:
        """Return all registered platform versions."""
        return {k: asdict(v) for k, v in self._registry.items()}

    @staticmethod
    def _is_newer(latest: str, current: str) -> bool:
        """Compare semver strings (e.g. '1.1.0' > '1.0.0')."""
        def parse(v: str):
            parts = []
            for p in v.split("-")[0].split("."):
                try:
                    parts.append(int(p))
                except ValueError:
                    parts.append(0)
            while len(parts) < 3:
                parts.append(0)
            return parts[:3]

        return parse(latest) > parse(current)

"""
OmniOps Worker Ollama Auto-Discovery Engine
کشف خودکار مدل‌های از قبل نصب‌شده روی سرور عملیاتی و تست اتصال بلادرنگ
"""
import time
import json
import urllib.request
import urllib.error
import logging
from typing import Dict, List, Optional

logger = logging.getLogger("omniops.discovery")

class WorkerModelDiscovery:
    @staticmethod
    def probe_worker_connection(worker_ip: str, port: int = 11434, timeout: float = 3.0) -> dict:
        """
        تست اتصال به سرور عملیاتی و استخراج فوری لیست مدل‌های آفلاین از قبل دانلودشده
        """
        start_time = time.time()
        endpoint = f"http://{worker_ip}:{port}/api/tags"

        try:
            req = urllib.request.Request(endpoint, headers={"User-Agent": "OmniOps-Discovery/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                latency_ms = round((time.time() - start_time) * 1000, 1)
                
                if resp.status == 200:
                    payload = json.loads(resp.read().decode("utf-8"))
                    raw_models = payload.get("models", [])
                    
                    discovered_models = []
                    for m in raw_models:
                        size_bytes = m.get("size", 0)
                        size_gb = round(size_bytes / (1024 ** 3), 2)
                        discovered_models.append({
                            "name": m.get("name", "unknown"),
                            "size_gb": size_gb,
                            "modified_at": m.get("modified_at", ""),
                            "format": m.get("details", {}).get("quantization_level", "Q4_K_M"),
                            "parameter_size": m.get("details", {}).get("parameter_size", ""),
                        })

                    logger.info(f"اتصال با نود {worker_ip} برقرار شد ({latency_ms}ms). تعداد {len(discovered_models)} مدل از قبل کشف شد.")
                    
                    return {
                        "connected": True,
                        "latency_ms": latency_ms,
                        "pre_installed_count": len(discovered_models),
                        "models": discovered_models,
                        "active_model": discovered_models[0]["name"] if discovered_models else None,
                    }

        except (urllib.error.URLError, TimeoutError, Exception) as e:
            logger.warning(f"عدم پاسخگویی سرویس هوش مصنوعی نود {worker_ip}: {e}")
            return {
                "connected": False,
                "latency_ms": -1,
                "pre_installed_count": 0,
                "models": [],
                "active_model": None,
                "error": "سرویس هوش مصنوعی در سرور عملیاتی در دسترس نیست یا در حال راه‌اندازی است.",
            }

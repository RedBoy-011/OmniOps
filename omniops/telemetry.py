"""Samaneh-ye jam-avari-e etela-at-e sakht-afzar va salamat-e system (Telemetry).

Zero-external-dependency hardware metrics collector for OmniOps Master & Nodes.
Gathers real-time CPU, RAM, Disk, GPU (NVIDIA VRAM), and OS runtime statistics.
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

_SERVER_START_TIME = time.time()
_LAST_CPU_SAMPLE: dict[str, Any] = {"time": 0.0, "data": None}


def _get_cpu_cores() -> int:
    try:
        return os.cpu_count() or 1
    except Exception:
        return 1


def _get_cpu_percent() -> float:
    global _LAST_CPU_SAMPLE
    now = time.monotonic()

    if sys.platform == "win32":
        try:
            import ctypes

            class FILETIME(ctypes.Structure):
                _fields_ = [
                    ("dwLowDateTime", ctypes.c_ulong),
                    ("dwHighDateTime", ctypes.c_ulong),
                ]

            def to_int(ft: Any) -> int:
                return (ft.dwHighDateTime << 32) | ft.dwLowDateTime

            idle, kernel, user = FILETIME(), FILETIME(), FILETIME()
            kernel32 = ctypes.windll.kernel32
            if not kernel32.GetSystemTimes(ctypes.byref(idle), ctypes.byref(kernel), ctypes.byref(user)):
                return 0.0

            curr = (to_int(idle), to_int(kernel), to_int(user))
            last = _LAST_CPU_SAMPLE.get("data")
            last_time = _LAST_CPU_SAMPLE.get("time", 0.0)

            if not last or (now - last_time) > 10.0 or (now - last_time) < 0.05:
                # Take a micro sleep to calculate instantaneous delta if no fresh sample
                time.sleep(0.05)
                idle2, kernel2, user2 = FILETIME(), FILETIME(), FILETIME()
                kernel32.GetSystemTimes(ctypes.byref(idle2), ctypes.byref(kernel2), ctypes.byref(user2))
                last = curr
                curr = (to_int(idle2), to_int(kernel2), to_int(user2))

            _LAST_CPU_SAMPLE["time"] = now
            _LAST_CPU_SAMPLE["data"] = curr

            idle_delta = curr[0] - last[0]
            kernel_delta = curr[1] - last[1]
            user_delta = curr[2] - last[2]
            total = kernel_delta + user_delta
            if total > 0:
                pct = ((total - idle_delta) / total) * 100.0
                return round(max(0.0, min(100.0, pct)), 1)
            return 0.0
        except Exception:
            return 0.0

    # Linux / Unix / macOS
    if os.path.exists("/proc/stat"):
        try:
            with open("/proc/stat", "r", encoding="utf-8") as f:
                line = f.readline()
            parts = [float(x) for x in line.split()[1:8]]
            idle_time = parts[3] + parts[4]
            total_time = sum(parts)
            curr = (idle_time, total_time)

            last = _LAST_CPU_SAMPLE.get("data")
            last_time = _LAST_CPU_SAMPLE.get("time", 0.0)

            if not last or (now - last_time) > 10.0 or (now - last_time) < 0.05:
                time.sleep(0.05)
                with open("/proc/stat", "r", encoding="utf-8") as f:
                    line2 = f.readline()
                parts2 = [float(x) for x in line2.split()[1:8]]
                last = curr
                curr = (parts2[3] + parts2[4], sum(parts2))

            _LAST_CPU_SAMPLE["time"] = now
            _LAST_CPU_SAMPLE["data"] = curr

            idle_delta = curr[0] - last[0]
            total_delta = curr[1] - last[1]
            if total_delta > 0:
                pct = ((total_delta - idle_delta) / total_delta) * 100.0
                return round(max(0.0, min(100.0, pct)), 1)
        except Exception:
            pass

    # Generic Unix fallback using os.getloadavg
    try:
        if hasattr(os, "getloadavg"):
            load1, _, _ = os.getloadavg()
            cores = _get_cpu_cores()
            return round(min(100.0, (load1 / cores) * 100.0), 1)
    except Exception:
        pass

    return 0.0


def _get_load_avg() -> list[float] | None:
    try:
        if hasattr(os, "getloadavg"):
            l1, l5, l15 = os.getloadavg()
            return [round(l1, 2), round(l5, 2), round(l15, 2)]
    except Exception:
        pass
    return None


def get_ram_info() -> dict[str, Any]:
    # Linux /proc/meminfo
    if os.path.exists("/proc/meminfo"):
        try:
            mem: dict[str, int] = {}
            with open("/proc/meminfo", "r", encoding="utf-8") as f:
                for line in f:
                    if ":" in line:
                        k, v = line.split(":", 1)
                        num = v.strip().split()[0]
                        mem[k.strip()] = int(num) * 1024  # convert kB to Bytes

            total = mem.get("MemTotal", 0)
            avail = mem.get("MemAvailable", mem.get("MemFree", 0) + mem.get("Buffers", 0) + mem.get("Cached", 0))
            used = max(0, total - avail)
            pct = round((used / total) * 100.0, 1) if total > 0 else 0.0
            return {
                "total_bytes": total,
                "used_bytes": used,
                "free_bytes": avail,
                "percent": pct,
                "total_gb": round(total / (1024**3), 2),
                "used_gb": round(used / (1024**3), 2),
                "free_gb": round(avail / (1024**3), 2),
            }
        except Exception:
            pass

    # Windows GlobalMemoryStatusEx
    if sys.platform == "win32":
        try:
            import ctypes

            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
                total = stat.ullTotalPhys
                avail = stat.ullAvailPhys
                used = max(0, total - avail)
                pct = float(stat.dwMemoryLoad)
                return {
                    "total_bytes": total,
                    "used_bytes": used,
                    "free_bytes": avail,
                    "percent": pct,
                    "total_gb": round(total / (1024**3), 2),
                    "used_gb": round(used / (1024**3), 2),
                    "free_gb": round(avail / (1024**3), 2),
                }
        except Exception:
            pass

    return {
        "total_bytes": 0,
        "used_bytes": 0,
        "free_bytes": 0,
        "percent": 0.0,
        "total_gb": 0.0,
        "used_gb": 0.0,
        "free_gb": 0.0,
    }


def get_disk_info(path: str | Path | None = None) -> dict[str, Any]:
    try:
        check_path = str(path or Path(__file__).resolve().parent.parent)
        usage = shutil.disk_usage(check_path)
        total = usage.total
        used = usage.used
        free = usage.free
        pct = round((used / total) * 100.0, 1) if total > 0 else 0.0
        return {
            "path": check_path,
            "total_bytes": total,
            "used_bytes": used,
            "free_bytes": free,
            "percent": pct,
            "total_gb": round(total / (1024**3), 2),
            "used_gb": round(used / (1024**3), 2),
            "free_gb": round(free / (1024**3), 2),
        }
    except Exception:
        return {
            "path": str(path or "."),
            "total_bytes": 0,
            "used_bytes": 0,
            "free_bytes": 0,
            "percent": 0.0,
            "total_gb": 0.0,
            "used_gb": 0.0,
            "free_gb": 0.0,
        }


def get_gpu_info() -> dict[str, Any]:
    """Detects NVIDIA GPU and VRAM allocation via nvidia-smi with zero dependencies."""
    cmd = [
        "nvidia-smi",
        "--query-gpu=name,memory.total,memory.used,memory.free,temperature.gpu,utilization.gpu",
        "--format=csv,noheader,nounits",
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=1.5, encoding="utf-8", errors="replace")
        if res.returncode == 0 and res.stdout.strip():
            first_line = res.stdout.strip().splitlines()[0]
            parts = [p.strip() for p in first_line.split(",")]
            if len(parts) >= 6:
                name = parts[0]
                total_mb = int(parts[1]) if parts[1].isdigit() else 0
                used_mb = int(parts[2]) if parts[2].isdigit() else 0
                free_mb = int(parts[3]) if parts[3].isdigit() else 0
                temp_c = int(parts[4]) if parts[4].isdigit() else None
                util_pct = int(parts[5]) if parts[5].isdigit() else None
                vram_pct = round((used_mb / total_mb) * 100.0, 1) if total_mb > 0 else 0.0
                return {
                    "available": True,
                    "name": name,
                    "vram_total_mb": total_mb,
                    "vram_used_mb": used_mb,
                    "vram_free_mb": free_mb,
                    "vram_percent": vram_pct,
                    "temperature_c": temp_c,
                    "gpu_utilization_percent": util_pct,
                }
    except Exception:
        pass

    return {
        "available": False,
        "name": "پردازشگر گرافیکی اختصاصی یافت نشد (حالت پردازندهٔ مرکزی / CPU-Only)",
        "vram_total_mb": None,
        "vram_used_mb": None,
        "vram_free_mb": None,
        "vram_percent": None,
        "temperature_c": None,
        "gpu_utilization_percent": None,
    }


def get_system_metrics(
    repo_root: str | Path | None = None,
    active_inferences: int = 0,
    max_inferences: int = 2,
    worker_nodes_count: int = 0,
    active_sessions_count: int = 0,
    ollama_status: str = "unknown",
    ollama_model_count: int = 0,
) -> dict[str, Any]:
    """Assembles all hardware and runtime telemetry into a structured payload."""
    now_ts = int(time.time())
    uptime_sec = int(time.time() - _SERVER_START_TIME)

    cpu_pct = _get_cpu_percent()
    cpu_cores = _get_cpu_cores()
    load_avg = _get_load_avg()
    ram_info = get_ram_info()
    disk_info = get_disk_info(repo_root)
    gpu_info = get_gpu_info()

    return {
        "server_time": now_ts,
        "uptime_seconds": uptime_sec,
        "cpu": {
            "percent": cpu_pct,
            "cores": cpu_cores,
            "load_avg": load_avg,
        },
        "ram": ram_info,
        "disk": disk_info,
        "gpu": gpu_info,
        "runtime": {
            "os": platform.system(),
            "os_release": platform.release(),
            "platform_string": f"{platform.system()} {platform.release()} ({platform.machine()})",
            "python_version": sys.version.split()[0],
            "active_inferences": active_inferences,
            "max_inferences": max_inferences,
            "worker_nodes_count": worker_nodes_count,
            "active_sessions_count": active_sessions_count,
            "ollama_status": ollama_status,
            "ollama_model_count": ollama_model_count,
        },
    }


DIAGNOSTIC_KEYWORDS: tuple[str, ...] = (
    "@system", "@status", "@telemetry", "/status", "/sys",
    "وضعیت سرور", "وضعیت سیستم", "سلامت سیستم", "وضعیت سخت‌افزار", "وضعیت سخت افزار",
    "مصرف رم", "میزان رم", "حافظه رم", "حافظه ram", "مصرف ram",
    "مصرف پردازنده", "مصرف cpu", "لود سرور", "لود cpu", "لود پردازنده",
    "دمای گرافیک", "دمای gpu", "مصرف گرافیک", "مصرف vram", "کارت گرافیک", "وضعیت gpu",
    "فضای دیسک", "حافظه دیسک", "هارد سرور", "حجم دیسک",
    "مدل‌های نصب", "مدل های نصب", "چه مدل هایی", "چه مدل‌هایی", "لیست مدل‌ها", "لیست مدل ها",
    "تله‌متری", "تله متری",
    "server status", "system status", "system health", "cpu usage", "ram usage",
    "gpu status", "disk space", "hardware telemetry",
)


def is_diagnostic_query(prompt: str) -> bool:
    """Returns True if the prompt asks about server health, telemetry, models, or hardware."""
    if not isinstance(prompt, str):
        return False
    lower = prompt.lower()
    return any(kw in lower for kw in DIAGNOSTIC_KEYWORDS)


def format_system_context(metrics: dict[str, Any] | None = None, model_names: list[str] | None = None) -> str:
    """Formats system metrics into an informative Persian context block for LLM grounding."""
    if metrics is None:
        metrics = get_system_metrics()

    cpu = metrics.get("cpu", {})
    ram = metrics.get("ram", {})
    disk = metrics.get("disk", {})
    gpu = metrics.get("gpu", {})
    runtime = metrics.get("runtime", {})

    cpu_str = f"{cpu.get('percent', 0.0)}% (تعداد هسته‌ها: {cpu.get('cores', 1)})"
    ram_str = f"{ram.get('used_gb', 0.0)} GB از {ram.get('total_gb', 0.0)} GB ({ram.get('percent', 0.0)}% اشغال، {ram.get('free_gb', 0.0)} GB آزاد)"
    disk_str = f"{disk.get('used_gb', 0.0)} GB از {disk.get('total_gb', 0.0)} GB ({disk.get('percent', 0.0)}% اشغال، {disk.get('free_gb', 0.0)} GB آزاد)"

    if gpu.get("available"):
        gpu_summary = (
            f"{gpu.get('name', 'NVIDIA GPU')} | حافظه VRAM: {gpu.get('used_vram_mb', 0)}MB/{gpu.get('total_vram_mb', 0)}MB "
            f"({gpu.get('percent_vram', 0)}%) | دمای هسته: {gpu.get('temperature_c', 0)}°C"
        )
    else:
        gpu_summary = "شناسایی نشد (پردازش روی CPU انجام می‌شود)"

    models_summary = ", ".join(model_names) if model_names else "بدون مدل محلی لود شده"
    uptime_sec = metrics.get("uptime_seconds", 0)
    uptime_hours = round(uptime_sec / 3600, 1)

    return (
        "[اطلاعات وضعیت زنده و تله‌متری سرور OmniOps]:\n"
        f"- پردازنده (CPU): {cpu_str}\n"
        f"- حافظه موقت (RAM): {ram_str}\n"
        f"- فضای ذخیره‌سازی دیسک: {disk_str}\n"
        f"- شتاب‌دهنده گرافیکی (GPU): {gpu_summary}\n"
        f"- مدل‌های هوش مصنوعی محلی موجود: {models_summary}\n"
        f"- پایداری سرور (Uptime): {uptime_hours} ساعت\n"
        f"- سیستم‌عامل سرور: {runtime.get('platform_string', platform.system())}"
    )


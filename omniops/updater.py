"""Modul-e barresi va emal-e be-rooz-resani-haye OmniOps az GitHub.

Checks for remote updates from GitHub repository (RedBoy-011/OmniOps),
provides real-time update notifications, and performs safe one-click pulls and frontend rebuilds.
Zero external dependencies.
"""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
import subprocess
import time
import urllib.request
from pathlib import Path
from typing import Any

logger = logging.getLogger("omniops.updater")

_CACHE_TTL_SECONDS = 300  # 5 minutes
_UPDATE_CACHE: dict[str, Any] = {"time": 0.0, "data": None}


def _get_repo_root(custom_root: Path | str | None = None) -> Path:
    if custom_root:
        return Path(custom_root).resolve()
    return Path(__file__).resolve().parent.parent


def get_current_commit(repo_root: Path | str | None = None) -> str | None:
    """Returns the current git commit hash of the local repository."""
    root = _get_repo_root(repo_root)
    try:
        res = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=5,
        )
        if res.returncode == 0 and res.stdout.strip():
            return res.stdout.strip()
    except Exception as exc:
        logger.debug("Failed to get current commit via git: %s", exc)

    # Fallback: inspect .git directory directly
    git_dir = root / ".git"
    try:
        head_file = git_dir / "HEAD"
        if head_file.is_file():
            content = head_file.read_text(encoding="utf-8").strip()
            if content.startswith("ref:"):
                ref_path = git_dir / content.removeprefix("ref:").strip()
                if ref_path.is_file():
                    return ref_path.read_text(encoding="utf-8").strip()
            elif len(content) == 40:
                return content
    except Exception:
        pass
    return None


def get_remote_commit(repo_root: Path | str | None = None, branch: str = "main") -> str | None:
    """Returns the latest commit hash from GitHub remote repository."""
    root = _get_repo_root(repo_root)

    # 1. Try git ls-remote first
    try:
        res = subprocess.run(
            ["git", "ls-remote", "origin", branch],
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=10,
        )
        if res.returncode == 0:
            for line in res.stdout.splitlines():
                parts = line.strip().split()
                if len(parts) >= 2 and parts[1] == f"refs/heads/{branch}":
                    return parts[0]
            if res.stdout.strip():
                return res.stdout.strip().split()[0]
    except Exception as exc:
        logger.debug("git ls-remote failed: %s", exc)

    # 2. Fallback to GitHub REST API with User-Agent
    try:
        req = urllib.request.Request(
            f"https://api.github.com/repos/RedBoy-011/OmniOps/commits/{branch}",
            headers={"User-Agent": "OmniOps-Updater/1.0", "Accept": "application/vnd.github.v3+json"},
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                sha = data.get("sha")
                if isinstance(sha, str) and len(sha) == 40:
                    return sha
    except Exception as exc:
        logger.debug("GitHub API commit check failed: %s", exc)

    return None


def check_for_updates(
    repo_root: Path | str | None = None,
    branch: str = "main",
    force_refresh: bool = False,
) -> dict[str, Any]:
    """Checks whether an update is available on GitHub and returns status info."""
    global _UPDATE_CACHE
    now = time.time()

    if not force_refresh and _UPDATE_CACHE["data"] is not None:
        if (now - _UPDATE_CACHE["time"]) < _CACHE_TTL_SECONDS:
            return dict(_UPDATE_CACHE["data"])

    current = get_current_commit(repo_root)
    remote = get_remote_commit(repo_root, branch)

    update_available = bool(current and remote and current != remote)
    error = None
    if not remote:
        error = "عدم امکان برقراری ارتباط با مخزن گیت‌هاب جهت بررسی به‌روزرسانی"

    result = {
        "update_available": update_available,
        "current_commit": current[:7] if current else "unknown",
        "current_full_commit": current or "",
        "latest_commit": remote[:7] if remote else (current[:7] if current else "unknown"),
        "latest_full_commit": remote or current or "",
        "branch": branch,
        "last_checked": int(now),
        "error": error,
    }

    _UPDATE_CACHE = {"time": now, "data": result}
    return result


def apply_update(repo_root: Path | str | None = None, branch: str = "main") -> dict[str, Any]:
    """Pulls latest updates from GitHub and rebuilds the web application."""
    global _UPDATE_CACHE
    root = _get_repo_root(repo_root)
    prev_commit = get_current_commit(root) or "unknown"

    # Step 1: git fetch
    fetch_res = subprocess.run(
        ["git", "fetch", "origin", branch],
        cwd=str(root),
        capture_output=True,
        text=True,
        timeout=30,
    )
    if fetch_res.returncode != 0:
        return {
            "status": "error",
            "message": f"خطا در دریافت تغییرات از گیت‌هاب (git fetch): {fetch_res.stderr.strip()}",
            "current_commit": prev_commit[:7],
        }

    # Step 2: git pull
    pull_res = subprocess.run(
        ["git", "pull", "--ff-only", "origin", branch],
        cwd=str(root),
        capture_output=True,
        text=True,
        timeout=45,
    )
    if pull_res.returncode != 0:
        # Fallback to normal pull if fast-forward fails
        pull_res = subprocess.run(
            ["git", "pull", "origin", branch],
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=45,
        )
        if pull_res.returncode != 0:
            return {
                "status": "error",
                "message": f"خطا در ادغام تغییرات گیت‌هاب (git pull): {pull_res.stderr.strip()}",
                "current_commit": prev_commit[:7],
            }

    new_commit = get_current_commit(root) or prev_commit

    # Step 3: Rebuild Web App frontend if npm is available
    rebuilt_frontend = False
    npm_path = shutil.which("npm")
    web_app_dir = root / "web" / "app"
    if npm_path and web_app_dir.is_dir():
        try:
            build_res = subprocess.run(
                ["npm", "run", "build"],
                cwd=str(web_app_dir),
                capture_output=True,
                text=True,
                timeout=90,
                shell=(subprocess.os.name == "nt"),
            )
            rebuilt_frontend = (build_res.returncode == 0)
        except Exception as exc:
            logger.warning("Frontend rebuild after update had warning: %s", exc)

    # Invalidate update cache so it immediately reflects latest commit
    _UPDATE_CACHE = {
        "time": time.time(),
        "data": {
            "update_available": False,
            "current_commit": new_commit[:7],
            "current_full_commit": new_commit,
            "latest_commit": new_commit[:7],
            "latest_full_commit": new_commit,
            "branch": branch,
            "last_checked": int(time.time()),
            "error": None,
        },
    }

    # Step 4: Sync release assets into the core downloads directory
    sync_res = sync_release_assets(root, branch)

    return {
        "status": "updated",
        "message": "سرور با موفقیت به آخرین نسخه گیت‌هاب به‌روزرسانی شد و فایل‌های انتشار به هسته کپی شدند.",
        "previous_commit": prev_commit[:7],
        "new_commit": new_commit[:7],
        "rebuilt_frontend": rebuilt_frontend,
        "release_assets_synced": True,
        "synced_files": sync_res.get("synced_files", []),
        "pull_output": pull_res.stdout.strip(),
        "restart_recommended": True,
    }


def compute_file_sha256(path: Path | str) -> str:
    """Computes SHA-256 checksum of a file on disk."""
    p = Path(path)
    if not p.is_file():
        return ""
    hasher = hashlib.sha256()
    try:
        with open(p, "rb") as f:
            while chunk := f.read(65536):
                hasher.update(chunk)
        return hasher.hexdigest()
    except Exception as exc:
        logger.warning("Failed to compute SHA-256 for %s: %s", p, exc)
        return ""


def format_size(size_bytes: int) -> str:
    """Formats bytes into human readable string (KB, MB, GB)."""
    if size_bytes <= 0:
        return "0 B"
    num = float(size_bytes)
    for unit in ["B", "KB", "MB", "GB"]:
        if num < 1024.0 or unit == "GB":
            return f"{num:.1f} {unit}" if unit != "B" else f"{int(num)} B"
        num /= 1024.0
    return f"{num:.1f} GB"


CORE_ARTIFACTS = [
    {
        "filename": "OmniOps-Edge-Setup.exe",
        "name": "ایجنت ویندوز دسکتاپ (Windows Desktop Edge)",
        "platform": "windows-x64",
        "category": "desktop",
        "description": "نصاب مستقیم ایجنت کپسولی شناور با کلید میانبر Alt+Space برای ویندوز ۱۰ و ۱۱ بدون نیاز به پایتون",
    },
    {
        "filename": "OmniOps-Mobile.apk",
        "name": "اپلیکیشن همراه اندروید (OmniOps Mobile)",
        "platform": "android",
        "category": "mobile",
        "description": "بسته نصبی رسمی اندروید با ارکستراتور سیار، تایید بیومتریک اثر انگشت و جزیره پویا",
    },
]


def get_core_downloads_info(repo_root: Path | str | None = None) -> dict[str, Any]:
    """Returns metadata, version, and SHA-256 checksums of core download artifacts."""
    root = _get_repo_root(repo_root)
    downloads_dir = root / "downloads"
    current_commit = get_current_commit(root)
    version = current_commit[:7] if current_commit else "v1.21.0"

    files_info = []
    seen_filenames = set()

    # 1. Process known core artifacts
    for item in CORE_ARTIFACTS:
        fname = item["filename"]
        seen_filenames.add(fname)
        target = downloads_dir / fname
        available = target.is_file()
        sha256 = compute_file_sha256(target) if available else ""
        size_bytes = target.stat().st_size if available else 0
        updated_at = int(target.stat().st_mtime) if available else None

        files_info.append({
            "filename": fname,
            "name": item["name"],
            "platform": item["platform"],
            "category": item["category"],
            "description": item["description"],
            "version": version,
            "size_bytes": size_bytes,
            "size_formatted": format_size(size_bytes),
            "sha256": sha256,
            "available_locally": available,
            "direct_url": f"/downloads/{fname}",
            "fallback_url": f"https://github.com/RedBoy-011/OmniOps/releases/latest/download/{fname}",
            "updated_at": updated_at,
        })

    # 2. Check for any additional binary artifacts in downloads/
    if downloads_dir.is_dir():
        for extra in downloads_dir.iterdir():
            if extra.is_file() and extra.name not in seen_filenames and not extra.name.endswith(".md"):
                sha = compute_file_sha256(extra)
                sz = extra.stat().st_size
                files_info.append({
                    "filename": extra.name,
                    "name": extra.stem.replace("-", " ").title(),
                    "platform": "windows" if extra.suffix == ".exe" else ("android" if extra.suffix == ".apk" else "generic"),
                    "category": "package",
                    "description": f"فایل نصبی {extra.name}",
                    "version": version,
                    "size_bytes": sz,
                    "size_formatted": format_size(sz),
                    "sha256": sha,
                    "available_locally": True,
                    "direct_url": f"/downloads/{extra.name}",
                    "fallback_url": f"https://github.com/RedBoy-011/OmniOps/releases/latest/download/{extra.name}",
                    "updated_at": int(extra.stat().st_mtime),
                })

    return {
        "status": "ok",
        "version": version,
        "commit": current_commit or "unknown",
        "downloads_dir_exists": downloads_dir.is_dir(),
        "files": files_info,
    }


def sync_release_assets(repo_root: Path | str | None = None, branch: str = "main") -> dict[str, Any]:
    """Copies/syncs newly prepared release files from GitHub or local builds into the core downloads directory."""
    root = _get_repo_root(repo_root)
    downloads_dir = root / "downloads"
    downloads_dir.mkdir(parents=True, exist_ok=True)
    synced_files = []

    # 1. Sync Windows Edge Setup if alternate name exists
    edge_exe = downloads_dir / "OmniOps-Edge-Setup.exe"
    agent_setup = downloads_dir / "omniops-agent-setup.exe"
    if not edge_exe.is_file() and agent_setup.is_file():
        shutil.copy2(agent_setup, edge_exe)
        synced_files.append("OmniOps-Edge-Setup.exe (from agent-setup)")
    elif edge_exe.is_file() and not agent_setup.is_file():
        shutil.copy2(edge_exe, agent_setup)

    # 2. Sync Android APK if build script exists or if one is present
    mobile_apk = downloads_dir / "OmniOps-Mobile.apk"
    if not mobile_apk.is_file():
        build_script = root / "scripts" / "build_android_apk.py"
        if build_script.is_file():
            try:
                subprocess.run(["python", str(build_script)], cwd=str(root), capture_output=True, timeout=30)
                if mobile_apk.is_file():
                    synced_files.append("OmniOps-Mobile.apk (built locally)")
            except Exception as exc:
                logger.debug("Local APK build attempt had error: %s", exc)

    # 3. Check GitHub Release assets fallback download if internet is accessible
    for artifact in ["OmniOps-Edge-Setup.exe", "OmniOps-Mobile.apk"]:
        dest = downloads_dir / artifact
        if not dest.is_file():
            gh_url = f"https://github.com/RedBoy-011/OmniOps/releases/latest/download/{artifact}"
            try:
                req = urllib.request.Request(gh_url, headers={"User-Agent": "OmniOps-Core/1.0"})
                with urllib.request.urlopen(req, timeout=10) as resp:
                    if resp.status == 200:
                        dest.write_bytes(resp.read())
                        synced_files.append(f"{artifact} (downloaded from GitHub release)")
            except Exception as exc:
                logger.debug("GitHub release asset fetch skipped for %s: %s", artifact, exc)

    current_info = get_core_downloads_info(root)
    return {
        "status": "ok",
        "message": f"فایل‌های انتشار در هسته همگام‌سازی شدند ({len(synced_files)} مورد جدید)",
        "synced_count": len(synced_files),
        "synced_files": synced_files,
        "files": current_info.get("files", []),
    }


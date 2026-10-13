"""Modul-e barresi va emal-e be-rooz-resani-haye OmniOps az GitHub.

Checks for remote updates from GitHub repository (RedBoy-011/OmniOps),
provides real-time update notifications, and performs safe one-click pulls and frontend rebuilds.
Zero external dependencies.
"""

from __future__ import annotations

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

    return {
        "status": "updated",
        "message": "سرور با موفقیت به آخرین نسخه گیت‌هاب به‌روزرسانی شد.",
        "previous_commit": prev_commit[:7],
        "new_commit": new_commit[:7],
        "rebuilt_frontend": rebuilt_frontend,
        "pull_output": pull_res.stdout.strip(),
        "restart_recommended": True,
    }

"""Barresi-ye faqat-khandani-e Master va Worker dar Ubuntu."""

import argparse
import json
import sqlite3
import subprocess
import sys
from pathlib import Path
from contextlib import closing
from urllib.error import URLError
from urllib.request import ProxyHandler, Request, build_opener

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from omniops.ollama import OllamaClient, OllamaError
from upgrade_config import parse_environment_file


def inspect(config: Path) -> tuple[dict, int]:
    result = {"service": "unknown", "master": "unknown", "database": "unknown", "worker": "unknown", "models": []}
    try:
        values = parse_environment_file(config)
    except (OSError, RuntimeError, ValueError):
        result["config"] = "missing_or_invalid"
        return result, 2
    result["config"] = "ok"
    try:
        check = subprocess.run(["systemctl", "is-active", "omniops-master.service"],
                               capture_output=True, text=True, timeout=5, check=False)
        result["service"] = "up" if check.returncode == 0 and check.stdout.strip() == "active" else "down"
    except (OSError, subprocess.TimeoutExpired):
        result["service"] = "down"

    host = values.get("OMNIOPS_BIND_HOST", "127.0.0.1")
    port = values.get("OMNIOPS_PORT", "9000")
    try:
        if not port.isdecimal() or not 1 <= int(port) <= 65535:
            raise ValueError("invalid port")
        opener = build_opener(ProxyHandler({}))
        with opener.open(Request(f"http://{host}:{port}/health"), timeout=4) as response:
            result["master"] = "up" if json.load(response).get("status") == "up" else "down"
    except (URLError, OSError, ValueError, json.JSONDecodeError):
        result["master"] = "down"

    endpoint = None
    try:
        path = Path(values["OMNIOPS_DB_PATH"])
        with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=3)) as db:
            quick_check = db.execute("PRAGMA quick_check").fetchone()
            result["database"] = "ok" if quick_check and quick_check[0] == "ok" else "failed"
            row = db.execute("SELECT value FROM settings WHERE name='ollama_endpoint'").fetchone()
            endpoint = row[0] if row else None
    except (KeyError, OSError, sqlite3.Error):
        result["database"] = "failed"
    endpoint = endpoint or values.get("OMNIOPS_OLLAMA_URL", "http://127.0.0.1:11434")
    try:
        models = OllamaClient(endpoint, timeout_seconds=4).list_models()
        result["worker"] = "up" if models else "no_models"
        result["models"] = [model.name for model in models]
    except (OllamaError, ValueError):
        result["worker"] = "unreachable"
    return result, 0 if all(result[key] == expected for key, expected in
                            (("service", "up"), ("master", "up"), ("database", "ok"), ("worker", "up"))) else 2


def main():
    parser = argparse.ArgumentParser(description="Read-only OmniOps Ubuntu diagnostics; never prints credentials")
    parser.add_argument("--config", type=Path, default=Path("/etc/omniops/master.env"))
    args = parser.parse_args()
    result, code = inspect(args.config)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return code


if __name__ == "__main__":
    raise SystemExit(main())

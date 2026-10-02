"""Negahdari-e kelid va database-e gateway-e feli pish az update."""

import argparse
import json
import os
import re
import shlex
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

KEYS = ("OMNIOPS_API_KEY", "OMNIOPS_SIGNING_KEY", "OMNIOPS_DB_PATH", "OMNIOPS_PORT", "OMNIOPS_OLLAMA_URL")


def find_live_gateway(repo: Path, proc: Path = Path("/proc")) -> tuple[int, Path, dict[str, str]] | None:
    matches = []
    for entry in proc.iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            args = (entry / "cmdline").read_bytes().split(b"\0")
            if not any(args[i:i + 2] == [b"-m", b"omniops.server"] for i in range(len(args) - 1)):
                continue
            cwd = (entry / "cwd").resolve(strict=True)
            if cwd != repo:
                continue
            environment = dict(field.split(b"=", 1) for field in (entry / "environ").read_bytes().split(b"\0") if b"=" in field)
            matches.append((int(entry.name), cwd, {
                key: environment[key.encode()].decode("utf-8") for key in KEYS if key.encode() in environment
            }))
        except (OSError, UnicodeDecodeError, ValueError):
            continue
    if len(matches) > 1:
        raise RuntimeError("Multiple OmniOps gateways are running in this repository; stop duplicates first")
    return matches[0] if matches else None


def parse_environment_file(path: Path) -> dict[str, str]:
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        parsed = shlex.split(line)
        if len(parsed) != 1 or "=" not in parsed[0]:
            raise RuntimeError("Existing master.env has an unsupported entry")
        key, value = parsed[0].split("=", 1)
        if key not in KEYS or key in values:
            raise RuntimeError("Existing master.env contains an unexpected or duplicate entry")
        values[key] = value
    return values


def prepare(repo: Path, config: Path, backups: Path, proc: Path = Path("/proc")) -> tuple[int, int]:
    repo = repo.resolve(strict=True)
    live = find_live_gateway(repo, proc)
    if config.exists():
        values = parse_environment_file(config)
        if live and any(values.get(key) != live[2].get(key) for key in ("OMNIOPS_API_KEY", "OMNIOPS_SIGNING_KEY")):
            raise RuntimeError("Running gateway keys differ from master.env; refusing to replace the live session")
        if config.stat().st_mode & 0o077:
            raise RuntimeError("master.env permissions must be restricted to its owner (chmod 600)")
    else:
        values = {key: value for key, value in os.environ.items() if key in KEYS}
        if live:
            # Gateway-e dar hale ejra kelidha va masire database ra moshakhas mikonad.
            values.update(live[2])
        if len(values.get("OMNIOPS_SIGNING_KEY", "").encode()) < 32 or len(values.get("OMNIOPS_API_KEY", "").encode()) < 32:
            raise RuntimeError("Original signing/API keys unavailable. Keep the running gateway alive or restore its original environment; no new keys were generated")
        base = live[1] if live else repo
        database = Path(values.get("OMNIOPS_DB_PATH", "data/identity.db"))
        values["OMNIOPS_DB_PATH"] = str((base / database).resolve())
        if not Path(values["OMNIOPS_DB_PATH"]).is_file():
            raise RuntimeError(f"Existing identity database not found: {values['OMNIOPS_DB_PATH']}; stopping before update")
        config.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(config.parent, 0o700)
        data = "".join(f"{key}={json.dumps(values[key], ensure_ascii=False)}\n" for key in KEYS if key in values)
        try:
            descriptor = os.open(config, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as destination:
                destination.write(data)
        except FileExistsError:
            raise RuntimeError("master.env appeared during update; retry safely") from None
    if len(values.get("OMNIOPS_SIGNING_KEY", "").encode()) < 32 or len(values.get("OMNIOPS_API_KEY", "").encode()) < 32:
        raise RuntimeError("Existing master.env has missing/short keys; original credentials required")
    try:
        port = int(values.get("OMNIOPS_PORT", "9000"))
        if not 1 <= port <= 65535:
            raise ValueError
    except ValueError:
        raise RuntimeError("Invalid OMNIOPS_PORT") from None
    database = Path(values.get("OMNIOPS_DB_PATH", "data/identity.db"))
    if not database.is_absolute():
        database = repo / database
    database = database.resolve()
    if not database.is_file():
        raise RuntimeError(f"Existing identity database not found: {database}; stopping before update")
    backups.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(backups, 0o700)
    backup = backups / f"identity-{datetime.now(timezone.utc):%Y%m%dT%H%M%S%fZ}.db"
    previous_umask = os.umask(0o077)
    try:
        source = sqlite3.connect(f"file:{quote(str(database))}?mode=ro", uri=True)
        target = sqlite3.connect(backup)
        try:
            source.backup(target)
        finally:
            source.close()
            target.close()
        os.chmod(backup, 0o600)
    finally:
        os.umask(previous_umask)
    print(f"Identity database backed up: {backup}", file=sys.stderr)
    return live[0] if live else 0, port


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--config", default="/etc/omniops/master.env", type=Path)
    parser.add_argument("--backups", default="/var/backups/omniops", type=Path)
    options = parser.parse_args()
    try:
        pid, port = prepare(options.repo, options.config, options.backups)
    except (OSError, RuntimeError, sqlite3.Error) as exc:
        print(f"OmniOps update stopped: {exc}", file=sys.stderr)
        raise SystemExit(1) from None
    print(f"{pid}|{port}")


if __name__ == "__main__":
    main()
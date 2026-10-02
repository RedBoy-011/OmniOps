"""Read the existing Master installation without changing keys or its HTTP port."""

import ipaddress
import os
import sys
from pathlib import Path

from scripts.upgrade_config import parse_environment_file


def read_master_settings(path: Path) -> tuple[str, int]:
    if os.name != "nt" and path.stat().st_mode & 0o077:
        raise ValueError("Master environment file must be restricted to its owner")
    values = parse_environment_file(path)
    host = values.get("OMNIOPS_BIND_HOST", "127.0.0.1")
    networks = [ipaddress.ip_network(cidr) for cidr in (
        "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
    )]
    try:
        address = ipaddress.IPv4Address(host)
        port = int(values.get("OMNIOPS_PORT", "9000"))
    except ValueError as exc:
        raise ValueError("Master needs a private IPv4 address and valid HTTP port") from exc
    if not any(address in network for network in networks) or not 1 <= port <= 65535:
        raise ValueError("Master needs a private IPv4 address and valid HTTP port")
    return host, port


if __name__ == "__main__":
    address, current_port = read_master_settings(Path(sys.argv[1]))
    print(f"{address}|{current_port}")

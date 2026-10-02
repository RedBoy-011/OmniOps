#!/usr/bin/env bash
# Nasb-e takrarpazir-e Ollama rooye Worker, faqat rooye IP-e khosusi.
set -Eeuo pipefail

fail() { printf 'Worker installation stopped: %s\n' "$*" >&2; exit 1; }
[[ "$(id -u)" == 0 ]] || fail 'Run as root on the worker.'
[[ -d /run/systemd/system ]] || fail 'A systemd host is required.'
[[ "$(uname -m)" == x86_64 ]] || fail 'This package targets x86_64 only.'
for binary in curl tar sha256sum python3 systemctl; do command -v "$binary" >/dev/null || fail "Missing prerequisite: $binary"; done

bind_ip=''
archive=''
version="${OLLAMA_VERSION:-v0.35.0}"
while (($#)); do
  case "$1" in
    --bind-ip) [[ $# -ge 2 ]] || fail '--bind-ip needs a value'; bind_ip="$2"; shift 2 ;;
    --archive) [[ $# -ge 2 ]] || fail '--archive needs a value'; archive="$2"; shift 2 ;;
    *) fail "Unsupported option: $1" ;;
  esac
done
[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Invalid OLLAMA_VERSION.'
[[ -n "$bind_ip" ]] || fail 'Provide --bind-ip with the worker private IPv4.'
python3 - "$bind_ip" <<'PY' || fail 'Bind IP must be a private LAN IPv4.'
import ipaddress, sys
address = ipaddress.IPv4Address(sys.argv[1])
assert any(address in network for network in map(ipaddress.ip_network, ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16')))
PY
ip -o -4 addr show | grep -F " $bind_ip/" >/dev/null || fail 'Bind IP is not configured on this worker.'

if [[ -e /etc/systemd/system/ollama.service && ! -f /etc/systemd/system/ollama.service.d/omniops.conf ]]; then
  fail 'An existing Ollama unit is managed outside OmniOps; review it before changing the bind address.'
fi
release="https://github.com/ollama/ollama/releases/download/$version"
asset='ollama-linux-amd64.tar.zst'
temporary=''
if [[ -z "$archive" ]]; then
  temporary="$(mktemp -d)"
  trap 'rm -f -- "$temporary/$asset"; rmdir -- "$temporary"' EXIT
  archive="$temporary/$asset"
  printf 'Downloading official Ollama %s (%s)...\n' "$version" "$asset"
  curl --proto '=https' --proto-redir '=https' --fail --location --retry 3 --retry-delay 3 --progress-bar "$release/$asset" -o "$archive"
fi
[[ -f "$archive" ]] || fail "Archive not found: $archive"
checksum="$(curl --proto '=https' --proto-redir '=https' --fail --silent --show-error --location --retry 3 "$release/sha256sum.txt" | awk '$2 == "./ollama-linux-amd64.tar.zst" {print $1}')"
[[ "$checksum" =~ ^[a-f0-9]{64}$ ]] || fail 'Official release checksum unavailable.'
printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --status || fail 'Ollama archive checksum mismatch.'
printf 'Checksum verified. Extracting package...\n'
tar --zstd -tf "$archive" >/dev/null || fail 'Invalid Ollama archive.'
tar --zstd -xf "$archive" -C /usr
[[ -x /usr/bin/ollama ]] || fail 'Ollama binary was not installed.'
if ! id ollama >/dev/null 2>&1; then useradd -r -s /usr/sbin/nologin -U -m -d /usr/share/ollama ollama; fi
install -d -o ollama -g ollama /usr/share/ollama
if [[ ! -e /etc/systemd/system/ollama.service ]]; then
  cat >/etc/systemd/system/ollama.service <<'UNIT'
[Unit]
Description=Ollama model worker
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/ollama serve
User=ollama
Group=ollama
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
fi
install -d /etc/systemd/system/ollama.service.d
printf '[Service]\nEnvironment="OLLAMA_HOST=%s:11434"\n' "$bind_ip" >/etc/systemd/system/ollama.service.d/omniops.conf
systemctl daemon-reload
systemctl enable ollama.service
systemctl restart ollama.service
for ((attempt=0; attempt<20; attempt++)); do
  if curl --noproxy '*' --fail --silent --max-time 2 "http://$bind_ip:11434/api/tags" | python3 -c 'import json,sys; assert isinstance(json.load(sys.stdin)["models"],list)' 2>/dev/null; then
    printf 'Worker API healthy on private address %s:11434; no public bind configured.\n' "$bind_ip"
    exit 0
  fi
  sleep 1
done
systemctl --no-pager -l status ollama.service >&2 || true
fail 'Ollama started but did not pass the local model API check.'

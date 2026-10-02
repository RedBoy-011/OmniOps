#!/usr/bin/env bash
# Nasb-e takrarpazir-e Ollama rooye Worker, faqat rooye IP-e khosusi.
set -Eeuo pipefail

fail() { printf 'Worker installation stopped: %s\n' "$*" >&2; exit 1; }
[[ "$(id -u)" == 0 ]] || fail 'Run as root on the worker.'
[[ -d /run/systemd/system ]] || fail 'A systemd host is required.'
[[ "$(uname -m)" == x86_64 ]] || fail 'This package targets x86_64 only.'
for binary in curl tar zstd sha256sum python3 systemctl ip df awk useradd install; do command -v "$binary" >/dev/null || fail "Missing prerequisite: $binary"; done

bind_ip=''
archive=''
models=()
non_interactive=false
version="${OLLAMA_VERSION:-v0.35.0}"
while (($#)); do
  case "$1" in
    --bind-ip) [[ $# -ge 2 ]] || fail '--bind-ip needs a value'; bind_ip="$2"; shift 2 ;;
    --archive) [[ $# -ge 2 ]] || fail '--archive needs a value'; archive="$2"; shift 2 ;;
    --model) [[ $# -ge 2 ]] || fail '--model needs a value'; models+=("$2"); shift 2 ;;
    --non-interactive) non_interactive=true; shift ;;
    *) fail "Unsupported option: $1" ;;
  esac
done
[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Invalid OLLAMA_VERSION.'

for model in "${models[@]}"; do
  [[ "$model" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,127}$ ]] || fail "Invalid model name: $model"
done
if [[ "${#models[@]}" -eq 0 && "$non_interactive" == false && -t 0 ]]; then
  printf 'Choose local models: 0) none  1) qwen3:0.6b (small chat)  2) qwen3:4b  3) bge-m3 (embedding)  4) small chat + embedding\n'
  read -r -p 'Model option [0]: ' choice
  case "${choice:-0}" in
    0) ;;
    1) models+=(qwen3:0.6b) ;;
    2) models+=(qwen3:4b) ;;
    3) models+=(bge-m3) ;;
    4) models+=(qwen3:0.6b bge-m3) ;;
    *) fail 'Invalid model option.' ;;
  esac
fi

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
binary_updated=false
if [[ ! -x /usr/bin/ollama || ! -f /etc/systemd/system/ollama.service.d/omniops.conf || -n "$archive" ]]; then
  available_kb="$(df -Pk /usr | awk 'NR==2 {print $4}')"
  [[ "$available_kb" =~ ^[0-9]+$ && "$available_kb" -ge 6291456 ]] || fail 'At least 6 GiB free disk is required before installing Ollama.'
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
binary_updated=true
[[ -x /usr/bin/ollama ]] || fail 'Ollama binary was not installed.'
else
  printf 'Existing OmniOps Ollama binary detected; reusing it.\n'
fi
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
old_override="$(cat /etc/systemd/system/ollama.service.d/omniops.conf 2>/dev/null || true)"
new_override="$(printf '[Service]\nEnvironment="OLLAMA_HOST=%s:11434"' "$bind_ip")"
if [[ "$old_override" != "$new_override" ]]; then
  printf '%s\n' "$new_override" >/etc/systemd/system/ollama.service.d/omniops.conf
  systemctl daemon-reload
fi
systemctl enable ollama.service
if [[ "$old_override" != "$new_override" || "$binary_updated" == true ]] || ! systemctl is-active --quiet ollama.service; then
  systemctl restart ollama.service
fi
for ((attempt=0; attempt<20; attempt++)); do
  if curl --noproxy '*' --fail --silent --max-time 2 "http://$bind_ip:11434/api/tags" | python3 -c 'import json,sys; assert isinstance(json.load(sys.stdin)["models"],list)' 2>/dev/null; then
    printf 'Worker API healthy on private address %s:11434; no public bind configured.\n' "$bind_ip"
    if ((${#models[@]})); then
      free_kb="$(df -Pk /usr/share/ollama | awk 'NR==2 {print $4}')"
      required_kb=2097152
      for model in "${models[@]}"; do
        case "$model" in
          qwen3:0.6b) required_kb=$((required_kb + 1048576)) ;;
          qwen3:4b) required_kb=$((required_kb + 3145728)) ;;
          bge-m3) required_kb=$((required_kb + 1572864)) ;;
          *) required_kb=$((required_kb + 1048576)) ;;
        esac
      done
      [[ "$free_kb" =~ ^[0-9]+$ && "$free_kb" -ge "$required_kb" ]] || fail 'Insufficient free disk for selected models; review capacity before download.'
      for model in "${models[@]}"; do
        printf 'Pulling selected model: %s\n' "$model"
        OLLAMA_HOST="$bind_ip:11434" /usr/bin/ollama pull "$model" || fail "Model download failed: $model"
      done
    fi
    exit 0
  fi
  sleep 1
done
systemctl --no-pager -l status ollama.service >&2 || true
fail 'Ollama started but did not pass the local model API check.'

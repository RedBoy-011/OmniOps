#!/usr/bin/env bash
# Nasb-e relay-e mahdood be Master baraye SOCKS dar Worker.
set -Eeuo pipefail
fail() { printf 'OmniOps SOCKS relay stopped: %s\n' "$*" >&2; exit 1; }
[[ "$(id -u)" == 0 ]] || fail 'Run as root on the intended Worker.'
[[ -d /run/systemd/system ]] || fail 'systemd is required.'
repo="$(pwd -P)"
[[ -f "$repo/omniops/proxy_relay.py" && -f "$repo/omniops/__init__.py" ]] || fail 'Run inside an updated OmniOps repository.'
master="${OMNIOPS_RELAY_MASTER_IP:-}"
listen="${OMNIOPS_RELAY_WORKER_IP:-}"
upstream="${OMNIOPS_RELAY_PROXY_IP:-}"
port="${OMNIOPS_RELAY_PORT:-17890}"
upstream_port="${OMNIOPS_RELAY_PROXY_PORT:-7890}"
if [[ -z "$master" || -z "$listen" || -z "$upstream" ]]; then
  [[ -r /dev/tty ]] || fail 'Set OMNIOPS_RELAY_MASTER_IP, OMNIOPS_RELAY_WORKER_IP and OMNIOPS_RELAY_PROXY_IP.'
  [[ -n "$master" ]] || read -r -p 'Private Master IP allowed to use relay: ' master </dev/tty
  [[ -n "$listen" ]] || read -r -p 'Private Worker IP to listen on: ' listen </dev/tty
  [[ -n "$upstream" ]] || read -r -p 'Private upstream SOCKS IP: ' upstream </dev/tty
fi
python3 - "$master" "$listen" "$upstream" "$port" "$upstream_port" <<'PY' || fail 'Invalid private relay address.'
from omniops.proxy_relay import private_ipv4
import sys
master, listen, upstream = map(private_ipv4, sys.argv[1:4])
assert master != listen
for port in sys.argv[4:]:
    assert port.isdecimal() and 1 <= int(port) <= 65535
assert 1024 <= int(sys.argv[4])
PY
if ! id -u omniops-relay >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /opt/omniops-relay --shell /usr/sbin/nologin omniops-relay
fi
install -d -o root -g root -m 0755 /opt/omniops-relay /opt/omniops-relay/omniops
install -m 0644 "$repo/omniops/__init__.py" /opt/omniops-relay/omniops/__init__.py
install -m 0644 "$repo/omniops/proxy_relay.py" /opt/omniops-relay/omniops/proxy_relay.py
unit=/etc/systemd/system/omniops-socks-relay.service
cat > "$unit" <<EOF
[Unit]
Description=OmniOps private SOCKS relay for Master
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=omniops-relay
Group=omniops-relay
WorkingDirectory=/opt/omniops-relay
ExecStart=/usr/bin/python3 -m omniops.proxy_relay --listen $listen --allow $master --upstream $upstream --port $port --upstream-port $upstream_port
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateDevices=true
PrivateTmp=true
CapabilityBoundingSet=
RestrictAddressFamilies=AF_INET AF_UNIX
IPAddressDeny=any
IPAddressAllow=$master/32
IPAddressAllow=$upstream/32

[Install]
WantedBy=multi-user.target
EOF
systemd-analyze verify "$unit" || fail 'Invalid relay service.'
systemctl daemon-reload
systemctl restart omniops-socks-relay.service
systemctl is-active --quiet omniops-socks-relay.service || fail 'Relay failed to start.'
systemctl enable omniops-socks-relay.service
printf 'SOCKS relay active on %s:%s for Master %s only.\n' "$listen" "$port" "$master"

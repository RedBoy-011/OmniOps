#!/usr/bin/env bash
# Nasb-e agent-e kam-hazineh ba karbar-e gheir-root rooye Worker-e Ubuntu.
set -Eeuo pipefail
fail() { printf 'OmniOps Worker stopped: %s\n' "$*" >&2; exit 1; }
[[ "$(id -u)" == 0 ]] || fail 'Run as root on the intended Worker.'
[[ -d /run/systemd/system ]] || fail 'systemd is required.'
for binary in python3 openssl curl systemctl runuser useradd; do command -v "$binary" >/dev/null || fail "Missing $binary"; done
repo="$(pwd -P)"
[[ -f "$repo/omniops/node_client.py" && -f "$repo/omniops/__init__.py" ]] || fail 'Run from an updated OmniOps repository.'
if [[ -n "${OMNIOPS_MASTER_URL:-}" ]]; then
  master_url="$OMNIOPS_MASTER_URL"
else
  [[ -r /dev/tty ]] || fail 'Provide OMNIOPS_MASTER_URL in noninteractive mode.'
  read -r -p 'Master private HTTPS origin (https://PRIVATE_IP:PORT): ' master_url </dev/tty
fi
if [[ -n "${OMNIOPS_CA_FILE:-}" ]]; then
  ca_source="$OMNIOPS_CA_FILE"
else
  [[ -r /dev/tty ]] || fail 'Provide OMNIOPS_CA_FILE in noninteractive mode.'
  read -r -p 'Trusted Master CA certificate path: ' ca_source </dev/tty
fi
[[ -r "$ca_source" && ! -L "$ca_source" ]] || fail 'CA certificate is missing or a symlink.'
python3 - "$master_url" <<'PY' || fail 'Master URL must be a private verified HTTPS origin.'
from omniops.node_client import validate_master_url
import sys
validate_master_url(sys.argv[1])
PY
actual_fingerprint="$(openssl x509 -in "$ca_source" -outform DER | openssl dgst -sha256 | awk '{print tolower($NF)}')"
[[ "$actual_fingerprint" =~ ^[0-9a-f]{64}$ ]] || fail 'Invalid CA certificate.'
ca_target=/etc/omniops-node/master-ca.crt
fingerprint_file=/etc/omniops-node/ca.sha256
if [[ -f "$fingerprint_file" ]]; then
  expected_fingerprint="$(cat "$fingerprint_file")"
elif [[ -n "${OMNIOPS_CA_SHA256:-}" ]]; then
  expected_fingerprint="${OMNIOPS_CA_SHA256,,}"
else
  [[ -r /dev/tty ]] || fail 'Provide OMNIOPS_CA_SHA256 from a trusted Master session.'
  read -r -p 'CA SHA256 fingerprint from the trusted Master SSH session: ' expected_fingerprint </dev/tty
  expected_fingerprint="${expected_fingerprint,,}"
fi
[[ "$expected_fingerprint" =~ ^[0-9a-f]{64}$ && "$actual_fingerprint" == "$expected_fingerprint" ]] || fail 'CA fingerprint mismatch; do not enroll.'
python3 - "$master_url" "$ca_source" <<'PY' || fail 'Master TLS certificate, SAN, or health could not be verified.'
from omniops.node_client import NodeClient
import json, sys
client = NodeClient(sys.argv[1], sys.argv[2])
with client.opener.open(client.master_url + '/health', timeout=5) as response:
    assert json.load(response)['status'] == 'up'
PY
state=/var/lib/omniops-node/node-identity.json
if [[ -e "$state" ]]; then
  installed_url="$(python3 - "$state" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as file:
    print(json.load(file)['master_url'])
PY
)"
  [[ "$installed_url" == "${master_url%/}" ]] || fail 'Existing node identity belongs to a different Master; revoke before reinstall.'
fi
if ! id -u omniops-node >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /var/lib/omniops-node --shell /usr/sbin/nologin omniops-node
fi
install -d -o omniops-node -g omniops-node -m 0700 /var/lib/omniops-node
install -d -o root -g root -m 0755 /opt/omniops-node /opt/omniops-node/omniops
install -m 0644 "$repo/omniops/__init__.py" /opt/omniops-node/omniops/__init__.py
install -m 0644 "$repo/omniops/node_client.py" /opt/omniops-node/omniops/node_client.py
install -d -o root -g root -m 0755 /etc/omniops-node
if [[ "$(realpath -- "$ca_source")" != "$(realpath -m -- "$ca_target")" ]]; then
  install -m 0644 "$ca_source" "$ca_target"
fi
printf '%s\n' "$expected_fingerprint" > "$fingerprint_file"
chmod 0644 "$fingerprint_file"
cd /opt/omniops-node
if [[ ! -e "$state" ]]; then
  node_name="${OMNIOPS_NODE_NAME:-$(hostname -s)}"
  if [[ -n "${OMNIOPS_GRANT_FILE:-}" ]]; then
    [[ "$OMNIOPS_GRANT_FILE" == /root/omniops-worker-grant && -f "$OMNIOPS_GRANT_FILE" && ! -L "$OMNIOPS_GRANT_FILE" ]] || fail 'Unexpected grant file path.'
    [[ "$(stat -c %a "$OMNIOPS_GRANT_FILE")" == 600 && "$(stat -c %u "$OMNIOPS_GRANT_FILE")" == 0 ]] || fail 'Grant file must belong to root with mode 0600.'
    runuser -u omniops-node -- python3 -m omniops.node_client --state "$state" --ca-file "$ca_target" \
      enroll --master "$master_url" --name "$node_name" --role worker --grant-stdin < "$OMNIOPS_GRANT_FILE"
    rm -f -- /root/omniops-worker-grant
  else
    [[ -r /dev/tty ]] || fail 'An interactive terminal is required to enter the one-time grant.'
    runuser -u omniops-node -- python3 -m omniops.node_client --state "$state" --ca-file "$ca_target" \
      enroll --master "$master_url" --name "$node_name" --role worker
  fi
fi
runuser -u omniops-node -- python3 -m omniops.node_client --state "$state" --ca-file "$ca_target" heartbeat || \
  fail 'Enrollment or verified heartbeat failed; service not enabled.'
ollama_url=http://127.0.0.1:11434
for candidate in 127.0.0.1 $(hostname -I); do
  [[ "$candidate" =~ ^[0-9.]+$ ]] || continue
  if curl --noproxy '*' -fsS --max-time 2 "http://$candidate:11434/api/tags" >/dev/null 2>&1; then
    ollama_url="http://$candidate:11434"
    break
  fi
done
python3 - "$ollama_url" <<'PY' || fail 'Ollama URL discovered outside the private network.'
from omniops.node_client import local_ollama_url
import os, sys
os.environ['OMNIOPS_LOCAL_OLLAMA_URL'] = sys.argv[1]
local_ollama_url()
PY
python_path="$(command -v python3)"
unit=/etc/systemd/system/omniops-worker-node.service
if [[ -f "$unit" ]] && ! grep -Fxq 'WorkingDirectory=/opt/omniops-node' "$unit"; then
  fail 'Existing unit belongs to another installation.'
fi
cat > "$unit" <<EOF
[Unit]
Description=OmniOps private Worker telemetry
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=omniops-node
Group=omniops-node
WorkingDirectory=/opt/omniops-node
StateDirectory=omniops-node
StateDirectoryMode=0700
Environment=OMNIOPS_LOCAL_OLLAMA_URL=$ollama_url
ExecStart=$python_path -m omniops.node_client --state $state --ca-file $ca_target run
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateDevices=true
PrivateTmp=true
ReadWritePaths=/var/lib/omniops-node
CapabilityBoundingSet=
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX

[Install]
WantedBy=multi-user.target
EOF
systemd-analyze verify "$unit"
systemctl daemon-reload
systemctl restart omniops-worker-node.service
systemctl is-active --quiet omniops-worker-node.service || fail 'Worker service did not start.'
systemctl enable omniops-worker-node.service
printf 'Worker service and authenticated heartbeat are active.\n'
printf 'Check: systemctl status omniops-worker-node.service\n'

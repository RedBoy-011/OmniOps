#!/usr/bin/env bash
# Port-e TLS-ye joda baraye Master, bedoon-e qat-e panel-e HTTP-e feli.
set -Eeuo pipefail
fail() { printf 'OmniOps Master TLS stopped: %s\n' "$*" >&2; exit 1; }
[[ "$(id -u)" == 0 ]] || fail 'Run as root on the existing Master.'
[[ -d /run/systemd/system ]] || fail 'systemd is required.'
for binary in python3 openssl curl systemctl systemd-analyze; do command -v "$binary" >/dev/null || fail "Missing $binary"; done
repo="$(pwd -P)"
[[ -f "$repo/omniops/tls_server.py" && -d "$repo/.git" ]] || fail 'Run inside an updated OmniOps repository.'
config=/etc/omniops/master.env
main_unit=/etc/systemd/system/omniops-master.service
[[ -r "$config" && -f "$main_unit" ]] || fail 'Update and start the existing Master first.'
grep -Fxq "WorkingDirectory=$repo" "$main_unit" || fail 'The current repository does not own the running Master.'
systemctl is-active --quiet omniops-master.service || fail 'Existing HTTP Master is not active.'
master_ip="$(python3 -c 'from scripts.upgrade_config import parse_environment_file; print(parse_environment_file("/etc/omniops/master.env").get("OMNIOPS_BIND_HOST", "127.0.0.1"))')"
[[ "$master_ip" != 127.0.0.1 ]] || fail 'Set a private LAN bind IP on the existing Master first.'
if [[ -n "${OMNIOPS_TLS_PORT:-}" ]]; then
  tls_port="$OMNIOPS_TLS_PORT"
else
  [[ -r /dev/tty ]] || fail 'Provide OMNIOPS_TLS_PORT when no interactive terminal is available.'
  read -r -p 'Private TLS port [9443]: ' tls_port </dev/tty
  tls_port="${tls_port:-9443}"
fi
[[ "$tls_port" =~ ^[0-9]+$ ]] && (( tls_port >= 1024 && tls_port <= 65535 )) || fail 'Choose a TCP port from 1024 to 65535.'
main_port="$(python3 -c 'from scripts.upgrade_config import parse_environment_file; print(parse_environment_file("/etc/omniops/master.env").get("OMNIOPS_PORT", "9000"))')"
[[ "$tls_port" != "$main_port" ]] || fail 'TLS port must differ from the existing HTTP port.'
unit=/etc/systemd/system/omniops-master-tls.service
if [[ -f "$unit" ]]; then
  grep -Fxq "WorkingDirectory=$repo" "$unit" || fail 'Existing TLS service belongs to a different repository.'
fi
pki=/etc/omniops/private-pki
bash "$repo/scripts/create-private-master-cert.sh" "$master_ip" "$pki"
python_path="$(command -v python3)"
cat > "$unit" <<EOF
[Unit]
Description=OmniOps private TLS Master
Requires=omniops-master.service
After=omniops-master.service
PartOf=omniops-master.service

[Service]
Type=simple
WorkingDirectory=$repo
EnvironmentFile=$config
ExecStart=/usr/bin/env OMNIOPS_PORT=$tls_port OMNIOPS_TLS_CERT=$pki/master.crt OMNIOPS_TLS_KEY=$pki/master.key $python_path -m omniops.tls_server
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemd-analyze verify "$unit"
systemctl daemon-reload
systemctl restart omniops-master-tls.service
for ((attempt=0; attempt<15; attempt++)); do
  if systemctl is-active --quiet omniops-master-tls.service && \
     curl --noproxy '*' --cacert "$pki/ca.crt" -fsS --max-time 2 "https://$master_ip:$tls_port/health" | \
       python3 -c 'import json,sys; assert json.load(sys.stdin)["status"] == "up"' 2>/dev/null; then
    systemctl enable omniops-master-tls.service
    renew_unit=/etc/systemd/system/omniops-master-tls-renew.service
    renew_timer=/etc/systemd/system/omniops-master-tls-renew.timer
    cat > "$renew_unit" <<RENEW
[Unit]
Description=Renew OmniOps private Master TLS certificate when due

[Service]
Type=oneshot
ExecStart=/bin/bash $repo/scripts/renew-private-master-tls.sh $master_ip $pki
RENEW
    cat > "$renew_timer" <<'TIMER'
[Unit]
Description=Check OmniOps private Master TLS certificate daily

[Timer]
OnCalendar=daily
Persistent=true
RandomizedDelaySec=1h

[Install]
WantedBy=timers.target
TIMER
    systemd-analyze verify "$renew_unit" "$renew_timer"
    systemctl daemon-reload
    systemctl enable --now omniops-master-tls-renew.timer
    printf 'Verified HTTPS Master: https://%s:%s/\n' "$master_ip" "$tls_port"
    printf 'Original HTTP Master remains on port %s.\n' "$main_port"
    printf 'Copy the public CA certificate through verified SSH: %s/ca.crt\n' "$pki"
    printf 'Allow TCP %s only from the Worker and trusted admin LAN IPs; do not expose it publicly.\n' "$tls_port"
    exit 0
  fi
  sleep 1
done
systemctl --no-pager -l status omniops-master-tls.service >&2 || true
fail 'TLS health check failed; existing HTTP Master was not modified.'

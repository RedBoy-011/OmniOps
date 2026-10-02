#!/usr/bin/env bash
# Tamdid-e leaf faghat dar soorat-e taghir; CA sabet mimanad.
set -Eeuo pipefail
[[ $# == 2 ]] || { printf 'Usage: renew-private-master-tls.sh PRIVATE_IP PKI_DIR\n' >&2; exit 1; }
[[ "$(id -u)" == 0 ]] || { printf 'Run as root.\n' >&2; exit 1; }
master_ip="$1"
pki="$2"
before='missing'
if [[ -f "$pki/master.crt" ]]; then before="$(sha256sum "$pki/master.crt" | awk '{print $1}')"; fi
bash "$(dirname -- "$0")/create-private-master-cert.sh" "$master_ip" "$pki"
after="$(sha256sum "$pki/master.crt" | awk '{print $1}')"
if [[ "$before" != "$after" ]]; then
  systemctl try-restart omniops-master-tls.service
  printf 'TLS leaf renewed and service restarted.\n'
fi

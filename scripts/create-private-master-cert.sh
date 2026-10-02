#!/usr/bin/env bash
# Govaahi-e dakheli baraye Master-e LAN; kelid-e CA az host kharej nemishavad.
set -Eeuo pipefail

fail() { printf 'OmniOps private TLS stopped: %s\n' "$*" >&2; exit 1; }
[[ $# == 2 ]] || fail 'Usage: create-private-master-cert.sh PRIVATE_MASTER_IP OUTPUT_DIRECTORY'
master_ip="$1"
certificate_dir="$2"
python3 - "$master_ip" <<'PY' || fail 'Master address must be a private IPv4 or loopback address.'
import ipaddress, sys
address = ipaddress.ip_address(sys.argv[1])
networks = [ipaddress.ip_network(n) for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")]
if not isinstance(address, ipaddress.IPv4Address) or not (address.is_loopback or any(address in n for n in networks)):
    raise SystemExit(1)
PY
command -v openssl >/dev/null || fail 'OpenSSL is required.'
[[ ! -L "$certificate_dir" ]] || fail 'Certificate directory must not be a symlink.'
umask 077
mkdir -p -- "$certificate_dir"
certificate_dir="$(realpath -- "$certificate_dir")"
[[ "$certificate_dir" != / ]] || fail 'Certificate directory must not be the filesystem root.'
chmod 0700 "$certificate_dir"
ca="$certificate_dir/ca.crt"
ca_key="$certificate_dir/ca.key"
leaf="$certificate_dir/master.crt"
leaf_key="$certificate_dir/master.key"
[[ ! -L "$ca" && ! -L "$ca_key" && ! -L "$leaf" && ! -L "$leaf_key" ]] || fail 'Certificate files must not be symlinks.'
if [[ -f "$ca" && ! -f "$ca_key" ]] || [[ ! -f "$ca" && -f "$ca_key" ]]; then
  fail 'Partial CA installation; repair it offline before retrying.'
fi
if [[ -f "$leaf" && ! -f "$leaf_key" ]] || [[ ! -f "$leaf" && -f "$leaf_key" ]]; then
  fail 'Partial Master certificate; repair it offline before retrying.'
fi
[[ ! -f "$leaf" || -f "$ca" ]] || fail 'Existing leaf without its issuing CA; repair offline.'
if [[ -f "$leaf" ]] && openssl x509 -checkend 2592000 -noout -in "$leaf" >/dev/null 2>&1 && \
   openssl verify -CAfile "$ca" -verify_ip "$master_ip" -purpose sslserver "$leaf" >/dev/null 2>&1 && \
   openssl x509 -in "$leaf" -noout -pubkey | openssl pkey -pubin -outform DER | openssl dgst -sha256 | \
       cmp -s - <(openssl pkey -in "$leaf_key" -pubout -outform DER | openssl dgst -sha256); then
  printf 'Existing Master certificate is valid for %s.\n' "$master_ip"
else
  scratch="$(mktemp -d "$certificate_dir/.issue.XXXXXXXX")"
  trap 'rm -rf -- "$scratch"' EXIT
  if [[ ! -f "$ca" ]]; then
    openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 3650 \
      -subj '/CN=OmniOps Private LAN CA' \
      -addext 'basicConstraints=critical,CA:TRUE,pathlen:0' \
      -addext 'keyUsage=critical,keyCertSign,cRLSign' \
      -keyout "$scratch/ca.key" -out "$scratch/ca.crt" >/dev/null 2>&1
    ca="$scratch/ca.crt"
    ca_key="$scratch/ca.key"
  fi
  openssl req -new -newkey rsa:3072 -sha256 -nodes \
    -subj "/CN=$master_ip" -keyout "$scratch/master.key" -out "$scratch/master.csr" >/dev/null 2>&1
  printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:%s\n' "$master_ip" > "$scratch/server.ext"
  openssl x509 -req -in "$scratch/master.csr" -CA "$ca" -CAkey "$ca_key" \
    -CAcreateserial -out "$scratch/master.crt" -days 365 -sha256 \
    -extfile "$scratch/server.ext" >/dev/null 2>&1
  openssl verify -CAfile "$ca" -verify_ip "$master_ip" -purpose sslserver "$scratch/master.crt" >/dev/null || fail 'Generated certificate failed verification.'
  if [[ "$ca" == "$scratch/ca.crt" ]]; then
    mv -- "$scratch/ca.key" "$certificate_dir/ca.key"
    mv -- "$scratch/ca.crt" "$certificate_dir/ca.crt"
  fi
  mv -- "$scratch/master.key" "$leaf_key"
  mv -- "$scratch/master.crt" "$leaf"
  chmod 0600 "$certificate_dir/ca.key" "$leaf_key"
  chmod 0644 "$certificate_dir/ca.crt" "$leaf"
  printf 'Master certificate issued for %s.\n' "$master_ip"
fi
openssl x509 -in "$certificate_dir/ca.crt" -outform DER | openssl dgst -sha256 | awk '{print tolower($NF)}'
printf 'Share only %s/ca.crt with the Worker over verified SSH.\n' "$certificate_dir"

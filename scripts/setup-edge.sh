#!/usr/bin/env bash
# اسکریپت فوق‌هوشمند راه‌اندازی و اتصال سرور لبه شبکه اینترنتی (Edge Node / آینه عمومی)
set -Eeuo pipefail

fail() { printf '\n❌ خطای سرور لبه (Edge): %s\n' "$*" >&2; exit 1; }
trap 'printf "\n⚠️ خطا در خط %s اسکریپت رخ داد.\n" "$LINENO" >&2' ERR

[[ "$(id -u)" == 0 ]] || fail 'این اسکریپت باید با دسترسی مدیر ارشد (root یا sudo) اجرا شود.'
[[ -d /run/systemd/system ]] || fail 'نیازمند سیستم‌عامل با پشتیبانی systemd است.'

# تابع خواندن امن از ترمینال کاربر حتی در صورت اجرای با curl | bash
prompt_terminal() {
  local prompt_text="$1"
  local var_name="$2"
  local default_val="${3:-}"
  local is_secret="${4:-0}"
  local res=""

  if [[ -r /dev/tty ]]; then
    if [[ "$is_secret" -eq 1 ]]; then
      read -s -r -p "$prompt_text" res </dev/tty || true
      printf '\n' >&2
    else
      read -r -p "$prompt_text" res </dev/tty || true
    fi
  elif [[ -t 0 ]]; then
    if [[ "$is_secret" -eq 1 ]]; then
      read -s -r -p "$prompt_text" res || true
      printf '\n' >&2
    else
      read -r -p "$prompt_text" res || true
    fi
  fi
  res="$(echo "${res:-$default_val}" | tr -d '\r\n')"
  eval "$var_name=\"\$res\""
}

printf '\n======================================================================\n'
printf '        راه‌اندازی سرور لبه شبکه اینترنتی OmniOps (Edge Node)\n'
printf '======================================================================\n\n'

cli_token=""
cli_domain=""
cli_master=""
while (($#)); do
  case "$1" in
    --token) [[ $# -ge 2 ]] || fail '--token نیازمند مقدار است'; cli_token="$2"; shift 2 ;;
    --domain) [[ $# -ge 2 ]] || fail '--domain نیازمند مقدار است'; cli_domain="$2"; shift 2 ;;
    --master) [[ $# -ge 2 ]] || fail '--master نیازمند مقدار است'; cli_master="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# ۱. نصب پیش‌نیازها و وب‌سرور Caddy
missing_tools=()
for tool in curl systemctl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    missing_tools+=("$tool")
  fi
done

if [[ "${#missing_tools[@]}" -gt 0 ]]; then
  apt-get update -y
  apt-get install -y "${missing_tools[@]}"
fi

if ! command -v caddy >/dev/null 2>&1; then
  printf 'در حال نصب رسمی وب‌سرور Caddy...\n'
  apt-get update -y
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg --yes
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

# ۲. دریافت نام دامنه عمومی اینترنتی
domain="${cli_domain:-${OMNIOPS_EDGE_DOMAIN:-}}"
while [[ -z "$domain" ]]; do
  prompt_terminal "نام دامنه عمومی سرور لبه (مثال: ops.yourdomain.com یا آی‌پی عمومی): " domain ""
  domain="$(echo "$domain" | tr -d '[:space:]')"
done

# ۳. دریافت آدرس سرور Master در شبکه داخلی یا تونل
master_target="${cli_master:-${OMNIOPS_EDGE_MASTER_TARGET:-}}"
token_candidate="${cli_token:-}"

if [[ -z "$master_target" && -n "$token_candidate" ]]; then
  raw_token="${token_candidate#omniops_*_}"
  master_target="$(python3 - "$raw_token" <<'PY'
import sys, json, base64
try:
    data = json.loads(base64.urlsafe_b64decode(sys.argv[1].encode()).decode())
    url = data.get('master_url', '')
    url = url.replace('https://', '').replace('http://', '')
    print(url)
except Exception:
    sys.exit(1)
PY
)" || true
fi

while [[ -z "$master_target" ]]; do
  prompt_terminal "آدرس داخلی سرور Master در شبکه خصوصی یا تونل (مثال: 172.19.30.94:9000): " master_target ""
  master_target="$(echo "$master_target" | tr -d '[:space:]')"
done

# در صورت نداشتن پورت، پیش‌فرض ۹۰۰۰ تنظیم شود
if [[ "$master_target" != *":"* ]]; then
  master_target="$master_target:9000"
fi
master_target="${master_target#http://}"
master_target="${master_target#https://}"

# ۴. تولید فایل پیکربندی Caddyfile
caddyfile="/etc/caddy/Caddyfile"
backup_caddyfile="/etc/caddy/Caddyfile.bak-$(date +%Y%m%d%H%M%S)"
if [[ -f "$caddyfile" ]]; then
  cp "$caddyfile" "$backup_caddyfile"
fi

cat > "$caddyfile" <<EOF
# تنظیمات درگاه لبه شبکه اینترنتی OmniOps Edge
$domain {
    reverse_proxy $master_target {
        header_up Host {upstream_hostport}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
EOF

# ۵. اعتبارسنجی و فعال‌سازی سرویس Caddy
printf 'در حال اعتبارسنجی پیکربندی Caddy...\n'
caddy validate --config "$caddyfile"
systemctl restart caddy
systemctl enable caddy

# ۶. نمایش وضعیت نهایی
cat << 'EOF'

╔══════════════════════════════════════════════════════════════════════╗
║             سرور لبه شبکه اینترنتی (Edge) با موفقیت فعال شد!         ║
╚══════════════════════════════════════════════════════════════════════╝
EOF
printf "  🌐 آدرس عمومی دسترسی:    https://%s/\n" "$domain"
printf "  🎯 هدایت ترافیک به Master: %s (شبکه خصوصی)\n" "$master_target"
printf "  🔒 گواهی امنیتی SSL:      خودکار (Caddy Let's Encrypt / ACME)\n"
printf "  ⚡ وضعیت سرویس:          فعال و پایدار (caddy.service: active)\n"
cat << 'EOF'
──────────────────────────────────────────────────────────────────────
  دستورات مدیریت سرور Edge:
    • وضعیت سرویس:   systemctl status caddy
    • مشاهده لاگ‌ها:    journalctl -u caddy -f
    • فایل تنظیمات:   /etc/caddy/Caddyfile
──────────────────────────────────────────────────────────────────────
  نکته امنیتی: مطمئن شوید پورت‌های ۸۰ و ۴۴۳ در فایروال اینترنت باز هستند
  و رکورد DNS دامنه به آی‌پی این سرور اشاره می‌کند.
══════════════════════════════════════════════════════════════════════
EOF
exit 0

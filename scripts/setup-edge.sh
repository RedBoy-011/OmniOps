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
for tool in curl systemctl python3 openssl; do
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

# تابع استخراج هوشمند اطلاعات سرور Master از توکن تبادل Edge
parse_and_apply_edge_token() {
  local raw_input="${1:-}"
  [[ -n "$raw_input" ]] || return 1

  local parsed=""
  parsed="$(python3 - "$raw_input" <<'PY'
import sys, re, json, base64

text = sys.argv[1].strip()
m = re.search(r'(omniops_[a-zA-Z0-9]+_[A-Za-z0-9_-]+)', text)
if not m:
    sys.exit(1)

token = m.group(1)
try:
    parts = token.split('_', 2)
    role = parts[1]
    raw = parts[2].rstrip('=')
    padded = raw + '=' * (-len(raw) % 4)
    data = json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
    url = str(data.get('master_url', '')).strip()
    url = url.replace('https://', '').replace('http://', '').split('/')[0]
    host = url.split(':')[0]
    if host:
        print(f"MASTER_TARGET={host}:9000")
        print(f"ROLE={role}")
except Exception:
    sys.exit(2)
PY
)" || return 1

  while IFS='=' read -r key val; do
    case "$key" in
      MASTER_TARGET) [[ -n "$val" ]] && master_target="$val" ;;
    esac
  done <<< "$parsed"

  [[ -n "$master_target" ]] && return 0
  return 1
}

token_candidate="${cli_token:-}"
master_target="${cli_master:-${OMNIOPS_EDGE_MASTER_TARGET:-}}"

if [[ -n "$token_candidate" ]]; then
  if parse_and_apply_edge_token "$token_candidate"; then
    printf '✅ توکن تبادل با موفقیت شناسایی شد. هدف Master: %s\n' "$master_target"
  fi
fi

# ۲. دریافت نام دامنه عمومی اینترنتی
domain="${cli_domain:-${OMNIOPS_EDGE_DOMAIN:-}}"
while [[ -z "$domain" ]]; do
  prompt_terminal "نام دامنه عمومی سرور لبه (مثال: ops.yourdomain.com یا آی‌پی عمومی): " domain ""
  domain="$(echo "$domain" | tr -d '[:space:]')"

  # اگر کاربر تصادفاً توکن را در نام دامنه پیست کرد
  if [[ "$domain" =~ omniops_ ]]; then
    parse_and_apply_edge_token "$domain" || true
    domain=""
    printf '💡 توکن شناسایی شد؛ اکنون نام دامنه عمومی این سرور لبه را وارد نمایید.\n'
  fi
done

# ۳. دریافت آدرس سرور Master در شبکه داخلی یا تونل
while [[ -z "$master_target" ]]; do
  prompt_terminal "آدرس داخلی سرور Master در شبکه خصوصی یا توکن تبادل (مثال: 172.19.30.94:9000): " master_target ""
  master_target="$(echo "$master_target" | tr -d '[:space:]')"

  if [[ "$master_target" =~ omniops_ ]]; then
    if parse_and_apply_edge_token "$master_target"; then
      printf '✅ توکن شناسایی شد. آدرس Master: %s\n' "$master_target"
      break
    fi
  fi
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

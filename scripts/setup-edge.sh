#!/usr/bin/env bash
# اسکریپت فوق‌هوشمند راه‌اندازی و اتصال سرور لبه شبکه اینترنتی (Edge Node / آینه عمومی)
set -Eeuo pipefail

fail() { printf '\n❌ خطای سرور لبه (Edge): %s\n' "$*" >&2; exit 1; }
trap 'printf "\n⚠️ خطا در خط %s اسکریپت رخ داد.\n" "$LINENO" >&2' ERR

[[ "$(id -u)" == 0 ]] || fail 'این اسکریپت باید با دسترسی مدیر ارشد (root یا sudo) اجرا شود.'
[[ -d /run/systemd/system ]] || fail 'نیازمند سیستم‌عامل با پشتیبانی systemd است.'

printf '\n======================================================================\n'
printf '        راه‌اندازی سرور لبه شبکه اینترنتی OmniOps (Edge Node)\n'
printf '======================================================================\n\n'

printf 'نقش سرور Edge:\n'
printf 'این سرور به عنوان درگاه عمومی اینترنتی با استفاده از وب‌سرور مدرن Caddy و گواهی خودکار\n'
printf 'SSL (ACME/Let'\''s Encrypt) عمل می‌کند و ترافیک را به سرور داخلی Master هدایت می‌نماید،\n'
printf 'بدون اینکه نیاز باشد پورت‌های سرورهای Master یا Worker روی اینترنت باز شوند.\n\n'

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
domain=""
while [[ -z "$domain" ]]; do
  if [[ -r /dev/tty && -t 0 ]]; then
    read -r -p "نام دامنه عمومی سرور لبه (مثال: ops.yourdomain.com یا آی‌پی عمومی): " domain </dev/tty || true
  else
    domain="${OMNIOPS_EDGE_DOMAIN:-}"
    [[ -n "$domain" ]] || fail 'متغیر OMNIOPS_EDGE_DOMAIN در حالت غیرتعاملی لازم است.'
  fi
  domain="$(echo "$domain" | tr -d '[:space:]')"
done

# ۳. دریافت آدرس سرور Master در شبکه داخلی یا تونل
master_target=""
while [[ -z "$master_target" ]]; do
  if [[ -r /dev/tty && -t 0 ]]; then
    read -r -p "آدرس داخلی سرور Master در شبکه خصوصی (مثال: 172.19.30.94:9000): " master_target </dev/tty || true
  else
    master_target="${OMNIOPS_EDGE_MASTER_TARGET:-}"
    [[ -n "$master_target" ]] || fail 'متغیر OMNIOPS_EDGE_MASTER_TARGET لازم است.'
  fi
  master_target="$(echo "$master_target" | tr -d '[:space:]')"
done

# در صورت نداشتن پورت، پیش‌فرض ۹۰۰۰ تنظیم شود
if [[ "$master_target" != *":"* ]]; then
  master_target="$master_target:9000"
fi
# حذف http/https از ابتدای آدرس جهت Caddyfile
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

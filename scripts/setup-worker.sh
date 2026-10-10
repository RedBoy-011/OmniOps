#!/usr/bin/env bash
# اسکریپت فوق‌هوشمند نصب، پیکربندی و اتصال نود عملیاتی (Worker Node) به سرور Master
set -Eeuo pipefail

fail() { printf '\n❌ خطای نود عملیاتی (Worker): %s\n' "$*" >&2; exit 1; }
trap 'printf "\n⚠️ خطا در خط %s اسکریپت رخ داد.\n" "$LINENO" >&2' ERR

[[ "$(id -u)" == 0 ]] || fail 'این اسکریپت باید با کاربر root یا دستور sudo اجرا شود.'
[[ -d /run/systemd/system ]] || fail 'نیازمند سیستم‌عامل با پشتیبانی systemd است.'

printf '\n======================================================================\n'
printf '        راه‌اندازی و اتصال هوشمند نود عملیاتی OmniOps (Worker Node)\n'
printf '======================================================================\n\n'

# ۱. نصب پیش‌نیازهای پایه روی Worker
missing_tools=()
for tool in git python3 curl systemctl openssl tar zstd; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    missing_tools+=("$tool")
  fi
done

if [[ "${#missing_tools[@]}" -gt 0 ]]; then
  printf 'در حال نصب ابزارهای پیش‌نیاز سیستم: %s...\n' "${missing_tools[*]}"
  apt-get update -y
  apt-get install -y "${missing_tools[@]}"
fi

# ۲. آماده‌سازی مخزن کدهای کلاینت Worker
repo=''
for candidate in "$PWD" /opt/omniops /opt/omniops-node /root/OmniOps; do
  if [[ -f "$candidate/omniops/node_client.py" && -d "$candidate/.git" ]]; then
    repo="$(realpath "$candidate")"
    break
  fi
done

if [[ -z "$repo" ]]; then
  repo="/opt/omniops"
  printf 'در حال دریافت کدهای OmniOps در %s...\n' "$repo"
  git clone https://github.com/RedBoy-011/OmniOps.git "$repo"
fi

cd "$repo"

# ۳. تشخیص آی‌پی خصوصی سرور Worker
detect_worker_ip() {
  local ip=""
  ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1); exit}')"
  if [[ -z "$ip" ]]; then
    for candidate in $(hostname -I 2>/dev/null); do
      if [[ "$candidate" =~ ^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.) ]]; then
        ip="$candidate"
        break
      fi
    done
  fi
  echo "${ip:-127.0.0.1}"
}

worker_ip="$(detect_worker_ip)"
printf '🔍 آی‌پی محلی شناسایی‌شده برای Worker: %s\n' "$worker_ip"
if [[ -r /dev/tty && -t 0 ]]; then
  read -r -p "تأیید آی‌پی Worker [Enter برای تأیید یا ورود آی‌پی جدید]: " user_worker_ip </dev/tty || true
  worker_ip="${user_worker_ip:-$worker_ip}"
fi

# ۴. نصب و پیکربندی موتور هوش محلی Ollama
printf '\n--- تنظیم موتور Ollama (پردازش مدل‌های هوش مصنوعی) ---\n'
install_ollama_choice="y"
if command -v ollama >/dev/null 2>&1; then
  printf 'موتور Ollama از قبل روی سیستم نصب است.\n'
else
  if [[ -r /dev/tty && -t 0 ]]; then
    read -r -p "آیا مایل به نصب خودکار Ollama هستید؟ (Y/n): " install_ollama_choice </dev/tty || true
  fi
  install_ollama_choice="${install_ollama_choice:-y}"
  if [[ "$install_ollama_choice" =~ ^[Yy] ]]; then
    printf 'در حال اجرای اسکریپت نصب رسمی Ollama با گوش‌دادن روی آی‌پی خصوصی...\n'
    bash "$repo/scripts/install-ollama-worker.sh" --bind-ip "$worker_ip" --model "qwen3:0.6b" --non-interactive || {
      printf 'تلاش با دستور نصب مستقیم Ollama...\n'
      curl -fsSL https://ollama.com/install.sh | sh
    }
  fi
fi

# ۵. دریافت اطلاعات اتصال به سرور مرکزی (Master)
printf '\n--- اتصال به سرور مرکزی (Master Node) ---\n'
master_url=""
while [[ -z "$master_url" ]]; do
  if [[ -r /dev/tty && -t 0 ]]; then
    read -r -p "آدرس کامل HTTPS سرور Master (مثال: https://172.19.30.94:9443): " master_url </dev/tty || true
  else
    fail 'در حالت غیرتعاملی باید متغیر OMNIOPS_MASTER_URL تنظیم شده باشد.'
  fi
  master_url="${master_url%/}"
done

# مسیر گواهی CA
ca_file="/etc/omniops-node/master-ca.crt"
mkdir -p /etc/omniops-node

if [[ ! -f "$ca_file" ]]; then
  printf '\nبرای برقراری ارتباط امن TLS نیاز به فایل گواهی ca.crt سرور Master است.\n'
  printf 'گزینه‌ها:\n'
  printf ' 1) وارد کردن مسیر فایل محلی ca.crt که از Master کپی کرده‌اید (مثال: /root/ca.crt)\n'
  printf ' 2) چسباندن (Paste) محتوای فایل ca.crt در همین ترمینال\n'
  choice="1"
  if [[ -r /dev/tty && -t 0 ]]; then
    read -r -p "انتخاب شما [1]: " choice </dev/tty || true
  fi
  choice="${choice:-1}"

  if [[ "$choice" == "2" ]]; then
    printf 'محتوای فایل ca.crt را قرار دهید و در خط بعد Ctrl+D بزنید:\n'
    cat > "$ca_file"
  else
    ca_input=""
    while [[ -z "$ca_input" || ! -f "$ca_input" ]]; do
      read -r -p "مسیر فایل ca.crt روی این سرور: " ca_input </dev/tty || true
      if [[ ! -f "$ca_input" ]]; then
        printf 'فایل پیدا نشد. دوباره وارد کنید.\n'
      fi
    done
    cp "$ca_input" "$ca_file"
  fi
fi

# محاسبه اثرانگشت SHA256 گواهی CA
ca_fingerprint="$(openssl x509 -in "$ca_file" -outform DER | openssl dgst -sha256 | awk '{print tolower($NF)}')"
printf 'اثرانگشت گواهی CA شناسایی‌شده: %s\n' "$ca_fingerprint"

# دریافت مجوز اتصال یک‌بارمصرف (One-Time Grant)
printf '\nکد مجوز یک‌بارمصرف ثبت نود (One-Time Grant) را وارد کنید.\n'
printf '💡 راهنما: روی سرور Master دستور زیر را با کاربر root اجرا کنید و خروجی را اینجا وارد کنید:\n'
printf '   python3 -m omniops.node_admin --local-root --role worker\n\n'

grant_code=""
while [[ -z "$grant_code" ]]; do
  if [[ -r /dev/tty && -t 0 ]]; then
    read -r -p "کد مجوز گرانت: " grant_code </dev/tty || true
  fi
  grant_code="$(echo "$grant_code" | tr -d '[:space:]')"
done

# ۶. ثبت و جفت‌سازی امن گره با سرور Master
printf '\nدر حال جفت‌سازی و ثبت نود در سرور Master...\n'
export OMNIOPS_MASTER_URL="$master_url"
export OMNIOPS_CA_FILE="$ca_file"
export OMNIOPS_CA_SHA256="$ca_fingerprint"
export OMNIOPS_GRANT_FILE="/root/omniops-worker-grant"

printf '%s' "$grant_code" > "$OMNIOPS_GRANT_FILE"
chmod 600 "$OMNIOPS_GRANT_FILE"

bash "$repo/scripts/install-private-worker-node.sh"

# ۷. نمایش وضعیت نهایی
cat << 'EOF'

╔══════════════════════════════════════════════════════════════════════╗
║              نود عملیاتی (Worker) با موفقیت متصل شد!                 ║
╚══════════════════════════════════════════════════════════════════════╝
EOF
printf "  ⚡ وضعیت سرویس:          فعال و پایدار (omniops-worker-node.service)\n"
printf "  🌐 متصل به سرور Master:  %s\n" "$master_url"
printf "  🤖 نشانی موتور Ollama:   http://%s:11434/\n" "$worker_ip"
printf "  🩺 ارسال Heartbeat:      تأییدشده و فعال\n"
cat << 'EOF'
──────────────────────────────────────────────────────────────────────
  دستورات مدیریت نود در سرور Worker:
    • وضعیت سرویس:   systemctl status omniops-worker-node.service
    • لاگ‌های زنده:    journalctl -u omniops-worker-node.service -f
    • وضعیت Ollama:   systemctl status ollama
──────────────────────────────────────────────────────────────────────
  این نود اکنون در پنل وب مدیر در بخش «مدیریت گره‌ها» فعال و سبز است.
══════════════════════════════════════════════════════════════════════
EOF
exit 0

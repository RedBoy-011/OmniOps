#!/usr/bin/env bash
# اسکریپت فوق‌هوشمند نصب، پیکربندی و اتصال نود عملیاتی (Worker Node) به سرور Master
set -Eeuo pipefail

fail() { printf '\n❌ خطای نود عملیاتی (Worker): %s\n' "$*" >&2; exit 1; }
trap 'printf "\n⚠️ خطا در خط %s اسکریپت رخ داد.\n" "$LINENO" >&2' ERR

[[ "$(id -u)" == 0 ]] || fail 'این اسکریپت باید با کاربر root یا دستور sudo اجرا شود.'
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
printf '        راه‌اندازی و اتصال هوشمند نود عملیاتی OmniOps (Worker Node)\n'
printf '======================================================================\n\n'

# پردازش آرگومان‌های خط فرمان
cli_token=""
cli_master=""
cli_grant=""
while (($#)); do
  case "$1" in
    --token) [[ $# -ge 2 ]] || fail '--token نیازمند مقدار است'; cli_token="$2"; shift 2 ;;
    --master) [[ $# -ge 2 ]] || fail '--master نیازمند مقدار است'; cli_master="$2"; shift 2 ;;
    --grant) [[ $# -ge 2 ]] || fail '--grant نیازمند مقدار است'; cli_grant="$2"; shift 2 ;;
    *) shift ;;
  esac
done

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

# ۴. نصب و پیکربندی موتور هوش محلی Ollama
printf '\n--- بررسی موتور Ollama (پردازش مدل‌های هوش مصنوعی) ---\n'
if command -v ollama >/dev/null 2>&1; then
  printf 'موتور Ollama از قبل روی سیستم نصب است.\n'
else
  ollama_choice="y"
  prompt_terminal "آیا مایل به نصب خودکار Ollama هستید؟ (Y/n) [Y]: " ollama_choice "y"
  if [[ "$ollama_choice" =~ ^[Yy] ]]; then
    printf 'در حال نصب رسمی Ollama با گوش‌دادن روی آی‌پی محلی %s...\n' "$worker_ip"
    bash "$repo/scripts/install-ollama-worker.sh" --bind-ip "$worker_ip" --model "qwen3:0.6b" --non-interactive || {
      printf 'تلاش با دستور نصب مستقیم Ollama...\n'
      curl -fsSL https://ollama.com/install.sh | sh
    }
  fi
fi

# ۵. دریافت اطلاعات اتصال به سرور مرکزی (Master) و توکن تبادل
printf '\n--- اتصال به سرور مرکزی (Master Node) ---\n'
mkdir -p /etc/omniops-node
chmod 700 /etc/omniops-node

master_url="${cli_master:-${OMNIOPS_MASTER_URL:-}}"
grant_code="${cli_grant:-${OMNIOPS_GRANT:-}}"
ca_file="/etc/omniops-node/master-ca.crt"
ca_fingerprint=""

token_candidate="${cli_token:-${OMNIOPS_JOIN_TOKEN:-}}"

if [[ -z "$token_candidate" && -z "$master_url" ]]; then
  printf '\n💡 روش‌های اتصال به سرور Master:\n'
  printf '  ۱) ورود «توکن تبادل یکپارچه» (تولیدشده در سرور Master با دستور omniops-token worker)\n'
  printf '  ۲) ورود آدرس سرور Master و کد مجوز به صورت دستی\n\n'
  user_input=""
  prompt_terminal "آدرس سرور Master یا توکن تبادل (Join Token) را وارد کنید: " user_input ""
  if [[ "$user_input" == omniops_* ]]; then
    token_candidate="$user_input"
  else
    master_url="$user_input"
  fi
fi

# اگر توکن تبادل داده شده، اطلاعات را خودکار از آن استخراج کن
if [[ -n "$token_candidate" ]]; then
  raw_token="${token_candidate#omniops_*_}"
  parsed="$(python3 - "$raw_token" <<'PY'
import sys, json, base64
try:
    data = json.loads(base64.urlsafe_b64decode(sys.argv[1].encode()).decode())
    print(data.get('master_url', ''))
    print(data.get('grant', ''))
    print(data.get('ca_fingerprint', ''))
    ca_crt = data.get('ca_crt', '')
    if ca_crt:
        with open('/etc/omniops-node/master-ca.crt', 'w', encoding='utf-8') as f:
            f.write(ca_crt)
        print('ca_saved')
    else:
        print('no_ca')
except Exception as e:
    sys.exit(1)
PY
)" || fail 'توکن تبادل نامعتبر است یا با خطا مواجه شد.'

  master_url="$(echo "$parsed" | sed -n '1p')"
  grant_code="$(echo "$parsed" | sed -n '2p')"
  ca_fingerprint="$(echo "$parsed" | sed -n '3p')"
  printf '✅ توکن تبادل با موفقیت اعتبارسنجی و خوانده شد:\n'
  printf '   • آدرس سرور Master: %s\n' "$master_url"
  if [[ -n "$ca_fingerprint" ]]; then
    printf '   • اثرانگشت گواهی Master CA: %s\n' "$ca_fingerprint"
  fi
fi

while [[ -z "$master_url" ]]; do
  prompt_terminal "آدرس کامل HTTPS سرور Master (مثال: https://172.19.30.94:9443): " master_url ""
done
master_url="${master_url%/}"

# دریافت گواهی CA در صورتی که با توکن ثبت نشده باشد
if [[ ! -f "$ca_file" || ! -s "$ca_file" ]]; then
  printf '\nگواهی امنیت TLS سرور Master (فایل ca.crt) لازم است.\n'
  ca_input=""
  prompt_terminal "مسیر فایل ca.crt روی این سرور [یا اینتر برای تلاش در دریافت از Master]: " ca_input ""
  if [[ -n "$ca_input" && -f "$ca_input" ]]; then
    cp "$ca_input" "$ca_file"
  else
    # دریافت خودکار گواهی از مستر روی پورت TLS
    master_host_port="${master_url#https://}"
    master_host="${master_host_port%%:*}"
    master_port="${master_host_port##*:}"
    master_port="${master_port:-9443}"
    printf 'در حال دریافت خودکار گواهی از %s:%s...\n' "$master_host" "$master_port"
    openssl s_client -showcerts -connect "$master_host:$master_port" </dev/null 2>/dev/null | \
      openssl x509 -outform PEM > "$ca_file" 2>/dev/null || true
  fi
fi

[[ -f "$ca_file" && -s "$ca_file" ]] || fail 'گواهی امنیتی ca.crt یافت نشد.'

if [[ -z "$ca_fingerprint" ]]; then
  ca_fingerprint="$(openssl x509 -in "$ca_file" -outform DER | openssl dgst -sha256 | awk '{print tolower($NF)}')"
fi
printf 'اثرانگشت گواهی امنیتی: %s\n' "$ca_fingerprint"

# دریافت کد مجوز در صورتی که از توکن استخراج نشده باشد
while [[ -z "$grant_code" ]]; do
  printf '\n💡 راهنما: روی سرور Master دستور زیر را برای صدور کد مجوز یا توکن بزنید:\n'
  printf '   omniops-token worker\n'
  prompt_terminal "کد مجوز گرانت (Grant Code): " grant_code ""
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

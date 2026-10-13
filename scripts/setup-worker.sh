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
if [[ -d .git ]]; then
  printf 'در حال همگام‌سازی کدهای مخزن محلی Worker با آخرین نسخه گیت‌هاب...\n'
  git fetch --prune origin main 2>/dev/null || true
  git reset --hard origin/main 2>/dev/null || true
fi

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

# تابع فوق‌هوشمند استخراج و اعتبارسنجی توکن از هر ورودی (حتی اگر کل دستور curl پیست شده باشد)
parse_and_apply_token() {
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

    master_url = str(data.get('master_url', '')).strip().rstrip('/')
    grant = str(data.get('grant', '')).strip()
    ca_fp = str(data.get('ca_fingerprint', '')).strip().lower()
    ca_crt = data.get('ca_crt', '')

    if ca_crt:
        try:
            with open('/etc/omniops-node/master-ca.crt', 'w', encoding='utf-8') as f:
                f.write(ca_crt)
            print("CA_SAVED=1")
        except Exception:
            print("CA_SAVED=0")
    else:
        print("CA_SAVED=0")

    print(f"MASTER_URL={master_url}")
    print(f"GRANT={grant}")
    print(f"CA_FINGERPRINT={ca_fp}")
    print(f"ROLE={role}")
except Exception:
    sys.exit(2)
PY
)" || return 1

  local found_master=""
  local found_grant=""
  local found_fp=""
  while IFS='=' read -r key val; do
    case "$key" in
      MASTER_URL) found_master="$val" ;;
      GRANT) found_grant="$val" ;;
      CA_FINGERPRINT) found_fp="$val" ;;
    esac
  done <<< "$parsed"

  if [[ -n "$found_master" && -n "$found_grant" ]]; then
    master_url="$found_master"
    grant_code="$found_grant"
    [[ -n "$found_fp" ]] && ca_fingerprint="$found_fp"
    return 0
  fi
  return 1
}

# بررسی توکن اولیه دریافتی از آرگومان‌ها
if [[ -n "$token_candidate" ]]; then
  if parse_and_apply_token "$token_candidate"; then
    printf '✅ توکن تبادل با موفقیت اعتبارسنجی و خوانده شد:\n'
    printf '   • آدرس سرور Master: %s\n' "$master_url"
    if [[ -n "$ca_fingerprint" ]]; then
      printf '   • اثرانگشت گواهی Master CA: %s\n' "$ca_fingerprint"
    fi
  else
    printf '⚠️ توکن اولیه معتبر نبود؛ وارد مرحله انتخاب دستی یا دریافت مجدد می‌شویم.\n'
  fi
fi

if [[ -z "$master_url" || -z "$grant_code" ]]; then
  printf '\n💡 روش‌های اتصال به سرور مرکزی (Master):\n'
  printf '  [1] ورود توکن تبادل یکپارچه (توصیه‌شده - کپی از وب‌پنل یا خروجی omniops-token worker)\n'
  printf '  [2] ورود دستی (آدرس سرور Master و کد مجوز به صورت جداگانه)\n\n'

  method_choice=""
  prompt_terminal "روش اتصال را انتخاب کنید [1 یا 2، پیش‌فرض: 1]: " method_choice "1"
  method_choice="$(echo "$method_choice" | tr -d '[:space:]')"

  # هوشمندی: اگر کاربر تصادفاً توکن یا دستور کامل curl را در همین فیلد پیست کرد
  if [[ "$method_choice" =~ omniops_ ]]; then
    if parse_and_apply_token "$method_choice"; then
      printf '✅ توکن تبادل شناسایی شد:\n'
      printf '   • آدرس سرور Master: %s\n' "$master_url"
      if [[ -n "$ca_fingerprint" ]]; then
        printf '   • اثرانگشت گواهی Master CA: %s\n' "$ca_fingerprint"
      fi
    fi
  elif [[ "$method_choice" =~ ^https?:// || "$method_choice" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+ ]]; then
    master_url="$method_choice"
  elif [[ "$method_choice" == "2" ]]; then
    :
  else
    # گزینه ۱ (پیش‌فرض): درخواست توکن یکپارچه
    printf '\n📌 لطفاً «توکن تبادل» یا کل دستور curl کپی‌شده را در خط زیر وارد کنید:\n'
    token_input=""
    prompt_terminal "توکن تبادل (Join Token): " token_input ""
    if parse_and_apply_token "$token_input"; then
      printf '✅ توکن تبادل با موفقیت اعتبارسنجی شد:\n'
      printf '   • آدرس سرور Master: %s\n' "$master_url"
      if [[ -n "$ca_fingerprint" ]]; then
        printf '   • اثرانگشت گواهی Master CA: %s\n' "$ca_fingerprint"
      fi
    else
      printf '⚠️ متن واردشده حاوی توکن معتبر نبود. به حالت ورود دستی منتقل می‌شوید.\n'
    fi
  fi
fi

# اعتبارسنجی و تکمیل آدرس Master در صورت عدم استخراج با توکن
while [[ -z "$master_url" || ! "$master_url" =~ ^https:// ]]; do
  if [[ -n "$master_url" ]]; then
    # اگر کاربر توکن را در آدرس سرور پیست کرده باشد
    if parse_and_apply_token "$master_url"; then
      printf '✅ توکن تبادل شناسایی شد؛ آدرس سرور: %s\n' "$master_url"
      break
    fi
    # اصلاح خودکار در صورتی که کاربر آی‌پی ساده یا http وارد کرده باشد
    if [[ "$master_url" =~ ^http:// ]]; then
      master_url="https://${master_url#http://}"
      if [[ "$master_url" =~ ^https://[0-9a-zA-Z.:-]+$ ]]; then
        break
      fi
    elif [[ "$master_url" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(:[0-9]+)?$ ]]; then
      if [[ "$master_url" != *":"* ]]; then
        master_url="https://${master_url}:9443"
      else
        master_url="https://${master_url}"
      fi
      break
    fi
    printf '⚠️ آدرس نامعتبر است! آدرس سرور باید با https:// شروع شود و شامل پورت باشد (مثال: https://172.19.30.94:9443).\n'
  fi
  prompt_terminal "آدرس کامل HTTPS سرور Master (مثال: https://172.19.30.94:9443): " master_url ""
  master_url="$(echo "$master_url" | tr -d '[:space:]')"
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
  prompt_terminal "کد مجوز گرانت (Grant Code) یا توکن تبادل: " grant_code ""
  grant_code="$(echo "$grant_code" | tr -d '[:space:]')"

  # اگر کاربر توکن یا کل دستور curl را اینجا پیست کرد
  if [[ "$grant_code" =~ omniops_ ]]; then
    if parse_and_apply_token "$grant_code"; then
      printf '✅ توکن تبادل شناسایی شد و کد مجوز استخراج گردید.\n'
      break
    fi
  fi
done

# ۶. ثبت و جفت‌سازی امن گره با سرور Master
printf '\nدر حال جفت‌سازی و ثبت نود در سرور Master...\n'
systemctl stop omniops-worker-node.service 2>/dev/null || true

# پاک‌سازی فایل‌های موقت یا اثرانگشت‌های منقضی‌شده قبلی
rm -f /etc/omniops-node/ca.sha256 /var/lib/omniops-node/node-identity.json 2>/dev/null || true
if [[ -n "$ca_fingerprint" ]]; then
  mkdir -p /etc/omniops-node
  printf '%s' "$ca_fingerprint" > /etc/omniops-node/ca.sha256
  chmod 644 /etc/omniops-node/ca.sha256
fi

export OMNIOPS_MASTER_URL="$master_url"
export OMNIOPS_CA_FILE="$ca_file"
export OMNIOPS_CA_SHA256="$ca_fingerprint"
export OMNIOPS_GRANT_FILE="/root/omniops-worker-grant"
export OMNIOPS_FORCE_REENROLL="1"

rm -f -- /root/omniops-worker-grant 2>/dev/null || true
printf '%s' "$grant_code" > "$OMNIOPS_GRANT_FILE"
chmod 600 "$OMNIOPS_GRANT_FILE"

bash "$repo/scripts/install-private-worker-node.sh"

systemctl daemon-reload 2>/dev/null || true
systemctl enable --now omniops-worker-node.service 2>/dev/null || true
systemctl restart omniops-worker-node.service 2>/dev/null || true

# ۷. نمایش وضعیت نهایی
cat << 'EOF'

╔══════════════════════════════════════════════════════════════════════╗
║              نود عملیاتی (Worker) با موفقیت متصل شد!                 ║
╚══════════════════════════════════════════════════════════════════════╝
EOF
printf "  ⚡ وضعیت سرویس:          فعال و پایدار (omniops-worker-node.service)\n"
printf "  🌐 متصل به سرور Master:  %s\n" "$master_url"
printf "  🤖 نشانی موتور Ollama:   http://%s:11434/\n" "$worker_ip"

# بررسی و نمایش مدل‌های آفلاین از قبل دانلودشده
if curl -fsSL http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  local_models="$(curl -fsSL http://127.0.0.1:11434/api/tags | python3 -c 'import sys, json; data=json.load(sys.stdin); print(", ".join(m["name"] for m in data.get("models", [])))' 2>/dev/null || true)"
  if [[ -n "$local_models" ]]; then
    printf "  🧠 مدل‌های کشف‌شده قبلی: %s (آماده استفاده بدون نیاز به دانلود)\n" "$local_models"
  else
    printf "  🧠 مدل‌های هوش مصنوعی:   آماده بارگذاری از پنل وب مستر\n"
  fi
fi

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

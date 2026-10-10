#!/usr/bin/env bash
# اسکریپت فوق‌هوشمند نصب، پیکربندی و به‌روزرسانی OmniOps Master برای اوبونتو
set -Eeuo pipefail

fail() { printf '\n❌ خطای توقف OmniOps: %s\n' "$*" >&2; exit 1; }
trap 'printf "\n⚠️ اسکریپت در خط %s با خطا مواجه شد. اطلاعات پایگاه‌داده ریست نشد.\n" "$LINENO" >&2' ERR

[[ "$(id -u)" == 0 ]] || fail 'این اسکریپت باید با دسترسی مدیر ارشد (root یا sudo) اجرا شود.'
[[ -d /run/systemd/system ]] || fail 'این اسکریپت نیازمند توزیع اوبونتو/دبیان همراه با systemd است.'

# ۱. نصب خودکار پیش‌نیازهای پایه‌ای سیستم در صورت عدم وجود
missing_tools=()
for tool in git python3 curl systemctl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    missing_tools+=("$tool")
  fi
done

if [[ "${#missing_tools[@]}" -gt 0 ]]; then
  printf 'در حال نصب ابزارهای پیش‌نیاز: %s...\n' "${missing_tools[*]}"
  apt-get update -y
  apt-get install -y "${missing_tools[@]}"
fi

# ۲. پیدا کردن پوشه مخزن یا کلون خودکار در صورت نصب تازه
repo=''
repositories=()
for candidate in "$PWD" /opt/omniops /root/OmniOps/OmniOps /root/OmniOps; do
  [[ -f "$candidate/omniops/server.py" && -d "$candidate/.git" ]] || continue
  origin="$(git -C "$candidate" remote get-url origin 2>/dev/null || true)"
  [[ "$origin" == *'github.com/RedBoy-011/OmniOps'* ]] || continue
  candidate="$(realpath "$candidate")"
  if [[ ! " ${repositories[*]} " == *" $candidate "* ]]; then repositories+=("$candidate"); fi
done

if [[ "${#repositories[@]}" -eq 0 ]]; then
  target="/opt/omniops"
  printf 'هیچ مخزن فعالی پیدا نشد. در حال دریافت خودکار کد از گیت‌هاب در %s...\n' "$target"
  git clone https://github.com/RedBoy-011/OmniOps.git "$target"
  repo="$target"
else
  # اولویت با فرایند در حال اجرا، سپس دایرکتوری فعلی
  for process in /proc/[0-9]*; do
    [[ -r "$process/cmdline" ]] || continue
    command_line="$(tr '\0' ' ' < "$process/cmdline" 2>/dev/null || true)"
    [[ "$command_line" == *'-m omniops.server'* ]] || continue
    process_directory="$(readlink -f "$process/cwd" 2>/dev/null || true)"
    for candidate in "${repositories[@]}"; do
      if [[ "$candidate" == "$process_directory" ]]; then
        repo="$candidate"
        break 2
      fi
    done
  done
  if [[ -z "$repo" ]]; then
    for candidate in "${repositories[@]}"; do
      if [[ "$candidate" == "$(realpath "$PWD")" ]]; then repo="$candidate"; break; fi
    done
  fi
  if [[ -z "$repo" ]]; then
    repo="${repositories[0]}"
  fi
fi

cd "$repo"
printf 'مخزن فعال: %s\n' "$repo"

# ۳. تشخیص خودکار آی‌پی سرور برای دسترسی شبکه (LAN IP Detection)
detect_lan_ip() {
  local ip=""
  # ۱. بررسی IP کارت شبکه متصل به اینترنت یا گیت‌وی
  ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1); exit}')"
  # ۲. در غیر این صورت استخراج از کارت‌های شبکه خصوصی
  if [[ -z "$ip" ]]; then
    for candidate in $(hostname -I 2>/dev/null); do
      if [[ "$candidate" =~ ^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.) ]]; then
        ip="$candidate"
        break
      fi
    done
  fi
  if [[ -z "$ip" ]]; then
    ip="127.0.0.1"
  fi
  echo "$ip"
}

config=/etc/omniops/master.env
saved_host=""
if [[ -f "$config" ]]; then
  saved_host="$(sed -n 's/^OMNIOPS_BIND_HOST=//p' "$config" | tr -d '"'\'' ' | head -n 1)"
fi

if [[ -z "${OMNIOPS_BIND_HOST:-}" ]]; then
  if [[ -n "$saved_host" ]]; then
    export OMNIOPS_BIND_HOST="$saved_host"
  else
    detected_ip="$(detect_lan_ip)"
    if [[ -r /dev/tty && -t 0 ]]; then
      printf '\n=======================================================\n'
      printf '🔍 آی‌پی شبکه شناسایی‌شده سرور: %s\n' "$detected_ip"
      read -r -p "آیا مایلید پنل روی این آی‌پی گوش دهد؟ [Enter برای تأیید یا ورود آی‌پی]: " user_ip </dev/tty || true
      export OMNIOPS_BIND_HOST="${user_ip:-$detected_ip}"
    else
      export OMNIOPS_BIND_HOST="$detected_ip"
    fi
  fi
fi
printf '🌐 نشانی اتصال شبکه: %s\n' "$OMNIOPS_BIND_HOST"

# ۴. بررسی وجود پایگاه‌داده و ایجاد خودکار حساب مدیر ارشد در صورت نصب تازه
db_file="$repo/data/identity.db"
needs_bootstrap=0
if [[ ! -f "$db_file" ]]; then
  needs_bootstrap=1
else
  active_admins="$(python3 -c "import sqlite3; db=sqlite3.connect('$db_file'); print(db.execute(\"SELECT COUNT(*) FROM users WHERE role='superadmin' AND status='active'\").fetchone()[0])" 2>/dev/null || echo 0)"
  if [[ "$active_admins" -lt 1 ]]; then
    needs_bootstrap=1
  fi
fi

admin_user_created=""
if [[ "$needs_bootstrap" -eq 1 ]]; then
  printf '\n======================================================================\n'
  printf '       پیکربندی اولیه: ساخت حساب کاربری مدیر ارشد (SuperAdmin)\n'
  printf '======================================================================\n'
  mkdir -p "$repo/data"
  chmod 700 "$repo/data"

  export OMNIOPS_API_KEY="${OMNIOPS_API_KEY:-$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')}"
  export OMNIOPS_SIGNING_KEY="${OMNIOPS_SIGNING_KEY:-$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')}"

  admin_user=""
  while [[ -z "$admin_user" ]]; do
    if [[ -r /dev/tty && -t 0 ]]; then
      read -r -p "نام کاربری مدیر ارشد [پیش‌فرض: admin]: " admin_user </dev/tty || true
    fi
    admin_user="${admin_user:-admin}"
  done

  admin_mobile=""
  while [[ -z "$admin_mobile" ]]; do
    if [[ -r /dev/tty && -t 0 ]]; then
      read -r -p "شماره موبایل مدیر ارشد [پیش‌فرض: 09120000000]: " admin_mobile </dev/tty || true
    fi
    admin_mobile="${admin_mobile:-09120000000}"
  done

  admin_pass=""
  while true; do
    if [[ -r /dev/tty && -t 0 ]]; then
      read -s -r -p "رمز عبور مدیر ارشد (حداقل ۱۲ نویسه): " admin_pass </dev/tty || true
      printf '\n'
      read -s -r -p "تکرار رمز عبور مدیر ارشد: " admin_pass_confirm </dev/tty || true
      printf '\n'
    else
      admin_pass="$(python3 -c 'import secrets; print(secrets.token_urlsafe(16))')"
      admin_pass_confirm="$admin_pass"
      printf 'رمز عبور تصادفی برای مدیر ارشد ایجاد شد: %s\n' "$admin_pass"
    fi

    if [[ "${#admin_pass}" -lt 12 ]]; then
      printf '⚠️ رمز عبور باید حداقل ۱۲ نویسه باشد. لطفاً دوباره وارد کنید.\n' >&2
      continue
    fi
    if [[ "$admin_pass" != "$admin_pass_confirm" ]]; then
      printf '⚠️ رمزهای عبور مطابقت ندارند. لطفاً دوباره وارد کنید.\n' >&2
      continue
    fi
    break
  done

  python3 -c "
import sys
from pathlib import Path
sys.path.insert(0, '$repo')
from omniops.identity import IdentityStore
store = IdentityStore(Path('$db_file'), '$OMNIOPS_SIGNING_KEY'.encode())
store.bootstrap_admin('$admin_user', '$admin_pass', '$admin_mobile')
"
  admin_user_created="$admin_user"
  printf '✅ حساب مدیر ارشد "%s" با موفقیت در پایگاه‌داده ایجاد شد.\n' "$admin_user"
  printf '======================================================================\n\n'
fi

# ۵. آماده‌سازی و اعتبارسنجی تنظیمات پایدار و بک‌آپ دیتابیس
unit=/etc/systemd/system/omniops-master.service
if [[ -f "$unit" ]] && ! grep -Fxq "WorkingDirectory=$repo" "$unit"; then
  fail "یک سرویس سیستمی دیگر به مخزن متفاوتی متصل است: $unit"
fi

helper="$(mktemp)"
trap 'rm -f "$helper"' EXIT
git show origin/main:scripts/upgrade_config.py > "$helper" 2>/dev/null || cp "$repo/scripts/upgrade_config.py" "$helper"
runtime="$(python3 "$helper" --repo "$repo")"
IFS='|' read -r old_pid port bind_host <<< "$runtime"
rm -f "$helper"
trap - EXIT

[[ "$old_pid" =~ ^[0-9]+$ && "$port" =~ ^[0-9]+$ && -n "$bind_host" ]] || fail 'تنظیمات درگاه معتبر نیست.'

# ۶. به‌روزرسانی کد مخزن
git fetch --prune origin main
git merge --ff-only origin/main 2>/dev/null || true

# ۷. بررسی و نصب خودکار Node.js 24 و nvm در صورت نیاز
if [[ -f /root/.nvm/nvm.sh ]]; then
  export NVM_DIR=/root/.nvm
  . "$NVM_DIR/nvm.sh"
elif [[ -f "$HOME/.nvm/nvm.sh" ]]; then
  export NVM_DIR="$HOME/.nvm"
  . "$NVM_DIR/nvm.sh"
fi

if ! command -v node >/dev/null || ! command -v npm >/dev/null || [[ ! "$(node --version 2>/dev/null)" =~ ^v24\. ]]; then
  if ! command -v nvm >/dev/null; then
    installer="$(mktemp)"
    trap 'rm -f "$installer"' EXIT
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh -o "$installer"
    bash "$installer"
    export NVM_DIR=/root/.nvm
    [[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh"
  fi
  nvm install 24
fi

# ۸. نصب کتابخانه‌های پایتون مورد نیاز
if ! python3 -c 'from cryptography.fernet import Fernet' 2>/dev/null; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y python3-cryptography
  python3 -c 'from cryptography.fernet import Fernet' || fail 'کتابخانه python3-cryptography در دسترس نیست.'
fi

# ۹. کامپایل و بیلد پنل وب فارسی
printf 'در حال ساخت فایل‌های پنل وب فارسی (React + Vite)...\n'
(cd "$repo/web/app" && npm ci && npm run build)

# ۱۰. اجرای آزمون‌های خودکار هسته
printf 'در حال اعتبارسنجی و اجرای آزمون‌های هسته...\n'
python3 -m unittest discover -s tests -q

# ۱۱. پیکربندی و راه‌اندازی سرویس systemd
python_path="$(command -v python3)"
cat > "$unit" <<EOF
[Unit]
Description=OmniOps development master
After=network.target

[Service]
Type=simple
WorkingDirectory=$repo
EnvironmentFile=$config
ExecStart=$python_path -m omniops.server
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemd-analyze verify "$unit"
systemctl daemon-reload

if [[ "$old_pid" != 0 ]] && ! systemctl is-active --quiet omniops-master.service && kill -0 "$old_pid" 2>/dev/null; then
  current_cwd="$(readlink -f "/proc/$old_pid/cwd" 2>/dev/null || true)"
  current_command="$(tr '\0' ' ' < "/proc/$old_pid/cmdline" 2>/dev/null || true)"
  if [[ "$current_cwd" == "$repo" && "$current_command" == *"-m omniops.server"* ]]; then
    kill -TERM "$old_pid" 2>/dev/null || true
    for ((attempt=0; attempt<20; attempt++)); do
      kill -0 "$old_pid" 2>/dev/null || break
      sleep 0.5
    done
  fi
fi

systemctl restart omniops-master.service

# ۱۲. اعتبارسنجی سلامت و بالا آمدن سرویس
service_healthy=0
for ((attempt=0; attempt<25; attempt++)); do
  if systemctl is-active --quiet omniops-master.service && curl -fsS --max-time 2 "http://$bind_host:$port/health" 2>/dev/null | python3 -c 'import json,sys; assert json.load(sys.stdin)["status"] == "up"' 2>/dev/null; then
    systemctl enable omniops-master.service
    service_healthy=1
    break
  fi
  sleep 1
done

[[ "$service_healthy" == 1 ]] || {
  systemctl --no-pager -l status omniops-master.service >&2 || true
  fail 'سرویس پس از راه‌اندازی پاسخ سالم نداد. دستور بررسی لاگ: journalctl -u omniops-master.service -n 60 --no-pager'
}

# ۱۳. فعال‌سازی خودکار درگاه امن TLS 1.3 روی پورت ۹۴۴۳ برای اتصال گره‌های Worker/Edge
if [[ ! -f /etc/systemd/system/omniops-master-tls.service ]]; then
  printf 'در حال فعال‌سازی درگاه امن TLS 1.3 برای گره‌ها (پورت ۹۴۴۳)...\n'
  export OMNIOPS_TLS_PORT=9443
  bash "$repo/scripts/install-private-master-tls.sh" || true
else
  systemctl restart omniops-master-tls.service 2>/dev/null || true
fi

# ۱۴. ایجاد میانبر سیستمی برای صدور آسان توکن تبادل گره‌ها
chmod +x "$repo/scripts/issue-token.sh" 2>/dev/null || true
ln -sf "$repo/scripts/issue-token.sh" /usr/local/bin/omniops-token 2>/dev/null || true

# تولید یک توکن اتصال اولیه برای نمایش به کاربر
worker_token="$(python3 -m omniops.node_admin --local-root --role worker --token --raw 2>/dev/null || true)"

# ۱۵. نمایش زیبا و کامل اطلاعات ورود به پنل و وضعیت سیستم
cat << 'EOF'

╔══════════════════════════════════════════════════════════════════════╗
║               OmniOps با موفقیت نصب و فعال شد!                       ║
╚══════════════════════════════════════════════════════════════════════╝
EOF
printf "  🌐 آدرس پنل وب:          http://%s:%s/\n" "$bind_host" "$port"
if [[ -n "$admin_user_created" ]]; then
  printf "  👤 نام کاربری مدیر ارشد:  %s\n" "$admin_user_created"
else
  printf "  👤 نام کاربری مدیر ارشد:  حساب کاربری فعال قبلی\n"
fi
printf "  ⚡ وضعیت سرویس:          فعال و پایدار (omniops-master.service: active)\n"
printf "  🔒 درگاه امن گره‌ها:     https://%s:9443/ (TLS 1.3)\n" "$bind_host"
printf "  🩺 بررسی سلامت هسته:     http://%s:%s/health\n" "$bind_host" "$port"
printf "  📦 نسخهٔ برنامه:          %s\n" "$(git rev-parse --short HEAD)"

if [[ -n "$worker_token" ]]; then
cat << EOF
──────────────────────────────────────────────────────────────────────
  🚀 دستور آماده اتصال نود عملیاتی (Worker Node):
  این دستور را کپی کنید و در ترمینال سرور Worker پیست نمایید تا خودکار وصل شود:

  curl -fsSL https://raw.githubusercontent.com/RedBoy-011/OmniOps/main/scripts/setup-worker.sh | bash -s -- --token $worker_token
──────────────────────────────────────────────────────────────────────
  💡 برای صدور توکن‌های تبادل جدید در هر زمان، در همین سرور دستور زیر را بزنید:
     omniops-token worker    (برای اتصال سرور عملیاتی)
     omniops-token edge      (برای اتصال سرور لبه)
EOF
fi

cat << 'EOF'
──────────────────────────────────────────────────────────────────────
  دستورات مدیریت سرویس در لینوکس:
    • وضعیت سرویس:   systemctl status omniops-master.service
    • لاگ‌های زنده:    journalctl -u omniops-master.service -f
    • راه‌اندازی مجدد: systemctl restart omniops-master.service
──────────────────────────────────────────────────────────────────────
  گام‌های بعدی:
  ۱. آدرس بالا را در مرورگر سیستم خود باز کنید و وارد پنل شوید.
  ۲. برای جفت‌سازی ایجنت ویندوز، از تب «ایجنت» در پنل کد پین ۶ رقمی بگیرید.
══════════════════════════════════════════════════════════════════════
EOF
exit 0
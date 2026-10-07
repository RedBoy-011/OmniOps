#!/usr/bin/env bash
# ==============================================================================
# OmniOps Enterprise Studio - Master Node One-Line Installer
# ==============================================================================
# Installs and launches the core OmniOps enterprise cluster on Ubuntu Server.
# Includes: PostgreSQL 16, Redis 7, Qdrant Vector DB, LiteLLM, and Master Core.
# ==============================================================================

set -Eeuo pipefail

COLOR_RESET="\033[0m"
COLOR_CYAN="\033[1;36m"
COLOR_GREEN="\033[1;32m"
COLOR_YELLOW="\033[1;33m"
COLOR_RED="\033[1;31m"
COLOR_BOLD="\033[1m"

log_info() {
    printf "${COLOR_CYAN}[OmniOps Master] INFO:${COLOR_RESET} %s\n" "$*"
}

log_success() {
    printf "${COLOR_GREEN}[OmniOps Master] SUCCESS:${COLOR_RESET} %s\n" "$*"
}

log_warn() {
    printf "${COLOR_YELLOW}[OmniOps Master] WARNING:${COLOR_RESET} %s\n" "$*"
}

log_fail() {
    printf "${COLOR_RED}[OmniOps Master] ERROR:${COLOR_RESET} %s\n" "$*" >&2
    exit 1
}

if [[ "$(id -u)" -ne 0 ]]; then
    log_fail "این اسکریپت باید با دسترسی روت (root / sudo) اجرا شود."
fi

# Detect OS
if [[ ! -f /etc/os-release ]]; then
    log_fail "فایل /etc/os-release یافت نشد. این اسکریپت مخصوص سرور اوبونتو است."
fi
. /etc/os-release
if [[ "$ID" != "ubuntu" && "$ID" != "debian" ]]; then
    log_warn "توزیع لینوکس شناسایی‌شده: $ID. این اسکریپت برای Ubuntu بهینه‌سازی شده است."
fi

log_info "بررسی و نصب پیش‌نیازها..."
apt-get update -y -q
apt-get install -y -q curl wget openssl ca-certificates gnupg lsb-release ufw

# Check Docker
if ! command -v docker &>/dev/null; then
    log_info "داکر بر روی سیستم یافت نشد. در حال نصب Docker Engine..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
fi

# Check Docker Compose plugin
if ! docker compose version &>/dev/null; then
    log_info "پلاگین docker-compose یافت نشد. در حال نصب..."
    apt-get install -y -q docker-compose-plugin || apt-get install -y -q docker-compose
fi

# Detect Local LAN IP
LAN_IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || hostname -I | awk '{print $1}')"
if [[ -z "$LAN_IP" ]]; then
    LAN_IP="127.0.0.1"
fi

INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P || echo "")"
if [[ -z "$INSTALL_DIR" || ! -f "$INSTALL_DIR/docker-compose.yml" ]]; then
    log_info "فایل‌های کلاستر به صورت محلی یافت نشد؛ در حال کلون کردن مخزن RedBoy-011/OmniOps در /opt/omniops..."
    INSTALL_BASE="/opt/omniops"
    mkdir -p "$INSTALL_BASE"
    apt-get install -y -q git
    if [[ -d "$INSTALL_BASE/.git" ]]; then
        cd "$INSTALL_BASE"
        git fetch origin
        git reset --hard origin/main || true
    else
        git clone https://github.com/RedBoy-011/OmniOps.git "$INSTALL_BASE"
    fi
    INSTALL_DIR="$INSTALL_BASE/cluster/master"
fi
ENV_FILE="$INSTALL_DIR/.env"

# Custom Port Configuration
CUSTOM_PORT="${OMNIOPS_BIND_PORT:-}"
if [[ -z "$CUSTOM_PORT" ]]; then
    printf "\n${COLOR_CYAN}[تنظیمات پورت سرور مستر]${COLOR_RESET}\n"
    printf "پورت پیش‌فرض سرویس هسته مرکزی و وب‌سرویس: ${COLOR_BOLD}8000${COLOR_RESET}\n"
    if [[ -e /dev/tty ]]; then
        read -r -p "شماره پورت مورد نظر را وارد کنید [اینتر برای تایید 8000]: " INPUT_PORT < /dev/tty
    else
        read -r -p "شماره پورت مورد نظر را وارد کنید [اینتر برای تایید 8000]: " INPUT_PORT
    fi
    CUSTOM_PORT="${INPUT_PORT:-8000}"
fi
log_info "پورت فعال سرور مستر: $CUSTOM_PORT"

if [[ ! -f "$ENV_FILE" ]]; then
    log_info "تولید کلیدهای امنیتی و فایل پیکربندی کلاستر (.env)..."
    CLUSTER_SECRET="$(openssl rand -hex 32)"
    PG_PASSWORD="$(openssl rand -hex 16)"
    REDIS_PASSWORD="$(openssl rand -hex 16)"
    QDRANT_KEY="$(openssl rand -hex 16)"
    LITELLM_KEY="sk-omniops-$(openssl rand -hex 16)"
    JWT_SECRET="$(openssl rand -hex 32)"

    cat > "$ENV_FILE" <<EOF
CLUSTER_SECRET_KEY=${CLUSTER_SECRET}
OMNIOPS_BIND_PORT=${CUSTOM_PORT}
OMNIOPS_ENV=production

POSTGRES_DB=omniops
POSTGRES_USER=omniops
POSTGRES_PASSWORD=${PG_PASSWORD}

REDIS_PASSWORD=${REDIS_PASSWORD}

QDRANT_API_KEY=${QDRANT_KEY}

LITELLM_MASTER_KEY=${LITELLM_KEY}

JWT_SECRET=${JWT_SECRET}
EOF
    chmod 600 "$ENV_FILE"
    log_success "فایل .env با دسترسی امن (600) ایجاد شد."
else
    log_info "فایل .env موجود حفظ شد."
    # Ensure port matches custom port
    sed -i "s/^OMNIOPS_BIND_PORT=.*/OMNIOPS_BIND_PORT=${CUSTOM_PORT}/" "$ENV_FILE" 2>/dev/null || true
fi

# Load variables
set -a
. "$ENV_FILE"
set +a

# Firewall configuration
log_info "پیکربندی فایروال UFW..."
ufw allow 22/tcp comment 'SSH' 2>/dev/null || true
ufw allow "${OMNIOPS_BIND_PORT:-8000}/tcp" comment 'OmniOps Master Core' 2>/dev/null || true

# Start Cluster
log_info "در حال راه‌اندازی کانتینرهای سرور هسته (Master Node)..."
cd "$INSTALL_DIR"
docker compose up -d

log_info "در حال بررسی سلامت سرویس‌ها (Postgres, Redis, Qdrant, LiteLLM)..."
sleep 5

MAX_WAIT=60
START_TIME=$(date +%s)
while true; do
    if docker compose ps | grep -q "unhealthy"; then
        log_warn "یکی از سرویس‌ها هنوز در حال آغاز است..."
    fi
    # Check if healthy
    RUNNING_COUNT=$(docker compose ps --filter "status=running" -q | wc -l)
    if [[ "$RUNNING_COUNT" -ge 4 ]]; then
        break
    fi
    CURRENT_TIME=$(date +%s)
    if (( CURRENT_TIME - START_TIME > MAX_WAIT )); then
        log_warn "برخی سرویس‌ها در مهلت مقرر آماده نشدند. لطفاً خروجی docker compose logs را بررسی کنید."
        break
    fi
    sleep 3
done

# Success Banner
printf "\n"
printf "${COLOR_GREEN}======================================================================${COLOR_RESET}\n"
printf "${COLOR_BOLD}   OmniOps Enterprise Studio - Master Node با موفقیت راه‌اندازی شد!   ${COLOR_RESET}\n"
printf "${COLOR_GREEN}======================================================================${COLOR_RESET}\n"
printf "  ${COLOR_CYAN}نشانی پنل ادمین (شبکه داخلی):${COLOR_RESET}  http://%s:%s\n" "$LAN_IP" "${OMNIOPS_BIND_PORT:-8000}"
printf "  ${COLOR_CYAN}کلید اتصال کلاستر (Cluster Secret):${COLOR_RESET}\n"
printf "  ${COLOR_YELLOW}%s${COLOR_RESET}\n\n" "$CLUSTER_SECRET_KEY"
printf "  ${COLOR_BOLD}گام‌های بعدی:${COLOR_RESET}\n"
printf "  ۱. برای نصب Worker نود (GPU/محاسباتی)، این کلید را هنگام نصب وارد کنید.\n"
printf "  ۲. برای نصب سرور آینه (Edge VPS)، این کلید و IP سرور را وارد کنید.\n"
printf "  ۳. کلاینت دسکتاپ ویندوز را با نشانی http://%s:%s متصل کنید.\n" "$LAN_IP" "${OMNIOPS_BIND_PORT:-8000}"
printf "${COLOR_GREEN}======================================================================${COLOR_RESET}\n\n"

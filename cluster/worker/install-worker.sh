#!/usr/bin/env bash
# ==============================================================================
# OmniOps Enterprise Studio - Worker Node One-Line Installer
# ==============================================================================
# Installs local AI inference (Ollama/vLLM) and isolated Docker sandbox on Ubuntu.
# Joins the cluster using Master IP and Cluster Secret Key.
# ==============================================================================

set -Eeuo pipefail

COLOR_RESET="\033[0m"
COLOR_CYAN="\033[1;36m"
COLOR_GREEN="\033[1;32m"
COLOR_YELLOW="\033[1;33m"
COLOR_RED="\033[1;31m"
COLOR_BOLD="\033[1m"

log_info() { printf "${COLOR_CYAN}[OmniOps Worker] INFO:${COLOR_RESET} %s\n" "$*"; }
log_success() { printf "${COLOR_GREEN}[OmniOps Worker] SUCCESS:${COLOR_RESET} %s\n" "$*"; }
log_warn() { printf "${COLOR_YELLOW}[OmniOps Worker] WARNING:${COLOR_RESET} %s\n" "$*"; }
log_fail() { printf "${COLOR_RED}[OmniOps Worker] ERROR:${COLOR_RESET} %s\n" "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || log_fail "این اسکریپت باید با دسترسی روت (root / sudo) اجرا شود."

# Accept CLI positional arguments if provided
MASTER_IP="${1:-${MASTER_IP:-}}"
CLUSTER_SECRET_KEY="${2:-${CLUSTER_SECRET_KEY:-}}"
MASTER_PORT="${3:-${MASTER_PORT:-}}"
OLLAMA_PORT="${4:-${OLLAMA_PORT:-}}"

# Prompt for Master IP and Cluster Secret Key if not provided
if [[ -z "$MASTER_IP" ]]; then
    if [[ -e /dev/tty ]]; then
        read -r -p "آدرس IP سرور هسته مرکزی در شبکه داخلی (Master LAN IP): " MASTER_IP < /dev/tty
    else
        read -r -p "آدرس IP سرور هسته مرکزی در شبکه داخلی (Master LAN IP): " MASTER_IP
    fi
fi
[[ -n "$MASTER_IP" ]] || log_fail "آدرس IP سرور مستر الزامی است."

if [[ -z "$CLUSTER_SECRET_KEY" ]]; then
    if [[ -e /dev/tty ]]; then
        read -r -s -p "کلید محرمانه اتصال کلاستر (Cluster Secret Key): " CLUSTER_SECRET_KEY < /dev/tty
        echo ""
    else
        read -r -s -p "کلید محرمانه اتصال کلاستر (Cluster Secret Key): " CLUSTER_SECRET_KEY
        echo ""
    fi
fi
[[ -n "$CLUSTER_SECRET_KEY" ]] || log_fail "کلید محرمانه کلاستر الزامی است."

# Prompt for Master Port
if [[ -z "$MASTER_PORT" ]]; then
    printf "پورت پیش‌فرض سرور مستر: 8000\n"
    if [[ -e /dev/tty ]]; then
        read -r -p "پورت سرور مستر را وارد کنید [اینتر برای تایید 8000]: " INPUT_M_PORT < /dev/tty
    else
        read -r -p "پورت سرور مستر را وارد کنید [اینتر برای تایید 8000]: " INPUT_M_PORT
    fi
    MASTER_PORT="${INPUT_M_PORT:-8000}"
fi

# Prompt for Ollama Port
if [[ -z "$OLLAMA_PORT" ]]; then
    printf "پورت پیش‌فرض سرویس استنتاج Ollama: 11434\n"
    if [[ -e /dev/tty ]]; then
        read -r -p "پورت سرویس Ollama روی این ورکر [اینتر برای تایید 11434]: " INPUT_O_PORT < /dev/tty
    else
        read -r -p "پورت سرویس Ollama روی این ورکر [اینتر برای تایید 11434]: " INPUT_O_PORT
    fi
    OLLAMA_PORT="${INPUT_O_PORT:-11434}"
fi

log_info "بررسی و نصب وابستگی‌ها..."
apt-get update -y -q
apt-get install -y -q curl wget ufw ca-certificates gnupg

# Install Docker
if ! command -v docker &>/dev/null; then
    log_info "در حال نصب Docker Engine..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker
fi

# Detect GPU
HAS_GPU=false
if command -v nvidia-smi &>/dev/null; then
    HAS_GPU=true
    log_success "کارت گرافیک NVIDIA شناسایی شد:"
    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || true
fi

# Install Ollama
if ! command -v ollama &>/dev/null; then
    log_info "در حال نصب Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh
    systemctl enable --now ollama
fi

log_info "بررسی ارتباط با سرور مستر در نشانی http://$MASTER_IP:$MASTER_PORT/health..."
if curl -fsS --max-time 5 "http://$MASTER_IP:$MASTER_PORT/health" &>/dev/null; then
    log_success "اتصال به سرور مستر با موفقیت برقرار شد."
else
    log_warn "سرور مستر در http://$MASTER_IP:$MASTER_PORT پاسخ نداد. لطفاً فایروال یا IP را بررسی کنید."
fi

# Pull initial coding model in background
log_info "در حال بارگیری مدل کدنویسی محلی پیش‌فرض (qwen2.5-coder:7b)..."
ollama pull qwen2.5-coder:7b || log_warn "بارگیری مدل را بعداً با 'ollama pull qwen2.5-coder:7b' تکرار کنید."

# Configure Firewall
ufw allow "$OLLAMA_PORT/tcp" comment 'Ollama Local LAN' 2>/dev/null || true

printf "\n"
printf "${COLOR_GREEN}======================================================================${COLOR_RESET}\n"
printf "${COLOR_BOLD}   OmniOps Enterprise Worker Node با موفقیت آماده و متصل شد!          ${COLOR_RESET}\n"
printf "${COLOR_GREEN}======================================================================${COLOR_RESET}\n"
printf "  ${COLOR_CYAN}وضعیت پردازشگر:${COLOR_RESET}  %s\n" "$([ "$HAS_GPU" = true ] && echo "NVIDIA GPU فعال" || echo "CPU Mode")"
printf "  ${COLOR_CYAN}سرور مستر متصل:${COLOR_RESET}  http://%s:%s\n" "$MASTER_IP" "$MASTER_PORT"
printf "  ${COLOR_CYAN}پورت Ollama:${COLOR_RESET}    %s\n" "$OLLAMA_PORT"
printf "${COLOR_GREEN}======================================================================${COLOR_RESET}\n\n"

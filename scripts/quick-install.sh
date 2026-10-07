#!/usr/bin/env bash
# ==============================================================================
# OmniOps Enterprise Studio - Unified One-Line Cluster Installer
# Repository: https://github.com/RedBoy-011/OmniOps
# ==============================================================================
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/RedBoy-011/OmniOps/main/scripts/quick-install.sh | sudo bash
#   curl -fsSL https://raw.githubusercontent.com/RedBoy-011/OmniOps/main/scripts/quick-install.sh | sudo bash -s -- master
#   curl -fsSL https://raw.githubusercontent.com/RedBoy-011/OmniOps/main/scripts/quick-install.sh | sudo bash -s -- worker <MASTER_IP> <SECRET_KEY>
#   curl -fsSL https://raw.githubusercontent.com/RedBoy-011/OmniOps/main/scripts/quick-install.sh | sudo bash -s -- edge <DOMAIN> <STATIC_IP> [PORT]
# ==============================================================================

set -Eeuo pipefail

COLOR_RESET="\033[0m"
COLOR_CYAN="\033[1;36m"
COLOR_GREEN="\033[1;32m"
COLOR_YELLOW="\033[1;33m"
COLOR_RED="\033[1;31m"
COLOR_BOLD="\033[1m"

RAW_BASE="https://raw.githubusercontent.com/RedBoy-011/OmniOps/main"

log_info() { printf "${COLOR_CYAN}[OmniOps] INFO:${COLOR_RESET} %s\n" "$*"; }
log_success() { printf "${COLOR_GREEN}[OmniOps] SUCCESS:${COLOR_RESET} %s\n" "$*"; }
log_warn() { printf "${COLOR_YELLOW}[OmniOps] WARNING:${COLOR_RESET} %s\n" "$*"; }
log_fail() { printf "${COLOR_RED}[OmniOps] ERROR:${COLOR_RESET} %s\n" "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || log_fail "این اسکریپت نیازمند دسترسی مدیر (root / sudo) است."

TARGET_NODE="${1:-}"

if [[ -z "$TARGET_NODE" ]]; then
    printf "\n"
    printf "${COLOR_CYAN}======================================================================${COLOR_RESET}\n"
    printf "${COLOR_BOLD}     سامانه سازمانی OmniOps Enterprise Studio - نصاب کلاستر توزیع‌شده    ${COLOR_RESET}\n"
    printf "     مخزن گیتهاب: ${COLOR_GREEN}https://github.com/RedBoy-011/OmniOps${COLOR_RESET}\n"
    printf "${COLOR_CYAN}======================================================================${COLOR_RESET}\n"
    printf "لطفاً نوع نود مورد نظر برای نصب را انتخاب نمایید:\n\n"
    printf "  ${COLOR_BOLD}1)${COLOR_RESET} سرور هسته مرکزی (Master Node) - دیتابیس‌ها، احراز هویت، RAG و ارکستراتور\n"
    printf "  ${COLOR_BOLD}2)${COLOR_RESET} سرور محاسباتی / پردازشی (Worker Node) - استنتاج مدل‌های لوکال GPU/CPU و سندباکس\n"
    printf "  ${COLOR_BOLD}3)${COLOR_RESET} سرور آینه و پروکسی اینترنتی (Edge Mirror Node) - پروکسی Caddy با SSL خودکار\n\n"
    
    if [[ -e /dev/tty ]]; then
        read -r -p "شماره گزینه را وارد کنید [1-3]: " CHOICE < /dev/tty
    else
        read -r -p "شماره گزینه را وارد کنید [1-3]: " CHOICE
    fi

    case "$CHOICE" in
        1) TARGET_NODE="master" ;;
        2) TARGET_NODE="worker" ;;
        3) TARGET_NODE="edge" ;;
        *) log_fail "گزینه نامعتبر است." ;;
    esac
fi

case "$TARGET_NODE" in
    master|1)
        log_info "شروع نصب نود مرکزی (Master Node)..."
        bash <(curl -fsSL "${RAW_BASE}/cluster/master/install-master.sh")
        ;;
    worker|2)
        log_info "شروع نصب نود محاسباتی (Worker Node)..."
        shift || true
        bash <(curl -fsSL "${RAW_BASE}/cluster/worker/install-worker.sh") "$@"
        ;;
    edge|mirror|3)
        log_info "شروع نصب سرور آینه و پروکسی اینترنتی (Edge Node)..."
        shift || true
        bash <(curl -fsSL "${RAW_BASE}/cluster/edge/install-edge.sh") "$@"
        ;;
    *)
        log_fail "نوع نود ناشناخته است: '$TARGET_NODE'. گزینه‌های معتبر: master, worker, edge"
        ;;
esac

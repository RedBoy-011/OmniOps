#!/usr/bin/env bash
# ==============================================================================
# OmniOps Enterprise Studio - Edge / Mirror Node One-Line Installer
# ==============================================================================
# Configures a public internet VPS as a secure Reverse Proxy with Caddy,
# automatic Let's Encrypt SSL, and unbuffered WebSocket support for OmniOps.
# ==============================================================================

set -Eeuo pipefail

COLOR_RESET="\033[0m"
COLOR_CYAN="\033[1;36m"
COLOR_GREEN="\033[1;32m"
COLOR_YELLOW="\033[1;33m"
COLOR_RED="\033[1;31m"
COLOR_BOLD="\033[1m"

log_info() { printf "${COLOR_CYAN}[OmniOps Edge] INFO:${COLOR_RESET} %s\n" "$*"; }
log_success() { printf "${COLOR_GREEN}[OmniOps Edge] SUCCESS:${COLOR_RESET} %s\n" "$*"; }
log_warn() { printf "${COLOR_YELLOW}[OmniOps Edge] WARNING:${COLOR_RESET} %s\n" "$*"; }
log_fail() { printf "${COLOR_RED}[OmniOps Edge] ERROR:${COLOR_RESET} %s\n" "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || log_fail "این اسکریپت باید با دسترسی روت (root / sudo) اجرا شود."

# Accept CLI positional arguments if provided ($1=DOMAIN, $2=STATIC_IP, $3=TARGET_PORT, $4=EDGE_PORT)
PUBLIC_DOMAIN="${1:-${PUBLIC_DOMAIN:-}}"
COMPANY_STATIC_IP="${2:-${COMPANY_STATIC_IP:-}}"
TARGET_PORT="${3:-${TARGET_PORT:-}}"
EDGE_HTTPS_PORT="${4:-${EDGE_HTTPS_PORT:-}}"

if [[ -z "$PUBLIC_DOMAIN" ]]; then
    if [[ -e /dev/tty ]]; then
        read -r -p "دامنه اینترنتی عمومی (مثال خیالی: ai.example-corp.com): " PUBLIC_DOMAIN < /dev/tty
    else
        read -r -p "دامنه اینترنتی عمومی (مثال خیالی: ai.example-corp.com): " PUBLIC_DOMAIN
    fi
fi
[[ -n "$PUBLIC_DOMAIN" ]] || log_fail "نام دامنه الزامی است."

if [[ -z "$COMPANY_STATIC_IP" ]]; then
    if [[ -e /dev/tty ]]; then
        read -r -p "آی‌پی استاتیک اینترنتی شرکت (مثال خیالی: 203.0.113.50): " COMPANY_STATIC_IP < /dev/tty
    else
        read -r -p "آی‌پی استاتیک اینترنتی شرکت (مثال خیالی: 203.0.113.50): " COMPANY_STATIC_IP
    fi
fi
[[ -n "$COMPANY_STATIC_IP" ]] || log_fail "آی‌پی استاتیک شرکت الزامی است."

if [[ -z "$TARGET_PORT" ]]; then
    printf "پورت پیش‌فرض فوروارد شده سرور مستر روی فایروال شرکت: 8000\n"
    if [[ -e /dev/tty ]]; then
        read -r -p "شماره پورت فوروارد شده شرکت را وارد کنید [اینتر برای تایید 8000]: " INPUT_T_PORT < /dev/tty
    else
        read -r -p "شماره پورت فوروارد شده شرکت را وارد کنید [اینتر برای تایید 8000]: " INPUT_T_PORT
    fi
    TARGET_PORT="${INPUT_T_PORT:-8000}"
fi

if [[ -z "$EDGE_HTTPS_PORT" ]]; then
    printf "پورت اینترنتی امن وب‌سرور Edge: 443 (HTTPS استاندار)\n"
    if [[ -e /dev/tty ]]; then
        read -r -p "پورت امن اینترنتی سرور آینه [اینتر برای تایید 443]: " INPUT_E_PORT < /dev/tty
    else
        read -r -p "پورت امن اینترنتی سرور آینه [اینتر برای تایید 443]: " INPUT_E_PORT
    fi
    EDGE_HTTPS_PORT="${INPUT_E_PORT:-443}"
fi

log_info "نصب پیش‌نیازها و وب‌سرور Caddy..."
apt-get update -y -q
apt-get install -y -q debian-keyring debian-archive-keyring apt-transport-https curl ufw

# Install Caddy
if ! command -v caddy &>/dev/null; then
    curl -1sLF 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLF 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y -q
    apt-get install -y -q caddy
fi

# Configure Caddyfile
log_info "پیکربندی معکوس‌کننده پروکسی (Caddyfile) بدون بافرینگ وب‌سوکت..."
# Domain directive with custom port if not 443
DOMAIN_DIRECTIVE="${PUBLIC_DOMAIN}"
if [[ "$EDGE_HTTPS_PORT" != "443" ]]; then
    DOMAIN_DIRECTIVE="${PUBLIC_DOMAIN}:${EDGE_HTTPS_PORT}"
fi

cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN_DIRECTIVE} {
    encode gzip zstd

    # Reverse proxy to company static IP and forwarded master port
    reverse_proxy ${COMPANY_STATIC_IP}:${TARGET_PORT} {
        header_up Host {upstream_hostport}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto https

        # Essential for unbuffered real-time WebSockets and streaming LLM tokens
        flush_interval -1
    }

    log {
        output file /var/log/caddy/omniops-edge.log
    }
}
EOF

# Firewall rules
ufw allow 80/tcp comment 'HTTP ACME challenge' 2>/dev/null || true
ufw allow "$EDGE_HTTPS_PORT/tcp" comment 'HTTPS OmniOps Edge' 2>/dev/null || true

# Restart Caddy
systemctl restart caddy
systemctl enable caddy

printf "\n"
printf "${COLOR_GREEN}======================================================================${COLOR_RESET}\n"
printf "${COLOR_BOLD}   OmniOps Enterprise Edge Mirror با موفقیت راه‌اندازی شد!             ${COLOR_RESET}\n"
printf "${COLOR_GREEN}======================================================================${COLOR_RESET}\n"
printf "  ${COLOR_CYAN}دامنه امن عمومی (SSL خودکار):${COLOR_RESET}  https://%s\n" "$DOMAIN_DIRECTIVE"
printf "  ${COLOR_CYAN}هدایت امن ترافیک به:${COLOR_RESET}          http://%s:%s\n" "$COMPANY_STATIC_IP" "$TARGET_PORT"
printf "  ${COLOR_BOLD}وضعیت وب‌سوکت:${COLOR_RESET}                فعال (بدون بافرینگ / Flush آنی)\n"
printf "${COLOR_GREEN}======================================================================${COLOR_RESET}\n\n"

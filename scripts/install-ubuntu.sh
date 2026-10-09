#!/usr/bin/env bash
# اسکریپت راه‌اندازی سریع OmniOps Master برای سرورهای اوبونتو
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$dir/update-ubuntu.sh" "$@"

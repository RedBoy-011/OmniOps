#!/usr/bin/env bash
# بازنشانی و تغییر نام کاربری و رمز عبور مدیر ارشد OmniOps (SuperAdmin)
set -Eeuo pipefail

if [[ -d /opt/omniops && -f /opt/omniops/omniops/reset_admin.py ]]; then
  repo="/opt/omniops"
else
  repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

cd "$repo"
python3 -m omniops.reset_admin "$@"

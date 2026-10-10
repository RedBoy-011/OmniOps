#!/usr/bin/env bash
# صدور توکن تبادل یکپارچه و دستور اتصال خودکار برای نودهای OmniOps
set -Eeuo pipefail

role="${1:-worker}"
[[ "$role" == "worker" || "$role" == "edge" ]] || {
  echo "نقش باید worker یا edge باشد. مثال: bash scripts/issue-token.sh worker" >&2
  exit 1
}

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$dir"
python3 -m omniops.node_admin --local-root --role "$role" --token

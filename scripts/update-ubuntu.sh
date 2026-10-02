#!/usr/bin/env bash
# Update-e tak-khati Ubuntu baraye Master-e azmayeshi-e feli.
set -Eeuo pipefail

fail() { printf 'OmniOps update stopped: %s\n' "$*" >&2; exit 1; }
trap 'printf "OmniOps update failed at line %s. The identity database was not reset.\n" "$LINENO" >&2' ERR

[[ "$(id -u)" == 0 ]] || fail 'Run from the root SSH shell used for the existing installation.'
[[ -d /run/systemd/system ]] || fail 'This updater needs an Ubuntu host running systemd.'
for dependency in git python3 curl systemctl; do
  command -v "$dependency" >/dev/null || fail "Missing required command: $dependency"
done

repo=''
repositories=()
for candidate in "$PWD" /root/OmniOps/OmniOps /root/OmniOps /opt/omniops; do
  [[ -f "$candidate/omniops/server.py" && -d "$candidate/.git" ]] || continue
  origin="$(git -C "$candidate" remote get-url origin 2>/dev/null || true)"
  [[ "$origin" == *'github.com/RedBoy-011/OmniOps.git' || "$origin" == *'github.com:RedBoy-011/OmniOps.git' ]] || continue
  candidate="$(realpath "$candidate")"
  if [[ ! " ${repositories[*]} " == *" $candidate "* ]]; then repositories+=("$candidate"); fi
done
[[ "${#repositories[@]}" -gt 0 ]] || fail 'Existing RedBoy-011/OmniOps checkout not found; no new installation was created.'
# Agar clone-e tekrari hast, masire gateway-e dar hale ejra olaviat darad.
for process in /proc/[0-9]*; do
  [[ -r "$process/cmdline" ]] || continue
  command_line="$(tr '\0' ' ' < "$process/cmdline" 2>/dev/null || true)"
  [[ "$command_line" == *'-m omniops.server'* ]] || continue
  process_directory="$(readlink -f "$process/cwd" 2>/dev/null || true)"
  for candidate in "${repositories[@]}"; do
    if [[ "$candidate" == "$process_directory" ]]; then
      [[ -z "$repo" || "$repo" == "$candidate" ]] || fail 'More than one OmniOps gateway is running; stop duplicate instances.'
      repo="$candidate"
    fi
  done
done
if [[ -z "$repo" ]]; then
  for candidate in "${repositories[@]}"; do
    if [[ "$candidate" == "$(realpath "$PWD")" ]]; then repo="$candidate"; break; fi
  done
fi
if [[ -z "$repo" ]]; then
  for candidate in "${repositories[@]}"; do
    if [[ -f "$candidate/data/identity.db" ]]; then
      [[ -z "$repo" ]] || fail 'Multiple identity databases found; run the updater from the active repository.'
      repo="$candidate"
    fi
  done
fi
[[ -n "$repo" ]] || fail 'More than one clone found; run the one-line updater from the active repository.'
cd "$repo"
printf 'Updating OmniOps in %s\n' "$repo"
[[ "$(git branch --show-current)" == main ]] || fail 'The checkout must be on its main branch.'
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail 'Tracked local edits exist; save/review them before updating.'

git fetch --prune origin main

config=/etc/omniops/master.env
unit=/etc/systemd/system/omniops-master.service
if [[ -f "$unit" ]] && ! grep -Fxq "WorkingDirectory=$repo" "$unit"; then
  fail "An existing OmniOps systemd service belongs to another checkout: $unit"
fi
helper="$(mktemp)"
trap 'rm -f "$helper"' EXIT
git show origin/main:scripts/upgrade_config.py > "$helper"
runtime="$(python3 "$helper" --repo "$repo")"
IFS='|' read -r old_pid port <<< "$runtime"
rm -f "$helper"
trap - EXIT
git merge --ff-only origin/main
[[ "$old_pid" =~ ^[0-9]+$ && "$port" =~ ^[0-9]+$ ]] || fail 'Invalid gateway state.'

if [[ -f /root/.nvm/nvm.sh ]]; then
  # Node-e nasb-shode dar Ubuntu-ye ghabli ra load kon.
  export NVM_DIR=/root/.nvm
  . "$NVM_DIR/nvm.sh"
fi
if ! command -v node >/dev/null || ! command -v npm >/dev/null || [[ ! "$(node --version)" =~ ^v24\. ]]; then
  if ! command -v nvm >/dev/null; then
    installer="$(mktemp)"
    trap 'rm -f "$installer"' EXIT
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh -o "$installer"
    bash "$installer"
    export NVM_DIR=/root/.nvm
    . "$NVM_DIR/nvm.sh"
  fi
  nvm install 24
fi
(cd web/app && npm ci && npm run build)
python3 -m unittest discover -s tests -q

python_path="$(command -v python3)"
cat > "$unit" <<EOF
[Unit]
Description=OmniOps development master (loopback only)
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
  # Faghat process-e motabegh ba in repo stop mishavad.
  current_cwd="$(readlink -f "/proc/$old_pid/cwd" 2>/dev/null || true)"
  current_command="$(tr '\0' ' ' < "/proc/$old_pid/cmdline" 2>/dev/null || true)"
  [[ "$current_cwd" == "$repo" && "$current_command" == *"-m omniops.server"* ]] || fail "Previous gateway PID changed during update; no process was stopped."
  kill -TERM "$old_pid"
  for ((attempt=0; attempt<20; attempt++)); do
    kill -0 "$old_pid" 2>/dev/null || break
    sleep 0.5
  done
  if kill -0 "$old_pid" 2>/dev/null; then
    fail "The previous manually launched gateway ($old_pid) did not stop; service was not started."
  fi
fi
systemctl restart omniops-master.service
for ((attempt=0; attempt<20; attempt++)); do
  if systemctl is-active --quiet omniops-master.service && curl -fsS --max-time 2 "http://127.0.0.1:$port/health" 2>/dev/null | python3 -c 'import json,sys; assert json.load(sys.stdin)["status"] == "up"' 2>/dev/null; then
    systemctl enable omniops-master.service
    printf 'OmniOps is healthy at http://127.0.0.1:%s/health\n' "$port"
    printf 'Version: %s\n' "$(git rev-parse --short HEAD)"
    printf 'Service: systemctl status omniops-master.service\n'
    exit 0
  fi
  sleep 1
done
systemctl --no-pager -l status omniops-master.service >&2 || true
fail 'Health check failed after restart; see: journalctl -u omniops-master.service -n 60 --no-pager'
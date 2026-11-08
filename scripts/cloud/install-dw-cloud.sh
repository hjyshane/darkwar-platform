#!/usr/bin/env bash
# Install (or remove) the dw-cloud systemd service on the cloud VM.
#
#   scripts/cloud/install-dw-cloud.sh                 capture + upload only (DW_CLOUD_NO_RESTART=1)
#   scripts/cloud/install-dw-cloud.sh --with-restart  also run the watchdog that relaunches the game
#   scripts/cloud/install-dw-cloud.sh --remove        stop, disable and delete the unit
#
# dw-cloud is the whole chain in one process (tcpdump chunks, ingest-dir, dw-sync,
# watchdog), the same shape as dw-iphone. The emulator is NOT started here: it is
# its own unit, dw-emulator.service (see dw-emulator.service.example next to this
# file), and dw-cloud only orders itself after it.
#
# Capture-only is the default on purpose. docs/runbooks/cloud-unattended.md section 9:
# the first run on a VM should prove that chunks arrive and journal-summary grows
# before anything is allowed to force-stop and relaunch the game. Re-run with
# --with-restart once that is seen.
#
# Settings come from ~/dw-data/.env (SUPABASE_URL, SUPABASE_SECRET_KEY,
# DW_COLLECTOR_ID, DW_COLLECTOR_SERVER_ID); override with DW_ENV_FILE. The cloud
# chain keeps its own journal, ~/dw-data/cloud.db, and its chunks in ~/dw-data/cloud/.
#
# Linux only (systemd, tcpdump, `ip route`). Run as the login user, not root:
# the unit runs as that user and tcpdump is started through `sudo -n`, so the
# user needs passwordless sudo for tcpdump (the GCE default account has it).

set -euo pipefail

UNIT="dw-cloud"
UNIT_FILE="/etc/systemd/system/$UNIT.service"
DATA="${DW_DATA_DIR:-$HOME/dw-data}"
ENV_FILE="${DW_ENV_FILE:-$DATA/.env}"
WITH_RESTART=0

case "${1:-}" in
  --remove)
    sudo systemctl disable --now "$UNIT" 2>/dev/null || true
    sudo rm -f "$UNIT_FILE"
    sudo systemctl daemon-reload
    echo "removed $UNIT"
    exit 0
    ;;
  --with-restart) WITH_RESTART=1 ;;
  "") ;;
  *) echo "usage: $0 [--with-restart|--remove]"; exit 2 ;;
esac

[ "$(uname -s)" = "Linux" ] || { echo "FAIL: Linux only"; exit 1; }
[ "$(id -u)" -ne 0 ] || { echo "FAIL: run as the login user, not root"; exit 1; }
command -v systemctl >/dev/null || { echo "FAIL: systemd not found"; exit 1; }

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COLLECTOR="$REPO/services/collector"
UV="$(command -v uv || true)"
[ -n "$UV" ] || { echo "FAIL: uv not found on PATH (curl -LsSf https://astral.sh/uv/install.sh | sh)"; exit 1; }
[ -f "$COLLECTOR/src/dw_collector/cloud/__main__.py" ] || { echo "FAIL: this checkout has no dw_collector/cloud; git pull first"; exit 1; }

TCPDUMP="${DW_CLOUD_TCPDUMP:-$(command -v tcpdump || true)}"
[ -n "$TCPDUMP" ] || { echo "FAIL: tcpdump not found. Run: sudo apt-get install -y tcpdump"; exit 1; }
if ! sudo -n "$TCPDUMP" --version >/dev/null 2>&1; then
  echo "FAIL: 'sudo -n $TCPDUMP' needs a password. The service cannot type one."
  echo "      Add a sudoers rule for tcpdump, or run on an account with NOPASSWD sudo."
  exit 1
fi

IFACE="${DW_CLOUD_INTERFACE:-}"
if [ -z "$IFACE" ]; then
  IFACE="$(ip -o -4 route show default 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "dev") print $(i + 1)}' | head -n1)"
fi
[ -n "$IFACE" ] || { echo "FAIL: cannot read the default route; set DW_CLOUD_INTERFACE"; exit 1; }

ADB="${DW_CLOUD_ADB:-$(command -v adb || true)}"
if [ "$WITH_RESTART" -eq 1 ] && { [ -z "$ADB" ] || [ ! -x "$ADB" ]; }; then
  echo "FAIL: --with-restart needs adb; set DW_CLOUD_ADB to platform-tools/adb"
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  cat <<MSG
FAIL: no env file at $ENV_FILE

Create it (outside the repo; the secret key bypasses RLS) with these four lines,
copying the values from the Windows collector's .env - not through chat:

  SUPABASE_URL=https://<project>.supabase.co
  SUPABASE_SECRET_KEY=<secret key>
  DW_COLLECTOR_ID=<a value of its own for this VM, not the Windows one>
  DW_COLLECTOR_SERVER_ID=580

then:  chmod 600 $ENV_FILE   and run this script again.
MSG
  exit 1
fi
for key in SUPABASE_URL SUPABASE_SECRET_KEY DW_COLLECTOR_ID DW_COLLECTOR_SERVER_ID; do
  grep -q "^$key=" "$ENV_FILE" || { echo "FAIL: $ENV_FILE has no $key="; exit 1; }
done

if ! systemctl list-unit-files dw-emulator.service 2>/dev/null | grep -q '^dw-emulator.service'; then
  echo "NOTE: no dw-emulator.service on this VM. dw-cloud still starts; the watchdog then"
  echo "      sees no device and counts failures. Template: $(dirname "$0")/dw-emulator.service.example"
fi

mkdir -p "$DATA/cloud"
(cd "$COLLECTOR" && "$UV" sync --no-dev)

# systemd gives a unit a minimal PATH; uv and adb live in the user's home.
TOOL_PATH="$HOME/.local/bin:$(dirname "$UV"):/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
[ -n "$ADB" ] && TOOL_PATH="$(dirname "$ADB"):$TOOL_PATH"
ADB_LINE=""
[ -n "$ADB" ] && ADB_LINE="Environment=DW_CLOUD_ADB=$ADB"
RESTART_LINE="Environment=DW_CLOUD_NO_RESTART=1"
if [ "$WITH_RESTART" -eq 1 ]; then
  RESTART_LINE="# watchdog on. Environment=DW_CLOUD_NO_RESTART=1 would turn it off."
fi

sudo tee "$UNIT_FILE" >/dev/null <<UNIT
# Written by scripts/cloud/install-dw-cloud.sh. Re-run the script instead of editing.
[Unit]
Description=Dark War cloud collector (tcpdump -> ingest -> sync, watchdog)
After=network-online.target dw-emulator.service
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$COLLECTOR
Environment=PATH=$TOOL_PATH
Environment=PYTHONIOENCODING=utf-8
Environment=DW_DATA_DIR=$DATA
Environment=DW_ENV_FILE=$ENV_FILE
Environment=DW_CLOUD_INTERFACE=$IFACE
Environment=DW_CLOUD_TCPDUMP=$TCPDUMP
$ADB_LINE
$RESTART_LINE
ExecStart=$UV run --no-sync dw-cloud
Restart=always
RestartSec=30
# SIGTERM lets the supervisor close the open chunk; give it the minute it may need.
TimeoutStopSec=90

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now "$UNIT"
sleep 5
if ! systemctl is-active --quiet "$UNIT"; then
  echo "FAIL: $UNIT is not active. Read:  journalctl -u $UNIT -n 50 --no-pager"
  exit 1
fi

MODE="capture only (DW_CLOUD_NO_RESTART=1)"
[ "$WITH_RESTART" -eq 1 ] && MODE="capture + watchdog (restarts the game)"
echo "installed $UNIT"
echo "  mode:      $MODE"
echo "  interface: $IFACE   chunks: $DATA/cloud   journal: $DATA/cloud.db"
echo "  log:       journalctl -u $UNIT -f"
echo "  check:     (cd $COLLECTOR && DW_SQLITE_PATH=$DATA/cloud.db uv run --no-sync dw-collector journal-summary)"
echo "  remove:    $0 --remove"

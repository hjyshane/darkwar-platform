#!/usr/bin/env bash
# Install (or remove) a launchd agent that runs dw-iphone from login on.
#
#   scripts/mac/install-iphone-agent.sh            install and start
#   scripts/mac/install-iphone-agent.sh --remove   stop and remove
#
# dw-iphone is the whole chain in one process (capture every plugged-in
# iPhone, ingest, sync), so one agent is all there is. launchd restarts it if
# it dies. A LaunchAgent runs only while you are logged in, which is also when
# a Mac with a phone plugged in is awake enough to be useful.
#
# Settings come from ~/dw-data/.env (SUPABASE_URL, SUPABASE_SECRET_KEY,
# DW_COLLECTOR_ID, DW_COLLECTOR_SERVER_ID); override with DW_ENV_FILE. The
# phone chain keeps its own journal, ~/dw-data/iphone.db.

set -euo pipefail

LABEL="com.darkwar.iphone"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DATA="${DW_DATA_DIR:-$HOME/dw-data}"
LOGS="$DATA/logs"
DOMAIN="gui/$(id -u)"

# The whole chain: dw-iphone, the dw-sync and ingester it starts, and the pcap capture of
# each phone. `uv run` is the job's own process and python is its child, and booting the job
# out stops the first without always stopping the second. The child is then orphaned and
# keeps capturing, ingesting and sending while the new one starts beside it: every phone is
# captured twice and every row is sent twice, which halves the upload and doubles the load
# on the database (found 2026-11-02, two sets running for five days).
# DW_STACK_PATTERN exists so the stop logic can be tried on processes that are not the
# collector; leave it alone otherwise.
STACK="${DW_STACK_PATTERN:-dw_collector\.iphone|dw_collector\.sync|ingest-dir --dir .*/iphone|pymobiledevice3 pcap}"

# Stop whatever is left of the chain: interrupt first, so a capture closes its chunk, then
# force what has not gone after ten seconds.
stop_stack() {
  local pids i
  pids="$(pgrep -f "$STACK" || true)"
  [ -n "$pids" ] || return 0
  echo "stopping leftover collector processes: $(echo "$pids" | tr '\n' ' ')"
  # shellcheck disable=SC2086
  kill -INT $pids 2>/dev/null || true
  for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 1
    pids="$(pgrep -f "$STACK" || true)"
    [ -z "$pids" ] && return 0
  done
  echo "forcing: $(echo "$pids" | tr '\n' ' ')"
  # shellcheck disable=SC2086
  kill -KILL $pids 2>/dev/null || true
}

if [ "${1:-}" = "--remove" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  stop_stack
  rm -f "$PLIST"
  echo "removed $LABEL"
  exit 0
fi

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COLLECTOR="$REPO/services/collector"
UV="$(command -v uv || true)"
[ -n "$UV" ] || { echo "FAIL: uv not found on PATH"; exit 1; }
command -v pymobiledevice3 >/dev/null || { echo "FAIL: pymobiledevice3 not found. Run: uv tool install pymobiledevice3"; exit 1; }
[ -f "$COLLECTOR/src/dw_collector/iphone/__main__.py" ] || { echo "FAIL: this checkout has no dw_collector/iphone; git pull first"; exit 1; }
ENV_FILE="${DW_ENV_FILE:-$DATA/.env}"
if [ ! -f "$ENV_FILE" ]; then
  cat <<MSG
FAIL: no env file at $ENV_FILE

Create it (outside the repo; the secret key bypasses RLS) with these four lines,
copying the values from the Windows collector's .env - not through chat:

  SUPABASE_URL=https://<project>.supabase.co
  SUPABASE_SECRET_KEY=<secret key>
  DW_COLLECTOR_ID=<the same value as on Windows>
  DW_COLLECTOR_SERVER_ID=580

then:  chmod 600 $ENV_FILE   and run this script again.
(DW_SQLITE_PATH is not needed: dw-iphone keeps its own journal, $DATA/iphone.db.)
MSG
  exit 1
fi

mkdir -p "$LOGS" "$HOME/Library/LaunchAgents"
# launchd gives a job a minimal PATH; uv tools and uv itself live in ~/.local/bin.
TOOL_PATH="$HOME/.local/bin:$(dirname "$UV"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$UV</string><string>run</string><string>--no-sync</string>
    <string>python</string><string>-m</string><string>dw_collector.iphone</string>
  </array>
  <key>WorkingDirectory</key><string>$COLLECTOR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$TOOL_PATH</string>
    <key>DW_ENV_FILE</key><string>$ENV_FILE</string>
    <key>PYTHONIOENCODING</key><string>utf-8</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOGS/iphone.log</string>
  <key>StandardErrorPath</key><string>$LOGS/iphone.log</string>
</dict>
</plist>
EOF

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
stop_stack
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl kickstart -k "$DOMAIN/$LABEL"

# One chain, or something is wrong: say so instead of letting it run doubled for days.
sleep 5
RUNNING="$(pgrep -f '/bin/python -m dw_collector\.iphone' | wc -l | tr -d ' ')"
if [ "$RUNNING" -gt 1 ]; then
  echo "WARNING: $RUNNING dw_collector.iphone processes are running; there should be one."
  echo "         Look with:  ps -eo pid,ppid,command | grep dw_collector"
fi
echo "installed $LABEL"
echo "  runs from: $COLLECTOR"
echo "  log:       $LOGS/iphone.log   (tail -f it)"
echo "  remove:    $0 --remove"

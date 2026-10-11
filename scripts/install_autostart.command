#!/bin/bash
# Start the Hidden local service automatically at login (macOS LaunchAgent).
# The service listens only on 127.0.0.1:8787. Undo with scripts/uninstall_autostart.command.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.thetrivials.hidden"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/Hidden.log"
PY="$ROOT/submission/venv/bin/python"
REPORT="$ROOT/output/autostart_install.log"
mkdir -p "$ROOT/output"
{
echo "=== $(date) ==="
if [ ! -x "$PY" ] || [ ! -f "$ROOT/frontend/dist/index.html" ]; then
  echo "First-time setup (dependencies and interface)..."
  python3 "$ROOT/run_app.py" --setup
fi
pkill -f "$ROOT/run_app.py" 2>/dev/null || true   # stop a manual instance; launchd takes over
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$PY</string><string>$ROOT/run_app.py</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
PLIST
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "LaunchAgent installed: $PLIST"
for i in $(seq 1 60); do
  if curl -s http://127.0.0.1:8787/api/health | grep -q '"service":"hidden"'; then
    echo "OK: Hidden is running at http://127.0.0.1:8787 and will start automatically at login."
    curl -s http://127.0.0.1:8787/api/health; echo
    echo "EXIT=0"; exit 0
  fi
  sleep 1
done
echo "The service did not answer within 60 s. Log: $LOG"
tail -20 "$LOG"
echo "EXIT=1"
} 2>&1 | tee "$REPORT"

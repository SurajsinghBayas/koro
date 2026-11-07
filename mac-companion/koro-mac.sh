#!/bin/sh
# Koro Mac companion: reports the MacBook's battery to your Koro server.
#   ./koro-mac.sh pair https://api.example.com ABCD1234   # once
#   ./koro-mac.sh install                                  # run every 10 min via launchd
#   ./koro-mac.sh push                                     # send now
#   ./koro-mac.sh x [--force]                              # collect X posts now (needs Agent-Reach, see README)
#   ./koro-mac.sh uninstall
set -eu
CONF="$HOME/.koro"
PLIST="$HOME/Library/LaunchAgents/com.koro.battery.plist"
XPLIST="$HOME/Library/LaunchAgents/com.koro.x.plist"
ARPY="$HOME/.local/share/uv/tools/agent-reach/bin/python"
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

case "${1:-push}" in
  pair)
    SERVER="${2:?server url}"; CODE="${3:?pairing code}"
    RESP=$(curl -fsS -X POST "$SERVER/v1/pair" -H 'content-type: application/json' \
      -d "{\"code\":\"$CODE\",\"name\":\"$(scutil --get ComputerName 2>/dev/null || echo MacBook)\",\"kind\":\"mac\"}")
    TOKEN=$(printf '%s' "$RESP" | /usr/bin/python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
    printf 'SERVER=%s\nTOKEN=%s\n' "$SERVER" "$TOKEN" > "$CONF"; chmod 600 "$CONF"
    echo "Paired. Now run: $0 install" ;;
  push)
    . "$CONF"
    BATT=$(pmset -g batt)
    PCT=$(printf '%s' "$BATT" | grep -Eo '[0-9]+%' | head -1 | tr -d '%')
    if printf '%s' "$BATT" | grep -q "AC Power"; then CHG=true; else CHG=false; fi
    curl -fsS -m 20 -X POST "$SERVER/v1/devices/battery" -H "authorization: Bearer $TOKEN" \
      -H 'content-type: application/json' -d "{\"pct\":${PCT:-0},\"charging\":$CHG}" >/dev/null ;;
  x)
    shift
    [ -x "$ARPY" ] || { echo "Agent-Reach is not installed (see README: X feeds)"; exit 1; }
    exec "$ARPY" "$(dirname "$SELF")/koro-x.py" "$@" ;;
  install)
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.koro.battery</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>$SELF</string><string>push</string></array>
  <key>StartInterval</key><integer>600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardErrorPath</key><string>/tmp/koro-battery.err</string>
</dict></plist>
EOF
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load "$PLIST"
    echo "Installed: battery is sent every 10 minutes while the Mac is awake."
    if [ -x "$ARPY" ]; then
      cat > "$XPLIST" <<XEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.koro.x</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>$SELF</string><string>x</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>StartInterval</key><integer>600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/tmp/koro-x.log</string>
  <key>StandardErrorPath</key><string>/tmp/koro-x.err</string>
</dict></plist>
XEOF
      launchctl unload "$XPLIST" 2>/dev/null || true
      launchctl load "$XPLIST"
      echo "Installed: X posts are collected every 10 min during India/MI matches, else every 30 min."
    fi ;;
  uninstall)
    launchctl unload "$PLIST" 2>/dev/null || true; rm -f "$PLIST"
    launchctl unload "$XPLIST" 2>/dev/null || true; rm -f "$XPLIST"; echo "Removed." ;;
  *) echo "usage: $0 pair <server> <code> | install | push | x [--force] | uninstall"; exit 1 ;;
esac

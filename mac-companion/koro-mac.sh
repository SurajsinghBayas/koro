#!/bin/sh
# Koro Mac companion: battery, clipboard sync + remote control from the phone, and X/YouTube collection.
#   ./koro-mac.sh pair https://api.example.com ABCD1234   # once
#   ./koro-mac.sh install                                  # run every 10 min via launchd
#   ./koro-mac.sh push                                     # send now
#   ./koro-mac.sh x [--force]                              # collect X posts now (needs Agent-Reach, see README)
#   ./koro-mac.sh send <link or text>                      # send to the phone (links open on tap)
#   ./koro-mac.sh clip on|off                              # pause / resume clipboard sync to the phone
#   ./koro-mac.sh uninstall
set -eu
CONF="$HOME/.koro"
PLIST="$HOME/Library/LaunchAgents/com.koro.battery.plist"
XPLIST="$HOME/Library/LaunchAgents/com.koro.x.plist"
APLIST="$HOME/Library/LaunchAgents/com.koro.agent.plist"
AGENT_DIR="$HOME/Library/Application Support/Koro"
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
  send)
    shift; . "$CONF"; TEXT="$*"; [ -n "$TEXT" ] || { echo "usage: $0 send <link or text>"; exit 1; }
    BODY=$(printf '%s' "$TEXT" | /usr/bin/python3 -c 'import sys,json;print(json.dumps({"text":sys.stdin.read()}))')
    curl -fsS -m 20 -X POST "$SERVER/v1/clip" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "$BODY" >/dev/null
    echo "Sent to your phone." ;;
  clip)
    case "${2:-}" in
      on)  sed -i '' '/^CLIP_SYNC=/d' "$CONF"; echo "Clipboard sync on." ;;
      off) sed -i '' '/^CLIP_SYNC=/d' "$CONF"; echo "CLIP_SYNC=0" >> "$CONF"; echo "Clipboard sync paused (phone → Mac still works)." ;;
      *) echo "usage: $0 clip on|off"; exit 1 ;;
    esac ;;
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
    # Clipboard sync + remote control (lock, sleep, media, volume): a tiny native agent, always running.
    mkdir -p "$AGENT_DIR"
    if swiftc -O -swift-version 5 "$(dirname "$SELF")/koro-agent.swift" -o "$AGENT_DIR/koro-agent" 2>/tmp/koro-agent-build.log; then
      cat > "$APLIST" <<AEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.koro.agent</string>
  <key>ProgramArguments</key><array><string>$AGENT_DIR/koro-agent</string></array>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>/tmp/koro-agent.log</string>
  <key>StandardErrorPath</key><string>/tmp/koro-agent.log</string>
</dict></plist>
AEOF
      launchctl unload "$APLIST" 2>/dev/null || true
      launchctl load "$APLIST"
      echo "Installed: clipboard sync + phone remote (lock, sleep, media, volume). Pause clipboard with: $0 clip off"
    else
      echo "Could not build the clipboard/remote agent (needs Xcode command line tools: xcode-select --install). See /tmp/koro-agent-build.log"
    fi
    if [ -x "$ARPY" ]; then
      cat > "$XPLIST" <<XEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.koro.x</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>$SELF</string><string>x</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>StartInterval</key><integer>180</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>/tmp/koro-x.log</string>
  <key>StandardErrorPath</key><string>/tmp/koro-x.err</string>
</dict></plist>
XEOF
      launchctl unload "$XPLIST" 2>/dev/null || true
      launchctl load "$XPLIST"
      echo "Installed: cricket posts from X every 3 min during India/MI matches, else every 15 min; My feed every 30 min."
    fi ;;
  uninstall)
    launchctl unload "$PLIST" 2>/dev/null || true; rm -f "$PLIST"
    launchctl unload "$XPLIST" 2>/dev/null || true; rm -f "$XPLIST"
    launchctl unload "$APLIST" 2>/dev/null || true; rm -f "$APLIST"; echo "Removed." ;;
  *) echo "usage: $0 pair <server> <code> | install | push | send <text> | clip on|off | x [--force] | uninstall"; exit 1 ;;
esac

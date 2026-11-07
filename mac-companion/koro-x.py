"""
Koro X collector (runs on the Mac, every 10 minutes via koro-mac.sh).

Reads X through Agent-Reach (its logged-in dedicated browser; read-only, no API fees) and sends the posts to
your Koro server:
  * cricket: latest posts from fast cricket-update accounts (every 10 min during an India/MI live match, else 30 min)
  * feed:    top posts by engagement from the accounts you follow (every 30 min)

Run with Agent-Reach's Python so the timeline call shares its browser:
  ~/.local/share/uv/tools/agent-reach/bin/python koro-x.py [--force]
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

HOME = os.path.expanduser("~")
STATE = os.path.join(HOME, ".koro-x-state.json")
AGENT_REACH = os.path.join(HOME, ".local", "bin", "agent-reach")
STOP_CODES = {"NEED_LOGIN", "PLATFORM_BLOCKED", "RATE_LIMITED", "BUSY"}


def conf():
    out = {}
    with open(os.path.join(HOME, ".koro")) as f:
        for line in f:
            if "=" in line:
                k, v = line.strip().split("=", 1)
                out[k] = v
    return out["SERVER"].rstrip("/"), out["TOKEN"]


def api(server, token, path, body=None):
    req = urllib.request.Request(
        server + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"authorization": f"Bearer {token}", "content-type": "application/json"},
        method="POST" if body is not None else "GET",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def load_state():
    try:
        with open(STATE) as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(s):
    with open(STATE, "w") as f:
        json.dump(s, f)


class Stop(Exception):
    """X wants a login / verification or is rate limiting: stop this run, try again next time."""


def user_tweets(handle, limit):
    p = subprocess.run([AGENT_REACH, "twitter", "tweets", handle, "--limit", str(limit)],
                       capture_output=True, text=True, timeout=240)
    try:
        d = json.loads(p.stdout)
    except ValueError:
        raise RuntimeError(f"agent-reach printed no JSON for @{handle}: {p.stderr[-200:]}")
    if not d.get("ok"):
        err = d.get("error") or {}
        if err.get("code") in STOP_CODES:
            raise Stop(f"{err.get('code')}: {err.get('message')}")
        raise RuntimeError(f"@{handle}: {err.get('code')} {err.get('message')}")
    return [it.get("raw") or {} for it in (d.get("result") or {}).get("items", [])]


def following_top(scan, top):
    from agent_reach.backends.opencli import opencli_call  # only importable from Agent-Reach's Python
    from agent_reach.runtime.result import ReachError

    try:
        rows = opencli_call("twitter", ["timeline", "--type", "following", "--limit", str(scan), "--top-by-engagement", str(top)],
                            timeout=240, login_hint="Run: agent-reach login twitter")
    except ReachError as e:
        code = getattr(e, "code", "")
        if code in STOP_CODES:
            raise Stop(f"{code}: {e}")
        raise
    if isinstance(rows, dict):
        rows = rows.get("data") or rows.get("items") or []
    return [r for r in rows if isinstance(r, dict)]


def main():
    force = "--force" in sys.argv
    server, token = conf()
    cfg = api(server, token, "/v1/x/config")
    st = load_state()
    now = time.time()
    try:
        live = len(api(server, token, "/v1/matches").get("live", [])) > 0
    except Exception:
        live = False

    payload = {"feed": [], "cricket": []}
    try:
        if force or live or now - st.get("cricket", 0) >= 29 * 60:
            for h in cfg.get("cricket", []):
                payload["cricket"] += user_tweets(h, cfg.get("cricketPerHandle", 15))
            st["cricket"] = now
        if force or now - st.get("feed", 0) >= 29 * 60:
            payload["feed"] = following_top(cfg.get("feedScan", 120), cfg.get("feedTop", 25))
            st["feed"] = now
    except Stop as e:
        st["error"] = str(e)
        save_state(st)
        print(f"stopped: {e}", file=sys.stderr)
        if payload["cricket"] or payload["feed"]:
            api(server, token, "/v1/x/ingest", payload)
        return 2

    st.pop("error", None)
    save_state(st)
    if payload["cricket"] or payload["feed"]:
        r = api(server, token, "/v1/x/ingest", payload)
        print(f"sent: {r.get('cricket', 0)} cricket, {r.get('feed', 0)} feed")
    else:
        print("nothing due")
    return 0


if __name__ == "__main__":
    sys.exit(main())

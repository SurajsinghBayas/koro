"""
Koro X collector (runs on the Mac every 3 minutes via koro-mac.sh; decides itself what is due).

Reads X through Agent-Reach (its logged-in dedicated browser; read-only, no API fees) and sends the posts to
your Koro server:
  * cricket: latest posts from fast cricket-update accounts (every 3 min during an India/MI live match, else 15 min)
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
    items = d.get("items") or (d.get("result") or {}).get("items") or []
    return [it.get("raw") or {} for it in items if isinstance(it, dict)]


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


def yt_description(url):
    """The video description, read like a normal browser visit from this Mac (YouTube blocks cloud servers)."""
    import re
    req = urllib.request.Request(url, headers={
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
        "accept-language": "en", "cookie": "SOCS=CAI; CONSENT=YES+"})
    with urllib.request.urlopen(req, timeout=20) as r:
        html = r.read().decode("utf-8", "replace")
    m = re.search(r'"shortDescription":"((?:[^"\\]|\\.)*)"', html)
    return json.loads('"' + m.group(1) + '"')[:4000] if m else ""


YTDLP = os.path.join(HOME, ".local", "share", "uv", "tools", "agent-reach", "bin", "yt-dlp")


def yt_dlp_subs(url):
    """Subtitles straight from yt-dlp (used when Agent-Reach is pausing YouTube). Returns text, "" if none, None on error."""
    import glob
    import tempfile
    if not os.path.exists(YTDLP):
        return None
    with tempfile.TemporaryDirectory() as d:
        p = subprocess.run([YTDLP, "--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", "en.*,en,hi.*",
                            "--sub-format", "json3", "-o", os.path.join(d, "s"), url], capture_output=True, text=True, timeout=180)
        files = sorted(glob.glob(os.path.join(d, "*.json3")), key=lambda f: ("orig" in f, len(f)))
        if not files:
            return "" if p.returncode == 0 else None
        with open(files[0]) as f:
            j = json.load(f)
    lines = []
    for ev in j.get("events", []):
        t = "".join(seg.get("utf8", "") for seg in ev.get("segs", []) or []).strip()
        if t and t != "\n" and (not lines or lines[-1] != t):
            lines.append(t)
    return " ".join(lines)


def yt_transcripts(server, token):
    """Help the server summarise new YouTube videos: description (always) + subtitles for fresh ones (yt-dlp via Agent-Reach)."""
    pending = api(server, token, "/v1/yt/pending").get("videos", [])
    sub_ok = True
    for v in pending:
        body = {"id": v["id"]}
        if v.get("wantDesc", True):
            try:
                body["description"] = yt_description(v["url"])
            except Exception as e:
                print(f"youtube: description {v['id']}: {e}", file=sys.stderr)
        if v.get("wantSub", True) and sub_ok:
            p = subprocess.run([AGENT_REACH, "youtube", "subtitle", v["url"]], capture_output=True, text=True, timeout=240)
            try:
                d = json.loads(p.stdout)
                if d.get("ok"):
                    body["text"] = "\n".join((it.get("text") or "") for it in d.get("items", [])).strip() or None
                elif (d.get("error") or {}).get("code") in STOP_CODES:
                    sub_ok = False  # Agent-Reach is pausing YouTube: use yt-dlp directly
                else:
                    body["text"] = ""  # no subtitles for this video
            except ValueError:
                pass
        if v.get("wantSub", True) and "text" not in body:
            try:
                t = yt_dlp_subs(v["url"])
                if t is not None:
                    body["text"] = t
            except Exception as e:
                print(f"youtube: yt-dlp {v['id']}: {e}", file=sys.stderr)
        api(server, token, "/v1/yt/transcript", body)
    return len(pending)


def main():
    force = "--force" in sys.argv
    server, token = conf()
    # YouTube first: an X login / rate-limit stop must not block summaries and explanations.
    try:
        n = yt_transcripts(server, token)
        if n:
            print(f"youtube: helped with {n} video(s)")
    except Exception as e:
        print(f"youtube: {e}", file=sys.stderr)
    cfg = api(server, token, "/v1/x/config")
    st = load_state()
    now = time.time()
    try:
        live = len(api(server, token, "/v1/matches").get("live", [])) > 0
    except Exception:
        live = False

    payload = {"feed": [], "cricket": []}
    try:
        cricket_every = (3 if live else 15) * 60 - 20  # small slack for launchd timing
        if force or now - st.get("cricket", 0) >= cricket_every:
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

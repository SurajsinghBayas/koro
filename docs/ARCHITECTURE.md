# Koro: how it works

## 1. The pieces

```
 Galaxy S25 (Tauri 2 app)                     AWS ap-southeast-1 (Singapore)
┌───────────────────────────────┐   HTTPS    ┌──────────────────────────────────┐
│ Svelte UI                     │ ─────────▶ │ EC2  t4g.small (ARM)             │
│ SQLite (offline copy of data) │ ◀───────── │  Caddy (HTTPS) → API (Bun+Hono)  │
│ Kotlin plugin: alarms, DND,   │            │  jobs: news · fixtures · live    │
│  battery, screen time, music, │            │  feed cache in memory + disk     │
│  FCM push receiver            │            └──────┬───────────────┬───────────┘
└──────────────▲────────────────┘                   │ SQL (pooled)  │ HTTPS
               │ push (match alerts)                ▼               ▼
         Firebase Cloud Messaging        Neon Postgres       Cricket API, RSS, HN
                                         (Singapore)
 MacBook Air M2 ── launchd every 10 min ── POST battery ──▶ API
```

| Piece | Job |
|---|---|
| **Phone app** | Shows everything and works offline. Owns anything that needs Android itself: alarms, DND, sleep timer, screen time, battery, music controls |
| **API on EC2** | The only thing that talks to outside APIs. Fetches news and cricket once for all your devices, syncs your lists, sends match push alerts |
| **Neon Postgres** | Source of truth for *your* data: tasks, grocery, habits, reminders, devices, settings |
| **FCM** | Wakes the phone for match alerts, so the app never polls in the background |
| **Mac companion** | A 10-line shell script that posts the MacBook's battery level |

---

## 2. What runs where

| Feature | Where it runs | Notes |
|---|---|---|
| Tasks, grocery, habits | Phone SQLite → synced to Neon | Works with no internet. Syncs when online |
| Reminders | **Phone** (AlarmManager exact alarms), synced to Neon | Fires even if the server is down or the phone is offline |
| Focus (DND), sleep timer, screen time, now playing | **Phone only** (Kotlin plugin) | These are Android APIs, so the server can't do them |
| News | **Server** fetches RSS + Hacker News every 30 min | Phone gets the top items in one small JSON |
| Matches (MI + India) | **Server** combines Cricinfo RSS (free, every 60 s) with CricketData.org (detail), *only during a tracked match* (see §7) | Phone gets FCM pushes when closed, and an SSE stream while the Matches screen is open |
| Device batteries | Mac → server every 10 min. Phone → server on open and on charger plug/unplug | Phone reads both |

**Tracked teams** (a config list on the server): Mumbai Indians (IPL) and India men (Tests, ODIs, T20Is). India women can be toggled on. Rohit's score is highlighted whenever he's playing (IPL and ODIs).

---

## 3. A day in the life

1. **You open the app.** It draws instantly from SQLite with no network wait, then sends two requests in parallel:
   `GET /v1/home` (matches, headlines, device batteries, ~10–20 KB compressed) and `POST /v1/sync` (list changes).
   The screen updates when they return. If you're offline, you still see everything from last time.
2. **You add "6pm call mom".** It's saved to SQLite and an alarm is set on the phone immediately. About 5 s later the change syncs to Neon.
3. **MI match day.** The server sees the fixture, and 30 min before the start it begins polling the cricket API. It sends an FCM push at each milestone in your rules (every over for MI, overs 10/20/30/40/50 for an India ODI, and so on) and at the result. Your phone stays asleep in between.
4. **You open the Matches screen during the game.** The app opens an SSE stream (`/v1/matches/:id/stream`) and the server pushes each score change the moment it sees it. The stream closes when you leave the screen.
5. **The Mac script runs.** It posts `{pct: 41, charging: false}` every 10 min. Your phone shows it the next time you open the app.
6. **Night.** Sleep timer and DND run entirely on the phone. The server is never involved.

---

## 4. API (small on purpose)

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/home` | Everything the Home screen needs, in one call. Supports ETag (a 304 reply costs almost nothing) |
| POST | `/v1/sync` | `{cursor, changes[]}` → `{changes[], cursor}` for tasks, grocery, habits, reminders |
| GET | `/v1/matches?status=live\|upcoming\|recent` | Matches tab |
| GET | `/v1/matches/:id/live` | Live score snapshot (served from memory) |
| GET | `/v1/matches/:id/stream` | SSE: pushes score changes while the Matches screen is open |
| GET | `/v1/news?cat=tech\|india\|world\|cricket` | News tab |
| POST | `/v1/devices/:id/battery` | Mac and phone report battery |
| POST | `/v1/devices/:id/push-token` | Register the phone's FCM token |
| GET | `/healthz` | Uptime check |

**Auth:** one user (you). Each device has its own long random token (`Authorization: Bearer …`). Only its SHA-256 hash is stored in Neon. On the phone the token lives in encrypted storage. Losing a device means deleting that one row.

---

## 5. Sync (offline-first, kept simple)

- Every synced row has `id` (UUID v7, generated on the device), `updated_at` and `deleted_at`. Deletes are kept as markers ("tombstones") so other devices learn about them.
- The phone writes to SQLite first and adds the change to an outbox. It syncs on app open, 5 s after an edit, and when the network comes back.
- The server applies changes with **last write wins** on `updated_at`, then returns everything changed since your cursor. With one user, real conflicts are almost impossible.

## 6. Neon schema

```sql
tasks          (id uuid pk, title text, notes text, due_on date, priority smallint,
                done_at timestamptz, sort int, updated_at timestamptz, deleted_at timestamptz)
grocery_items  (id uuid pk, name text, category text, bought_at timestamptz, updated_at, deleted_at)
habits         (id uuid pk, name text, days_mask smallint, updated_at, deleted_at)
habit_logs     (habit_id uuid, day date, pk(habit_id, day))
reminders      (id uuid pk, title text, fire_at timestamptz, repeat text, done_at, updated_at, deleted_at)
devices        (id uuid pk, name text, kind text, token_hash bytea, push_token text,
                battery_pct smallint, charging bool, battery_at timestamptz)
settings       (key text pk, value jsonb)
screen_time    (day date, app text, minutes int, pk(day, app))   -- optional, for weekly trends
```

**News and match data are *not* stored in Neon.** They are temporary, so the server keeps them in memory with a JSON snapshot on disk for restarts. That way Neon only wakes up when *you* actually use the app. On the free plan, Neon pauses the database when idle, and its compute time is what's limited.

---

## 7. Server stack

- **Bun + Hono (TypeScript).** Same language as the Svelte UI, with shared types through `zod`. It uses roughly 60–80 MB of RAM. (Rust + axum would be leaner, but it's slower to build features in.)
- **Drizzle ORM** with Neon's **pooled** connection string (the `-pooler` host).
- **Jobs** run inside the same process (`croner`). No separate queue is needed.
- **FCM** via the Firebase Admin HTTP v1 API with a service account.
- **Cricket provider behind an adapter** (`fixtures()`, `live(id)`), so you can switch providers without touching the app.

### Live scores: layered sources (free or nearly free)

Using one paid API for everything is expensive. Instead, the server combines sources, each doing what it's cheapest at:

| Layer | Source | Gives | Cost / limits | Used for |
|---|---|---|---|---|
| **A. Live summary** | **Cricinfo live-scores RSS** `static.cricinfo.com/rss/livescores.xml` | One request returns **every live match** as a line like `India 245/4 * v Australia` | Free, no key. Feed says `ttl=2` (refreshes about every 2 min). *Tested 2026-11-08: works* | Detect "MI/India match is live", headline score, wickets, result |
| **B. Detail** | **CricketData.org** API | Overs, batters (Rohit's score), bowlers, status text, fixtures | Free: 100 calls/day. Paid: **$5.99/month = 2,000/day** | Fixtures (2 calls/day), plus details while a tracked match is live |
| **C. Bonus (T20Is)** | **Sportmonks** free plan | Full data for T20 Internationals | Free: 180 calls/hour per endpoint, T20I/BBL/CSA T20 only | India T20Is every 20–30 s at no cost |
| **D. Emergency fallback** | Cricbuzz scrapers (e.g. `ekamid/cricbuzz-live`) | Scraped HTML | Free but fragile, against site terms, breaks on redesigns | Only if A and B are both down. Off by default |

**How they combine during a match**
1. **Fixtures** (B, twice a day) tell the server when a tracked match starts.
2. From 30 min before the start, the server polls **A every 60 s**. That's one tiny XML file for all matches. It finds the MI/India line and compares it with the last one. New runs or wickets update the in-memory score. A wicket or the result triggers an FCM push.
3. **B (detail)** is called on a budget:
   - Free plan (100/day): every 5 min while live (about 45 calls for a T20), plus at most 1 call per 30 s **only while your Matches screen is open**.
   - $5.99 plan (worth it during the IPL): every 30 s while live (about 420 calls per T20, well inside 2,000/day).
4. **Adaptive speed.** Polling is faster in the last 5 overs or when Rohit is past 40, slower during innings breaks, rain or stumps (read from the status text), and stops at the result.
5. **Failover.** Each source sits behind the same `ScoreSource` interface with a health check. If A returns stale data for over 5 min or fails to parse, the server switches to B (or C for T20Is) and pushes you a quiet "score source degraded" note.

**Getting scores to the phone in real time**
- **App closed:** FCM pushes follow the **update rules by format** above (milestones silent, result buzzes).
- **Matches screen open:** an **SSE stream** (`GET /v1/matches/:id/stream`). The server sends a few hundred bytes the moment the score changes, with no phone polling. The stream closes when the screen is hidden.
- The phone never talks to cricket sources directly. One server poll serves all your devices.

**Update rules by format (default, $0)**

| Match | Phone gets an update at | Source | API calls per match day |
|---|---|---|---|
| **IPL (MI)** | **Every over**, both innings + result | CricketData free | ~45 |
| **India T20I** | After overs **5, 10, 15, 20** each innings + result | Sportmonks free | ~20 (not limited) |
| **India ODI** | After overs **10, 20, 30, 40, 50** each innings + result | CricketData free | ~40–60 |
| **India Test** | End of each **session** (Lunch, Tea, Stumps) every day + result | CricketData free | ~25–30 |

Server config (`tracking.ts`):
```ts
export const rules = {
  ipl_mi:    { teams: ['Mumbai Indians'], format: 't20',  every: 'over' },
  india_t20: { teams: ['India'],          format: 't20i', atOvers: [5, 10, 15, 20] },
  india_odi: { teams: ['India'],          format: 'odi',  atOvers: [10, 20, 30, 40, 50] },
  india_test:{ teams: ['India'],          format: 'test', atSessions: ['Lunch', 'Tea', 'Stumps'] },
  always:    ['result'],                 // every format: final outcome
} as const;
```

How the server catches each milestone without wasting calls:
- **Over milestones (ODI, T20I):** the server predicts when the next milestone will arrive from the current over rate. It checks rarely until about 2 overs before, then every ~1 min until the over count passes the milestone, and sends that snapshot. The update can be an over late at most, and shows the exact overs (e.g. `10.2 ov`).
- **Test sessions:** the server polls every ~15 min and watches the match status for "Lunch / Tea / Stumps". Session times are known from the day's start time, so it checks more often near them.
- **IPL every over:** a check about every 4 min, timed to the over rate.
- **Result:** the Cricinfo RSS (free, every 60 s) spots the match ending, and the server confirms with one detail call.
- All four fit the **100/day free plan**, since you'll rarely have two tracked matches on the same day.

**On the phone**
- Each tracked match gets **one** notification card that **updates in place** (lock screen + Now Bar) instead of stacking new ones. For example: `IND 168/3 (30 ov) · Rohit 72* · RR 5.6`.
- Milestone updates are **silent**. Only the **result** buzzes.
- **In the app**, the score stays current anyway: the Cricinfo RSS refreshes it about every minute while the Matches screen is open. This doesn't count toward the notification rules.

**Ball-by-ball mode** (optional upgrade)
- A T20 delivery comes about every 30–45 s. To catch each ball the server polls layer B every **~10 s**.
  Per day: about 1,260 calls for a T20 and about 1,900 for an ODI, which fits the **$5.99 plan (2,000/day)** for one followed match a day.
  For India T20Is, layer C (Sportmonks) gives about 20 s updates for free.
- **App open:** each ball arrives over SSE, with a "last 6 balls" strip (`1 · 4 · W · 0 · 6 · 1`).
- **App closed:** a **sticky live notification** (shown in Samsung's Now Bar on the lock screen) is updated by FCM data messages each ball. Only big events (wicket, Rohit 50/100, result) buzz.
  It ends at the result or when you tap "Stop following". It's opt-in per match because about 400 wake-ups per match is a noticeable battery cost.
- Expect a few seconds' delay behind TV, and roughly in step with streaming apps, which also run behind live. Only expensive official feeds are faster.

**Notes**
- The Cricinfo RSS is public but unofficial. Personal use is fine. Don't redistribute it or build a public product on it.
- Expected cost: **$0** with per-over updates (the default). Pay $5.99/month only if you ever want ball-by-ball. Goalserve-style feeds (~$125/month) aren't needed.

---

## 8. EC2 setup

- **Region: ap-southeast-1 (Singapore) for both EC2 and Neon.** Neon has no Mumbai region, and keeping EC2 next to the database makes queries about 1 ms instead of about 60 ms. The extra phone-to-Singapore distance is fine for this app.
- **Instance:** `t4g.small` (ARM Graviton, 2 GB). `t4g.micro` (1 GB) also works for one user. Use Ubuntu 24.04 or Amazon Linux 2023.
- **Run:** `docker compose` with two services, `api` and `caddy`. Caddy sets up HTTPS (Let's Encrypt) automatically for a subdomain such as `api.yourdomain.com`.
  - Alternative: **Cloudflare Tunnel**. No public ports at all, and free.
- **Security group:** open 443 only. Close 22 and use **SSM Session Manager** instead.
- **Secrets** go in SSM Parameter Store, loaded into the environment: `DATABASE_URL`, `CRICKET_API_KEY`, `FCM_SERVICE_ACCOUNT`, `DEVICE_TOKEN_PEPPER`.
- **Deploy:** GitHub Actions builds an arm64 image → pushes to GHCR → `docker compose pull && up -d` over SSM.
- **Monitoring:** UptimeRobot (free) on `/healthz`, plus Docker logs.
- **Backups:** Neon's point-in-time restore, plus an optional weekly `pg_dump` to S3.

## 9. Phone side (Tauri 2)

- The Rust core is now thin: HTTP client, SQLite (`tauri-plugin-sql`), sync outbox, and secure token storage.
- **Kotlin plugin `koro-android`:** exact alarms · DND · sleep timer (audio focus + volume fade) · BatteryManager · UsageStats (screen time) · MediaSession (now playing) · FCM receiver · keep screen on (desk mode).
- **Battery rules:** no background polling, one shared ticker, live polling only while visible, push for everything else.

## 10. Build order

1. **Server skeleton:** EC2 + Caddy + Neon + `/healthz` + device tokens.
2. **App shell:** theme, SQLite, sync for tasks and grocery.
3. **Reminders + habits + focus + sleep timer** (Kotlin plugin v1).
4. **News + matches + FCM alerts.**
5. **Device batteries + Mac script.**
6. **Desk mode + screen time.**

# Koro: personal app for the Galaxy S25

One app for the day: tasks, reminders, habits, focus, sleep timer, MI + India matches, headlines, grocery, device batteries, and a desk clock.
It should feel instant and barely touch the battery.

| Doc | Covers |
|---|---|
| `ARCHITECTURE.md` | How it works: phone app, EC2 API, Neon, push, sync, setup, build order |
| `UIUX.md` | Screens, themes, motion, libraries |
| `src/styles/theme.css` | Design system (tokens, components, light/dark) |
| `showcase.html` | Clickable Home screen preview |

## Features
| Module | What it does |
|---|---|
| Home | One screen with everything for today |
| Matches | Mumbai Indians + India (Tests, ODIs, T20Is): live, upcoming, results, push alerts |
| News | Tech, India, World and Cricket headlines |
| Tasks | Daily to-do with carry-over |
| Grocery | Quick list, tap to mark as bought |
| Reminders | Quick chips ("in 30 min", "tonight"), exact alarms |
| Habits | Daily check-ins, streaks, X/Twitter screen-time limit |
| Focus | 25-min timer that turns on Do Not Disturb |
| Sleep timer | Fades out and stops Spotify/YT Music after N minutes |
| Devices | S25 + MacBook battery and charging state |
| Desk mode | Big clock + today's agenda while the phone is on the desk |

**Tweets:** the X API has no usable free tier, so the app shows a screen-time limit for X instead of a feed.

## Stack
- **App:** Tauri 2 (Android) + Svelte 5 + SQLite + a custom Kotlin plugin
- **Backend:** Bun + Hono on **EC2 t4g.small (Singapore)**
- **Database:** **Neon Postgres (Singapore)**
- **Push:** Firebase Cloud Messaging
- **Mac:** launchd shell script that posts battery

## Battery and memory rules
- True black in dark mode (AMOLED). Animate only `transform` and `opacity`. No looping animations.
- No background polling from the phone. The server polls once and pushes to the phone.
- Live scores poll only while the Matches screen is visible.
- Release build: `opt-level="s"`, LTO, strip, arm64-only APK. Targets: APK under 12 MB, RAM under 120 MB.

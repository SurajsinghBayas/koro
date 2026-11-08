# Koro

A personal all-rounder for one Galaxy S25 and one MacBook: an AI brief for the day, cricket (India + MI), news and YouTube digests, a holographic music player, a remote for the Mac, a shared clipboard, wellbeing limits, lists and home-screen widgets.

▶ **Film:** a 4K walkthrough made with Remotion from real screen recordings lives in [`video/`](video/) (render it with `npm run render`).

```
app/            Tauri 2 + Svelte 5 phone app (Kotlin plugin in app/src-tauri/plugins/tauri-plugin-koro)
server/         Bun + Hono API · Postgres (Neon in prod, embedded PGlite locally) · cricket engine · AI · FCM
shared/         quick-add parser used by both
mac-companion/  koro-agent.swift (menu-bar agent: remote, now playing, clipboard), koro-x.py (X / YouTube collector), koro-mac.sh (installer)
video/          Remotion project for the 4K product film
docs/           plan, UI/UX, architecture
```

## What it does

| Area | Features |
|---|---|
| **Today** | AI morning and night briefs from weather, calendar, tasks, cricket and news. Festival-aware: on Diwali or Holi the brief wishes you in its own words and mentions a real custom. Quick add by voice or text ("milk, eggs, call bank 10am"). |
| **Now playing** | Holographic player for whatever is playing on the phone **or the Mac** (the Mac wins when both play). Synced lyrics, Up next, Like / Shuffle / Repeat, and Play: find any song and it starts in YouTube Music with a radio mix. |
| **Mac remote** | Play/pause, volume and brightness sliders that stay in sync both ways (with an on-screen HUD on the Mac), Lock, **Sleep on/off** (display sleep, wakes it again), **Keep awake** (starts and ends an [Amphetamine](https://apps.apple.com/app/amphetamine/id937984704) session, falls back to `caffeinate`), Deep sleep, Find Mac, Work mode and one-tap app launchers. |
| **Clipboard** | Copy text or an **image** on the Mac and it's on the phone's clipboard. Share a photo or text to Koro on the phone and press ⌘V on the Mac. |
| **Cricket** | Live India and MI scores, scorecards, results, the buzz from X, and pushes by over or session (see the alert rules below). |
| **News & YouTube** | AI digests for World, India, AI & Tech and AI Startups; any YouTube video fully explained and saved as PDF or Markdown; read later offline. |
| **Wellbeing** | Daily limits per app, screen time, water, focus and sleep timers, habits. |
| **Widgets** | Holographic home-screen widgets: Today, Water (+1 glass), Mac remote, live Cricket, Now playing and the lists. |
| **Everywhere** | Pull down from the top of any tab to fetch only what changed (ETags, 304s). Desk mode for a docked phone. |

## 1. Run the server on your Mac (LAN, for first use)

```sh
cd server
bun install
bun src/index.ts            # http://0.0.0.0:8787, pairing code is SETUP_CODE in server/.env
bun test                    # 38 tests
```

The phone and the Mac must be on the same Wi-Fi. In the app's Settings, pair with `http://<mac-ip>:8787` and the code from `server/.env`.

## 2. Build and install the Android app

You need about **8 GB of free disk** for the NDK, Gradle and the Rust Android build.

```sh
# one-time toolchain
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
sdkmanager "ndk;27.2.12479018" "platforms;android-36" "build-tools;36.0.0" "platform-tools"
export NDK_HOME=$ANDROID_HOME/ndk/27.2.12479018
rustup target add aarch64-linux-android

cd app
bun install
bunx tauri android init      # generates src-tauri/gen/android (once)
bun run android:build        # → src-tauri/gen/android/app/build/outputs/apk/universal/release/*.apk
```

Install on the phone (Settings → About phone → tap Build number 7× → Developer options → USB debugging on):

```sh
adb devices                  # accept the prompt on the phone
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

The release APK is signed with the debug key unless you configure signing, which is fine for a personal sideloaded app.

**After the first launch on the phone:** in Settings, allow notifications, exact alarms, Do Not Disturb access (for Focus), Usage access (for screen time) and "Unrestricted" battery. Each one has its own button.

## 3. Mac companion

```sh
mac-companion/koro-mac.sh pair http://localhost:8787 <SETUP_CODE>
mac-companion/koro-mac.sh install     # builds koro-agent with swiftc, installs the launchd jobs
```

Re-run `install` after pulling changes to `koro-agent.swift`. The agent lives in the menu bar and:

- reports battery, volume, brightness, display sleep and keep-awake state, and what's playing (Music, Spotify, Safari / Chrome tabs incl. YouTube Music);
- runs commands from the phone: media keys, volume, brightness, lock, `sleeptoggle`, `awake`, `sleep`, find, work mode and app launchers;
- syncs the clipboard (text and images, ≤ 2000 px) both ways.

On first launch macOS asks for **Accessibility** (media keys) and **Automation** (Amphetamine, browsers, Music). For Keep awake, install Amphetamine from the App Store; without it Koro uses `caffeinate`.

## 4. Production: EC2 + Neon

1. **Neon:** create a project in `aws-ap-southeast-1` (Singapore; Neon has no Mumbai region). Copy the **pooled** connection string.
2. **EC2:** launch a `t4g.small` (ARM, Amazon Linux 2023) in `ap-southeast-1`. Open ports 80 and 443. Then:
   ```sh
   # COPYFILE_DISABLE stops macOS adding ._* files (they would be run as migrations)
   COPYFILE_DISABLE=1 tar czf - --exclude=server/node_modules --exclude=server/data --exclude='server/.env*' server shared | ssh ec2-user@<ip> 'mkdir -p ~/koro && cd ~/koro && tar xzf -'
   scp server/.env ec2-user@<ip>:~/koro/server/.env
   ssh ec2-user@<ip> 'bash ~/koro/server/deploy/ec2-setup.sh'
   ```
3. On EC2, edit `~/koro/server/.env` and set `DATABASE_URL=<neon pooled url>`. The AI keys and `SETUP_CODE` came across with the file.
4. Log out and back in, then from `~/koro` run `echo DOMAIN=<domain> > server/deploy/.env` once and `docker compose -f server/deploy/docker-compose.yml up -d --build`. Example domain: `DOMAIN=api.<elastic-ip-with-dashes>.sslip.io docker compose -f server/deploy/docker-compose.yml up -d --build`. You can use your own domain instead. Caddy gets HTTPS automatically.
5. In the app, open Settings → Unpair, then pair again with `https://<domain>`.

## 5. The film (Remotion)

```sh
cd video
npm install
npm run studio        # preview and tweak scenes (src/scenes.ts holds the script)
npm run render        # → out/koro-4k.mp4, 3840×2160, 30 fps, H.264
```

Scenes play real screen recordings from `public/clips/` (captured with `adb shell screenrecord`) inside a 3D phone frame on a holographic background.

## Optional keys (`server/.env`)

| Key | What it adds |
|---|---|
| `CRICKETDATA_API_KEY` | Exact overs for the 5/10/15/20 and 10/20/…/50 milestones, session breaks in Tests, and Rohit's score. Free plan: 100 hits a day. |
| `SPORTMONKS_API_TOKEN` | Faster India T20I updates. The free plan covers T20Is only. |
| `FCM_SERVICE_ACCOUNT_JSON` + `FIREBASE_*` | Real push notifications when the app is closed. Create a Firebase project, add an Android app with package `com.koro.app`, and download a service account key. |

Without any of these keys you still get live totals and results from the free Cricinfo RSS feed, and every alert lands in the in-app inbox.

## Alert rules

| Match | When you're notified |
|---|---|
| IPL (MI) | Every over |
| India T20I | After overs 5, 10, 15 and 20 of each innings, plus the result |
| India ODI | After overs 10, 20, 30, 40 and 50 of each innings, plus the result |
| India Test | At Lunch, Tea and Stumps each day, plus the result |

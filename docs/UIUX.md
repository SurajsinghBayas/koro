# Koro: UI/UX

Simple, fast and readable. The style is sky blue, silver and gold with a light pixel accent, used sparingly.
Preview: `showcase.html` (the Home screen, the Desk mode button and the theme button all work).

## Principles
1. **Text is always readable.** All words use **Geist** (sans). The pixel font is used only for big numbers: scores, clock, timers.
2. **Colors come only from theme tokens.** No hard-coded text colors, and no text placed over images. That's what keeps light and dark mode correct.
3. **Calm at rest.** Animations play once and stop. Nothing loops. Nothing redraws while you aren't touching the phone.

## Themes
- **Auto** (default): follows the phone's dark-mode setting.
- **Light**: silver-white background, white cards. Deeper sky `#0071B0` and gold `#946300` are used for text so they pass contrast.
- **Dark**: true black, which saves battery on the S25's AMOLED screen.
- Battery saver forces dark. Desk mode is always black.

## Screens
| Tab | Contents |
|---|---|
| **Home** | Quick-add bar · Matches (MI + India: live / next / last result) · Today's tasks · Reminders · Focus + Sleep tiles · Habits + X screen time · Devices · Headlines · Grocery |
| **Matches** | Live, upcoming and recent for MI and India (all formats). Tap a match for the scorecard |
| **News** | Tech · India · World · Cricket tabs. Save for later |
| **Lists** | Tasks · Grocery · Habits · Reminders |
| **Desk mode** (Home header button) | Big flip clock + today's agenda, always black, burn-in shift |

## Motion (the few things kept)
- **Rolling digits** for scores and battery (NumberFlow in the app).
- **Live pill:** when you scroll past the match card, a small pill with the live score slides in at the top. Pure CSS.
- **Pixel dissolve** when switching theme and entering desk mode, about 300 ms.
- **Haptics:** a tick on toggles, a double tick on completing something, a long buzz for reminders.

## Libraries
| Library | Use |
|---|---|
| Svelte 5 built-ins (`svelte/transition`, `animate:flip`) | Page and list motion |
| `@number-flow/svelte` | Rolling numbers |
| `@formkit/auto-animate` | Smooth list reorders |
| `@tauri-apps/plugin-haptics` | Haptics |
| pixelarticons | Icons |
| Fonts (bundled locally) | **Geist** for text · **Geist Pixel** / Pixelify Sans for big numerals |

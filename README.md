# What's My Workout?

A single-file mobile-first workout tracker that follows a fixed rotation and tells you what's next.

Live at: https://habits.chrisaug.com

## Rotation

Peloton Ride → Upper Push → Peloton Ride → Upper Pull → Peloton Ride → Lower Body → Peloton Ride → Yoga → repeat

## Features

- Shows the next workout in the rotation
- "Done!" advances the rotation; "Skip Today" logs an off day without advancing it
- **Undo** — reverses the most recent log entry (today's or yesterday's); restores rotation if it was a rotation-advancing done
- **Log for yesterday** — each workout row has a subtle link to immediately log that workout for yesterday (no confirmation), without affecting the rotation
- **Off Day row** — always-visible item at the bottom of the list; "Done" logs a day off (same as Skip Today), "Log for yesterday" logs an off day for yesterday
- Full workout history stored in localStorage as `{type, date}` entries
- Installable as a home screen PWA on iPhone (standalone mode, offline-capable)

## Storage (`localStorage` key: `wmw_v1`)

| Field | Description |
|---|---|
| `peloton`, `upper_push`, etc. | Date of last completion per workout type |
| `rotationIndex` | Current position in the 8-step rotation (0–7) |
| `actionDate` | Date the rotation was last actioned (locks the card for the day) |
| `history` | Array of `{type, date, advanced}` — every workout and off day logged; `advanced: true` = rotation-advancing done, `advanced: false` = row-level done / log-yesterday / off-day row; no `advanced` key = pre-flag legacy entry (treated as rotation-advancing for backward compat) |

## PWA

Requires `apple-touch-icon.png` (180×180 PNG, generated from `icon.svg`) for a proper home screen icon on iOS. Until added, iOS uses a page screenshot as the icon.

## Next Steps

1. ~~Deploy to Netlify~~ ✓
2. Add cardio/strength alternation logic

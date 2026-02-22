# What's My Workout?

A single-file mobile-first PWA that follows a fixed workout rotation and tells you what's next.

Live at: https://habits.chrisaug.com

## Rotation

Peloton alternates with every other workout. Yoga appears every 4th workout overall. The full 12-step cycle:

| Step | Workout |
|------|---------|
| 1 | Peloton Ride |
| 2 | Upper Push (chest / shoulders / triceps) |
| 3 | Peloton Ride |
| 4 | **Yoga** |
| 5 | Peloton Ride |
| 6 | Upper Pull (back / biceps) |
| 7 | Peloton Ride |
| 8 | **Yoga** |
| 9 | Peloton Ride |
| 10 | Lower Body |
| 11 | Peloton Ride |
| 12 | **Yoga** |
| → repeat | |

The rotation is position-based, not time-based — it always picks up where it left off regardless of how many days pass between workouts.

## Features

- **Hero card** — shows today's workout (Next Up), locks after Done or Skip Today
- **Tomorrow preview** — shows the next step in the rotation so you can plan ahead
- **Done!** — logs the workout and advances the rotation
- **Skip Today** — logs an off day without advancing the rotation (same workout suggested tomorrow)
- **Undo** — reverses the most recent log entry (today's or yesterday's); rolls back the rotation if applicable
- **Log for yesterday** — each workout row has a link to immediately backfill that workout for yesterday, without affecting the rotation
- **All Workouts list** — shows all 5 workout types with days since last completed
- Offline-capable PWA, installable on iPhone home screen

## Storage (`localStorage` key: `wmw_v1`)

| Field | Type | Description |
|---|---|---|
| `peloton`, `upper_push`, `upper_pull`, `lower`, `yoga` | `string` (YYYY-MM-DD) | Date of last completion per workout type |
| `rotationIndex` | `number` (0–7) | Current position in the 8-step rotation |
| `actionDate` | `string` (YYYY-MM-DD) | Date the rotation was last actioned — locks the hero card for the day |
| `history` | `array` | Every workout and off day ever logged as `{type, date, advanced}` |

**`history` entry flags:**
- `advanced: true` — logged via Done! (rotation-advancing)
- `advanced: false` — logged via row-level Done or Log for yesterday (does not affect rotation)
- no `advanced` key — legacy entry from before flag was introduced (treated as rotation-advancing for backward compat)

## PWA

Requires `apple-touch-icon.png` (180×180 PNG, generated from `icon.svg`) for a proper home screen icon on iOS. Until added, iOS uses a page screenshot as the icon.

## Next Steps

1. Migrate storage to Supabase (replace localStorage with a real DB)
2. Build a history view — calendar or log of past workouts and off days
3. Improve backtracking — ability to edit or correct past entries beyond yesterday

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

## Storage

Data is stored in **Supabase** (primary) with **localStorage** (`wmw_v1`) as an offline fallback. On every load the app reads from Supabase and mirrors the result to localStorage; on every write it saves to localStorage first (instant) then syncs to Supabase.

### Supabase tables

**`state`** — single row (id = 1), tracks rotation position

| Column | Type | Description |
|---|---|---|
| `id` | `int` | Always 1 |
| `rotation_index` | `int` | Current position in the 12-step rotation |
| `action_date` | `text` (YYYY-MM-DD) | Date the card was last actioned — locks the hero card for the day |

**`history`** — one row per logged event

| Column | Type | Description |
|---|---|---|
| `id` | auto | Primary key |
| `type` | `text` | Workout ID (`peloton`, `upper_push`, `upper_pull`, `lower`, `yoga`) or `off` for a skipped day |
| `date` | `text` (YYYY-MM-DD) | Date of the logged event |
| `advanced` | `boolean` | `true` = rotation-advancing (Done! button); `false` = non-advancing (row Done or Log for yesterday) |
| `created_at` | `timestamptz` | Set automatically by Supabase |

### localStorage cache (`wmw_v1`)

The local cache mirrors the Supabase data plus derived fields:

| Field | Type | Description |
|---|---|---|
| `peloton`, `upper_push`, `upper_pull`, `lower`, `yoga` | `string` (YYYY-MM-DD) | Date of last completion per workout type (derived from history) |
| `rotationIndex` | `number` | Current position in the rotation |
| `actionDate` | `string` (YYYY-MM-DD) | Locks the hero card for the day |
| `history` | `array` | Every logged event as `{type, date, advanced}` |

## PWA

Requires `apple-touch-icon.png` (180×180 PNG, generated from `icon.svg`) for a proper home screen icon on iOS. Until added, iOS uses a page screenshot as the icon.

## Next Steps

1. Build a history view — calendar or log of past workouts and off days
2. Improve backtracking — ability to edit or correct past entries beyond yesterday

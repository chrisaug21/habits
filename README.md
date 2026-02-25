# What's My Workout?

A single-file mobile-first PWA that follows a fixed workout rotation and tells you what's next.

Live at: https://habits.chrisaug.com

## Vision
What’s My Workout? started as a personal tool to answer one simple question: what should I do today? The goal was never to replace a gym app or a coach — just to remove the daily friction of deciding, and to build a streak worth protecting.

The longer-term vision expands that idea into a small daily habit dashboard for a close-knit group of friends and family. Alongside the workout rotation, the app will grow to track a handful of other healthy daily habits — things like journaling and hitting a water intake goal — visualized in a calendar view that shows your past consistency and keeps your future goals in sight.

The calendar is the centerpiece: a simple, honest record of the days you showed up, paired with a forward-looking view of what’s coming. Not just where you’ve been, but where you’re headed — your next workout already planned, your weekly habit targets visible, your streaks worth protecting. No gamification, no social pressure, no algorithms. Just your habits, your history, and a clear picture of whether you’re living the way you want to live.

Planned for a small user base — a handful of people with logins plus a public guest view — the app will stay intentionally simple. No integrations, no notifications, no noise. Just a few good habits, a honest look at the past, and a clear path forward.

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

- **Hero card** — shows today's workout (Next Up), locks after Done, Skip Today, or Log Other Activity
- **Tomorrow preview** — shows the next step in the rotation so you can plan ahead
- **Done!** — logs the workout and advances the rotation
- **Skip Today** — logs an off day without advancing the rotation (same workout suggested tomorrow)
- **Log Other Activity** — opens a modal to record a free-form activity (e.g. "Morning walk", "Swim"); does not advance the rotation; stores recent activities in `wmw_other_activities` for quick re-selection
- **Undo** — reverses the most recent log entry (today's or yesterday's); rolls back the rotation if applicable
- **Log for yesterday** — each workout row has a link to immediately backfill that workout for yesterday, without affecting the rotation
- **All Workouts list** — shows all 5 workout types with days since last completed
- **History view** — accessible via a bottom navigation bar (Today / History tabs)
  - **Calendar** (default): monthly grid with prev/next month navigation; each day shows a purple workout icon for completed workouts, an amber moon for rest/skip days, a teal zap icon for other activities, a dimmed projected icon for future days based on the rotation, or is empty for past days with no data; today is subtly highlighted
  - **List**: chronological log of all past entries (newest first), with workout icon, date, day of week, and name; other activities show the free-form name in teal with a zap icon; a "Coming Up" section below shows the next 14 projected workouts (dimmed)
  - Both views are read-only
- Offline-capable PWA, installable on iPhone home screen
- **Test mode** — hidden feature; triple-tap the version stamp (bottom of Today screen) or press Ctrl+Shift+T to toggle; shows an amber banner confirming no real data is affected; uses isolated localStorage keys (`wmw_test`, `wmw_test_other_activities`) and skips all Supabase calls

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
| `type` | `text` | Workout ID (`peloton`, `upper_push`, `upper_pull`, `lower`, `yoga`), `off` for a skipped day, or `other` for a free-form activity |
| `date` | `text` (YYYY-MM-DD) | Date of the logged event |
| `advanced` | `boolean` | `true` = rotation-advancing (Done! button); `false` = non-advancing (Skip, Other Activity, row Done, Log for yesterday) |
| `note` | `text` (nullable) | Free-form activity name; only set when `type = 'other'`. Add with: `ALTER TABLE history ADD COLUMN note text;` |
| `sequence` | `integer` | Explicit insert order (the entry's index in the history array). Used for sorting instead of `created_at` because batch re-inserts share the same timestamp. Add with: `ALTER TABLE history ADD COLUMN sequence integer;` |
| `created_at` | `timestamptz` | Set automatically by Supabase; not used for ordering |

### localStorage cache (`wmw_v1`)

The local cache mirrors the Supabase data plus derived fields:

| Field | Type | Description |
|---|---|---|
| `peloton`, `upper_push`, `upper_pull`, `lower`, `yoga` | `string` (YYYY-MM-DD) | Date of last completion per workout type (derived from history) |
| `rotationIndex` | `number` | Current position in the rotation |
| `actionDate` | `string` (YYYY-MM-DD) | Locks the hero card for the day |
| `history` | `array` | Every logged event as `{type, date, advanced, note?}` — `note` is only present for `type: 'other'` entries |
| `wmw_other_activities` (separate key) | `string[]` | Up to 10 most-recently used other activity names, most-recent first, deduplicated case-insensitively |

## Deployment

This is a static site deployed on Netlify. The Supabase credentials are **not** stored in the source code — they are injected at deploy time from Netlify environment variables.

### Required environment variables

Set these in **Netlify Dashboard → Your site → Site configuration → Environment variables**:

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL (e.g. `https://xxxx.supabase.co`) |
| `SUPABASE_KEY` | Your Supabase publishable (anon) key |

### How it works

`netlify.toml` defines a one-line build command that uses `sed` to replace the `%%SUPABASE_URL%%` and `%%SUPABASE_KEY%%` placeholder tokens in `index.html` with the real values before Netlify serves the site. The source file always contains the placeholder tokens — the real credentials only exist inside the deployed build.

### Local development

For local testing, temporarily replace the placeholder tokens in `index.html` with your actual credentials, but **do not commit that change**. Restore the placeholders before pushing.

### Keep-alive function

`netlify/functions/keep-alive.js` is a Netlify scheduled function that runs once daily (configured via `netlify.toml`). It makes a lightweight read against the Supabase `state` table using the same `SUPABASE_URL` and `SUPABASE_KEY` environment variables, preventing the free-tier Supabase project from pausing due to inactivity. No additional setup is required — it runs automatically on a daily cron schedule.

## PWA

Requires `apple-touch-icon.png` (180×180 PNG, generated from `icon.svg`) for a proper home screen icon on iOS. Until added, iOS uses a page screenshot as the icon.

The service worker (`sw.js`) precaches the Supabase JS client from the CDN alongside the app's own files. This means the app loads correctly offline after the first visit — no network request to the CDN needed.

## Next Steps

1. Improve backtracking — ability to edit or correct past entries beyond yesterday
2. Multi-user support with logins and a public guest view
3. Habit tracking beyond workouts (journaling, water intake, etc.)

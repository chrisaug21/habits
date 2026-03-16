# Habits

A mobile-first PWA for daily habits — workout tracking, journaling, and intention-setting.

**Current version: 1.5.6**

Live at: https://habits.chrisaug.com

## Vision
Habits started as a personal workout tracker but has grown into a small daily habit dashboard. It answers three questions every morning: what should I do for exercise today, what’s my intention, and what am I grateful for?

The calendar is the centerpiece: a simple, honest record of the days you showed up, paired with a forward-looking view of what’s coming. No gamification, no social pressure, no algorithms. Just your habits, your history, and a clear picture of whether you’re living the way you want to live.

Planned for a small user base — a handful of people with logins plus a public guest view — the app will stay intentionally simple. No integrations, no notifications, no noise.

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

### Navigation
Bottom nav: **Today · Log · Stats** (three tabs)

### Today tab
The Today tab is a daily habit dashboard with three cards. All entry happens via modals — the tab itself is read-only with action buttons.

**Workout card**
- Shows today's suggested workout (Next Up) with rotation, Done!, and Undo logic unchanged
- **Done!** — logs the workout and advances the rotation
- **Log activity** — opens a chooser modal with all 5 workout types, Rest Day, and a freeform Other activity option
- **Undo** — reverses the most recent log entry; rolls back the rotation if applicable
- **Tomorrow preview** — shows the next step in the rotation below the card

**Journal card**
- Incomplete state: "Journal" button opens the journal modal
- Complete state: shows a truncated preview of today's entries + Done ✓ badge + Edit button
- Journal modal — three prompts: "What's your intention for today?", "What are you grateful for?", "What's the one thing you'll get done today?"; Save writes to Supabase + localStorage
- **Gratitude uniqueness nudge** — on Save, compares new gratitude against the last 7 days; if similar entry found, shows "You mentioned something similar recently — still want to use it?" with Yes / Change it options

**Weight card**
- Incomplete state: "Log Weight" button opens the weight modal
- Complete state: shows logged weight in lbs + Done ✓ badge + Edit button
- Weight modal — large number input (lbs, step 0.1); upserts to the Supabase `weight` table

### Log tab
- **Calendar** (default): monthly grid with prev/next month navigation; each day shows a purple workout icon for completed workouts, an amber moon for rest/skip days, a teal zap icon for other activities, a dimmed projected icon for future days, or is empty for past days with no data; days with a journal entry show a small **green dot**; days with weight logged show a small **coral dot**; today is subtly highlighted; all past days are tappable
- **List**: chronological log of all past entries (newest first), with workout icon, date, day of week, and name
- **Schedule**: the next 14 projected workouts based on the current rotation
- **Past-day detail / backfill** — tap any past day in the calendar to open a day-detail sheet; it always opens in read-only mode first and shows exercise, weight, and any journal entry for that day; from there you can add or edit exercise, and add or edit weight for any past day; journal remains read-only; exercise options are all 5 rotation workouts, Rest Day, and Other Activity

### Stats tab
- **Last 30 Days / All Time toggle** — defaults to Last 30 Days; toggle state resets on each open
- **Weight Trend** — first section on the tab; shows raw weigh-in dots, a 7-day rolling average line, and a dimmer trendline; if fewer than 2 weights exist it shows an empty state instead
- **Total Workouts** — count of rotation-advancing entries in the selected time range
- **Streaks** — current streak and longest streak (always computed from full history regardless of range toggle)
- **Consistency %** — days with a workout / total days in range
- **Workouts by Type** — horizontal progress bars for all 5 workout types

### Other
- Offline-capable PWA, installable on iPhone home screen; entries logged while offline are automatically synced to Supabase the next time the app loads with a connection
- **Account + Settings** — Settings shows the signed-in email, avatar initial, optional first/last name fields stored in Supabase auth metadata, a Tutorial shortcut, Sync data now, Change password, Send feedback, Sign out, and a Danger Zone delete-account flow
- **Auth recovery** — login includes a Forgot password link that sends a Supabase password reset email; recovery links open the app and prompt for a new password
- **First-time welcome screen** — brand-new signups see a one-time welcome overlay before the Today tab, with a quick walkthrough of workouts, journaling, weight tracking, and settings; dismiss state is stored per user in localStorage
- **Test mode** — hidden feature; triple-tap the version stamp (bottom of Today screen) or press Alt+Shift+T to toggle; shows an amber banner confirming no real data is affected; uses isolated localStorage keys (`habits_test`, `habits_test_other_activities`, `habits_test_journal`) and skips all Supabase calls
- **Sync status** — the version stamp at the bottom of the Today screen shows `synced just now` / `synced Xm ago` / `offline`; updates after every successful or failed Supabase read/write

## Storage

Data is stored in **Supabase** (primary) with **localStorage** as an offline fallback. On every load the app reads from Supabase and mirrors the result to localStorage; on every write it saves to localStorage first (instant) then syncs to Supabase.

### Supabase tables

**`state`** — single row (id = 1), tracks rotation position

| Column | Type | Description |
|---|---|---|
| `id` | `int` | Always 1 |
| `rotation_index` | `int` | Current position in the 12-step rotation |
| `action_date` | `text` (YYYY-MM-DD) | Date the card was last actioned — locks the hero card for the day |

**`history`** — one row per logged workout event

| Column | Type | Description |
|---|---|---|
| `id` | auto | Primary key |
| `type` | `text` | Workout ID (`peloton`, `upper_push`, `upper_pull`, `lower`, `yoga`), `off` for a skipped day, or `other` for a free-form activity |
| `date` | `text` (YYYY-MM-DD) | Date of the logged event |
| `advanced` | `boolean` | `true` = rotation-advancing; `false` = non-advancing |
| `note` | `text` (nullable) | Activity name when `type = 'other'`, or optional reason when `type = 'off'` |
| `sequence` | `integer` | Explicit insert order; used for sorting instead of `created_at` |
| `created_at` | `timestamptz` | Set automatically by Supabase; not used for ordering |

**`journal`** — one row per day (date is unique)

| Column | Type | Description |
|---|---|---|
| `id` | auto | Primary key |
| `date` | `text` (YYYY-MM-DD) | The journal date — unique, one entry per day |
| `intention` | `text` (nullable) | Response to "What's your intention for today?" |
| `gratitude` | `text` (nullable) | Response to "What are you grateful for?" |
| `one_thing` | `text` (nullable) | Response to "What's the one thing you'll get done today?" |
| `created_at` | `timestamptz` | Set automatically by Supabase |

**`weight`** — one row per day (date is unique)

| Column | Type | Description |
|---|---|---|
| `id` | auto | Primary key |
| `date` | `date` | The weight date — unique, one entry per day |
| `value_lbs` | `numeric(5,1)` | Weight in lbs |
| `created_at` | `timestamptz` | Set automatically by Supabase |

Migration SQL (run manually in Supabase SQL editor):
```sql
create table if not exists weight (
  id         bigint generated always as identity primary key,
  date       date           not null unique,
  value_lbs  numeric(5,1)   not null,
  created_at timestamptz    not null default now()
);
alter table weight enable row level security;
create policy "allow all" on weight for all using (true) with check (true);
```

### localStorage keys

| Key | Type | Description |
|---|---|---|
| `<user-id>:habits_v1` | JSON object | Full workout state: `rotationIndex`, `actionDate`, `history[]`, last-completion dates per workout type, `_maxSeq` |
| `<user-id>:habits_other_activities` | `string[]` | Up to 10 most-recently used other activity names |
| `<user-id>:habits_v1_skip_reasons` | `string[]` | Up to 10 most-recently used skip reasons |
| `<user-id>:habits_journal` | `array` | Journal entries as `[{ date, intention, gratitude, one_thing }]`, newest first |
| `<user-id>:habits_weight` | `array` | Weight entries as `[{ date, value_lbs }]`, newest first |
| `<user-id>:habits_welcomed` | `string` | One-time dismissal flag for the welcome screen (`'1'` after the user closes it) |

**localStorage migration:** On first load after this release, the app automatically migrates legacy shared keys like `wmw_v1`, `habits_v1`, and `habits_journal` into the signed-in user's namespaced keys, then deletes the old shared key.

### Test-mode localStorage keys

When test mode is active (`?test=true` in the URL), the app writes to isolated per-user keys (`<user-id>:habits_test`, `<user-id>:habits_test_other_activities`, `<user-id>:habits_test_skip_reasons`, `<user-id>:habits_test_journal`, `<user-id>:habits_test_weight`) and skips all Supabase calls. All test data is wiped by the Reset button in the test banner.

## File structure

| File | Purpose |
|---|---|
| `index.html` | App shell — HTML markup only |
| `style.css` | All CSS styles |
| `app.js` | All JavaScript — app logic, Supabase calls, service worker registration |
| `sw.js` | Service worker — precaching and offline support |
| `manifest.json` | PWA manifest |
| `netlify.toml` | Build command (injects Supabase credentials) and scheduled keep-alive function |
| `netlify/functions/keep-alive.js` | Daily Supabase ping to prevent free-tier pause |

## Deployment

This is a static site deployed on Netlify. The Supabase credentials are **not** stored in the source code — they are injected at deploy time from Netlify environment variables.

### Required environment variables

Set these in **Netlify Dashboard → Your site → Site configuration → Environment variables**:

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL (e.g. `https://xxxx.supabase.co`) |
| `SUPABASE_KEY` | Your Supabase publishable (anon) key |

### How it works

`netlify.toml` defines a one-line build command that uses `sed` to replace the `%%SUPABASE_URL%%` and `%%SUPABASE_KEY%%` placeholder tokens in `app.js` with the real values before Netlify serves the site. The source file always contains the placeholder tokens — the real credentials only exist inside the deployed build.

### Local development

For local testing, temporarily replace the placeholder tokens in `app.js` with your actual credentials, but **do not commit that change**. Restore the placeholders before pushing.

### Keep-alive function

`netlify/functions/keep-alive.js` is a Netlify scheduled function that runs once daily (configured via `netlify.toml`). It makes a lightweight read against the Supabase `state` table using the same `SUPABASE_URL` and `SUPABASE_KEY` environment variables, preventing the free-tier Supabase project from pausing due to inactivity. No additional setup is required — it runs automatically on a daily cron schedule.

### Feedback form

Settings feedback submits through a hidden Netlify form named `feedback` using a standard POST from the app. To have submissions forwarded to your inbox, configure a Netlify email notification for that form in the Netlify dashboard after the first deploy that includes it.

## PWA

Requires `apple-touch-icon.png` (180×180 PNG, generated from `icon.svg`) for a proper home screen icon on iOS. Until added, iOS uses a page screenshot as the icon.

The service worker (`sw.js`) precaches `index.html`, `style.css`, `app.js`, and the CDN scripts used by the app (Supabase, Lucide, and Chart.js). This means the app loads correctly offline after the first visit — no network request to the CDN needed.

## Next Steps

1. Multi-user support with logins and a public guest view
2. 7-day average weight in the Weight card (#73)
3. Journal streaks and stats

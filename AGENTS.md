# AGENTS.md — Habits (project-specific overrides)

> Global instructions live in ~/.codex/AGENTS.md. This file adds
> habits-specific context only.

## Project overview
Habits is a mobile-first PWA for personal habit tracking. Solo-built,
intentionally simple. Live at https://habits.chrisaug.com.

## Stack
- Vanilla JS, HTML, CSS — plain script modules, no framework or bundler
- Supabase (backend + auth)
- Netlify (hosting + serverless functions)

## Architecture rules
- Supabase is the source of truth for all writes
- localStorage is read-only cache — do not write to it
- Account-level UI settings belong in `user_preferences`, not `state`
- `user_preferences` should be loaded once after auth, cached in memory, and written back directly on change
- Custom workout rotations should load into in-memory `state.workoutLibrary` and `state.userRotation` after auth resolves
- Auth bootstrap should show the splash screen first and only reveal the login screen or app after auth resolves (or the 2 second splash timeout is reached)
- Pre-built workout programs should load into in-memory `state.programs` after auth resolves; if that fetch fails, fall back silently so the rest of the app still works
- Program-picker actions must disable while a program save is in flight so users cannot double-submit or jump into the builder mid-save
- Use shared rotation helpers for reads so the app prefers `state.userRotation` when it has 2+ items and otherwise falls back to the built-in `WORKOUTS`/`ROTATION`
- Read workout icons from `workout_library.icon` when workout rows are already loaded; do not re-derive display icons from category in app code
- Today and Stats should show explicit dark loading placeholders during Supabase reads and manual syncs instead of rendering partial empty content
- Persist saved user rotations through the `save_user_rotation` Supabase RPC instead of separate client-side delete/insert calls
- Keep tutorial copy aligned with the live product: custom workout rotation controls and Today tab card visibility should be reflected in onboarding text
- Keep `app.js` as the runtime spine; shared helpers may live in small support files like `shared.js` and `data.js`, while feature code belongs in feature modules
- Supabase JS `.upsert()` calls must pass `onConflict` as a comma-separated string, not an array
- If Supabase is unreachable, show an error toast — no offline writes
- Reuse shared "last done" thresholds and labels across surfaces instead of re-inventing per-view logic
- Do not add frameworks or dependencies without explicit approval

## Mobile-first
PWA optimized for one-handed iPhone use. Prioritize large tap targets,
minimal typing, fast load, offline capability in every UI decision.

## Service worker + versioning (high risk — be careful)
- Bump `VERSION` in `app.js` and cache prefix in `sw.js` together before
  every push
- Format: VERSION 1.1.48 → cache `habits-v48`
- Never update one without the other
- Cache prefix is `habits-v##` — do not change this format

## Supabase rules
- No destructive schema changes without explicit instruction
- Explain SQL migrations clearly before running
- Preserve RLS policies after any auth-related changes

## Pre-push checklist
1. Bump VERSION in app.js + cache version in sw.js (must match)
2. Verify mobile layout
3. Confirm service worker behavior intact
4. Update README.md if schema, features, or deployment changed
5. Update AGENTS.md if new patterns or gotchas were discovered

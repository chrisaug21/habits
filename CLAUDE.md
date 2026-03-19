# CLAUDE.md — Habits (project-specific overrides)

> Global instructions live in ~/.claude/CLAUDE.md. This file adds
> habits-specific context only.

## Project overview
Habits is a mobile-first PWA for personal habit tracking. Solo-built and
intentionally simple. Live at https://habits.chrisaug.com.

## Stack
- Vanilla JS, HTML, CSS (plain script modules, no framework or bundler)
- Supabase (backend + auth)
- Netlify (hosting + serverless functions)

## Architecture rules
- Supabase is the source of truth for all writes — do not revert to localStorage
- localStorage is read-only cache only
- localStorage cache keys must be scoped per user ID to prevent cache bleed between accounts on the same device
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
- Reuse shared "last done" thresholds and labels across surfaces instead of re-inventing per-view logic
- If Supabase is unreachable, show an error toast — do not attempt offline writes
- Do not introduce frameworks or additional dependencies without explicit approval

## Mobile-first
This is a PWA optimized for one-handed iPhone use. Every UI/UX decision must
prioritize large tap targets, minimal typing, fast load, and offline capability.

## Service worker + versioning
- Bump `VERSION` constant in `app.js` before every push
- Bump the cache prefix in `sw.js` to match (e.g. VERSION 1.1.48 → `habits-v48`)
- These must always be updated together — never one without the other
- Cache prefix is `habits-v##` — ignore any suggestions to change this format

## Supabase
- No destructive schema changes without explicit instruction
- Clearly explain any SQL migrations before running them
- Ensure RLS policies remain intact after any auth-related changes

## Pre-push checklist
1. Bump VERSION in app.js and cache version in sw.js (together)
2. Verify mobile layout
3. Confirm service worker behavior is intact
4. Update README.md if schema, features, or deployment steps changed
5. Update AGENTS.md if new patterns or gotchas were discovered

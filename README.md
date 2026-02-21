# What's My Workout?

A single-file mobile-first workout tracker that suggests whichever of your 5 workouts is most overdue.

Live at: https://habits.chrisaug.com

## PWA

Installable as a home screen app on iPhone. Uses a service worker to cache the app shell for offline use. `localStorage` data persists within the standalone app context.

**Note:** For a proper home screen icon on iOS, generate `apple-touch-icon.png` (180×180 PNG) from `icon.svg` and add it to the repo root. Until then, iOS will use a page screenshot as the icon.

## Next Steps

1. ~~Deploy to Netlify~~ ✓
2. Add cardio/strength alternation logic

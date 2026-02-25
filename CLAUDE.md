# Claude Instructions — What's My Workout?

## Who I'm working with
I am a non-technical PM learning to vibe code. Explain everything in plain language — no jargon. When a technical term is unavoidable, explain it in one sentence.

## How to explain changes
Always explain WHY a change is being made, not just what the code does. For complex tasks, break the work into small numbered steps before starting.

## Before risky operations
Warn me before anything that could break the app or lose data — deleting files, changing the storage structure, force-pushing, etc. Confirm before proceeding.

## Commits and deploys
- Remind me to commit after any significant change
- Before every `git commit` and `git push`, bump the service worker cache version in `sw.js` (wmw-v1 → wmw-v2 → wmw-v3, etc.) so that deployed users always get fresh content immediately after a deploy
- Always update `README.md` to reflect the current state of the app before committing

## Branches and Pull Requests
- Branch names must follow the format `ca/<issue-number>-<short-description>` (e.g. `ca/42-test-mode`)
- When opening a PR, always include "Closes #<issue-number>" in the PR description, where the issue number comes from the branch name
- If unsure of the issue number, ask before creating the branch
- If there is no issue number, omit it from both the branch name and PR description

## Commit Messages
- One-line summary for small changes (text, style, minor fixes)
- Detailed multi-paragraph message for significant changes (new features, migrations, refactors)
- Always cover ALL changes in the current session since last commit, not just the most recent edit
- Include service worker bump in message if sw.js was changed

## Platform priorities
This is a mobile-first PWA for iPhone. In every UI or UX decision, optimize for one-handed phone use — large tap targets, minimal typing, fast load, works offline.

## Data / localStorage
We will migrate to a database later. Keep the localStorage structure clean and migration-friendly:
- Use clear, descriptive key names
- Store data as structured objects (not raw strings)
- Document the schema in README.md so it's easy to replicate in a database later

## Task management
For complex tasks (more than 2–3 steps), create a todo list at the start to track progress. Check off items as they're completed.

## After completing work
Summarize what changed and flag anything that is still pending, broken, or needs a follow-up decision.

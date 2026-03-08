# Claude Instructions — Habits

## Who I'm working with
I am a non-technical PM learning to vibe code. Explain everything in plain language — no jargon. When a technical term is unavoidable, explain it in one sentence.

## Project profile
This is a solo-built personal web app maintained by a non-technical product manager.

Core stack:
- HTML
- CSS
- Vanilla JavaScript
- Supabase
- Netlify
- GitHub
- CodeRabbit

Preferred approach:
- Keep things simple and readable
- Prefer small files and straightforward code over clever abstractions
- Avoid heavy frameworks unless explicitly requested
- Minimize dependencies whenever possible
- Choose the least complex solution that will still be easy to maintain later

When suggesting changes, optimize for:
1. Low complexity
2. Low token usage
3. Easy debugging
4. Easy future handoff to a more robust stack if needed

## How to explain changes
Always explain WHY a change is being made, not just what the code does. For complex tasks, break the work into small numbered steps before starting.

## How to work
Before making code changes, briefly state:
1. what you think the problem is
2. the smallest reasonable fix
3. which files you expect to touch

For any task larger than a quick fix, work in small phases:
- inspect
- plan
- implement
- test
- summarize

Do not jump into broad refactors unless explicitly asked.
Prefer improving the existing code over rewriting working code.

## Token and efficiency rules
Conserve tokens whenever possible.

- Prefer concise answers unless more detail is necessary
- Do not restate large chunks of code unless needed
- Do not explain obvious HTML/CSS/JS basics unless asked
- When editing, change only the files that truly need changes
- Avoid generating multiple alternative implementations unless asked
- Prefer targeted fixes over speculative cleanup
- Use bullets and short sections instead of long essays when summarizing work

## Before risky operations
Warn me before anything that could break the app or lose data — deleting files, changing storage structure, destructive SQL, force-pushing, large refactors, dependency swaps, or auth changes.

Explain:
- what could go wrong
- how to back out
- whether a safer option exists

Confirm before proceeding with risky or destructive actions.

## Plugin and tool usage
Use available plugins and tools deliberately when they reduce guesswork, rework, or token burn.

### context7
Use context7 whenever working with:
- Supabase auth, database, storage, RLS, migrations, or client APIs
- Netlify config, redirects, headers, functions, forms, or deploy behavior
- Playwright
- GitHub Actions or GitHub integrations
- third-party JavaScript libraries or browser APIs with changing documentation

Do not rely on memory alone for these tools when documentation can be fetched.
Prefer concise docs and minimal examples over large documentation dumps.

### frontend-design
Use frontend-design when working on:
- page layout
- visual polish
- typography
- spacing
- responsive design
- UI hierarchy
- interaction clarity

When using frontend-design, keep designs realistic for a simple HTML/CSS/JS app.
Do not introduce frameworks or large design systems unless explicitly requested.

### GitHub
Use the GitHub plugin when it will help inspect issues, branches, PRs, or repo state.
Prefer using GitHub for repo context rather than guessing.

### Playwright
Use Playwright for user-flow validation, UI smoke tests, and bug reproduction when relevant.
Especially use it after meaningful UI or interaction changes.

### Supabase
Use the Supabase plugin for inspecting schema, auth setup, policies, storage, and debugging backend issues.
Prefer inspecting the actual project state over assuming schema or policy details.

### code-simplifier
Use code-simplifier only after a feature works.
Use it to simplify recently changed code without changing behavior.

### claude-md-management
Use claude-md-management to keep this file accurate when workflows, stack, or conventions change.
Do not rewrite this file unnecessarily.


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
This is a mobile-first PWA for iPhone. In every UI or UX decision, optimize for one-handed 
phone use — large tap targets, minimal typing, fast load.

## UI and product standards
This app should feel simple, fast, and calm.

For UI decisions:
- prioritize clarity over novelty
- prefer obvious labels over clever wording
- avoid clutter
- keep forms short
- make key actions easy to reach on mobile
- preserve a polished but lightweight feel

When proposing UI changes, explain the user benefit in plain English.

## Data / Supabase
Supabase is the primary and authoritative data store. All reads and writes go to Supabase first.

localStorage is used as a lightweight cache only — it mirrors Supabase data and is not a fallback 
source of truth. A future ticket (#79) will remove localStorage entirely.

Current tables: `state`, `history`, `journal`
Credentials are injected at deploy time via Netlify env vars — never hardcoded in source.

When adding new data features:
- Create a new Supabase table with RLS enabled and an "allow all" policy (until auth ships)
- Mirror the table structure in README.md
- Do not add new localStorage keys unless explicitly asked

## Codebase-specific patterns

### Today tab cards
Any new card that reflects daily state must call its `renderXCard()` from two places:
- Inside `render()` (called after every data operation)
- In a startup `loadX().then(() => { renderXCard(); if (historyViewActive && historySubTab === 'calendar' && cachedData) renderCalendar(cachedData); })` alongside `loadJournal()` at the bottom of DOMContentLoaded

### Hero card buttons
When adding or removing buttons in the hero card, update the `setButtonsDisabled` array near the top of app.js (search `setButtonsDisabled`) — it controls which buttons are disabled during network round-trips.

### Removing a nav tab
Requires 4 changes: (1) HTML button, (2) `switchMainTab` variable assignment, (3) `switchMainTab` hidden toggle, (4) `switchMainTab` classList toggle, and (5) the nav event listener. Also remove any `if (xViewActive)` block from `switchMainTab`.

### Modal conversion pattern
To convert a full-page view into a bottom-sheet modal: change outer div to `class="modal-overlay" id="x-modal" hidden`, wrap content in `<div class="modal-sheet">`, add `<div class="modal-title">`, replace save button with `modal-cancel-btn` + `modal-confirm-btn` pair. Add `max-height: 88vh; overflow-y: auto` on the sheet if content is tall (e.g. multiple textareas).

### XSS safety
`escapeHtml(str)` exists in app.js (search `escapeHtml`). Use it whenever writing user-entered text into innerHTML. Prefer `textContent` for simple string values — it's safer and doesn't need escaping.

### Hero card locking
The hero card locks for the day when `data.actionDate === todayStr()`. Any log action that should lock it must set `data.actionDate = today` before calling `saveData()`. Currently: `markDone`, `logSkip`, `logOtherActivity`, `markRowDone`.

### Modal → log action order
Always call `closeXModal()` BEFORE calling an async log function (`markRowDone`, `logSkip`, `logOtherActivity`). The `isProcessing` guard and `setButtonsDisabled` run at the start of every log function — if the modal is still open, its buttons stay frozen.

## Architecture guardrails
Because this is a simple personal app:

- Prefer vanilla HTML/CSS/JS patterns over adding a framework
- Keep business logic separate from DOM manipulation when practical
- Avoid deeply nested event logic
- Prefer small helper functions with clear names
- Avoid introducing build tools unless clearly necessary
- Do not add abstractions for hypothetical future needs

When code starts getting repetitive, simplify carefully without turning the project into an architecture exercise.

## Task management
For complex tasks (more than 2–3 steps), create a todo list at the start to track progress. Check off items as they're completed.

## File editing discipline
Before editing, identify the minimum set of files required.
Avoid touching unrelated files.

When making changes:
- preserve existing code style unless there is a strong reason not to
- avoid renaming files or functions unless it materially improves clarity
- do not move large blocks of code unless necessary
- leave brief comments only where they help a non-technical maintainer understand why something exists

## Version numbering
The app version is defined as a `VERSION` constant near the top of `index.html` and must follow `MAJOR.MINOR.BUILD` format (e.g. `1.0.27`).

On every PR:
- Always increment BUILD by 1, keeping it in sync with the sw.js cache version (they should always match — e.g. `VERSION = '1.0.27'` and `CACHE = 'wmw-v27'`)
- Increment MINOR when the PR ships a complete new feature or screen; reset to 0 only when MAJOR increments — BUILD never resets under any circumstance
- Increment MAJOR only for transformative changes (e.g. multi-user auth, full redesign); MINOR resets to 0, BUILD keeps climbing
- Never reset BUILD under any circumstance — it is a permanent monotonic counter
- If unsure whether a PR warrants a MINOR or MAJOR increment, ask before committing

## Testing and verification
After meaningful changes, verify the result in the simplest reliable way available.

Preferred order:
1. quick code sanity check
2. browser/manual validation
3. Playwright flow test when useful

When reporting back, distinguish clearly between:
- what was changed
- what was tested
- what still needs verification

## Before every git push — pre-push checklist
Complete all five steps in order before every `git push`:

1. Bump `VERSION` constant in `app.js` (increment BUILD; increment MINOR if 
   a complete new feature shipped; see version numbering rules below)
2. Bump the service worker cache version in `sw.js` to match 
   (e.g. VERSION 1.1.48 → CACHE 'habits-v48')
3. Run `/revise-claude-md` — review proposed diff and approve any updates
4. Update `README.md` if the schema, features, or deployment steps changed
5. Summarize what changed and flag anything pending, broken, or needing 
   a follow-up decision

Do not push until all five steps are complete.
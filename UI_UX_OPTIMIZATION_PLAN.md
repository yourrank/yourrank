# Dashboard UX: the "2-click" restructure

Goal: a streamer's daily job — change the prize, tweak players, glance at the
board — should take **~2 clicks**, not a tour through a 9-section SaaS dashboard.

This is a structural change, not a rewrite. The dashboard was already
well-built (live-preview iframe, sticky savebar, inline player editing). The
problem was *layout and flow*, so the changes stay within the existing
vanilla-JS + SSR-HTML architecture.

## What changed

### 1. One "Editor" section instead of two
`Prize & players` and `Design` were separate sidebar pages. They're now merged
into a single **Editor** section using the split-screen grid the Design page
already had:

- **Left column** (`.design-controls`): Brand & prize → Players table →
  Player columns → Page design → Pro features → Template text → Legal → Socials.
- **Right column** (`.design-preview`): the live preview iframe, sticky so it
  stays in view while you scroll the controls.

The daily job and its visual result now live on one screen.

### 2. Land on the job, not a dashboard
Login used to open `Overview` (a stats + checklist page). Now:

- A **set-up** board lands directly on the **Editor** (`isBoardSetup()` gate).
- A **brand-new** board still lands on **Overview** so the setup checklist is
  front and center.

`?nav=` still overrides, so deep links keep working.

### 3. Sidebar: 9 items → 6
- **Editor** is first (the primary action).
- **Notifications** folded into **Integrations** (overlay + domain + alerts —
  all "set once" plumbing).
- **Boards** nav is **hidden for solo users** — the sidebar already has a board
  switcher + "Manage boards". JS reveals the Boards table only at 2+ boards
  (`state.BOARDS.length >= 2`).

### 4. The save loop closes visibly
The preview renders from saved server state (via `/dashboard/preview`), so after
a successful save we call `updateDesignPreview()` and the on-screen board
refreshes immediately. Edit → Save → see it. That's the 2-click loop.

The Editor header also gets **Copy link** and **View live ↗** buttons so sharing
never needs navigation.

## The flow, before vs after

**Before — update the prize pool**
1. Log in → Boards table
2. Click the board
3. Click "Prize & players" in the sidebar
4. Find the prize field
5. Type → Save (verify by opening the public page in a new tab)

**After — update the prize pool**
1. Log in → Editor (you're already there)
2. Type the prize → Save → preview refreshes in place

## Files touched
- `apps/leaderboard/src/pages/dashboard.js` — nav consolidation, section merge,
  Editor header actions.
- `apps/leaderboard/src/assets/dashboard.js` — smart landing, Boards-nav
  visibility, Editor header wiring, expose `fitDesignPreview`.
- `apps/leaderboard/src/assets/dashboard/shell.js` — re-fit preview when the
  Editor opens.
- `apps/leaderboard/src/assets/dashboard/site.js` — refresh preview after save.
- `apps/leaderboard/src/__tests__/dashboard-quick-actions.test.js` — updated to
  the new structure + coverage for the merged Editor and hidden Boards.

## Verified
`bun run lint`, `bun run typecheck`, and the full `bun run test` suite all pass.

## Not done (larger, separate initiatives)
- **Inline edit from the preview** (click a value in the rendered board to edit
  it) — needs postMessage plumbing between the iframe and the dashboard.
- **True live preview of *unsaved* edits** — the preview reads saved state; a
  debounced draft-render endpoint would make it update as you type, pre-save.
- **Analytics as a top HUD** — Analytics/Referrals are still their own pages.

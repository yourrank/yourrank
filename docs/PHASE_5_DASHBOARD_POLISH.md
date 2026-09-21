# Phase 5 creator dashboard polish

Baseline: `main` at `5a6e47b2` (merged PR #818). Scope is refinement of the existing creator dashboard; Phase 3 navigation and Phase 4 Home composition stay unchanged. No new features, domain changes, backend rewrites, or restricted legacy mechanics.

## Audit before implementation

The production JSX/page renderers and compiled assets were served by `scripts/dashboard-polish-fixtures.mjs` with isolated synthetic API responses. `scripts/verify-dashboard-polish.mjs` captured all requested destinations at 1280 and 390 CSS pixels. These fixtures do not prove authentication, persistence, provider delivery, or deployed routing. Screenshot and DOM evidence: `.local-logs/dashboard-polish-before/`.

| Destinations inspected | Concrete findings / disposition |
| --- | --- |
| Home | Shared dark action/link contrast; existing attention, pulse, recent activity and quick-action hierarchy retained. |
| Community Setup, Leaderboard, Appearance, Share | Existing responsive forms and leaderboard row transformation retained. Shared contrast and mobile Search discoverability affect these pages. Preview fixture is not a live public-site verification. |
| Audience Members, Activity, Reviews | Existing readable stacked mobile rows retained. Pending review chip has dark text on dark amber. Populated member names wrap correctly. |
| Engage Activities, Giveaways | Shared action contrast and mobile Search. Activity list already has bounded pagination and mobile layout; restricted giveaway tabs excluded from changes. |
| Rewards Ways to earn | Mobile action-cell grid places Disable under the label while Edit occupies the value column. Repeated solid red actions dominate ordinary rows. |
| Rewards Shop | Long names are ellipsized on mobile; paginator occupies excessive vertical space; every Delete is a solid red primary-sized action. Mobile reward editor is an unnamed overlay with no focus trap, and initial input focus scrolls its heading/close control out of view. |
| Rewards Claims | Pending chip contrast; mobile row actions split across label/value columns. Preserve canonical Claims API and transition behavior. |
| Insights | Shared contrast; retain existing report structure and empty-state hierarchy. |
| Telegram | Shared chrome/contrast applies. Initial fixtures show local error states; provider integration requires separate verification. |
| Settings Account, Team, Billing, Connections, Data | Shared action/link contrast and mobile Search. Preserve account/site scope, billing behavior and destructive confirmations. |
| Site pages (additional deep link) | Hidden `#kickStatus` repeats provider presentation inside legacy Advanced tools; Connections remains the provider owner. Remove the redundant status row/client DOM writes, preserve credits fetch and Home projection. |

Additional interaction probe before editing (`interaction-probe.json`):

1. At 390px Search is hidden outside Home; Ctrl+K works but touch users cannot discover it.
2. Closing the command palette leaves its input browser-visible and focusable because only opacity/pointer events change; Escape can leave focus in the invisible input.
3. The palette footer wraps keyboard instructions awkwardly on mobile, and hover selection does not update the combobox active descendant.
4. The reward editor at 390px reports no dialog role/name; focus starts below its heading and no modal isolation is established.
5. Dark `--ws-accent-text` uses dark ink but `--ws-accent` remains the light theme's deep indigo. Pending chips bypass semantic warning text. These are token wiring defects, not a new palette choice.

## Implementation map and acceptance

- Shared styling owner: `apps/leaderboard/src/assets/dashboard-v4.css`; preserve its token contract and theme layer.
- Interaction owners: existing command palette, reward editor in `credits.js`, shared `YRDialog.trap`.
- Legacy presentation owner: `dashboard.jsx` and `dashboard/site.js`.
- Preserve routes, Home data/filtering, pagination, save/draft/validation, selected-site isolation, provider ownership and backend behavior.
- Verify all destinations at 390/768/1280/large desktop; keyboard palette and overlays; populated/empty/loading/error states where practical; regression tests and repository gates.
- Stop after the audit defects and required verification are resolved or explicitly blocked. No follow-on phase.

## Final verification log

### Problems found and fixes

- Shared workspace action and status tokens had dark-mode contrast mismatches. The canonical dashboard token chain now supplies the dark accent and semantic warning/success/danger text.
- The command palette was visually hidden only by opacity, could leave focus in an invisible input, and did not expose Search on small screens. It now uses real hidden state, restores focus safely, updates the active descendant on pointer selection, and keeps the existing Ctrl+K/Enter/Escape flow.
- Reward and claim row actions wrapped inconsistently and destructive actions competed with primary work. Shared row-action layout and quiet danger treatment now keep the local primary action clear.
- Shop titles and pagination were difficult to scan on narrow screens. Long titles wrap, the pager stays compact, and the reward editor opens as a named modal with focus trapping, Escape handling, focus restoration, and a scrollable mobile viewport.
- The legacy hidden Kick status presentation was removed from Site settings. The credits status fetch and Home projection remain; Connections stays the provider-management owner.

### Consolidation and scope

- `dashboard-v4.css` remains the shared styling owner for workspace tokens, row actions, palette states, status chips, and responsive rules.
- The existing `YRDialog.trap` remains the overlay interaction owner; no new dialog system or route was introduced.
- The Phase 3 rail and Phase 4 Home hierarchy, APIs, site scope, save/draft/validation behavior, and provider ownership remain unchanged.
- No generated bundle was hand-edited. `apps/leaderboard/src/assets_bundled.js` was regenerated by the existing build.

### Browser verification

- The fixture sweep covered all 21 required dashboard destinations at 1440, 1280, 768, and 390 pixels in populated state: 84 route/viewport combinations, zero document-width overflows, zero uncaught page errors, and zero unexpected 5xx responses.
- Empty state covered all 21 destinations at 1280 and 390 pixels. Loading state covered the selected dashboard routes at both widths. Error state covered the selected routes at both widths.
- The interaction probe passed mobile Search, Ctrl+K, arrow navigation, Enter, Escape, Back/Forward, alternate site selection, reward-editor dialog semantics, focus containment/restoration, and mobile overlay geometry.
- Evidence is under `.local-logs/dashboard-polish-after/`; those files contain synthetic fixture output only.

### Repository and database checks

- PASSED: targeted Phase 5 regression tests (32 tests), `bun run lint`, `bun run typecheck`, static migration compatibility, and the complete repository test runner (exit 0; its suites reported 171 shared tests plus the isolated leaderboard suites with zero failures).
- PASSED: real PostgreSQL games, rollup, identity/RLS, session/team, activity automation, JSONB, provider portability, dashboard lists, and claim support suites against disposable local databases. The rollup suite required UTC on the disposable database to match CI's timestamp semantics.
- PASSED: N-1 compatibility against the recorded coherent and Leaderboard source commits. The gate exercised 125 baseline migrations and 27 expanded migrations through upgrade, current-worker, and rollback contracts.
- NOT VERIFIED: the local E2E release gate. Wrangler startup was blocked by stale local Miniflare state locks from the first attempt; automatic approval review rejected the cleanup command because the review service had exhausted its usage limit. No product or repository files were changed by that failed gate.
- NOT VERIFIED: dependency audit, secret scan, CodeQL, and SBOM generation. These are CI/host-tool checks and were not available to execute fully in this local session.

### Known local cleanup

- The managed test session created disposable local databases named `yourrank_phase5_test`, `yourrank_n1_phase5`, `yourrank_n1_phase5_retry`, and `yourrank_phase5_e2e`, plus two N-1 worktrees under `.n1/`. They contain synthetic test data only. The leftover Wrangler process from the failed E2E startup is local to this session and should be stopped before reusing port 8787.

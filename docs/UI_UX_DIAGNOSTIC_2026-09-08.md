# YourRank UI/UX diagnostic — 8 September 2026

Status: diagnosis only. No application code, production configuration, saved player data, or deployment was changed.

## Scope and evidence

Goal: explain the reported slow viewer preview, hidden feedback, save/navigation freeze, and generic/text-heavy dashboard before implementation.

Evidence: authenticated production browser inspection, desktop screenshots at approximately 1280 × 720, mobile inspection at 390 × 844, DOM geometry/hit testing, console checks, and source tracing. Local baseline: `main`, `c7d58c4477574e2ef5625b6563b4b20c78ffdf2f`. Production's exact deployed revision was not established. Production CSS differs from this checkout; local source references below explain matching mechanisms, not a claim that every deployed byte matches HEAD.

Account state: Free, one selected unpublished site, unverified email, five saved players. No paid-plan, moderator, multi-site, or populated member/reward fixtures were available in this browser session.

One temporary unsaved player row was created to test feedback and validation. The invalid-save test stopped at client validation. The editor's Discard changes flow removed the test draft, reloaded the saved data, and the UI returned to five players. No successful save, publish, broadcast, payment, invitation, or destructive production operation was submitted.

The finish line for this diagnostic is an evidence-backed list of defects, design findings, coverage limits, and a repair/verification sequence. It is not an assertion that every application state has been tested.

## Highest-priority findings

### D01 — P1: failed Save temporarily blocks navigation

**REPRODUCED.** In Players, create a draft row and enter `abc` into its Score. Click Home, then Save in the Unsaved changes dialog. The dialog closes, the invalid field remains, and clicking Home again does nothing. A later click after the guard period opens the dialog again. There was no remaining dialog or inert background after Save, so this reproduced freeze is a navigation lock, not a focus-trap leak.

`assets/dashboard/shell.js:68–85` waits for `_dirty` to become false, or a 15,000 ms timer. It programmatically clicks Save but does not receive validation/failure completion. `assets/dashboard/site.js:1872–1888` returns immediately on validation failure without clearing dirty. `requestDashboardRoute` rejects further requests while `navigationPending` is true (`shell.js:145`).

The save request itself can wait 20 seconds (`site.js:1911`), while the navigation guard waits only 15. This timeout mismatch is source-confirmed; a slow successful request was not exercised.

**Repair:** have navigation await the actual save result, with explicit success, validation failure, request failure, and cancellation outcomes. Release the navigation lock immediately on validation failure. Keep drafts intact on failure and show the field/error visibly. Do not merely shorten the timeout.

**Acceptance:** invalid Save returns control immediately; error is visible; Cancel/Escape work; repeated navigation is possible; failed and slow saves never silently drop the user's destination or lose the draft.

### D02 — P1: “Discard” does not discard the editor draft

**REPRODUCED.** Add a blank player, click Home, choose Discard, then return to Players. The sixth blank row remains, but the dirty save bar has disappeared. Home still reports five saved players.

`shell.js:92` calls only `clearDirty()`. `state.js:75` clears the flag; it does not restore the saved data or inputs. Player draft persistence is separate (`players.js:251–270`). The editor's dedicated discard path correctly clears storage and reloads (`site.js:1992`), but the navigation dialog does not use it.

**Impact:** the user is told changes were discarded while those changes remain in the form. A subsequent edit/save could include previously discarded data. That later persistence risk is inferred, not tested with a production write.

**Repair:** one discard operation must restore all editor fields and state, remove the stored draft, clear obsolete feedback, then navigate.

**Acceptance:** add/edit → Discard → return and reload both show the original saved values, no restored draft, no stale success message, and no dirty state.

### D03 — P1: Add player and validation messages are under the header

**REPRODUCED WITH GEOMETRY.** `#status` contained “Player added. Save to publish.” with `hidden=false`. Its fixed rectangle began at y=16, height 44.5px, z-index 60. Hit testing its center returned the Publish button and `.lb-topbar` above it; the header's z-index was 100.

The base rule is `assets/app.css:300`. Player actions write to this region through `players.js:41`; other operations use `dashboard/utils.js:37`. The same feedback location is used for save errors, which makes D01 especially confusing.

**Repair:** give feedback one shared placement/layer contract across both Workers, headers, drawers and dialogs. Keep field validation adjacent to the field, with a visible page summary when necessary. Avoid multiple per-page z-index patches.

**Acceptance:** success and errors are painted and readable at top/middle/bottom scroll positions, with the header, save bar and mobile drawer present. Assert hit testing/geometry, not just text existence.

### D04 — P1: Site preview can remain blank forever, with a nonworking Refresh button

**REPRODUCED.** Open the dashboard on another section, then navigate to Site. The viewer preview remains a blank dark rectangle. Refresh preview has no visible effect. The same behavior occurred after clearing the diagnostic draft, on desktop and mobile. Switching the preview device tab eventually renders the actual viewer page; no save is required.

The matching source sequence is:

1. Settings tabs initialize during dashboard boot (`dashboard.js:312`, `dashboard/account.js:249–291`).
2. Preview rendering returns early while its section is hidden (`site.js:529`, `site.js:597`).
3. The Refresh listener is wired only after that visibility check (`site.js:584–600`).
4. Later `navTo` refreshes previews for `board`, but not `site` (`shell.js:277`).
5. Device tabs independently request a refresh (`dashboard/preview-tabs.js`).

**Repair:** initialize controls independently of visibility, then request rendering when the owning Site section becomes active. Test both direct entry and navigation from Home/Players/Settings.

**Acceptance:** first visible entry triggers a real render; Refresh works on the first click even before any successful render; hidden sections do not issue unnecessary requests.

### D05 — P1: preview claims success before it has rendered

**REPRODUCED.** The blank Site preview displayed “Preview matches your changes.” Initial HTML ships that success text (`pages/dashboard.jsx:356`); the board preview similarly starts with “Up to date” (`:214`). When D04 prevents initialization, the false success can remain indefinitely.

Additional source risk: frame `load` treats every non-blank location as synced (`site.js:568–578`), without proving a successful preview render. Login/error documents were not tested. The 8-second watchdog reveals an error but is not an HTTP/server-latency measurement.

**Repair:** explicit idle/loading/ready/error states; success only after the correct render confirms completion for the current draft. Preserve the last good preview during updates where feasible.

**Acceptance:** blank, failed, expired-session and outdated previews never say they match the current draft; Retry and progress states remain visible.

## Navigation and design findings

### D06 — P2: production branding differs from the documented/source system

**DIRECTLY OBSERVED.** Production's loaded stylesheet and computed values use:

| Property | Production observed | Local source / documented direction |
|---|---|---|
| Rail | `#edf1f7`, pale blue-gray | `#121111`, production black |
| Action accent | `#4056b9`, muted blue | `#2200ff`, electric violet |
| Typeface | Fira Sans | Inter with Fira fallback |
| Page title token | 28px | 34px |
| Sidebar width token | 232px | 272px |

Local token owner: `assets/dashboard-v4.css:59–169`; design authority: `DESIGN.md`. This is a real delivery/authority discrepancy. Whether it is a different deployment, an intentional unrecorded change, or cache history has NOT been established. Do not declare a CDN defect without asset/release evidence.

**Repair prerequisite:** identify deployed revision and asset build, then agree which visual direction is authoritative. Do not silently deploy local styling as the requested redesign.

### D07 — P2: Home lacks a distinctive creator/community focal point

**VISUAL FINDING.** The observed unpublished Home is mostly a generic title, small site name, verification card, two-value metric band, and text lists. Brand identity is concentrated in the small sidebar mark. On mobile, verification and “Not published” dominate the first viewport; real community content falls below it.

This state correctly surfaces the publication blocker, but gives the creator little sense of the destination they are building. Typography, neutral surfaces, repeated containers, and small labels give most information similar weight.

**Design direction for approval:** a recognizable community identity area using real site identity; one strong next action; compact publication readiness; then meaningful activity and participant/reward imagery when real assets/data exist. Keep account versus selected-site scope explicit. Show an honest compact empty state instead of expanding zero metrics into a dashboard. Do not invent members, charts, imagery, or a marketing hero to fill space.

### D08 — P2: excessive explanation and repeated empty/setup surfaces

**OBSERVED ACROSS SITE, ACTIVITIES, REWARDS AND INSIGHTS.** Examples:

- Site stacks Name, Brand, Navigation, Public address and Viewer access, with explanations and several links that send the user to another section to finish configuration.
- Activities shows introductory explanation, a separate free-credit explanation, a large empty activity module, repeated creation CTA, automation explanation, upgrade notice, templates explanation, and schedules explanation.
- Rewards overview combines connection onboarding, two quota counts, five zero metrics and an empty table.
- Insights wraps each group in a question, explanatory paragraph and definitions beneath values. This helps explain semantics but is expensive to scan repeatedly.
- Settings Connections mixes creator identity, per-site reward connection, delivery connections and a second selected-site connection handoff. Scope labels help, but the number of distinct concepts increases effort.

**Repair:** one sentence for the page's purpose, one dominant action, compact empty/setup state, secondary detail on demand, and consistent outcome-based labels. Keep necessary explanations at the decision they affect. Distinguish members from leaderboard player records; do not merge identities to simplify copy.

### D09 — P2: route entry can scroll past orientation

**REPRODUCED.** Entering Site through the sidebar/drawer positioned the viewport inside Public site controls/preview. The Site title and section tabs were above the viewport; on mobile only the bottom of the horizontal tab strip remained near the fixed header.

`shell.js:295–310` scrolls to the default panel hash using `scrollIntoView`. A default page entry and an intentional deep link need different scrolling behavior.

**Repair:** ordinary navigation reveals the destination title and local navigation; explicit deep links reveal the target with header clearance. Preserve intentional Back scroll behavior.

### D10 — P2: Insights can show “Players” as its page title

**REPRODUCED.** After a document reload on Players, navigating to Insights showed an H1 of “Players” while the route, breadcrumbs and content were Insights.

`pages/dashboard.jsx:284–288` builds the hidden Analytics H1 using the document's initial tab and even falls back to a board-tab label. `performance.js:53` updates panels and breadcrumbs but not that H1.

**Repair:** derive each section's heading from its own active route when entered; never initialize an inactive section from another section's tab.

**Acceptance:** direct entry and Players → Insights → Traffic sources → Back all show matching title, breadcrumb, active tab and URL.

### D11 — P2: shared dialog styles do not reach body-mounted dialogs

**DOM/SOURCE CONFIRMED; desktop dismissal PASSED.** The shared dialog appends its overlay to `body` (`assets/dialog.js:140`). It therefore does not match `.v3-dash[data-auth-workspace] .modal`, which defines the workspace dialog design (`dashboard-v4.css:3005`). The live confirmation used the global `ui.css:376` rule and z-index 200 instead of the workspace rule's 1000.

This is a real component ownership mismatch, but it did not cause the reproduced desktop freeze: Cancel and Discard removed inert state and restored control. Mobile drawer/dialog overlap and nested dialogs remain unverified.

**Repair:** give portals the same token/style ownership as workspace content, with one overlay stack and defined focus-return behavior.

### D12 — P2: redundant current-page breadcrumb in People

**OBSERVED.** On Members, the breadcrumb's People link pointed to the same Members URL as the current page, with Members as its leaf. This contradicts the repository's rule that breadcrumbs must not link the active page. Sidebar, breadcrumb and Members subnav repeat the same destination.

**Repair:** keep a truthful nonlinked ancestry label where no distinct parent page exists; verify rendered URLs including site context across direct and fragment entry.

## Performance: what is known and what is not

- Site's blank preview is not solely network slowness: D04 reproduces a missing initialization path with an inert Refresh control.
- Every preview update replaces the iframe and submits a complete draft to `/dashboard/preview` after a 300ms debounce. The handler resolves the user and site and renders the public page (`handlers/preview.js:38–125`). That work is source-confirmed; its actual server cost is not measured.
- The visibility predicate checks the containing section, not whether the preview itself is hidden by the active Players tab. This can request work for a CSS-hidden preview. Request counts were not measured.
- Initial dashboard boot waits on `/api/auth/me`, then `/api/site`. Local assets preserve relative module imports, so browser boot also depends on a module graph. No reliable waterfall or TTFB attribution was captured.
- The first browser-tool navigation was abnormally slow and later displayed the loader; the page eventually rendered. Tool elapsed time must NOT be reported as site load time. Subsequent entry also showed a transient loader. No p50/p95/Core Web Vitals claim is justified.

Before optimization, record cold/warm document entry, first Site preview, subsequent preview, device switch, and a representative edit. Separate network/server/render time; capture request counts, transfer size and failure states. This is the remaining performance measurement work, not evidence that the database or Cloudflare is the cause.

## Coverage and validation

Canonical scope source: `packages/shared/src/dashboard-routes.ts`, including aliases, delivery mode and account/site context. Runtime coverage is representative, not exhaustive.

| Surface | Executed evidence | Remaining coverage |
|---|---|---|
| Home | Desktop/mobile rendering, sidebar navigation, real unpublished state | Published/populated, no-site, different plans |
| Sites | Selected-site row and management entry rendered | Create/delete/multi-site switching |
| Players | Add draft, invalid field, Save guard, Cancel, navigation Discard, editor Discard, restored five saved players | Successful persistence, import/export, large tables, mobile editing |
| Leaderboard Appearance | Content and actual viewer preview rendered | All paid options; Share/History workflows |
| Site Public site | Blank preview, dead Refresh, device-switch recovery, desktop/mobile layout | Saving, permissions, notifications/domain/advanced workflows |
| Activities | Free empty/manual and locked automation surfaces rendered | Creation, scheduling and populated states |
| People Members | Empty state, site-scoped navigation, breadcrumb | Reviews and moderation actions |
| Rewards | Overview, Shop and Ways to earn empty states rendered | Creation, claims/activity completion, populated states |
| Insights | Overview data, wrong heading, navigation | All date windows, traffic/events tabs, nonzero data |
| Settings | Account loaded; Team, Billing, Connections, Data rendered | Password, invitation, payment, export, delete mutations |
| Telegram | Overview, no-bot onboarding, cross-Worker navigation | Commands/broadcasts/offers and connection actions |
| Viewer | Preview content at desktop/mobile device selection | Public published site, sign-in, membership and claims journeys |

Restricted legacy Games, wagering, predictions and chance-based flows were intentionally excluded under AGENTS.md. Sensitive account/billing/permission mutations were outside this diagnostic.

**PASSED:** desktop Cancel/Discard focus/inert release; editor discard restored original five players; mobile drawer opened and closed through destination navigation; mobile Home fit the inspected viewport; Settings account data completed loading; actual preview rendered after device selection. Representative console reads returned no error/warning entries. Console silence does not invalidate the reproduced bugs.

**FAILED:** D01–D05 behavior, D09 orientation, D10 heading, D12 breadcrumb. D06 and D11 are verified discrepancies; D07/D08 are contextual design judgments.

**NOT RUN:** selected Bun suites (dialog, SPA navigation, loading states, player CRUD, site customizer, preview handler). Launch failed because `bun` was not found. No tests passed or failed; the runner did not execute. Full lint/typecheck/test/build were not run for this diagnosis-only change.

**Detector:** ran once against `pages/dashboard.jsx`; it flagged `logoPreview` at line 381 for missing src. The element is intentionally hidden until a logo is supplied, so this is not counted as a demonstrated broken-image defect. The detector cannot establish usability, deployed style consistency, or interaction correctness.

**NOT VERIFIABLE IN THIS PASS:** full WCAG conformance, screen-reader operation, exact contrast across every state, browser/device matrix, slow-server save success, production revision/asset provenance, quantitative loading performance. No numerical overall health score is given because it would imply coverage this run does not have.

## Recommended execution order — not yet executed

1. **Resolve deployment baseline.** Identify the production revision and generated assets, including the branding discrepancy. Preserve one route and token owner.
2. **Repair interaction integrity.** Save/navigation result handling, complete discard, message placement, portal ownership. This is the first implementation batch because users currently cannot trust completion/recovery.
3. **Repair preview lifecycle and measure performance.** Visibility entry, first-use Refresh, truthful readiness, slow/error states; then optimize the measured bottleneck.
4. **Correct navigation identity.** Heading ownership, default scroll position, active breadcrumb links and site context across both delivery modes.
5. **Design Home and the shared page hierarchy.** Agree a concrete branded composition with real content, then apply its typography, actions, states and density consistently to Site, Activities, People, Rewards and Insights. Avoid a separate Home-only visual system.
6. **Verify the connected journeys.** Browser tests must include direct-entry versus in-app navigation, failed Save, Discard → return → reload, initial preview/Retry, mobile overlays, and explicit published/unpublished and role/plan fixtures. Existing source-string tests are not evidence that these user journeys work.

The design tooling also reported `.impeccable/design.json` older than `DESIGN.md`. Refreshing that sidecar can align future tooling, but it is not proof of the production CSS discrepancy and was not changed.

# YourRank roles, UX and feature disposition audit — 2026-09-06

Implementation follow-up: [First report fixes and verification](yourrank-report-one-fixes.md). The audit below remains the original evidence snapshot; the follow-up records the subsequently authorized code changes.

Method: dual-agent (A: `/root/design_assessment`; B: `/root/evidence_assessment`), with parent route, identity, feature and public-journey investigation. Assessment A finished before detector findings entered synthesis.

## Changed

Audit and decision record only. No application code, account, production data, permissions or deployment changed. The extensive pre-existing worktree was preserved.

Finish line: assess the creator/viewer journeys and other role boundaries, recommend header/footer changes, and classify apparently invisible features from real route/caller evidence. This is not an implementation or deletion approval, exhaustive dead-code proof, or production-readiness certification.

## Main decision

Keep the current community-oriented navigation and the distinct creator/viewer presentation. Prioritize explicit context, truthful setup state and sign-in continuity before another visual redesign or new role. Reconcile the running deployment with the worktree before fixing issues the local redesign already addresses.

## Findings, in priority order

### P1 — Team does not identify the site being managed

Production `/dashboard/settings/team` says “selected site” but presents neither a site name nor a selector. `apps/leaderboard/src/pages/account.jsx:63` sets `boardContext="none"`; `apps/leaderboard/src/assets/account.js:485` resolves the operational site from state/query/defaults. `packages/shared/src/dashboard-routes.ts:188` correctly records the current route as account-scoped.

Decision: retain the route and account-wide seat summary, but add a named site context directly above site invitations/membership operations. Repeat that name in consequential confirmation copy. A user should never have to remember which site a team action affects. Runtime evidence: read-only owner Team view; no invitation/removal submitted.

### P1 — Production onboarding contradicts its prerequisite

The production unverified-owner Home simultaneously says Confirm email, “The essentials are done. Publish when you’re ready,” and Publish as the next setup step. The topbar also presents Publish prominently.

Decision: one governing next action, Confirm email until verified, then Publish. Treat this as deployment drift: current `apps/leaderboard/src/assets/dashboard/overview.js:114` already includes verification-specific setup logic, and the worktree design differs from the deployed black rail/purple actions. Rebuild and validate the worktree before release; do not stack another redesign over it. No production publication or verification email was triggered.

### P2 — Telegram changes workspace orientation

Production Home has a site selector and Search in the topbar. Telegram moves site context into a static rail card and shows Current bot in the topbar without Search. Telegram is account-owned (`dashboard-routes.ts:194`); `apps/bot/src/dashboard-views/app.ts:59` and `:65` supply its context.

Decision: keep stable navigation/search placement, explicitly label the account-owned bot context, and avoid implying that selecting a site changes bot ownership. Review generic shell only; restricted Telegram workflows are outside scope.

### P2 — Anonymous viewer navigation repeats destinations and loses specificity

Local `/demo` presents Sign in, All communities and Your account, all pointing to `/me` or its profile anchor. `packages/shared/src/viewer-shell.ts:21` always emits the account links. The generic fallback in `packages/shared/src/site-render.ts:333` points to the account index; provider-specific links do preserve `returnTo`.

Decision: show one primary anonymous sign-in/join entry that preserves the originating community. Show account/membership utilities once relevant. Keep `/me` as the account directory and `/<slug>/me` as the personal community surface; do not merge their identities or histories. An empty membership directory should offer an actionable return to the initiating community or an explicit community-link entry, without inventing a public discovery directory.

### P2 — Demo navigation crosses environments

Local `/demo` rail links remain on localhost, while body reward/leaderboard CTAs and legal links go to `https://yourrank.site/demo/...`. This was directly visible in the browser. `site-render.ts:500` defaults `homeUrl` to the production origin, and several content/footer links compose it.

Decision: derive local navigation from the request/site origin consistently while preserving deliberate canonical/share URLs. Validate the same boundary for custom domains. Custom-domain runtime is not verified; this finding proves the demo/local mismatch only.

### P2 — Marketing footer lacks direct policy destinations

Both `apps/web/src/components/home/motion-footer.tsx:7` and `apps/web/src/components/site-shell.tsx:103` omit direct Terms/Privacy/Cookies links. The local homepage browser tree confirmed their absence from its footer. The public community footer does include policy links.

Decision: provide a compact, consistent trust row with Terms, Privacy, Cookies and Contact in both marketing footers. Retain the expressive homepage footer if desired, but validate its fixed positioning and 620px minimum height on mobile before approval. Footer mobile failure was not reproduced, so its sizing is a review item, not a confirmed defect.

### P2 — Reviews busy state uses an invalid ARIA value

`apps/leaderboard/src/assets/people.js:55` uses `queue.toggleAttribute("aria-busy", loading)`, which adds an empty attribute while loading. Use the explicit string `true`/`false` value. This is a source-inspected accessibility defect; the loading state was not exercised with a screen reader.

### P2 — Architecture documentation disagrees with the active marketing router

`ARCHITECTURE.md` and root guidance describe Next as homepage-only. Current `apps/leaderboard/src/index.js:67` declares `MARKETING_PAGES` with the product, pricing, documentation and company pages, and `:756` proxies that set to the marketing app. Those Next pages have real route consumers.

Decision: keep these pages. Reconcile documentation with the intended deployment boundary explicitly. They must not be deleted as dead code based on outdated prose.

## Roles and identity decisions

| Role / relationship | Current evidence | Decision |
| --- | --- | --- |
| Anonymous visitor | Public creator pages and sign-in gates | Keep; optimize orientation and continuation. |
| Viewer Account | Independent viewer authentication and global `/me` | Keep separate from creator authentication. |
| Community Member | `site_viewers` relationship; community-specific history and balances | Keep site-scoped; membership is not a new global operator role. |
| Streamer / Owner | `sites.user_id`; canonical capabilities in `team.ts` | Keep full legitimate site operation and account administration. |
| Moderator | `team.ts:55`; delegated operational capabilities, Team entitlement | Keep. Test a real moderator on two sites, revoked access and plan downgrade before claiming complete role UX. |
| Manager | Explicit migration to Moderator in `20260905000000_wave_h_owner_moderator_roles.sql` | Do not restore; this is deliberate simplification, not a forgotten role. Keep migration history. |
| Platform Admin | `index.js:1036` checks `is_admin` and requires MFA | Keep as separate internal administration, outside customer role menus. Live admin UX not verified. |
| Telegram operator / subscriber | Operator uses creator account; subscriber relationship remains separate | No additional role or inferred Viewer membership needed. |
| Leaderboard Player | Separate ranking record | Do not infer a Viewer Account from matching display names. |
| Agency / custom permission roles | Deferred product expansion | Defer until an actual delegation need exceeds Owner/Moderator. |

Missing evidence is mainly role states, not a missing role name: invited/expired invite, removed moderator, suspended delegation after downgrade, blocked/unjoined/member viewer, multiple communities, and account-to-community return. These need real role fixtures; no permission failure is inferred solely from missing live coverage.

## Header and footer decisions

| Surface | Keep | Change |
| --- | --- | --- |
| Creator | Sidebar section roots; page tabs; current workspace visual direction | Stable header scope/search/action; explicit site name where content acts on a site. No large marketing footer; compact support/legal/account access. |
| Viewer | Creator identity; Home/Leaderboard/Rewards/My Community; blue guide | Reduce anonymous account utilities, preserve sign-in origin, subordinate global account tools to community tasks. Compact creator contact/policy footer. |
| Marketing | Distinct brand treatment and expressive homepage | Clear creator versus viewer entry; policy links in both footers; verify footer mobile behavior. |
| Telegram | Shared creator navigation and bot-specific context | Stable utility placement; truthful account-owned context. |
| Internal admin | Separate protected operational surface | Defer design verdict until a real authorized admin session is reviewed. |

Do not copy one identical header/footer across all surfaces: their users and tasks differ. Share tokens and utility behavior where appropriate, with one owner for each navigation responsibility.

## Feature and dead-code disposition

| Candidate | Evidence / classification | Strategy |
| --- | --- | --- |
| Activities / free code drops | Registered `/dashboard/activities`; `handlers/activities.js`; client UI | KEEP. A real safe workflow, not a placeholder universal activity system. |
| Templates / scheduling | `handlers/activity-automation.js:91` exposes entitlement and safe-kind allowlist; `assets/activities.js:105` renders templates | KEEP, plan-gated. Unavailable to Free does not mean dead. No scheduling executed in this audit. |
| Reviews | Registered People tab; narrow source adapter | KEEP narrow scope. Do not advertise universal moderation/review support. |
| Claims | Rewards redemptions route and viewer adapters | KEEP; present one consistent Claims vocabulary. Do not replace persistence speculatively. |
| Recognition / generic challenges | Architecture intent; challenges explicitly `deferred` in `handlers/activities.js:114` | DEFER. No empty nav destinations or claims that they are available. |
| Generic Communication / announcements | Explicit `deferred_communication_not_ready` in automation response | DEFER. Existing Telegram does not prove a generic communication abstraction. |
| Next marketing subpages | `MARKETING_PAGES` and proxy route consumer | KEEP. Documentation is stale; code is reachable. |
| `apps/consumer` and monitor | Queue consumers, scheduled triggers, health routes and main Worker heartbeat probes | KEEP infrastructure; no customer menu is required. |
| OBS overlays | Explicit overlay routes in `index.js` and imported renderer | KEEP as output/integration, not a separate user role. |
| Legacy aliases and `/games` marketing redirect | Canonical manifest compatibility; Next `/games` redirects to `/sites` | KEEP required redirects/aliases until deliberate migration proves retirement safe. |
| Restricted legacy systems | Manifest still lists legacy routes; intentionally absent from primary target navigation | CONTAIN; do not promote, extend or consolidate. Any retirement needs a separate dependency/data plan; nothing deleted here. |
| `createReporter` in `packages/shared/src/monitoring.ts:34` | Repository-wide search finds only its declaration and documentation example; shared package is private | REMOVE CANDIDATE for a focused cleanup after import/build verification. Retain the monitoring module: `sendErrorToDiscord` and other exports have live consumers. |
| `credits-pages.js`, `account-pages.js`, `giveaway-pages.js`, shared shell and legacy styles | Actual imports, route/template consumers or non-workspace consumers | KEEP consumed code. Old names or CSS versions alone are not deletion proof. |

No whole feature was proved safe for immediate deletion. The useful distinction is active, gated, infrastructure, deferred, compatibility, restricted legacy, and an unused export candidate.

## Verification and limits

- PASSED: mechanical inventory of the canonical dashboard manifest: **38 routes**, 33 Leaderboard-owned and 5 Bot-owned. This is inventory coverage, not 38 browser passes.
- PASSED: desktop read-only production owner Home, Telegram empty/unconnected view, Settings and Team inspection. Local homepage, `/demo`, `/demo/me`, anonymous `/me`, and login entry inspection.
- PASSED: source tracing for role capabilities, admin guard, viewer/account boundaries, marketing proxy, queued infrastructure, feature gates, template imports and unused-export search.
- EXECUTED: Impeccable detector on `apps/leaderboard/src/pages`, exit 1 reporting 18 warnings across 14 files: 12 `overused-font`, 5 `broken-image`, 1 `gradient-text`. None establishes an additional defect: fonts match retained design scope; image flags target hidden placeholders populated before display; the gradient belongs to retained creator-brand overlay output. These warnings are not 18 verified UI bugs. No restricted workflow was exercised.
- NOT RUN: Bun tests; Bun is unavailable on PATH and the standard locations checked by Assessment B. No test pass is claimed.
- NOT RUN: mobile viewport, keyboard-only completion, screen-reader operation, real moderator/member/admin sessions, custom domains, connected Telegram, real OAuth completion, reward/claim writes, publishing or invite mutations.
- EXCLUDED: restricted game/wagering/paid-chance and gambling-specific operations. Registry inventory acknowledges their existence only.
- No local server was started or stopped; an existing local service was used. No browser overlay was injected. Browser screenshots/trees are session evidence; no screenshot artifact is claimed.
- Run notes: target slug `apps-leaderboard-src-pages-dashboard-jsx`; no `.impeccable/critique/ignore.md` was present. Assessments ran independently. Browser evidence used native CUA trees/screenshots; no mutable-injection API was used, no overlay/live server was started, and no user-visible detector overlay is claimed. A persistent copy is archived through Impeccable critique storage.

Heuristic assessment is deliberately limited: status 2/4, real-world match 2/4, consistency 2/4, recognition 2/4, efficiency 2/4, minimalist design 3/4, help 2/4. Control/undo, error prevention and error recovery are unknown because their journeys were not exercised. Do not interpret these as an application-wide quality score.

## Recommended execution order

1. Fix explicit Team scope and the source-confirmed viewer continuation/ARIA/footer issues.
2. Validate the already modified local dashboard, then reconcile deployment and documentation with the intended route ownership.
3. Exercise role/state fixtures and responsive navigation; use the 38-route registry to report coverage and exclusions.
4. Remove only proven unused exports in a focused cleanup. Keep gated and background capabilities; leave deferred capabilities out of navigation.
5. Add product breadth only after the existing owner → community → viewer → claim → return journey is reliable.

Risks: production and worktree differ, many pre-existing changes are uncommitted, and authenticated populated journeys were not covered. This audit prioritizes work; it does not certify all roles or the deployment.

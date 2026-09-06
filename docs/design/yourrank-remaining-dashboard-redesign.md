# Remaining dashboard redesign

## Contract

Goal: complete remaining creator-workspace hierarchy work and redesign viewer account and creator-branded membership surfaces.
Order: People evidence → runtime prerequisites → creator operational pages → viewer account/membership → cleanup and verification.
In scope: canonical templates/styles, disclosure/navigation hierarchy, truthful copy, loading/error states, regression tests.
Out of scope: deployment, real OAuth/messaging, billing reconciliation, restricted mechanics, identity/schema consolidation.
Acceptance: current tasks precede optional setup; account/site boundaries remain explicit; balances and claims remain per-community; native controls/mobile remain usable; live evidence is distinguished from fixture tests.

## Direction

Creator pages extend the mineral/slate workspace. Activities puts current work before reusable setup; Site discloses less-frequent configuration; account security forms disclose on intent.

Viewer mode is Operate: a member returning from a stream, often on a phone, wants to resume a community and check a claim. Keep creator branding on membership pages. The global account becomes a membership directory with compact identity—not another admin console or aggregate credit wallet. Membership puts claims before historical records and discloses occasional code entry.

The user rejected the prior incremental viewer direction (`85715f46`) and explicitly authorized structural replacement. The implemented Channel guide uses seed `c2610fb4`, candidate 6: visible blue navigation, flat ice reading surface, navy Fira typography, a membership directory followed by account maintenance, and claims-first community pages. This is code-led, not fidelity to an approved comp. `viewer-shell.ts` and `viewer-shell.css` own supported viewer chrome and material; stored templates and `devin-system.css` no longer govern these pages. Restricted Games retain their legacy shell without mechanics changes.

## Evidence and coverage

Creator route inventory: `packages/shared/src/dashboard-routes.ts`. Viewer owners: `pages/viewer-dashboard.js` and `assets/viewer-dashboard.js` for `/me`; `packages/shared/src/site-render.ts` for `/<slug>/me`.

- People mobile: fresh live capture replaced stale file; context/tabs/content/Insights link visible.
- Live creator audit: Site, Leaderboard setup, Activities, Insights, Settings account.
- Live viewer audit: `/me` signed-out and `/demo/me` signed-out.
- Local preview database diagnosis distinguished Docker localhost from Windows PostgreSQL at 127.0.0.1. Additive local prerequisites and clearly labeled synthetic viewer/membership/claim fixtures enabled signed-in browser verification. No production data was changed.

## Final viewer verification — 2026-09-06

Changed: shared connected viewer navigation, canonical material owner, global membership directory/account disclosure, compact per-community balance, full-width claim records, native activity disclosures, useful sign-in/unavailable states and persistent return paths. Removed obsolete viewer CSS from app.css and dashboard-v4.css. Login navigation now targets a visible panel; successful logout transfers focus; avatar initials survive image-loading failures.

Verified:

- PASSED: `bun run build`, root lint, root typecheck, and final `bun run test` (shared, consumer, bot, isolated leaderboard files, monitor, web). Evidence: `.impeccable/review/viewer-final-{build,lint,typecheck,regression}.log`. Credential-dependent skipped tests remain SKIPPED, not passes.
- PASSED: focused viewer tests, 78 tests / 518 assertions before final related test migration. Updated obsolete chrome/heading expectations without weakening behavioral, scope, or security assertions. The CSRF-cookie test now explicitly sets and restores its required domain configuration.
- PASSED: live local synthetic directory with two separate balances; populated membership with pending/completed/cancelled claims and ledger; Rewards navigation; membership → Your account → directory; mobile layouts at 390px and desktop at 1440px. Latest captures: `viewer-desktop.png`, `viewer-mobile.png`, `member-desktop.png`, `member-mobile.png` under `.impeccable/review/`.
- PASSED: live Sign out returns to visible login, hides previous account/memberships, and focuses `vd-login-card`; screenshot `viewer-logout.png`. Earlier live switch-login also completed. Latest browser console inspection returned no errors/warnings.
- PASSED: independent Impeccable finish review disposition `ship`; duplicate context, logout focus, avatar fallback and scoped design persistence findings resolved. DESIGN.md and its sidecar record the replacement separately from creator/marketing/legacy surfaces.

Not verified: production deployment, real OAuth-provider round trip, actual remote-avatar failure in browser (unit-tested), live blocked/unavailable membership states (renderer-tested), real claim/code mutations, custom-domain live navigation, populated People and Telegram flows. Browser captures use synthetic local records, not customer data.

Risks: this is not a full-site production sign-off. Existing unrelated dirty worktree changes remain. An intermittent repository-wide JSONB scan timed out during earlier aggregate runs; it passed in isolation at the unchanged limit and in the final canonical full run. No CI limits or security controls were relaxed. No commit or deployment was performed.

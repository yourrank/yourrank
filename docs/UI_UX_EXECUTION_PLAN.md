# Dashboard recovery and design execution

Approved scope: implement the 8 September UI/UX diagnostic. Branch: `codex/dashboard-ux-recovery`.

## Baseline and finish line

- Production baseline confirmed through successful Deploy run `34266566626`: `8e43692756b22043d84f9046a10a398742a57ae4` (#697).
- The diagnostic checkout was two commits behind. #696 deliberately changed the workspace to the mineral blue/Fira system and updated DESIGN.md. D06 is resolved as stale local baseline, not a CDN defect. Preserve the current system while strengthening product-specific composition.
- In scope: save/discard/navigation recovery, messages/dialogs, preview lifecycle, route headings/scroll/breadcrumbs, Home identity and shared page density, regression and browser verification.
- Out of scope: restricted legacy mechanics; auth/billing/schema changes; invented product data; automatic production deployment.
- Finish: implemented behavior passes focused regressions, relevant shared/Worker gates and desktop/mobile runtime checks; report exact unverified scope. No claim of full-app verification from one account.

## Execution batches

| Batch | Work / source owners | Acceptance / verification | Status |
|---|---|---|---|
| 0 | Reconcile production revision, source and design; recover Bun | Work starts from deployed SHA; tests execute with project runtime | Baseline resolved |
| 1 | Save result and discard in dashboard/site.js + shell.js; feedback in dashboard-v4.css; shared dialog portal | Invalid/failed Save releases navigation immediately; Discard restores all values and removes persisted draft; messages paint above chrome; Cancel/Escape restore control | Implemented. Local browser PASSED: invalid Save, successful persistence, Discard, Cancel, Escape, Back and toast. Server failure retention PASSED in unit tests |
| 2 | Preview entry and controls in site.js/shell.js; readiness in preview handler/page markup | Direct and SPA Site entry render; first Refresh works; stale/error/blank frames never report success; hidden previews do not request work | Implemented. Lifecycle regressions including stale-frame revisions PASSED; local browser PASSED entry/Refresh/mobile and failure-document recovery |
| 3 | Route-specific headings/scroll in shell/performance/page; canonical breadcrumb owner in shared | Players → Insights headings match; ordinary Site entry reveals orientation; current-page crumbs are unlinked | Implemented. Heading/crumb gates PASSED. Site heading stays visible on mobile entry and reload. Additional mobile fragment-drawer defect fixed and browser verified |
| 4 | Home composition and concise shared content | Real selected-site identity is the focal point; truthful readiness and one next action; smaller empty/setup states; consistent current tokens; usable desktop/mobile | Implemented. Home identity/mobile summary, Activities empty/existing disclosure, Rewards empty metrics expansion and Connections secondary settings browser verified |
| 5 | Regression gates, builds, bounded browser checks, diff review | Publish exact test outcomes, runtime evidence and limits; build generated assets from source; no unrelated files staged | Final verification recorded below; local implementation only, no production release |

## Design direction

Operate mode: the creator recognizes their community, sees what needs attention, and acts. Keep the current Fira Sans/Fira Code roles and mineral palette (#4056b9 action, #202b3c text, #f5f7fa canvas, #ffffff surface, #edf1f7 chrome). Use real community identity and the existing YourRank mark rather than decorative statistics or generic illustration. Home should organize identity/readiness, current work and participant activity into a clear composition. Secondary explanations and unused automation setup should recede behind details controls. Public streamer branding remains separate from product action color.

## Verification contract

1. Red/green regressions for save result, navigation guard, discard/reset, preview readiness and canonical route chrome.
2. Build shared package before Worker tests; regenerate assets through build.js.
3. Test actual local Worker with isolated local database. Do not seed or mutate production.
4. Browser: invalid Save → navigation; failed save recovery; Discard → return/reload; first Site preview/Refresh/device selection; Home and Site desktop/mobile; overlay hit testing; route identity.
5. Root lint/typecheck/test before any commit. Preserve test gates. Report environment failures separately from test failures.
6. Bound visual review to one batched inspection and one confirmation round unless an acceptance failure remains.

## Change map

Canonical route scope: packages/shared/src/dashboard-routes.ts. Shell structure: dashboard-chrome.ts. Navigation labels/state: dashboard-nav.ts and dashboard-chrome-state.ts. Editor state: dashboard/state.js, players.js, site.js. Preview: same public renderer through handlers/preview.js. Token owner: dashboard-v4.css. Dependent surfaces include the Leaderboard shell, fragment pages and Bot dialogs/chrome; backend domain behavior remains unchanged.

No parallel replacement implementation or legacy route migration is planned. The diagnostic report remains historical evidence; this plan records the newer baseline and progress.

## Executed evidence — 9 September

- Local actual Leaderboard Worker: `http://localhost:8791`, isolated Postgres database `yourrank_ui_test_20260909`, generated demo fixture account. No production writes or deployment. Local-only config/logs are ignored under `.local/ui-runtime/`.
- Browser PASSED: Home → Site first preview, first Refresh, direct mobile Site entry selecting Mobile; valid site-name Save → Home → reload persists `Atlas Community`; added temporary player → invalid score → navigation Save → Home responds again in **662 ms** across both automated clicks; Cancel leaves zero dialogs/inert nodes; navigation Discard → Home → Players leaves original five players, no temporary row. Toast center hit-test succeeds at y≈76px, z-index 1100. Players → Insights gives `Overview`.
- Local preview POST observations: **152–349 ms** in the sampled Worker log. These are local server response times, not a production speedup measurement or full preview paint timing.
- First desktop/mobile Home and Site visual pass: no horizontal overflow at 390px. Mobile hierarchy had an overriding H1 rule; the source fix and tighter two-column summary are written but not yet visually confirmed. Home's previously omitted player scores were found during this review and corrected in the shared client collector.
- Focused tests PASSED at their executed revisions: 49 tests for Save/navigation; later 63 tests for Site lifecycle and shared chrome (942 assertions). New tests cover invalid save/no request, server failure retention, hidden preview work, Refresh after hidden initialization, blank/error/ready documents, and canceled deferred work. The subsequent stale-frame revision test has not executed.
- Root lint PASSED with one unused-import warning, then the import was removed. Root typecheck PASSED. Both predate the final changes and require a final run.
- Official root test attempt 1 FAILED on a 5-second filesystem-scanning timeout in `jsonb-binding-contract`; retry passed that suite and continued. Later runs exposed old copy/breadcrumb expectations, which were updated to the requested behavior with assertions retained.
- Exhaustive Leaderboard files, one process per file: **1,749 passed, 7 skipped, 3 failed**. Failures were: current-page Settings link expectation, raw pixel font-size ceiling (242 vs 241), and a staging negative fixture regex that did not remove the Hyperdrive stanza under CRLF. Fixes are written: unlinked expectation, identity token, and CRLF-tolerant fixture removal with an added mutation assertion. **These fixes have not been rerun.**
- Final test command was rejected by automatic approval review with “You've hit your usage limit.” No workaround execution was attempted. Latest source is ahead of `assets_bundled.js`; regenerate it before final verification or shipping. No commit/PR/deployment is ready to claim.

## Resumed execution and final browser evidence

The usage interruption above is historical. Execution resumed with the user's authorization and the earlier failures were corrected and rerun. The staging fixture normalizes CRLF before applying negative mutations; production configuration and security assertions are unchanged.

- PASSED: explicit preview revision test ignores an old response while a newer draft is pending. Browser navigation to a non-preview document inside the frame shows an error; Refresh restores the real preview.
- PASSED: Escape closes the unsaved dialog with zero remaining dialogs or inert nodes. Back opens the guard; Cancel retains the Site route and draft; a subsequent Back → Discard restores Home and the saved site name.
- PASSED: at 390×844, Home uses 13px orientation text and 28px community identity with two summary columns and no horizontal overflow. Site H1 top was 319.5px on both ordinary entry and reload, below the header and verification notice. Viewport reset after testing.
- PASSED: Activities starts collapsed without saved templates; a local inert template fixture makes it open on entry with the existing work visible. No schedule was created or executed.
- PASSED: Rewards with zero activity collapses only the detailed metrics; opening the disclosure shows actual zeros. Connections keeps the connect action prominent and secondary usage/login settings accessible in a disclosure. Local OAuth was not completed.
- Additional defect found during final mobile testing: fragment navigation changed the page but left the drawer covering it. Shared `closeDashboardDrawer()` now handles core, fragment and same-URL navigation. Browser PASSED on Rewards and Activities; account chrome test asserts the emitted close event and focus behavior.
- Final review: no domain, authentication, billing, production config, schema or dependency changes. Discard deliberately reloads saved state, trading one reload for complete reset of all editor fields. Generated assets are rebuilt through the canonical build script. The local test database and logs remain isolated under ignored test configuration.

## Verification limits and release boundary

Final executed gate results: **root test PASSED — 2,223 passed, 108 skipped, 0 failed; root lint PASSED; root typecheck PASSED; generated-asset build PASSED; `git diff --check` PASSED.** Local logs: `.local/ui-runtime/tests-accepted.log`, `lint-verified.log`, `typecheck-verified.log`. Skips are existing environment/integration exclusions, not successes. This final result supersedes the intermediate failures above.

This completes the scoped remediation plan locally, not a claim that every application route has no bugs. Production latency after deployment, external OAuth/services, every account role, real mobile devices and live reward fulfillment are NOT VERIFIED. Integration checks skipped by the existing suite remain SKIPPED. No production deployment, push or commit was performed. Releasing this branch remains a separate action.

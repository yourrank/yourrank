# Community rewards and event leaderboards — 2026-09-08

Historical verification of the initial local changes. The subsequent audit
replaced Postgres image bytes with R2 and repaired remaining viewer regressions;
see [audit verification](audit-findings-verification.md) for current behavior,
test results, migration prerequisites and deployment limits.

## Changed

- Community logo navigation preserves the chosen viewer template. Configured, enabled channel links appear in the shared public navigation. Site settings labels match Reward shop and My activity.
- Site settings fills the workspace width. Appearance block labels use workspace text color. Insights groups questions and emphasizes their values.
- Public reward cards use 3:2 images, credit cost and a clear claim action. Creator uploads re-encode to static WebP (maximum edge 960px, maximum output 180KB). Images load separately and lazily rather than inside shop JSON.
- Shop Delete removes an item from the creator and public lists, clears its picture, retains the row for claim history, and prevents editing a deleted item back into availability.
- Leaderboard Setup supports up to 20 independent points events per site. Each has its own name, player list, save/version check and publication setting. A public select switches between main and published event standings. Event scores do not change the main leaderboard, viewer credits or memberships.
- Additive migrations: `20260908000100_reward_images.sql`, `20260908000200_site_event_leaderboards.sql`. The events table lives in the existing backend-only `app_private` schema with explicit Worker-group privileges.

## Verified

- PASSED: asset generation, lint, typecheck and `git diff --check`.
- PASSED: the root runner's constituent suites, executed separately after an intermittent Windows asset-file lock: shared 254, leaderboard 1,742, consumer 16, bot 170, monitor 17, web 12. Total 2,211 passed, zero failed. Existing 108 integration skips remain skipped.
- PASSED: migration compatibility gate and unique migration versions.
- PASSED: real local PostgreSQL Worker-role access; anon/authenticated cannot use `app_private`.
- PASSED: official local demo login, create Event A/B, switch published event standings, search inside the selected event, and preserve main leaderboard scores. Logo click retained Spotlight.
- PASSED: upload a local PNG through the file chooser, optimize to 960×629 WebP / 24,202 bytes, save, then load the public image successfully. Delete returned 200, removed the item from the list and made its public image return 404. Event deletion returned 200 and removed public access. Only the three fixtures created for this test were removed.
- PASSED: desktop/mobile browser inspection of reward cards and Insights; Site content width measured 1,118px at a 1,440px viewport; Appearance labels computed as rgb(32,43,60); enabled Kick URL appeared in the real viewer preview. Temporary channel edits were discarded.
- Detector: one existing hidden logo preview without a source was flagged. It is intentionally populated by the upload editor, not a shipped broken image.
- PASSED: fresh independent static review found no material blocker after checking migration uniqueness/private-schema access, custom-domain scoping, image routing and validation, upload race guards, and deletion semantics. The reviewer did not independently execute runtime tests; executed runtime evidence above is from the primary agent.

## Not verified / risks

- No production or staging deployment, real OAuth login or real viewer claim was performed.
- Custom-domain media routing is covered by code tests, not a deployed custom-domain browser test.
- Local schema was migrated; remote databases still require the additive migrations before this code ships.
- Initial independent review found migration, custom-domain, async upload and image-validation defects; fixes were implemented and tested. Its follow-up and documenter hit an agent usage limit; documentation was completed locally and a fresh independent static review completed without a material blocker.
- Screenshot inspection was performed through the browser tool; screenshots were not exported to repository files.

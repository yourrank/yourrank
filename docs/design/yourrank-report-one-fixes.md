# First roles / UX audit — implementation and verification

Date: 2026-09-06. Implements the accepted findings in `yourrank-roles-ux-feature-audit.md`. This record covers the local worktree, not a production release.

## Changed

| Finding | Implemented disposition |
| --- | --- |
| Team has no visible site scope | The authorized Team response includes the site name. The page names that site above members/invites and links to the existing Sites selector. Invite, removal and revocation dialogs repeat the name. Seats are explicitly account-wide. Removal/revocation retain the confirmed site ID across asynchronous confirmation. Failed/late loads cannot leave stale controls or paint a departed page. |
| Telegram changes header orientation | Shared workspace search markup now has one owner in shared dashboard chrome. Telegram labels its bot context `Account · Telegram`, removes the misleading static Active site rail card and loads the working command palette. Direct Settings loads initialize the same search module. |
| Anonymous viewer utilities repeat destinations | Anonymous public communities show the primary sign-in entry without account/membership utilities. The generic sign-in fallback retains the community path. Signed-in viewers retain All communities and Your account. The global account link responds to sign-in/sign-out state. |
| Empty membership directory offers no action | The empty state accepts the community name from its YourRank link and opens its `/me` page on the same origin. It validates the name, rejects URLs/path traversal and preserves existing truncated slugs ending in a hyphen. Navigation does not create membership or claim a reward. |
| Demo crosses environments | The existing worktree request-origin wiring was retained and rebuilt. Renderer regression coverage verifies body/legal/provider continuation links use the supplied local origin. |
| Missing marketing policy links | Both footers consume one Terms / Privacy / Cookies / Contact component with wrapping and 44px link targets. Existing homepage composition retained after mobile inspection. |
| Invalid Reviews ARIA loading value | Loading now sets `aria-busy` to the explicit string `true` or `false`. |
| Marketing ownership documentation is stale | Root AGENTS, ARCHITECTURE and PROJECT_STATE describe the actual MARKETING_PAGES proxy registry rather than homepage-only ownership. |
| Unused monitoring export | Removed the unconsumed `createReporter` factory and its private obsolete types. Active monitoring exports remain. No whole feature was deleted. |

The existing local Home verification-specific next action was already implemented; it was rebuilt and its existing setup regression checks passed. Production onboarding drift remains a deployment validation item. No second onboarding implementation was added.

Role and feature strategy remains the audit decision: keep Owner/Moderator, separate Viewer Account/Membership/Player/Telegram identities, retain gated and background capabilities and required aliases, and keep deferred capabilities out of navigation. No role, entitlement, database or restricted legacy feature was redesigned.

## Verified

- **PASSED — root `bun run test`: 2,179 passed, 108 skipped, 0 failed.** Counts aggregate the suite summaries from `scripts/test.mjs`; skipped integration cases are not passes. Includes shared, Bot, isolated Leaderboard files, Consumer, Monitor and Web. The final viewer boundary test also passed in an isolated run (17 tests).
- **PASSED — `bun run lint`, `bun run typecheck`, and `bun run check:test-mocks`.** Mock allowlist remains 11 documented legacy files; no global mock was added.
- **PASSED — instruction pack self-check:** 95 skills, evaluation contracts and instruction graph validated. **SKIPPED:** optional official `skills-ref` validation, executable unavailable.
- **PASSED — shared TypeScript build and Leaderboard asset generation.** Generated bundle rebuilt from its source; 84 assets. No dependency upgrades or generated-file hand edits.
- **PASSED — browser, local read-only fixture using real page renderers, generated assets and Team handler with injected collaborators:** named owner Team; site-specific invitation/removal copy; Moderator read-only controls; Telegram search opening and keyboard navigation to Settings; direct Settings search; anonymous community sign-in continuing to `/demo/me`; signed-in account utilities; empty global membership entry, invalid path feedback and navigation to the community. Desktop and 390px mobile layouts inspected; no horizontal overflow in inspected Team/empty-directory states.
- **PASSED — real Next dev server browser:** homepage and Pricing footer policy links present; mobile 390px screenshots inspected; homepage policy link targets measured at 44px; no observed horizontal overflow. Pricing browser error-log query returned no errors.
- **PASSED — independent bounded source review:** no remaining introduced blocker. Its trailing-hyphen compatibility finding was fixed and covered by an executable regression assertion.
- The changed shared HTML snapshot was reviewed: its only update removed anonymous duplicate utilities and retained the originating community sign-in path. Scope tests retain capture-before-confirmation checks and are supplemented with behavioral tests.

Local command logs are in ignored `.impeccable/review/report-one-*.log`. Browser trees/screenshots are session evidence; no screenshot artifact is claimed. The temporary fixture refuses mutations and is not a production authentication bypass.

## Not verified

- Real database-backed role lifecycle, owner/moderator multi-site accounts, invite acceptance/revocation, membership writes, populated live claims and connected provider behavior.
- Real OAuth completion, custom-domain navigation, administrator sessions, screen-reader use and all 38 routes in a browser. The route coverage gate is automated structural coverage, not 38 browser passes.
- Production deployment/cache propagation and production onboarding after release. No deploy, commit, invitation, publishing or production data change was performed.

## Risks

The worktree contains extensive changes predating this implementation; its complete diff is not attributable to this task. The browser fixture proves presentation and client interaction with representative state, not production authentication, database isolation or third-party delivery. Existing release-readiness blockers remain independent of this UX work.

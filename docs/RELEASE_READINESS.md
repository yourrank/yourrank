# Release Readiness

Audit date: 2026-09-01

This report evaluates the product that exists after Wave K. It does not create a Wave L and it does not treat roadmap completion as launch approval. Evidence is labelled `PASSED`, `FAILED`, `SKIPPED`, `NOT RUN`, or `NOT VERIFIED`; a skipped or unavailable check is never counted as a pass.

## Baseline

- Repository: `yourrank/yourrank`
- Starting branch: latest `main`
- Starting SHA: `fc0fd1ca7fa4e639a1ee30a2cea23b4c3f9c29fc`
- Required Wave K merge contained: `fc0fd1ca7fa4e639a1ee30a2cea23b4c3f9c29fc` — **PASSED**
- Audit branch: `codex/release-readiness`
- Roadmap state: complete through Wave K; Recognition, Communication, social features, generic automation, and restricted workflow expansion remain outside the launch audit.

## Launch disposition

| Launch mode | Disposition | Blocking reasons |
|---|---|---|
| Closed beta | **NOT READY** | No successful restore drill is recorded; production has 12 pending DLQ rows with the oldest more than eight days old; dedicated staging infrastructure and required mail configuration are not verified. |
| Public Free | **NOT READY** | Closed-beta blockers remain, and the dedicated staging release path cannot run until its isolated Supabase/Hyperdrive resources and required mail configuration are provisioned and verified. |
| Paid Public | **NOT READY** | All Free-launch blockers remain, and no real recurring subscription provider, verified subscription webhook, renewal/failure/cancellation reconciliation, or durable provider subscription mapping exists. |

Final recommendation: **DO NOT LAUNCH**.

## Current system map

| Component | Purpose | Production entrypoint | Persistence | External dependency | Failure impact |
|---|---|---|---|---|---|
| Leaderboard Worker (`apps/leaderboard`) | Apex routing, creator dashboard, creator public sites, Viewer Account/Membership APIs, Claims, Insights, Connections, and safe Activity automation cron | `yourrank.site/*`; `src/index.js`; five-minute cron | Supabase/Postgres through Hyperdrive, Durable Objects, audit log; produces queue events | Cloudflare, Supabase, Resend, Kick OAuth/webhooks, marketing service binding | Primary creator/viewer product unavailable; cron or mutation failure can delay safe Activities or user actions |
| Bot Worker (`apps/bot`) | Telegram dashboard, login/webhooks, bot operations, signed callbacks, broadcasts and recovery crons | `/bot*`, `/dashboard/telegram*`, `/hook/*`, `/pb*`, `/r/*`; `src/worker.ts` | Supabase/Postgres through Hyperdrive, RateLimiter Durable Object; produces queue events | Telegram, Resend, Cloudflare | Telegram and bot workflows unavailable; callback/broadcast processing impaired |
| Consumer Worker (`apps/consumer`) | Durable analytics/conversion/export event consumption, DLQ processing, liveness | Queue consumers, `/consumer/*`, five-minute cron | Supabase/Postgres, event queue and DLQ, RateLimiter Durable Object | Cloudflare Queues, Supabase, optional Discord alerting | Events delayed or moved to DLQ; analytics and asynchronous work become stale |
| Monitor Worker (`apps/monitor`) | Five-minute endpoint, database, canary and optional backup-freshness monitoring | Scheduled Worker | Cloudflare logs only | Production endpoints, optional Discord | Outages or stale recovery state may go unalerted |
| Marketing Worker (`apps/web`) | Next.js marketing pages proxied at the apex and redirects for legacy app hosts | service binding `yourrank-web`; `app.yourrank.site` and `next.yourrank.site` redirect to apex | Static/OpenNext assets; Hyperdrive binding is present | Cloudflare Workers/OpenNext, Leaderboard service binding | Marketing or apex `/` content unavailable; product copy can misrepresent launch scope |
| Supabase/Postgres | Canonical relational state, migrations, transactions, locks, audit history | Hyperdrive bindings and migration workflow | 125 ordered SQL migrations at audit baseline | Supabase/Postgres | Product mutations and reads fail; missing schema before cron code is unsafe |
| Event queues | Request-path durability and asynchronous processing | `yourrank-events` and `yourrank-events-dlq` | Cloudflare Queues plus DLQ rows/health state | Cloudflare Queues | Delayed/lost processing if admission and fallback both fail; stale DLQ requires operator action |
| GitHub Actions | PR gates, deploy ordering, security scans, rollback | `.github/workflows/*` | Build artifacts, SBOM and Actions evidence | GitHub, Bun, Supabase CLI, Cloudflare | Unsafe code or schema can reach production if gates are bypassed |

The production deployment order encoded in the repository is migrations, Leaderboard Worker, Bot Worker, Consumer Worker, production smoke checks, then Monitor Worker. The marketing Worker has its own build/deploy workflow and is consumed by the apex through a service binding.

## P0 findings

**Count: 0.** Focused authorization, privacy, Claims, Activity automation, and session tests found no verified cross-account leak, authentication bypass, duplicate scheduler mutation, secret exposure, destructive migration, or wrong billing grant. This is not a claim that unavailable production-only checks passed.

## P1 findings

**Count: 7.**

| ID | Finding | Audit disposition |
|---|---|---|
| P1-01 | Creator signup/recovery could mutate account state while email verification delivery was unavailable, and resend recovery could depend on browser-supplied email. | **FIXED.** Production/staging require both `RESEND_API_KEY` and `MAIL_FROM`; signup and password recovery fail before mutation when delivery is unavailable; signed-in resend resolves the current user server-side; delivery failure is truthful; `/health` and deploy smoke expose the requirement. Regression tests pass. Deployment secrets themselves remain **NOT VERIFIED**. |
| P1-02 | Public marketing, onboarding, and legal/product copy promoted or described restricted legacy mechanics and nonexistent recurring/crypto billing as current product behavior. | **FIXED.** Primary marketing and onboarding now describe sites, community, free credits, Rewards and Claims; the marketing `/games` destination permanently redirects to `/sites`; factual policy wording now matches the current free-credit product and does not promise checkout. Restricted Owner routes remain contained and were not redesigned. |
| P1-03 | Staging deployed only part of the runtime, did not apply migrations first, and omitted non-inherited Cloudflare bindings/variables. It could accidentally point at incomplete or production-shared infrastructure. | **FIXED IN CODE / OPERATIONALLY BLOCKED.** Staging now has a fail-closed preflight, migrations-before-code, isolated queue/service/worker definitions, full Web/Consumer/Leaderboard/Bot/Monitor order, and smoke before Monitor. Literal Hyperdrive placeholders deliberately prevent deployment until dedicated staging infrastructure is provisioned. |
| P1-04 | DLQ health reported green based only on count even when rows were stale; the live system has 12 pending rows and the oldest was 748,873 seconds old at the probe. | **DETECTOR FIXED / BACKLOG OPEN.** Health now degrades for count, age (24-hour default), or a failed probe and returns reasons. The production backlog was not mutated during the audit and must be investigated/replayed or intentionally disposed of before launch. |
| P1-05 | Recovery evidence is absent, and the backup freshness handler read `process.env` rather than the Worker environment. `/api/health/backup` currently returns 503 because no successful restore verification is recorded. | **CODE FIXED / OPERATIONAL BLOCKER OPEN.** The handler now validates the Worker environment threshold and fails closed; recovery documentation no longer claims unverified backups/PITR. An isolated restore drill and provider-side backup/PITR verification are still required. |
| P1-06 | The canonical bot test command used Bun's substring directory filter, so an ignored local `dist` tree caused duplicate compiled tests and false failures. | **FIXED.** The bot runner enumerates exact source test files. It passes 164 tests, skips 10 PostgreSQL-dependent tests, and runs no compiled duplicate. |
| P1-07 | Canonical paid checkout is not implemented. Manual/trial entitlement evidence does not establish subscription billing. | **DEFERRED INDEPENDENT BLOCKER.** No provider was invented in this audit. Paid Public remains blocked until a separate provider project supplies recurring checkout, verified webhooks, idempotent reconciliation, renewal/failure/cancellation handling and durable mappings. |

## P2 findings

**Count: 2.**

| ID | Finding | Disposition |
|---|---|---|
| P2-01 | Account export handlers truthfully return 503 because the `ACCOUNT_EXPORTS` R2 binding is absent from production and staging configuration. | Open. The code does not pretend an export exists and tests cover the controlled failure. Provisioning and retention policy need a separate bounded operational change. |
| P2-02 | Wrangler warns that the Bot Worker exports the pre-existing `RateLimiter` Durable Object without a migration stanza; comments state that the class predates current configuration. | Open evidence gap. Do not add a new-class migration against a live class without Cloudflare deployment-history confirmation. |

## Known deferred capability

- Recognition: deferred for lack of trustworthy Viewer/Membership-linked evidence.
- Communication, messaging, social graph and creator CRM: absent by design.
- Generic automation and additional Activity types: absent; only allowlisted `safe_code_drop` scheduling exists.
- Recurring paid subscriptions: absent and independently blocks Paid Public.
- Restricted Games, wagering, predictions, paid-chance and settlement mechanics: not target launch strategy; no implementation or optimization occurred in this audit.

## Creator journey

Result: **PARTIALLY VERIFIED; launch-blocking end-to-end run NOT VERIFIED.**

- Creator route/auth, selected-site, Home, Community/Site, Activities, Members, Rewards, Claims, Reviews, Insights, Connections, Team, Automation and Settings source suites pass.
- Production browser checks reached authenticated Home, Site, Activities, Members, Rewards, Insights and Settings documents at ten widths without document overflow.
- Signup and recovery now fail closed when deployed email is not configured; the verification page gives a recovery action instead of claiming an email was sent.
- A clean isolated account journey through signup → verification delivery → first site → publish → public site → mutation workflows was not run because no isolated mail provider and PostgreSQL runtime were available locally. It remains **NOT VERIFIED** until staging is provisioned and the release E2E/smoke plan executes.

## Moderator journey

Result: **PASSED at authorization/service boundaries; real invitation browser journey NOT VERIFIED.**

- The capability matrix allows Members safe operations, Reviews, ordinary Claims, safe Activities, aggregate Insights and Team-entitled safe automation.
- Billing, account security, Team administration, provider credentials/Connection lifecycle, site-owner settings, bot configuration, arbitrary credit adjustment and restricted legacy boundaries are server-denied.
- Removal is rechecked server-side; focused tests show an old session loses capability after membership removal.
- A real email invitation acceptance through a deployed browser session is **NOT VERIFIED** locally.

## Viewer journey

Result: **PASSED at renderer/service boundaries; full deployed mutation journey NOT VERIFIED.**

- Passive visit and generic OAuth do not create Membership. Join is explicit and does not set billable `last_active_at`.
- Successfully committed safe participation may create Membership through the canonical transaction.
- Global `/me` remains the My communities index; creator-local `/me` is the exact selected Community relationship.
- Participation is bounded to persisted free code-drop claims; Claims reuse the canonical lifecycle; Recognition remains absent; no “Member since” date is fabricated.
- Anonymous demo browser checks reached creator Home, Leaderboard, Rewards, local My Community and global My communities at all required widths without overflow.
- A fresh deployed Viewer OAuth/Join/Claim/Participation browser journey is **NOT VERIFIED** because isolated provider and database infrastructure were unavailable.

## Multi-site isolation

Result: **PASSED in authorization/context tests and prior authenticated browser context checks; destructive live mutation NOT RUN.**

- Site IDs are resolved through owned-site/capability boundaries for Activities, Members, Reviews, Claims, Insights, Connections and Automation.
- Tests cover wrong-site substitution and Home selected-site alerts. Canonical route/query state preserves selected context.
- Prior authenticated browser evidence covered an Owner with populated and empty sites, repeated selection, direct load, refresh and Back/Forward without stale document context.
- No production mutations were made. A two-site isolated staging mutation run remains **NOT VERIFIED**.

## Multi-viewer isolation

Result: **PASSED at service/cache boundaries; deployed account-switch browser run NOT VERIFIED.**

- Viewer Claims and Membership reads require the authenticated global Viewer ID plus exact site membership.
- Focused tests deny Viewer A access to Viewer B Claim detail, balance and Membership and prevent cross-site history contamination.
- Authenticated viewer HTML/API responses are private/no-store and vary on Cookie; no shared Worker cache stores personalized HTML.
- A production logout/login switch was not performed against real user data. A staging browser account-switch run remains **NOT VERIFIED**.

## Auth/session

Result: **PASSED for implemented server boundaries; provider/custom-domain callbacks remain partly NOT VERIFIED.**

- Creator and Viewer session tests cover expiry, revocation, logout, secure/HttpOnly/SameSite cookie construction, rotation, suspension and account identity.
- OAuth state is one-time, provider/host-bound, expires, and rejects replay. Same-origin and CSRF guards are exercised.
- Wrong-site Join substitution is denied before membership mutation.
- Custom-domain renderer/auth tests use the same Viewer Account and membership semantics as the apex.
- Real Kick/Telegram provider outages, callback allowlists and cookie behavior in an actual custom-domain browser are **NOT VERIFIED** in this local environment.

## IDOR matrix

| Resource | Owner substitution | Moderator/role boundary | Viewer substitution | Result |
|---|---|---|---|---|
| Site / selected context | Owned-site lookup denies Owner B IDs | Site capability required | Not applicable | **PASSED** |
| Member / Membership | Site-bound membership join | Canonical member capability | Viewer ID plus site membership required | **PASSED** |
| Review | Site/source tuple required | Review capability required | Internal queue not exposed | **PASSED** |
| Claim / Reward | Site/source joins and transition locks | Ordinary Claim/reward capability; sensitive credit adjustment denied | Viewer A detail lookup filters by Viewer A | **PASSED** |
| Team invitation | Owner account/site scope | Team management denied | Not exposed | **PASSED** |
| Automation template/schedule | Site ownership and capability rechecked | Safe Activity capability plus Team entitlement rechecked | Not exposed | **PASSED** |
| Connections | Site/provider scope required | Lifecycle and credentials Owner-only | No credential API | **PASSED** |
| Insights | Exact selected-site capability | Aggregate read only | Viewer denied | **PASSED** |

## Privacy/cache

Result: **PASSED in source/focused tests.**

- Authenticated creator/viewer responses use `private, no-store`; Cookie variation is explicit where documents depend on identity.
- Public renderer caching does not include personalized Viewer/creator fields. Personalized APIs are not placed in the Worker cache.
- Provider tokens, refresh tokens, webhook secrets, private emails, fraud context, block reasons, internal Review fields, Claim actor/source IDs and private fulfillment values are excluded from relevant projections.
- Two-viewer and anonymous-after-auth response tests pass. Production CDN header sampling beyond the audited routes is **NOT VERIFIED**.

## Billing truth

One canonical plan owner defines:

| Plan | Price | Active viewers / rolling 30d | Sites | Players/site | Operators | Safe automation |
|---|---:|---:|---:|---:|---:|---|
| Free | $0 | 100 | 1 | 50 | 1 | Manual safe Activities only |
| Pro | $24/month or $240/year | 2,500 | 3 | 1,000 | 1 | Yes |
| Team | $69/month or $690/year | 10,000 | 10 | 5,000 | 5 | Yes, including current Moderator capability |

Plan display, metadata, effective entitlement, site/player/operator limits, downgrade restrictions and viewer-right preservation are contract-tested. No environment variable can silently change canonical prices.

## Payment-provider status

There is no production-capable recurring checkout, canonical subscription webhook, renewal/failure/cancellation reconciliation, or durable customer/subscription mapping for Pro/Team. `/api/billing/checkout` returns a controlled 503; legal and marketing copy no longer presents it as available.

**PAID PUBLIC LAUNCH BLOCKED — recurring payment provider not implemented.**

## Active-viewer semantics

Result: **PASSED.** Billable activity remains distinct global Viewer Accounts with a newly committed qualifying safe action, pooled across all sites owned by the creator in a rolling 30-day window. Current qualifying actions are authenticated reward claim, authenticated free code-drop claim and successfully credited signed Kick reward redemption.

Page views, `/me`, Join, OAuth sign-in, passive browsing, failed/blocked/rate-limited actions, anonymous traffic and idempotent replay do not mark billable activity. Tests pin 70/85/95/100 thresholds, 101+ grace, recovery and paid entitlement behavior.

## Claims/Rewards

Result: **PASSED at transactional boundaries, including the PR PostgreSQL migration/race gate.**

- Create/list, viewer balance, Claim submission, pending creator view, Complete and Cancel paths reuse the canonical redemption adapter.
- Terminal transitions are atomic/idempotent; contradictory transitions fail; cancellation restores balance/stock/ledger once.
- Completion time comes from `claim_completed` audit evidence, never mutable `updated_at`.
- Creator and Viewer cross-identity substitutions are denied and private fulfillment/actor fields are redacted.

## Safe Activities

Result: **PASSED at validation/service boundaries; deployed end-to-end mutation NOT VERIFIED.**

- Manual and automation paths share one canonical free code-drop validator/service.
- Successful claim commits membership, credits, ledger and Participation evidence together.
- Failed, exhausted, expired, blocked and replayed attempts cannot mark activity or billing activity.
- No name/IP/device matching is used as identity.

## Automation

Result: **PASSED in unit/service, real PostgreSQL concurrency and isolated scheduler E2E tests.**

- Only `safe_code_drop` is accepted. Template/schedule validation, one-time/daily/weekly UTC recurrence, cancellation, three bounded retries, stale >6h handling, entitlement downgrade/restore, removal/suspension/unpublish failure and 50-row due batch are covered.
- Transaction lock plus unique occurrence and Activity constraints enforce at most one Activity per occurrence.
- Restored entitlement does not fire missed backlog; a new future time is required.
- The five-minute Leaderboard cron is deployed only after migrations in the production and corrected staging workflows.

## Connections

Result: **PASSED for evidence-derived state and authorization.**

States distinguish Not connected, Authorized, Refresh required, Needs verification and Needs attention from stored credential/expiry evidence. Token presence alone is not called healthy. Lifecycle and credential operations remain Owner-only and selected-site scoped; API projections omit provider identifiers and secrets. No background provider polling was added. Live provider reconnect/disconnect is **NOT VERIFIED**.

## Insights

| Metric | Exact definition | Source | Window | Scope | Trust limitation |
|---|---|---|---|---|---|
| New members | Non-system selected-site memberships created in the window | `site_viewers` | rolling 7/30-day `[start,end)` UTC | selected site | Membership creation is not necessarily billable activity |
| Returning members | Joined before start and latest authenticated selected-site visit in window | `site_viewers` | 7/30 UTC | selected site | Uses latest authenticated visit, not continuous engagement |
| Participants / repeat participants | Distinct non-system members with >=1 / >=2 distinct persisted code-drop claims | `code_drop_claims`, `code_drops` | 7/30 UTC | selected site | Only safe code drops, not all product activity |
| Active drops | Drops with at least one persisted claim | code-drop persistence | 7/30 UTC | selected site | Does not measure impressions or failed attempts |
| Claims submitted/completed/top reward | Window submissions; distinct audit-backed completion events; non-cancelled most-claimed reward | `redemptions`, `shop_items`, `audit_log` | 7/30 UTC | selected site | Old completions without audit events may be absent |
| Pending Reviews / Claims | Current operational queues | Reviews adapter / pending redemptions | current, not date-limited | selected site | Operational count, not historical trend |
| Public visits | Opens of the selected public site | existing public analytics | displayed range | selected site | Page opens, not identified members |

The endpoint accepts only 7/30, uses UTC, requires `canRoleViewInsights`, excludes system viewers, rate-limits, bounds reads, isolates failed sections and returns no per-viewer rows. Existing source/traffic limitations remain visible.

## Database/migrations

- Migration filename/order/static audit: **PASSED**.
- Wave I indexes, Wave H role constraints, Viewer/Membership/billing reconciliation and Wave K occurrence constraints are present in the ordered migration set.
- Empty-database apply and PostgreSQL concurrency: **PASSED in PR CI**. PostgreSQL 16 applied all 125 migrations with `ON_ERROR_STOP`, then passed wagering, rollup, session/team, two real automation race/cancel tests, JSONB writer tests and schema-consistency checks.
- A separate realistic production-data upgrade and fresh `EXPLAIN (ANALYZE, BUFFERS)` run remain **NOT VERIFIED**; the CI database is an empty isolated schema.
- Recovery is forward-fix plus restore evidence; no unsafe generic rollback SQL was invented.

## Deployment order

Production repository order:

1. Apply all Supabase migrations and refuse deploy when required migration credentials are absent.
2. Build/test/audit and deploy Leaderboard (contains the five-minute safe automation cron).
3. Build/test/audit and deploy Bot.
4. Build/test/audit and deploy Consumer with event and DLQ bindings.
5. Smoke apex, pricing/contact, Bot/Telegram routes, Consumer and DB/email health.
6. Deploy Monitor only after smoke passes.
7. Verify queue/DLQ, automation occurrences and backup freshness before public traffic.

The marketing Worker builds/deploys separately; the apex uses the `MARKETING` service binding. Staging now follows migrations → Web/Consumer → Leaderboard → Bot → smoke → Monitor and refuses placeholders or production-shared identifiers.

## Environment requirements

No secret values were printed or committed.

| Area | Required names | Optional/conditional names | Evidence |
|---|---|---|---|
| Production deploy | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` | rollback/version metadata managed by workflow | Names audited; actual presence **NOT VERIFIED** |
| Leaderboard | `HYPERDRIVE` or `DATABASE_URL`; production/staging `RESEND_API_KEY` + `MAIL_FROM`; `TOKEN_ENC_KEY` for protected secrets | Kick OAuth/webhook names when enabled, `SENTRY_DSN`, monitoring webhook, backup freshness threshold | Missing mail/DB now controlled/degraded; actual secret inventory **NOT VERIFIED** |
| Bot | `HYPERDRIVE` or `DATABASE_URL`, `TOKEN_ENC_KEY`, `ADMIN_API_KEY`, `IP_HASH_SALT`, Telegram login token/username when Telegram login is enabled | Resend sender, Sentry | Config names audited; values **NOT VERIFIED** |
| Consumer | `HYPERDRIVE`, event queue, DLQ, RateLimiter binding | Discord monitoring webhook | Wrangler dry-run passed for production |
| Monitor | `MONITOR_TARGET`; enable backup check for launch | Discord webhook, canary postback key/slug | Staging enables backup check; production live backup endpoint returns 503 |
| Staging | `STAGING_SUPABASE_PROJECT_REF`, `STAGING_SUPABASE_ACCESS_TOKEN`, `STAGING_SUPABASE_DB_PASSWORD`, dedicated Hyperdrive IDs, isolated Cloudflare workers/queues, mail secrets | provider test credentials | Deliberately fail-closed; provisioning **NOT VERIFIED** |

Cloudflare environment variables and bindings are non-inherited, so staging definitions repeat required values/bindings explicitly.

## Observability

| Subsystem | Current signal | Audit result |
|---|---|---|
| Apex/DB/mail | `/health` with DB, consumer, DLQ and email-verification state; deploy smoke | Live endpoint returned 200 with DB true; detector changes not deployed |
| Backup recovery | `/api/health/backup`, optional Monitor check | Live endpoint returned 503; launch blocker |
| Consumer/DLQ | heartbeat counts, last success/failure, pending count and oldest age; logs/Discord option | Live consumer healthy; stale DLQ backlog open |
| Automation | audit events, occurrence/schedule states, Home attention, cron logs | Unit evidence passed; deployed scheduler E2E pending |
| OAuth/Connections | structured errors and evidence-derived state | Source tests passed; live provider failure drills not run |
| Bot | Worker logs, dashboard health, deploy smoke, recovery cron | Tests passed; production secret inventory not verified |
| Migrations/deploy | ordered Actions jobs and smoke/rollback workflows | Static/workflow audit passed; PR CI pending |

## Recovery

Database, provider, queue and malformed callback paths return controlled errors without stack/secret exposure in focused tests. Queue admission uses a fallback; failed automation retries are bounded; invalid provider authorization becomes actionable; stale sessions receive current server authorization.

Recovery readiness is nevertheless **FAILED** for launch because no successful isolated database restore has been recorded. Required evidence is provider backup/PITR confirmation, an isolated restore, integrity checks and a recorded timestamp visible through the backup health endpoint. The old production DLQ backlog must also be resolved with an auditable operator decision.

## Custom domains

Result: **PASSED in shared renderer/auth tests; live custom-domain OAuth/cookie run NOT VERIFIED.** Apex and custom domains share route, Viewer Account, Join, Membership, Claims and Participation code paths. Host-bound OAuth state and cookie-domain construction are tested. Actual DNS/TLS/provider callback behavior for a creator custom domain was unavailable locally.

## Responsive/accessibility

- Actual browser QA covered creator Home, Site, Activities, Members, Rewards, Insights and Settings and viewer creator Home, Leaderboard, Rewards, My Community and global My communities.
- Widths: 320, 360, 390, 430, 640, 768, 900, 1024, 1280 and 1440 CSS pixels.
- Creator: 70/70 route-width combinations had no document horizontal overflow.
- Viewer: 50/50 route-width combinations had no document horizontal overflow and exposed main heading/skip-link structure.
- Focus/drawer/form/status behavior is regression-tested in source. A fresh browser keyboard/focus run against the changed local verification state was **NOT VERIFIED** because the browser/runtime connector was unavailable after the branch changes.
- The Impeccable static detector found only the existing accepted Inter-font warning and no new audit-change defect.

## Dead routes

Canonical dashboard route/Worker ownership and aliases pass mechanical parity tests. Internal route inventory found no unowned canonical dashboard destination or redirect loop. Marketing `/games` is now a permanent redirect to `/sites`; it is not advertised in primary marketing navigation. Contained direct restricted Owner routes remain only where current architecture requires them and were not expanded. A full deployed link crawler remains **NOT VERIFIED**.

## Product-copy truth

Primary public copy now describes the implemented creator site, community, leaderboard, free-credit Rewards/Claims, Insights and safe scheduling boundaries. It does not promise Recognition, Communication, AI, generic automation, paid checkout or restricted mechanics as launch capabilities. Onboarding calls a new site a draft until verified/published. Policy wording was corrected only for factual runtime consistency; this audit makes no legal conclusion.

## Performance evidence

- High-value Insights/Member/Claim/My Community reads are bounded and selected-site indexed; Insights uses three independently timed five-second reads plus canonical Reviews count.
- Viewer Participation is capped at 25 and Claims at 50; automation due scan is ordered and capped at 50; API pagination is bounded.
- No new base64/logo payload or provider call was added to render paths.
- Prior Wave I PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` evidence justified the current narrow indexes. Fresh database plans, production latency/Core Web Vitals and scheduler query timing are **NOT VERIFIED** in this audit environment.

## CI

Local evidence before PR:

| Gate | Result |
|---|---|
| Full canonical tests | **PASSED** — shared, consumer, exact-file bot, per-file Leaderboard, Monitor and Web; local DB-dependent cases reported as skipped |
| Lint | **PASSED** — zero errors; one pre-existing unused consumer `ctx` warning |
| Typecheck | **PASSED** |
| Shared build | **PASSED** |
| Leaderboard build/assets | **PASSED** |
| Bot build | **PASSED** |
| Web Next.js compile/prerender | **PASSED** — 15 pages |
| OpenNext final Worker bundle | **PASSED in Linux PR CI**; local Windows stopped at a symlink permission after successful Next compile |
| Dependency audit | **PASSED** — no moderate-or-higher unignored vulnerability reported |
| SBOM | **PASSED** — CycloneDX 1.5 generated with 637 components in a temporary artifact |
| TruffleHog | **PASSED in PR CI** (`--only-verified`) |
| Test-mock guard | **PASSED** — 11 documented legacy files |
| `.ai` self-check | **PASSED** — 95 skills/contracts and instruction graph; external `skills-ref` executable unavailable |
| `git diff --check` | **PASSED** |
| Migration/Postgres race tests | **PASSED in PR CI** — all 125 migrations plus wagering, rollup, session/team, automation concurrency and JSONB writers |
| E2E and scheduler E2E | **PASSED in PR CI** — 60 passed, 0 failed; the Wave K scheduled Activity executed once and recorded normal participation |
| E2E environment-dependent cases | **SKIPPED: 12** — marketing root/pricing, separate Bot Worker/Telegram routes and real Telegram bot were unavailable in the isolated Worker runtime |
| Password-reset email token | **NOT VERIFIABLE** in E2E — no mailbox; API reset request/bogus-token/change-password path passed |
| CodeQL | **CodeQL SKIPPED** — the repository's conditional analysis job did not run |

PR #681 executable checks passed: Build, Dependency Audit, E2E, Lint, Migration Dry-Run, Test, Typecheck, SBOM and TruffleHog. A workflow success is not a substitute for the skipped CodeQL analysis.

## Production smoke plan

Use isolated launch-test accounts/data; do not mutate restricted systems or existing production Viewer records.

1. Confirm migration job and all Worker versions correspond to the approved SHA.
2. Require `/health` DB, email verification, Consumer and DLQ state to be healthy; require `/api/health/backup` 200 with a recent restore drill.
3. Creator: sign in, load dashboard, select Site A, refresh/direct-load, publish/open the public site.
4. Viewer: sign in, verify passive visit created no Membership, explicitly Join Site A, open local My Community and global My communities.
5. Create one short-lived free code drop in the isolated site; claim it once; confirm replay denial, credits and Participation history.
6. Create one isolated Reward Claim; confirm pending creator view; Complete; confirm canonical viewer completion event/time. Separately test Cancel on a second isolated Claim.
7. Confirm Insights selected-site aggregates and independent unavailable-section behavior.
8. Confirm Connection state is evidence-derived; do not reconnect a real creator provider during smoke.
9. On an entitled test site, schedule one future safe code drop; verify one occurrence/Activity and no generated-code leakage.
10. Switch repeatedly between Site A and Site B; verify all Home alerts, Members, Activities, Rewards, Claims, Insights, Connections and Automation stay isolated.
11. Confirm Moderator allowed/denied boundaries and server denial after removal.
12. Inspect queue/DLQ, cron, Worker and audit logs; remove or retain test data according to the documented safe cleanup path.

## Remaining launch blockers

1. Record a successful isolated database restore and confirm provider backup/PITR configuration; require backup health to become 200.
2. Investigate and resolve the 12-row production DLQ backlog, including the row older than eight days; require age/count health to be green.
3. Provision dedicated staging Supabase/Hyperdrive/queues/workers and required mail configuration; remove placeholders only with verified non-production identifiers.
4. On provisioned staging, run the 12 environment-dependent E2E cases for marketing, the separate Bot Worker/Telegram routes and real provider wiring; verify a real verification/reset email through a test mailbox. Enable CodeQL only when repository entitlement is available and report it separately.
5. Before any Paid Public launch, implement and independently audit a real recurring subscription provider and reconciliation lifecycle.

Until blockers 1–4 are resolved, Closed Beta and Public Free remain **NOT READY**. Paid Public remains **NOT READY** until all five are resolved.

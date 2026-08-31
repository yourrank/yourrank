# Project State

Maintained to prevent architecture drift.

**Evidence baseline:** Wave K candidate branched from `main` at `d36b6253230e6dad3a535feacc02845e0463f52b` (Wave J Viewer Membership Expansion merged)

**Last reconciled:** 2026-08-31

**Scope:** current implementation reality only. Target product direction lives in [`docs/YOURRANK_PRODUCT_ARCHITECTURE.md`](../docs/YOURRANK_PRODUCT_ARCHITECTURE.md).

## Canonical Current Sources

| Concern | Current owner |
|---|---|
| Dashboard route semantics | `packages/shared/src/dashboard-routes.ts` |
| Navigation presentation | `packages/shared/src/dashboard-nav.ts` |
| Chrome state | `packages/shared/src/dashboard-chrome-state.ts` |
| Authenticated shell structure | `packages/shared/src/dashboard-chrome.ts` |
| Leaderboard Worker shell adapter | `apps/leaderboard/src/pages/dashboard-shell.jsx` |
| Client dashboard navigation | `apps/leaderboard/src/assets/dashboard/shell.js` |
| Public viewer renderer | `packages/shared/src/site-render.ts` |
| Public viewer styles | `apps/leaderboard/src/assets/site-shell.css` |
| Authenticated workspace tokens | `apps/leaderboard/src/assets/dashboard-v4.css`, `ws-token-contract` block |
| Schema | `supabase/migrations` (125 migration files including the Wave K safe Activity automation migration) |
| Runtime/deployment description | `ARCHITECTURE.md` plus Worker configuration |

## Convergence Status

### Route ownership/model — RESOLVED

- `DASHBOARD_ROUTES` is the single editable current route-semantics manifest.
- Stable IDs, canonical paths, sections/tabs, Worker owners, delivery modes, scopes, navigation parameters, and legacy aliases are encoded there.
- Browser/server/Worker parity and uniqueness are enforced by shared and Worker tests.
- `dashboard-nav.ts` derives hrefs and route ownership from the manifest; it is presentation, not a competing route table.

### Dashboard shell and chrome — RESOLVED

- `dashboardChromeHtml()` in `packages/shared/src/dashboard-chrome.ts` is the single authenticated structural emitter.
- Leaderboard pages and Telegram documents render that shared structure through thin adapters.
- `dashboard-chrome-state.ts` owns titles, crumbs, active rail state, and local tabs.
- Structural ownership and chrome-ownership gates prevent a second shell/tree.

### Navigation ownership — RESOLVED

- The sidebar owns section roots, page subnavigation owns tabs, and the topbar owns context/search/actions.
- The visible rail presents Home, Sites, Community (Site and Leaderboard), Activities, People, Rewards, Insights, Telegram, and Settings. Restricted legacy Engagement and Games routes remain contained and directly routable for authorized operational use but are not primary product navigation.
- Community is presentation-only; People and Insights are labels over the existing audience and analytics route families. No route ID, URL, scope, owner, or schema changed with those labels.
- `requestDashboardRoute` in `apps/leaderboard/src/assets/dashboard/shell.js` is the one authenticated client-navigation entry point.
- The public viewer account history runtime is separate and does not own dashboard navigation.

### Telegram shell/runtime — STRUCTURE CONVERGED; WORKER BOUNDARY RETAINED

- The duplicate Telegram dashboard shell runtime was deleted in Wave 2.
- Telegram routes remain account-scoped `worker-document` destinations served by the Bot Worker at `/dashboard/telegram*`.
- Telegram documents use shared navigation, chrome state, shell structure, and leaderboard-owned shared assets.
- Current operational Telegram workflows remain intact pending a future generic communication architecture.

### CSS/token state — CANONICAL TOKENS; REMAINING CASCADE DEBT

- Every authenticated `--ws-*` token is defined once in the `ws-token-contract` block of `dashboard-v4.css`.
- `tokens.test.js` enforces token ownership, the type/spacing scales, focus behavior, and drift ratchets.
- `devin-system.css` still supplies broader marketing/public material variables and some authenticated page-body material rules. It no longer owns a competing `--ws-*` token block, but its remaining authenticated cascade is accepted debt.
- Legacy `v3-*`/`v4-*` class-generation names and raw-value ratchets remain current debt; they are not patterns to extend.

### Render/delivery model — OWNERSHIP CONVERGED; TRANSPORTS INTENTIONALLY DISTINCT

The canonical manifest records three current delivery modes:

- `spa-section` — core sections rendered inside the persistent dashboard document;
- `fragment` — full documents on direct load plus `/dashboard/_content` fragments during client navigation;
- `worker-document` — Telegram documents served by the Bot Worker.

These modes share route, chrome, navigation, and shell ownership. A migration may converge transport later, but there is no second semantic route model or shell.

### Legacy redirects — MANIFEST-OWNED AND RETAINED

- Legacy dashboard path aliases and `?nav=` redirects live in `dashboard-routes.ts`.
- Serving Workers derive behavior from the manifest, with parity tests and legacy-route telemetry.
- Redirect removal remains deferred until operational evidence supports it.

### Public viewer — ONE IMPLEMENTATION, MEMBERSHIP HISTORY EXPANDED

- `packages/shared/src/site-render.ts` renders the creator public destination.
- `site-shell.css` owns its responsive visual system.
- Primary viewer navigation includes Home, Leaderboard, Rewards, and site-scoped My Community, with a separate global `/me` My communities index. The legacy Games route may remain operational when its persisted flag is enabled, but it is absent from the primary viewer navigation and Site section editor.
- Current public labels and routes remain implementation truth until target viewer capabilities exist.
- My Community composes bounded Participation, Credits, and Claims reads only after exact Viewer Account plus selected-site Membership resolution. The global index remains compact and does not aggregate or duplicate history.
- Recent viewer waves established shared chrome, truthful auth/empty states, responsive behavior, creator branding, and persistent membership history without a parallel renderer.

### Viewer Membership history — WAVE J AVAILABLE; RECOGNITION DEFERRED

- `packages/shared/src/site-render.ts` remains the one creator-scoped My Community renderer. No viewer-history endpoint, replacement renderer, universal event store, or history table was introduced.
- Participation currently means only a successfully persisted free code-drop Claim in `code_drop_claims`. The read joins its `code_drops.site_id`, direct canonical `viewer_id`, exact `site_viewer_id`, and a non-system Viewer; it orders by immutable Claim creation time and returns at most 25 viewer-safe records. Failed/exhausted attempts, Join, visits, `last_seen_at`, passive credits, names, provider identifiers, Reviews, and all restricted legacy workflows are absent.
- Claims remain owned by the Wave G adapter in `apps/leaderboard/src/handlers/claims.js`. My Community calls that adapter for the exact site, Viewer, and Membership instead of issuing a second raw redemption query. Viewer projections expose the canonical Claim ID, reward name/cost, canonical status, submission time, and an audit-backed completion/cancellation time where one exists; raw site, Membership, reward/source, actor, and mutable `updated_at` values are omitted. Membership Claim history is bounded at 50.
- Terminal Claim timestamps come only from matching `claim_completed` / `claim_cancelled` audit events. An old terminal redemption without an event remains terminal but has no displayed terminal timestamp; `redemptions.updated_at` is never promoted into lifecycle evidence.
- Recognition decision: **DEFERRED — INSUFFICIENT SAFE/LINKED EVIDENCE**. Current leaderboard players and archives are name-based, Hall of Fame reuses that history, mixed tournament placement is outside the safe target boundary, Reviews are internal decisions, and no current creator-recognition or challenge-completion source satisfies safe selected-site ownership plus canonical Viewer/Membership linkage. My Community therefore has no empty Recognition panel, fake badge, points model, or inferred history.
- Authenticated creator-site HTML is `private, no-store` and varies on `Cookie`. A non-member receives the existing Join state and no history reads. Apex and custom-domain My Community resolve through the same route/read composition; a new Viewer session receives a new server-rendered response with only that Viewer's site-scoped data.
- Global `/me` remains the My communities index with community identity, balance, claiming availability, and pending Claim count only. Wave K does not add a parallel viewer automation identity; a scheduled drop becomes a normal code-drop Activity and its successful Claim enters the existing Wave J Participation history.

### Community ownership — CONSOLIDATED

- Community remains a presentation grouping over the existing site-scoped Site and Leaderboard routes; it has no parallel router, shell, entity, or persistence model.
- The canonical Site body is rendered from `apps/leaderboard/src/pages/dashboard.jsx` and is the only creator-wide public-identity editor.
- Site owns name, tagline, logo, accent, typography, social links, public-section visibility, URL/domain controls, and real-viewer preview.
- Leaderboard retains Setup, Players, Appearance, Share, and History. Appearance owns only leaderboard-specific columns, layout/blocks, and prize labels; its site-wide identity note links to Site.
- Preview uses `renderSite()` through an ownership-checked endpoint.
- Site → Connections is a separate fragment route, not a second Site implementation.
- Sites remains a top-level account-scoped destination. The selected-site control switches sites and links to Manage Sites, but it is absent from account-scoped pages and does not own the current create-site workflow, so it is not yet a complete replacement.
- Recognition is deferred: the only trustworthy historical result content is the archive data already owned by Leaderboard History and the public Hall of Fame. There is no distinct, moderated cross-capability recognition model to justify another creator destination.

### Safe Activities foundation — AVAILABLE; ADAPTER-BASED

- `/dashboard/activities` is a site-scoped fragment destination for safe community workflows.
- The current shared presentation and `/api/activities` adapt only existing free code drops. No universal Activity table, new participant model, or schema migration was introduced.
- Code-drop claims continue to resolve through authenticated Viewer Account and the existing `site_viewers` Site Membership record.
- Mixed Engagement remains a contained legacy route family rather than a primary navigation destination. Restricted legacy Games, paid-chance raffles, predictions, wagering, payout, and settlement mechanics are not imported into Activities.
- Challenges are deferred because a shared foundation is not yet sufficiently proven. Tournaments remain outside Activities because current settings include entry-cost and eligibility fields that are not cleanly isolated from the zero-cost subset.

### Safe Activity automation — WAVE K AVAILABLE; ONE EXPLICIT KIND

- Activities owns automation contextually at `/dashboard/activities`; no top-level Automation product, generic workflow graph, dynamic handler lookup, queue, Durable Object, or browser/in-memory timer was added. The only supported kind is the server allowlisted `safe_code_drop` workflow proven by the existing manual free code-drop Activity.
- `apps/leaderboard/src/code-drop-service.js` is the canonical validation and creation boundary for both manual and scheduled drops. Templates store only reusable reward/claim/expiry settings. Creating a template is inert and cannot create an Activity.
- Creating a schedule snapshots the validated template name and configuration. Later template edits or deletion cannot silently alter an approved schedule. Schedules persist exact UTC instants and support only one-time, fixed 24-hour UTC daily, or fixed seven-day UTC weekly recurrence.
- Postgres owns durable schedules and occurrences. The existing Leaderboard Worker five-minute scheduled handler runs one bounded ordered due scan of at most 50 rows. Each transaction locks the schedule; unique `(schedule_id, occurrence_at)` occurrence persistence plus the unique `code_drops.automation_occurrence_id` boundary permits at most one Activity for an occurrence even under duplicate or concurrent invocation.
- A delay of up to six hours executes once using the intended occurrence identity. A later run becomes a controlled stale failure. Transient infrastructure errors retry at most three times with at least four minutes between attempts; validation, site, creator, Moderator, and entitlement failures do not loop. Recurrence advances from the intended UTC instant to the first future interval and never generates a missed backlog.
- Cancellation changes durable lifecycle state rather than deleting history. Cancellation and execution serialize on the locked schedule: cancellation wins with no Activity, or execution wins and the completed occurrence cannot be cancelled retroactively. Rescheduling is limited to paused/failed schedules and always requires an explicit new future time.
- Creation and execution recheck selected-site Activity capability. Owner may manage safe automation. A current Moderator may do so only through canonical `canRoleManageActivities`, and execution also requires the creator to remain an active Owner or active site Moderator under an effective Team owner plan. Removal, suspension, draft/unpublished site state, deletion, and downgrade fail closed.
- Free retains manual safe code drops. Pro and Team enable new templates, schedules, and recurrence through `canUseAutomation()` in canonical plan metadata; prices and other limits are unchanged. Downgrade preserves configuration and pauses due work. Restoring entitlement never releases missed work automatically: the creator must choose a new future time.
- Home reads real selected-site schedules only. The next scheduled safe occurrence appears in Coming next; controlled paused/failed schedules appear once in Needs attention. Activities exposes creator-facing controlled reasons without claim codes, secrets, provider data, or stacks. Audit rows cover template lifecycle, scheduling/cancellation/rescheduling, success, controlled failure, recurrence disablement, and entitlement pause without recording generated codes.
- Generic Communication architecture is **NOT READY**. Safe announcements and external reminders are therefore deferred. Existing Telegram, Discord, queue, auto-reset, restricted event, wagering, prediction, raffle, payout, settlement, and tournament operations remain separate and cannot enter the allowlist.
- Deployment requires applying `20260907000000_wave_k_safe_activity_automation.sql` before deploying the Worker/configuration that runs the existing five-minute cron. There is no backfill or existing Activity rewrite.

### Safe Reviews foundation — AVAILABLE; ADAPTER-BASED

- People now owns site-scoped Members and Reviews at `/dashboard/audience/members` and `/dashboard/audience/reviews` through the canonical fragment route model.
- The current Reviews queue adapts one proven human-decision source only: flagged participant eligibility exceptions on persisted zero-entry-fee tournament signups. This narrow Reviews adapter does not move tournaments into Activities or import paid/mixed tournament behavior.
- Reviews use the existing `tournament_entries` source state and append decision events to the existing `audit_log`; no universal Review table or migration was introduced because a second reusable safe review lifecycle is not yet proven.
- Review state is derived from `people_review_allow` / `people_review_exclude` audit events rather than neighboring tournament states. Reviews support only Allow or Exclude for that signup; an allowed waitlisted signup remains waitlisted, and unresolved flagged signups cannot enter zero-cost random selection. Decisions lock the site-bound tournament then source row and write any source update plus attributable audit event atomically. Identical retries are idempotent; contradictory stale decisions fail.
- Context uses an explicit Viewer Account → selected-site `site_viewers` membership link where one exists, and shows only authenticated provider links. It does not expose the existing source score, raw reason, IP, device, or network data and does not infer identity from names.
- Home review attention is deferred; Home remains account-scoped and no trustworthy, inexpensive selected-site integration has been established.

### Safe Claims foundation — AVAILABLE; ADAPTER-BASED

- Rewards owns canonical safe Claims at the existing `/dashboard/rewards/redemptions` route, now presented as Claims. No new top-level route or navigation family was introduced.
- The only proven safe fulfillment lifecycle is the existing authenticated reward redemption workflow. `/api/claims` and `/api/viewer/claims` adapt `redemptions` joined to `site_viewers`, `viewers`, `shop_items`, and `sites`; no `claims` table or migration was introduced.
- Canonical Claim states map existing persistence as `pending` → Submitted/Needs fulfillment, `fulfilled` → Completed, and `cancelled` → Cancelled. Creator actions are Complete or Cancel. The compatibility redemption transition endpoint remains available, but both APIs use one atomic transition implementation.
- Pending transitions are site-scoped and atomic. Exact terminal retries are idempotent, contradictory terminal transitions fail, cancellation refunds the existing balance/stock/ledger effects once, and terminal decisions append attributable `claim_completed` or `claim_cancelled` events to `audit_log` without copying fulfillment values.
- Claim identity is Viewer Account plus the selected site's `site_viewers` Membership. Viewer APIs return only the authenticated viewer's records; creator APIs require the existing site capability. Username, display-name, IP, device, browser, or raw provider identifiers are not ownership proof.
- No private fulfillment fields are currently required by the proven workflow. Claim detail explicitly reports that no private data is stored; all creator/viewer Claim responses are `no-store`, and there is no public Claim-detail API.
- Kick reward earning, free code drops, free chat giveaway/raffle winners, tournament participants/winners, and manual credit adjustments do not yet provide a reusable fulfillment lifecycle and remain outside Claims. Restricted wagering, payout, settlement, withdrawal, and paid-chance mechanics are excluded.
- Home adds no new Claims card or account-wide queue. Its existing selected-site pending-redemption alert is relabeled as Claims because it already receives the selected site's current Rewards usage count. A broader viewer navigation destination remains deferred; current public site and `/me` surfaces show truthful claim status within their existing ownership.

### Moderator and Team operations — OWNER + MODERATOR CONVERGED

- V1 exposes only Owner and Moderator. Owner is represented by `sites.user_id`; delegated, site-scoped access remains in the existing `site_members` table. The Wave H migration deterministically maps the dead pre-launch Manager value to Moderator, records recovery audit rows, aborts on unexpected roles, and constrains member/invite rows to Moderator. No second team table or RBAC engine exists.
- `packages/shared/src/team.ts` is the canonical server-owned role-to-capability owner. Owner retains every legitimate capability. Moderator can operate the existing leaderboard boundary, Members (including block/unblock), safe Activities, Reviews, ordinary Claims, local Rewards catalog/mappings, and read operational Insights. Moderator cannot manage Team, billing, account security, site settings, provider connections/credentials, bot configuration, the legacy broad Credits boundary, or arbitrary manual credit adjustments.
- Restricted legacy handlers do not infer Moderator access from the broad compatibility `canRoleManageBoard` capability. Paid-chance raffles, predictions, and the current mixed tournament operational handlers use an owner-only containment guard; safe leaderboard, archive/history, player, Activity, Review, Claim, and Reward capability paths retain their existing Moderator behavior.
- Team relationships are site-specific; the same operator's relationship to another owner or site never grants access. Role resolution rechecks the selected site, persisted membership, and owner Team entitlement on every protected request. No role is stored in the session. Removal therefore stops the next protected request; downgrade preserves member rows but suspends delegated access, and a restored Team entitlement makes valid rows effective again.
- Seats remain account-pooled across all sites owned by one creator: Free 1 total operator, Pro 1, Team 5. Pending invites reserve identities, duplicate identities do not consume another pooled seat, and invite creation/acceptance serialize on the owner account row before enforcing the canonical limit. Billing prices and all other entitlements are unchanged.
- Invitations are email-bound, site-bound, Moderator-only, seven-day records with inviter, expiry, accepted/revoked state, and a 192-bit random bearer token stored only as SHA-256. Acceptance locks the invite and owner row, validates the authenticated account email, role, entitlement, and seat limit, and treats an exact second acceptance as an idempotent replay.
- Team lifecycle writes append-only `team_invitation_created`, `team_invitation_revoked`, `team_invitation_accepted`, and `team_operator_removed` records to the existing `audit_log` in the same transaction as source changes. Review and Claim events retain their source-specific actor audit behavior; no duplicate Team activity UI or audit mutation endpoint was added.
- Settings → Team is the one Team surface. Owners see pooled seat usage, invite/remove/revoke controls, and the Team upgrade path; Moderators receive minimal read-only context without pending invite data or mutation controls. There is no role-edit route because Moderator is the only delegated V1 role.
- Reviews and Claims semantics are unchanged; only their capability ownership converged. Claims still contain no private fulfillment PII. If a future Claim workflow introduces sensitive fulfillment data, it requires a new evidence-led access review rather than inheriting current ordinary-Claim access automatically.
- Wave I Insights/Connection Health, Wave J Viewer Membership history, and the narrow Wave K safe Activity automation described here are implemented. The official architecture roadmap waves are complete; this does not claim generic automation, Communication, Recognition, social features, or restricted workflow support.

### Insights and connection health — AVAILABLE; AGGREGATE + EVIDENCE-BASED

- The customer-facing product label is Insights. Stable route IDs and the existing selected-site `/dashboard/analytics` route family remain unchanged; the canonical tabs are Overview, Traffic sources, and Public site activity. No parallel analytics route family, service, persistence model, or AI interpretation layer exists.
- Overview answers four questions before traffic detail: whether the community is returning, how selected-site code drops are used, how free-credit reward Claims are used, and what operational work needs attention. Existing public-site traffic remains a secondary line chart/detail source; the legacy export containing unrelated conversion/revenue fields is not exposed from Insights.
- Available date windows are rolling 7 or 30 days, compared against one server-owned `[startsAt, endsAt)` pair of `timestamptz` instants and labeled UTC. The endpoint resolves the selected site's owner plan and caps the requested window through canonical `HISTORY_DAYS`; a Moderator inherits the owner's effective history entitlement. Current windows fit inside every existing Free/Pro/Team entitlement, and downgrades do not delete data.
- New members are non-system `site_viewers` membership rows created in the window. Returning members have an earlier membership row and `last_seen_at` in the window. This is authenticated selected-site return behavior, not anonymous traffic, frequency, or account-pooled active-viewer billing usage. Historical pre-correction `created_at` rows may include passive provenance, so customer-facing member detail does not present the value as an explicit “Member since” date; forward-going passive reads no longer inflate the metric.
- Participants are distinct non-system viewers with a selected-site `code_drop_claims` record in the window. Repeat participants claimed at least two different code drops, and active drops are distinct code drops with a claim. Restricted Games, wagering, paid chance, predictions, odds, payout, and settlement records are excluded.
- Reward usage counts real selected-site `redemptions`: Claims submitted in the window, distinct Claims with a durable `claim_completed` audit event in the window, and the most-claimed non-cancelled `shop_items` reward among window submissions. Completion events include canonical site/source IDs; completions from before this audit lifecycle existed may not appear. Current pending Claims are operational and therefore intentionally not date-limited. No recipient/private fulfillment values or member-level rows are returned.
- Pending Reviews reuse the canonical People Reviews count adapter over flagged zero-entry-fee tournament-signup exceptions and their existing audit decisions. No trust/fraud score or raw signal is selected or returned.
- `/api/insights` requires `canRoleViewInsights`, enforces selected-site lookup, accepts only 7/30, rate-limits by user and site, and runs three five-second aggregate reads plus the canonical Reviews count with section-level failure isolation. A failed aggregate returns an unavailable section instead of erasing successful sections. All reads exclude system viewers and the response is `no-store`. Owner and Moderator may read it; Viewer sessions and wrong/cross-creator sites are denied.
- `Settings → Connections` is the connection inventory/lifecycle surface. It labels Creator account versus individual site scope and lists only supported current integrations: Kick identity/rewards, Telegram identity/site delivery, and Discord site delivery. Kick connect/reconnect/disconnect is available there for owned sites; notification configuration actions use canonical `board` navigation context to deep-link to the selected site's existing single Site notifications editor instead of duplicating its form.
- Connection states name persisted evidence rather than claiming generic provider health. Kick may be Not connected, Needs verification, Refresh required, Authorized, or Needs attention. Authorized requires a saved, unexpired access token plus the required selected-site channel; an absent expiry is not treated as proof. An expired access token with a refresh credential is Refresh required until an operation exercises that credential. A proven invalid grant or provider 401 clears the invalid saved credentials and becomes Needs attention; transient provider failures preserve refreshability. Discord is Configured/Not configured because no delivery-success record exists. Telegram identity is Linked/Not connected; site delivery is Enabled/Paused/Not configured. Optional never-configured integrations are never warnings.
- Home reuses the selected-site Rewards status response and adds no connection KPI or OAuth execution. It shows a compact Needs attention alert only when Kick authorization is provably broken, free credits are enabled, and at least one active Kick reward mapping depends on it. The copy names the selected site and affected reward operation. Owner opens Settings → Connections with canonical `board` context; Moderator may view the existing `siteId` connection context but receives no lifecycle control.
- `deriveKickConnectionHealth()` is the single connection-state adapter reused by Settings and Rewards/Home. Creator connection responses contain status, public display names, scope, explanatory copy, and actions only; raw provider user/channel/chat IDs, OAuth access/refresh tokens, webhook values, and credential timestamps are absent. Responses are `no-store`.
- Owner retains `canRoleManageConnections`. Moderator receives only the minimal selected-site Kick status already needed to understand Rewards, cannot connect/reconnect/disconnect or change OAuth/configuration, and never receives tokens, expiry, or provider identifiers.
- Telegram Bot Worker commands, bots, broadcasts, subscribers, and day-to-day operations remain at `/dashboard/telegram*`; Wave I does not create Community → Communication. Communication remains deferred.
- Representative PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` evidence justifies three narrow Insights indexes: selected-site reward submissions by membership/time, current pending Claims by membership, and a partial completion-event site/window/source path. No new table or fulfillment column was introduced. Billing definitions, account-pooled active-viewer measurement, Team caps, restricted legacy systems, and the Wave H capability model are unchanged.
- Authenticated local-browser verification covers an Owner with one populated and one empty site plus a Moderator on the Owner site. Insights and Connections have no document overflow or clipped controls at 320, 360, 390, 430, 640, 900, 1024, 1280, or 1440 CSS pixels; narrow Insights and Settings tabs remain fully visible. Owner selection, direct links, Back/Forward, and refresh retain canonical site context. Moderator Insights remains aggregate-only, connection lifecycle controls are hidden and server-denied, credential fields are absent, and fresh affected-route console logs are clean.

### Critical integrity boundaries — CORRECTED IN CANDIDATE

- Membership, presence, and billable activity are distinct. Anonymous and authenticated passive creator Home, Leaderboard, Rewards, My Community, site-data, and global `/me` reads never create `site_viewers`. Generic Viewer OAuth creates/authenticates only the Viewer Account. Existing Membership reads may advance throttled `last_seen_at`; they never initialize or update `last_active_at`.
- Canonical active-viewer usage remains the rolling 30-day `COUNT(DISTINCT sv.viewer_id)` pooled across every site owned by one creator. The current qualifying safe actions are a newly committed authenticated reward claim, a newly committed authenticated free code-drop claim, and a successfully credited provider-signed Kick reward redemption. Failed, blocked, rate-limited, anonymous, passive, and idempotent replay paths do not mark activity. Viewer rights remain available when creator expansion is restricted.
- Existing `last_active_at` rows do not record which historical caller wrote them, so passive historical marks cannot be distinguished safely from legitimate activity. This candidate performs no destructive reset or migration; future passive membership rows remain null until a qualifying action.
- `site_viewers.block_reason` and fraud score remain private creator/moderation context. Public and authenticated viewer renderers, APIs, `/me`, site-scoped membership/Rewards/Claims data, and viewer exports omit internal reasons and use controlled generic blocked-membership copy. Viewer-specific JSON responses are private and `no-store`; legitimate authorized People/Credits and owner account-export visibility remains.
- Restricted legacy is operationally isolated from target creator Home, primary creator navigation, quick actions, command palette, primary viewer navigation, Site public-section controls, and the global viewer membership journey. No restricted business logic, calculations, persistence, or product replacement was introduced.
- Viewer Account and membership presentation now converge on the existing identity model. Global `/me` is the account-scoped **My communities** index; each `/<slug>/me` or custom-domain `/me` is that creator's **My Community** membership surface. Global account data links into creator-owned Rewards/credits/Claims instead of duplicating those experiences.
- Global membership summaries expose only community identity, free-credit balance, controlled claiming availability, and the count of pending Claims needing creator action. They do not expose creator plan data, raw site/membership IDs, historical “Member since” provenance, full cross-community Claim history, internal block reasons, or fraud context.
- Provider connections shown on the Viewer Account require their persisted OAuth link timestamp; names or external identifiers alone are not proof. Custom-domain and apex navigation preserve local community versus global account ownership, and creator-scoped OAuth failures render controlled messages rather than raw provider/query values.
- Wave J adds bounded free code-drop Participation and canonical expanded Claims history to My Community. Recognition remains deferred for lack of a trustworthy safe Viewer-linked source. Social features and messaging remain deferred. Wave K adds only creator-side safe code-drop templates/scheduling; scheduled Claims reuse this same Participation history.

Production `site_viewers` creation audit (canonical sources; generated `packages/shared/dist/kick-credits.js` mirrors its TypeScript source and is not a fourth caller):

| Caller | Trigger | Membership allowed? | `last_seen_at` | `last_active_at` | Final decision |
|---|---|---:|---:|---:|---|
| `apps/leaderboard/src/viewer-membership.js` | Authenticated explicit Join POST or valid single-use OAuth Join intent | Yes | No | No | Canonical idempotent Join; exact visible site, zero defaults, no plan-capacity gate |
| `apps/leaderboard/src/handlers/events.js` | Newly committed authenticated free code-drop Claim | Yes | No | Yes, after successful transaction | Keep; Membership, Claim, credit and ledger commit as one safe action; invalid/exhausted/rate-limited/replayed paths create no row |
| `packages/shared/src/kick-credits.ts` | Newly committed provider-signed mapped Kick reward credit grant | Yes | No | Yes, in successful credit update | Keep; duplicate/tampered/unmapped/rate-limited/blocked paths do not upsert Membership or mark activity |

Removed writers: `getViewerSiteData()` is read/presence-only, and generic Kick/Discord callbacks never create Membership. Reward redemption is not a creator: it requires an existing Membership and balance.

Current fulfillment audit:

| Workflow | Current owner | Viewer identity | Source and states | Private data | Persistence | Classification | Current action |
|---|---|---|---|---|---|---|---|
| Reward shop redemption | Rewards / Credits | Authenticated Viewer Account joined through selected-site `site_viewers` membership | `redemptions`: `pending`, `fulfilled`, `cancelled`; linked `shop_items` reward | None | `redemptions`, `site_viewers`, `viewers`, `shop_items`, `credit_ledger`, `site_credit_aggregates` | SAFE + READY; ALREADY SUFFICIENT / ADAPT ONLY | Canonical Claims presentation/API and audited terminal transitions over existing persistence |
| Kick channel-reward credit earning | Rewards / Ways to earn | Provider-signed viewer linkage into Viewer Account and Site Membership | `kick_reward_events` and `credit_ledger`; event processed into credits | Provider event payload exists, but no fulfillment fields | `kick_reward_events`, `credit_ledger` | SAFE BUT NOT READY | Remains credit earning, not a Claim |
| Free code drop | Activities | Authenticated Viewer Account and Site Membership | `code_drops`, `code_drop_claims`; active/expired plus one claim record | No fulfillment data | Existing drop and ledger tables | SAFE BUT NOT READY | Remains an Activity result; no creator fulfillment lifecycle invented |
| Free chat giveaway / raffle winner | Transitional Engagement / Giveaways | Current records do not consistently prove canonical viewer ownership | Existing winner/export records; no shared fulfillment states | No proven fulfillment model | Existing giveaway records | AMBIGUOUS / SAFE BUT NOT READY | Excluded from Claims pending identity and lifecycle evidence |
| Tournament participant / winner | Transitional Engagement / Tournaments | Some `tournament_entries.viewer_id` links exist; no reward fulfillment ownership | Entry/result states, not a reward fulfillment lifecycle | Existing tournament review context is separate | Existing tournament tables | SAFE BUT NOT READY | Excluded; Wave F review behavior unchanged |
| Manual credit adjustment / tip | Rewards / member management | Selected-site membership | Immediate `credit_ledger` event; no pending fulfillment | Existing bounded reason/description, not fulfillment data | `credit_ledger`, `site_viewers` | ALREADY SUFFICIENT | Remains credit activity, not a Claim |
| Wagering, predictions, paid chance, payout, settlement, withdrawal | Restricted legacy owners | Not considered | Restricted financial/game states | Out of scope | Restricted legacy tables | RESTRICTED LEGACY | Not adapted, renamed, refactored, or tested as Claims |

Existing-to-canonical state mapping:

| Existing redemption state | Canonical Claim state | Meaning |
|---|---|---|
| `pending` | Submitted / Needs fulfillment | The authenticated viewer spent free credits on the reward; creator action is required |
| `fulfilled` | Completed | An authorized creator/team actor confirms the ordinary reward fulfillment is complete |
| `cancelled` | Cancelled | Terminal; credits and finite stock are restored once |

Waiting for viewer, Needs review, Approved, and Expired are not implemented because the proven reward workflow has no supporting source state or action. They remain target concepts, not aliases.

Server-owned transition matrix:

| Current source / canonical state | Actor | Allowed next state | Enforcement and effects |
|---|---|---|---|
| `pending` / Submitted | Owner or Moderator authorized by `canRoleManageClaims` for the selected site | `fulfilled` / Completed | Atomic site-scoped pending-only update plus `claim_completed` audit event |
| `pending` / Submitted | Owner or Moderator authorized by `canRoleManageClaims` for the selected site | `cancelled` / Cancelled | Atomic site-scoped pending-only update, one balance refund, one finite-stock restore, one revoke ledger row, and `claim_cancelled` audit event |
| `fulfilled` / Completed | Same authorized actor retrying Complete | No change | Idempotent success; no repeated audit or source effect |
| `cancelled` / Cancelled | Same authorized actor retrying Cancel | No change | Idempotent success; no repeated refund, stock restore, ledger, or audit effect |
| Either terminal state | Any actor requesting the other terminal state | None | Safe `409` conflict; reopening is unsupported |
| Any Claim | Viewer | No Claim transition in Wave G | Viewer creation remains the existing idempotent `/api/viewer/redeem`; Claim APIs are read-only for viewers because no real viewer-required fulfillment action exists |

Privacy, access, retention, and notification decisions:

- No recipient name, address, phone, email, ID, fulfillment note, or arbitrary viewer message is stored. The authenticated detail response exposes a structured empty `fulfillmentDetails` model so clients do not infer fields.
- Creator list/detail/transition require the selected-site Claims-management capability. Viewer list/detail require the authenticated Viewer Account and filter through `site_viewers.viewer_id`. Anonymous/public Claim APIs do not exist. All Claim API responses, including errors, are `no-store`.
- Because no private fulfillment values exist, Wave G does not broaden team access or add an Owner-only data path. If a real workflow later requires sensitive data, current capability granularity must be reassessed conservatively in Wave H before those values are exposed.
- There is no private fulfillment-data retention obligation in the current model. Existing redemption, ledger, and redacted audit records retain ordinary fulfillment/account history under their existing behavior; no unsafe speculative deletion job was added.
- Existing Discord/overlay redemption alerts are relabeled as reward Claims. No notification or automation platform was added, and viewer notification on completion remains deferred.

## Current Major Surfaces

| Surface | Current route/implementation reality |
|---|---|
| Home | Account-scoped dashboard route with selected-site context carried by current navigation state |
| Sites collection | Account-scoped `/dashboard/leaderboards` |
| Leaderboard editor | Site-scoped SPA route family under `/dashboard/leaderboard` |
| Site | Site-scoped `/dashboard/site` plus separate Connections fragment |
| Activities | Site-scoped `/dashboard/activities`; free code-drop adapter plus Pro/Team templates, UTC scheduling, and fixed UTC recurrence for `safe_code_drop` only |
| Rewards (including Claims) | Site-scoped fragment route family under `/dashboard/rewards`; Claims adapts existing reward redemptions at `/dashboard/rewards/redemptions` |
| People (Members + Reviews) | Site-scoped `/dashboard/audience/members` and `/dashboard/audience/reviews` |
| Insights | Site-scoped SPA route family under `/dashboard/analytics` |
| Telegram | Account-scoped Bot Worker documents under `/dashboard/telegram*` |
| Settings | Account-scoped fragment routes under `/dashboard/settings` |
| Public creator destination | `renderSite()` via apex slug routes and custom-domain routes |

Community, People, and Insights are current navigation presentation labels only; they do not imply new entity or persistence boundaries. Activities has a narrow current route and adapter boundary for free code drops; broader Activity families remain target-only. **My Community** and global **My communities** now present the existing Viewer Account/`site_viewers` foundation; Recognition and Communication remain target-only claims.

## Worker and Runtime Topology

- `apps/leaderboard` owns the apex application, public creator sites, auth, most dashboard routes, APIs, and the homepage proxy boundary.
- `apps/bot` owns Telegram dashboard documents, bot/webhook/redirect/postback routes, and scheduled Telegram work.
- `apps/consumer` drains queue-backed analytics/conversion/notification work.
- `apps/monitor` performs uptime checks.
- Workers share Supabase/Postgres infrastructure through Hyperdrive and use Postgres-backed sessions.
- `apps/web` remains the proxied marketing homepage only.

## Current Identity and Scope Facts

- Creator/operator accounts (`users`), viewer accounts (`viewers`), creator-team access (`site_members`), site memberships (`site_viewers`), leaderboard player rows (`players`), and Telegram subscriber relationships (`bot_subscribers`) are distinct current records. Team Owner is `sites.user_id`; the only persisted delegated V1 role is site-scoped Moderator.
- `viewers` is the current global viewer-account anchor. A provider connection is treated as authenticated only when its OAuth link timestamp is present; names and raw external identifiers are not linkage proof.
- `site_viewers` is the current physical Site Membership record. Its foreign keys and unique `(site_id, viewer_id)` constraint already provide the required scope and uniqueness, so no additive membership table or inferred backfill is justified.
- A site Membership is created only by the canonical explicit authenticated Join mutation or atomically with a successfully committed approved safe action. Generic Kick/Discord OAuth and anonymous or authenticated passive site entry do not create one, and creator-entered usernames do not create viewer or membership records. Existing Member entry may advance throttled `last_seen_at`; Join sets neither presence nor `last_active_at`; only a qualifying committed safe action advances billable activity.
- People reuses `/dashboard/audience/members` and `/dashboard/audience/reviews`. Member detail binds membership ID and selected site; review list/detail/decisions bind the source entry and any membership join to the selected site. Creator authorization uses the existing site capability boundary.
- Rewards Claims bind an existing redemption to its Viewer Account through the selected-site `site_viewers` membership. Creator and viewer Claim APIs independently enforce those site and account boundaries.
- Leaderboard Player and Telegram Subscriber records remain unlinked to Viewer Account and Site Membership. No username, display-name, IP, device, or fuzzy matching is used to infer identity.
- Dashboard route scope is explicitly `account` or `site`.
- Current site navigation uses both `board` and `siteId` query spellings by delivery family.
- No player/subscriber identity consolidation or parameter normalization has been implemented.

## Known Technical Debt / Deferred Work

| Finding | Current status |
|---|---|
| Broader Activities consolidation beyond the free-drop adapter | Deferred; mixed Engagement and restricted Games remain contained legacy routes outside primary target navigation |
| Three delivery transports remain | Intentional current state; ownership is already singular |
| `board` and `siteId` both carry selected-site context | Separate parity-tested migration if changed |
| `devin-system.css` still shapes authenticated page-body material | Accepted cascade debt; no competing `--ws-*` owner |
| Legacy `v3-*`/`v4-*` names and raw-value ratchets | Existing debt; do not extend |
| Legacy route aliases | Retained pending telemetry evidence |
| Viewer/site membership expansion beyond the converged Viewer Account + existing `site_viewers` foundation | Wave J Participation and expanded Claims history are present; further expansion and Recognition remain deferred until proven safe linked evidence exists |
| Automation beyond safe free code drops | Deferred; Communication is not ready and restricted or unproven workflows cannot enter Wave K automation |
| Recognition destination | Deferred; current archive evidence remains owned by Leaderboard History and the public Hall of Fame |
| Shared Activity / Review / Claim persistence | Shared presentation uses narrow adapters; universal persistence remains deferred until real reuse and migration safety are proven |
| Claims expansion beyond reward redemptions | Deferred; other safe workflows do not yet expose a proven fulfillment lifecycle, and private fulfillment fields must be evidence-led |
| Billing terms/providers/enums | Separate reconciliation required |
| Restricted legacy route families | Operationally contained for owners where retained; excluded from target Home/navigation and target architecture work |

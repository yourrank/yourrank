# Project State

Maintained to prevent architecture drift.

**Evidence baseline:** `main` at `affef6e0a6104461974d3d972f421a328c1f8bf4` (PR #673 merged)

**Last reconciled:** 2026-08-30

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
| Schema | `supabase/migrations` (124 migration files including the Wave H role convergence migration) |
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
- The visible rail presents Home, Sites, Community (Site and Leaderboard), Activities, People, Rewards, Insights, transitional Engagement and Games, Telegram, and Settings.
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

### Public viewer — ONE IMPLEMENTATION, CURRENTLY POLISHED

- `packages/shared/src/site-render.ts` renders the creator public destination.
- `site-shell.css` owns its responsive visual system.
- Current sections include Home, Leaderboard, Rewards, Games, site-scoped My Credits, and a separate global `/me` account/sites surface.
- Current public labels and routes remain implementation truth until target viewer capabilities exist.
- Recent viewer waves established shared chrome, truthful auth/empty states, responsive behavior, and creator branding without a parallel renderer.

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
- Mixed Engagement remains a separate transitional destination. Restricted legacy Games, paid-chance raffles, predictions, wagering, payout, and settlement mechanics are not imported into Activities.
- Challenges are deferred because a shared foundation is not yet sufficiently proven. Tournaments remain outside Activities because current settings include entry-cost and eligibility fields that are not cleanly isolated from the zero-cost subset.

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
- Team relationships are site-specific; the same operator's relationship to another owner or site never grants access. Role resolution rechecks the selected site, persisted membership, and owner Team entitlement on every protected request. No role is stored in the session. Removal therefore stops the next protected request; downgrade preserves member rows but suspends delegated access, and a restored Team entitlement makes valid rows effective again.
- Seats remain account-pooled across all sites owned by one creator: Free 1 total operator, Pro 1, Team 5. Pending invites reserve identities, duplicate identities do not consume another pooled seat, and invite creation/acceptance serialize on the owner account row before enforcing the canonical limit. Billing prices and all other entitlements are unchanged.
- Invitations are email-bound, site-bound, Moderator-only, seven-day records with inviter, expiry, accepted/revoked state, and a 192-bit random bearer token stored only as SHA-256. Acceptance locks the invite and owner row, validates the authenticated account email, role, entitlement, and seat limit, and treats an exact second acceptance as an idempotent replay.
- Team lifecycle writes append-only `team_invitation_created`, `team_invitation_revoked`, `team_invitation_accepted`, and `team_operator_removed` records to the existing `audit_log` in the same transaction as source changes. Review and Claim events retain their source-specific actor audit behavior; no duplicate Team activity UI or audit mutation endpoint was added.
- Settings → Team is the one Team surface. Owners see pooled seat usage, invite/remove/revoke controls, and the Team upgrade path; Moderators receive minimal read-only context without pending invite data or mutation controls. There is no role-edit route because Moderator is the only delegated V1 role.
- Reviews and Claims semantics are unchanged; only their capability ownership converged. Claims still contain no private fulfillment PII. If a future Claim workflow introduces sensitive fulfillment data, it requires a new evidence-led access review rather than inheriting current ordinary-Claim access automatically.
- Wave I Insights/Connection Health and Wave J work have not started. Existing Insights reads are permissioned only; existing provider connection management was narrowed to Owner without adding new connection-health product behavior.

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
| Activities | Site-scoped `/dashboard/activities`; adapter over free code drops only |
| Rewards (including Claims) | Site-scoped fragment route family under `/dashboard/rewards`; Claims adapts existing reward redemptions at `/dashboard/rewards/redemptions` |
| People (Members + Reviews) | Site-scoped `/dashboard/audience/members` and `/dashboard/audience/reviews` |
| Insights | Site-scoped SPA route family under `/dashboard/analytics` |
| Telegram | Account-scoped Bot Worker documents under `/dashboard/telegram*` |
| Settings | Account-scoped fragment routes under `/dashboard/settings` |
| Public creator destination | `renderSite()` via apex slug routes and custom-domain routes |

Community, People, and Insights are current navigation presentation labels only; they do not imply new entity or persistence boundaries. Activities has a narrow current route and adapter boundary for free code drops; broader Activity families remain target-only. Recognition, Communication, My Community, and My Communities remain target-only claims.

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
- A site membership is created by an authenticated viewer entering a site context or by a provider-signed channel-reward interaction. Anonymous browsing does not create one, and creator-entered usernames no longer create viewer or membership records.
- People reuses `/dashboard/audience/members` and `/dashboard/audience/reviews`. Member detail binds membership ID and selected site; review list/detail/decisions bind the source entry and any membership join to the selected site. Creator authorization uses the existing site capability boundary.
- Rewards Claims bind an existing redemption to its Viewer Account through the selected-site `site_viewers` membership. Creator and viewer Claim APIs independently enforce those site and account boundaries.
- Leaderboard Player and Telegram Subscriber records remain unlinked to Viewer Account and Site Membership. No username, display-name, IP, device, or fuzzy matching is used to infer identity.
- Dashboard route scope is explicitly `account` or `site`.
- Current site navigation uses both `board` and `siteId` query spellings by delivery family.
- No player/subscriber identity consolidation or parameter normalization has been implemented.

## Known Technical Debt / Deferred Work

| Finding | Current status |
|---|---|
| Broader Activities consolidation beyond the free-drop adapter | Deferred; mixed Engagement and restricted Games remain explicit transitional destinations |
| Three delivery transports remain | Intentional current state; ownership is already singular |
| `board` and `siteId` both carry selected-site context | Separate parity-tested migration if changed |
| `devin-system.css` still shapes authenticated page-body material | Accepted cascade debt; no competing `--ws-*` owner |
| Legacy `v3-*`/`v4-*` names and raw-value ratchets | Existing debt; do not extend |
| Legacy route aliases | Retained pending telemetry evidence |
| Viewer/site membership expansion beyond the existing `site_viewers` foundation | Deferred until a proven capability needs additive persistence |
| Recognition destination | Deferred; current archive evidence remains owned by Leaderboard History and the public Hall of Fame |
| Shared Activity / Review / Claim persistence | Shared presentation uses narrow adapters; universal persistence remains deferred until real reuse and migration safety are proven |
| Claims expansion beyond reward redemptions | Deferred; other safe workflows do not yet expose a proven fulfillment lifecycle, and private fulfillment fields must be evidence-led |
| Billing terms/providers/enums | Separate reconciliation required |
| Restricted legacy route families | Operational current implementation; excluded from target architecture work |

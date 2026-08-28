# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Thesis

> **YourRank is the community operating system for streamers.**

YourRank gives creators one persistent workspace to run their community and gives viewers one persistent relationship and history inside each creator community. The dashboard is a creator workspace; the public site is a creator destination.

The canonical target architecture is [`docs/YOURRANK_PRODUCT_ARCHITECTURE.md`](docs/YOURRANK_PRODUCT_ARCHITECTURE.md). This file is its concise product summary, not a second architecture specification.

## Users

- Streamers and creator operators who need to run community workflows without becoming full-time administrators.
- Moderators and team members who need delegated, appropriately scoped operational access.
- Viewers/community members who want clear participation, status, history, recognition, and legitimate reward or claim state.
- Agencies and larger creator organizations are a later expansion after the single-community operating model is proven.

## Target Product Model

The target creator-facing information architecture is:

**Home → Community → Activities → People → Rewards → Insights → Settings**

- **Home** surfaces truthful attention, current work, upcoming work, and one useful next action.
- **Community** groups the selected site's public identity, leaderboard, recognition, and future safe communication capabilities.
- **Activities** organizes safe community activities only after real workflows prove shared primitives.
- **People** owns site-scoped members, reviews, and moderation.
- **Rewards** owns free loyalty credits, creator rewards, redemptions, and activity.
- **Insights** begins as selected-site reporting and must not imply unsupported global aggregation.
- **Settings** owns account, team, ordinary SaaS billing, data/privacy, and clearly scoped connections.

Product labels do not automatically require URL, schema, API, or persisted-domain renames.

## Current Implementation Boundary

The target model does not replace current implementation truth. Until deliberate migration waves change it:

- current dashboard route semantics come from `packages/shared/src/dashboard-routes.ts`;
- current navigation presentation comes from `packages/shared/src/dashboard-nav.ts`;
- current runtime and deployment topology come from `ARCHITECTURE.md`, Worker configuration, code, and tests;
- current implementation status comes from `.ai/PROJECT_STATE.md`.

Existing compatibility routes and operational workflows remain functional while presentation and information architecture migrate deliberately.

## Operating Context and Scopes

- Operators often work during live streams in low-light, multi-screen environments and need fast, interruption-safe workflows.
- Account-scoped and selected-site-scoped state must remain explicit. Home is account-scoped with clearly labeled selected-site context.
- `Site` remains the current persisted/domain term. `Community` is primarily a target product/navigation grouping, not automatically a new database entity.
- Creator accounts, viewer accounts, creator/site memberships, leaderboard player records, and Telegram subscriber relationships must not be silently merged.
- Public sites run at `yourrank.site/<slug>` and on supported custom domains.

## Capabilities and Constraints

- The product runs as a Cloudflare Workers monorepo with shared Supabase/Postgres infrastructure and Postgres-backed sessions.
- Anonymous public HTML may be cached; viewer-specific or authenticated data must never leak into anonymous cached responses.
- Public and private state must be truthful. Queued, pending, completed, unavailable, and error states must not be misrepresented.
- Shared Activity, Review, and Claims persistence is deferred until concrete workflows prove a safe reusable abstraction.
- Free / Pro / Team is the target customer-facing direction only. Current billing enums, prices, providers, recurring/lifetime terms, and entitlement behavior remain unresolved until a separate billing reconciliation.
- Background queues process analytics, conversions, notifications, and some fulfilment work; the UI must distinguish queued, processing, failed, and completed states.
- Account and viewer export infrastructure exists, but deployment bindings remain an operational verification item.

## Product Principles

1. **Run the community, not the software.** Organize work around creator outcomes and progressively disclose setup details.
2. **One workspace, explicit context.** Keep account and selected-site scope visible and preserve one shell, navigation system, route model, and public renderer.
3. **State before action.** Show truthful state before or beside any decision it affects.
4. **Automate routine work; review exceptions.** Human review must be explainable and must not claim certainty from weak signals.
5. **Preserve identity boundaries.** Link identities only with legitimate proof; never merge records from matching names or behavioral guesses.
6. **Build shared abstractions from evidence.** Do not create universal Activity, Review, Claims, or membership models before real reuse and migration safety are proven.
7. **Protect momentum.** Preserve drafts, return users to the workflow they started, attach errors to the right control, and close every loop.

## Accessibility and Inclusion

Target WCAG 2.2 AA for customer-facing and operator interfaces. Essential workflows must support keyboard navigation, visible focus, reduced motion, semantic status announcements, readable contrast, practical 44px touch targets, and responsive use on small screens. Basic viewer participation, identity, privacy, and fairness are not paid advantages.

## Canonical Sources

- Target product architecture: `docs/YOURRANK_PRODUCT_ARCHITECTURE.md`
- Current route semantics: `packages/shared/src/dashboard-routes.ts`
- Current runtime/deployment architecture: `ARCHITECTURE.md`
- Current implementation state: `.ai/PROJECT_STATE.md`
- Canonical visual language: `DESIGN.md`

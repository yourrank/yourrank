# Changelog

## [Unreleased]
- **Dashboard consolidation, Wave 2 (#627–#635)**: converged the authenticated dashboard onto single-owner implementations — one canonical chrome-state owner (`packages/shared/src/dashboard-chrome-state.ts`, #627), one client navigation entry point (`requestDashboardRoute` in `assets/dashboard/shell.js`, #628), one-delivery-owner regression gates for Site Settings (#629), Analytics (#630), Sites-list (#631) and the Leaderboard editor (#632), deletion of the duplicate Telegram dashboard shell runtime (#633), manifest-owned legacy dashboard redirects with instrumentation (#634), and a single authenticated dashboard shell structure with a runtime ownership gate (#635).
- **Dashboard redesign, Wave 3 (#636–#641)**: dashboard design foundation with workspace design tokens and consolidated design primitives (#636), shared shell and navigation visual polish (#638), standardized authenticated page chrome (text-led tab strips, page heads, truncating breadcrumbs; sticky offsets derived from `--ws-topbar-h`) (#639), simplified authenticated Home and Sites bodies with narrow-width row stacking (#640), and a simplified Leaderboard editor body with progressive disclosure, a single topbar publish action, a sticky in-column save bar, and multiple mobile overflow fixes (320px checkbox wrapping, History archive row stacking, step selection and sticky-layer collision fixes) (#641).
- **Phase 7 (Site Settings & Account Team)**: Scoped Site Settings archive deletion, Discord/Telegram notification test buttons, and Account Team mutations (role assignment, member removal, invite issuance, revocation) to selected `siteId`.
- **Phase 6 (Rewards & Engagement)**: Added Rewards onboarding flow (ways to earn before shop setup), viewer `/meg` credit and order tracking, Flash Drop claim mechanics with error recovery, giveaway retry states, tournament bracket generation with validation, and idempotent Order redeployment processing.
- **Phase 5 (Vocabulary & Entity Consistency)**: Harmonized domain terminology across operator and viewer interfaces (`Site`, `Leaderboard`, `Player`, `Member`, `Visitor`, `Rewards`, `Credits`, `Order`).
- **Phase 4, 4B & 4C (Navigation Architecture & Auth Hardening)**: Implemented persistent SPA shell navigation (`/dashboard/_content`), unified left-rail navigation with clear data scopes (`Current site` vs global `Account`/`Telegram`), explicit classification of 401 (session expiry) vs 403 (unauthorized) errors, and relocated Kick connection management to Site Settings.
- **Kick connection labels (#610)**: Token now displays as "Renews automatically" and connection state labels were cleaned up.
- **UI redesign wave (#612–#618)**: Quiet light design system rollout across the dashboard: shop card structure and rewards sticky overlap fixes, setup card action row, sample-players alert stacking, public home-CTA pair grid, Engage stage/chat and Games settings alignment, sticky subnav full-width fix, warm tinted canvases with elevated cards and solid cobalt active nav, readable popovers, tip drawer as side panel, fixed preview header contrast, Engage stage stats row, and unified event cards for raffles/drops/predictions with a status-led tournament workspace.
- **Dead pages cleanup (#617)**: Removed the obsolete `/docs` and `/faq` Worker pages and `docs.css`.
- **Agent instruction system (#619)**: Consolidated the agent instruction system into a single `.ai` hierarchy (v7, 95 skills), routing `AGENTS.md` through one skill root; added even contracts for project skills.
- **Handler calling convention & server-authoritative transitions (#620)**: One calling convention for route handlers (`(request, env, deps?)`), fixing nine production routes that threw on injected dependencies; server-authoritative product state transitions (raffle draws with zero tickets refused, Kick channel persisted for tournaments, truthful analytics/export/logout states); one client/server contract for games with no demo balance anywhere (mock API and `?demo=1` mode deleted); native jsonb binding instead of pre-serialization across Worker, bot and packages/shared, with a shared `fromJsonb()` reader and a column-driven static test guarding against regressions; DLQ event body bound natively with the consumer gate gap closed; e2e release gate reports real per-scenario verdicts with explicit SKIPPED states for gated dependencies.
- **Legacy jsonb data repair (#621)**: Allowlisted, reversible repair migration for legacy double-encoded rows (20 columns), with per-row pre-images stored by primary key and a rollback that restores only rows the application has not since edited.
- **CI repair gate (#622)**: Preflight baseline moved to 0 with the production repair result recorded, and the gate step stays alive when the report has zero structural-evidence lines.
- Canonicalized frontend ownership: the apex Leaderboard Worker owns the full application, while `apps/web` now serves only the privileged marketing homepage.
- Hardcheck v5: 7 P0/P1 fixes (setup wizard, WCAG contrast, archive limit, notification settings)
- Hardcheck v5: Security hardening (admin TOTP rate limit, Sentry context tags)
- Hardcheck v5: Dashboard fixes (notification save, test buttons, overlay upgrade link)

## [0.2.0] - 2026-07-04
- Multi-board support (multiple leaderboards per user)
- Custom domains with CNAME verification
- Telegram Stars billing integration
- NOWPayments crypto billing
- Admin 2FA (TOTP)
- Admin audit logging
- Public API endpoints
- OBS overlay widget
- Setup wizard for new users
- Sentry error tracking (toucan-js)
- CSP nonce on bot dashboard
- WCAG 2.2 AA accessibility baseline

## [0.1.0] - 2026-06-25
- Initial release
- Leaderboard SPA with live polling
- Telegram bot integration (!rank, !board commands)
- Session management (KV-backed, cross-worker)
- Rate limiting (fail-closed)
- CSRF double-submit protection
- IP hashing (SHA-256 + salt)
- Token encryption at rest (AES-256-GCM)

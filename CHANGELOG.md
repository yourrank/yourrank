# Changelog

## [Unreleased]
- **Phase 7 (Site Settings & Account Team)**: Scoped Site Settings archive deletion, Discord/Telegram notification test buttons, and Account Team mutations (role assignment, member removal, invite issuance, revocation) to selected `siteId`.
- **Phase 6 (Rewards & Engagement)**: Added Rewards onboarding flow (ways to earn before shop setup), viewer `/me` credit and order tracking, Flash Drop claim mechanics with error recovery, giveaway retry states, tournament bracket generation with validation, and idempotent Order redemption processing.
- **Phase 5 (Vocabulary & Entity Consistency)**: Harmonized domain terminology across operator and viewer interfaces (`Site`, `Leaderboard`, `Player`, `Member`, `Visitor`, `Rewards`, `Credits`, `Order`).
- **Phase 4, 4B & 4C (Navigation Architecture & Auth Hardening)**: Implemented persistent SPA shell navigation (`/dashboard/_content`), unified left-rail navigation with clear data scopes (`Current site` vs global `Account`/`Telegram`), explicit classification of 401 (session expiry) vs 403 (unauthorized) errors, and relocated Kick connection management to Site Settings.
- Canonicalized frontend ownership: the apex Leaderboard Worker owns the full application, while `apps/web` now serves only the proxied marketing homepage.
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
- Session management (KV-backed, cross-Worker)
- Rate limiting (fail-closed)
- CSRF double-submit protection
- IP hashing (SHA-256 + salt)
- Token encryption at rest (AES-256-GCM)

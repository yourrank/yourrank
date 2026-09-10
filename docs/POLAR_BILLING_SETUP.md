# Polar billing connection

The integration is implemented in the Leaderboard Worker. The dashboard remains usable without Polar configuration; paid CTAs stay disabled. No card payment has been executed or tested with Polar yet.

## Connect the account

1. Start with a Polar **sandbox** organization. Create four distinct recurring, fixed-price, USD products. Use a single price per product, no provider trial, and one month/year per billing period.

   | Product | Price | Interval | Worker variable |
   | --- | ---: | --- | --- |
   | Pro monthly | $24 | Month | `POLAR_PRODUCT_PRO_MONTHLY` |
   | Pro annual | $240 | Year | `POLAR_PRODUCT_PRO_ANNUAL` |
   | Team monthly | $69 | Month | `POLAR_PRODUCT_TEAM_MONTHLY` |
   | Team annual | $690 | Year | `POLAR_PRODUCT_TEAM_ANNUAL` |

   These prices come from `packages/shared/src/plans.ts`. The Worker validates each product's price, currency, interval, and organization before creating checkout. Leave an unconfigured interval blank to keep its checkout disabled. Do not reuse one product ID for multiple options or replace IDs used by existing subscriptions without a migration.

2. Add an organization access token with `checkouts:write`, `customers:read`, `customer_sessions:write`, `products:read`, and `orders:read` permissions. Set `POLAR_ACCESS_TOKEN` as a Worker secret. Never put this token in client code or commit it.

3. Set `POLAR_SERVER=sandbox`, `POLAR_ORGANIZATION_ID`, the product IDs above, and `PUBLIC_BASE_URL` to the canonical public origin. Production uses `POLAR_SERVER=production` and `PUBLIC_BASE_URL=https://yourrank.site`. Sandbox and production have different tokens, products, organizations, and webhook secrets.

4. Register a webhook endpoint on Polar:

   `https://yourrank.site/api/billing/webhook/polar`

   For sandbox testing, use the public HTTPS address of your sandbox Worker. Subscribe to **customer.state_changed**, **order.paid**, and **order.refunded**. Copy its signing secret into `POLAR_WEBHOOK_SECRET` using your Worker secret manager. Secrets generated on/after September 8, 2026 use Standard Webhooks; leave `POLAR_WEBHOOK_LEGACY_SECRET` unset. Set it to `true` only for an older Polar HMAC secret.

5. Apply `20260909120000_polar_provider.sql`, `20260909120100_polar_billing.sql`, and `20260909120200_polar_checkout_reservation.sql` in order as separate committed migrations before deploying this Worker. They add nullable unique provider keys, checkout reservations, and a receipt ledger in the existing backend-only `app_private` schema, with explicit `yourrank_app` grants. Existing subscription/payment rows remain valid with NULL provider keys; no uniqueness constraint is added to their existing transaction references. All three migrations are now reflected in the isolated local test database. No production migration was applied.

6. Build shared code and Worker assets, run the repository checks, and deploy the Worker to the sandbox environment. No production deployment is part of this change.

## Before enabling production

Execute with Polar test payment details in sandbox:

- Free account → Pro monthly checkout → payment confirmed → Pro entitlement and payment record.
- Annual checkout → correct total ($240/$690) and annual period.
- Abandoned checkout → return to Billing without paid access; retry reuses the unexpired session.
- Existing subscriber → Manage subscription → invoices/payment method/cancellation and plan changes supported by your Polar portal configuration.
- Renewal → expiry advances once. Failed payment → no new unpaid access period. End-of-period cancellation retains confirmed access; revocation removes Polar access and preserves valid manual/trial grants.
- Duplicate and reordered webhook deliveries → one payment/subscription record, current provider state wins.
- Order refund → payment history shows the refund; subscription access follows Polar subscription state (a refund alone is not an instruction to revoke).
- Forged webhook → 403. Checkout/portal without session or CSRF → rejected.
- Account deletion → recurring subscription must be cancelled first; open or uncertain checkouts block deletion. No account is recreated by late webhooks.

The browser's `?billing=return` is only a status hint. It never grants access. Refresh usage reads the latest locally confirmed plan. Billing availability is derived from configuration, not a fabricated successful payment.

## Failure recovery

Checkout creation has a durable reservation before the non-idempotent Polar request. Concurrent clicks reuse the confirmed URL. A provider timeout or uncertain database write leaves the reservation blocked so another checkout cannot silently be created. The user sees a recoverable support message.

For an uncertain reservation, an operator must inspect Polar for that exact authenticated external customer ID. If a checkout exists, recover its URL and expiry into the account's `app_private.polar_accounts` row, or wait for/revoke it in Polar before clearing the reservation. Never clear an uncertain reservation while a payable checkout can still exist. Do not clear reservations automatically after an arbitrary timeout.

Webhook work and the receipt ledger commit together. A failure returns 500 so Polar can retry; failed events are not marked processed. Redeliver an event from Polar after restoring service. Monitor non-2xx deliveries, which Polar may eventually disable. Do not remove webhook credentials to turn off new sales while existing subscriptions still need renewal/cancellation processing; disable new sales separately in Polar and keep the connection alive.

Database rollback: leave these additive tables/columns in place and roll back application code only. Do not delete payment history or provider IDs. Before enabling production, confirm migration/backups and complete the sandbox checklist above.

## Verification evidence

- PASSED: 14 Polar boundary/lifecycle tests with 73 assertions, including real local PostgreSQL reconciliation, payment replay/refund, failed renewal, deletion guard and uncertain checkout protection. The migration gate also passed (24 combined tests / 132 assertions).
- PASSED: final full repository suite: 2,241 passed, 109 skipped, zero failures. Build, lint, typecheck, migration compatibility and diff whitespace checks passed.
- PASSED: backend-role access to private Polar tables; anon/authenticated lack schema usage. Browser Billing/Usage desktop and 390px review, monthly/annual switching (earlier run), and corrected Insights mobile insets/two-column metrics. Data deletion dialog cancellation was checked earlier.
- The local-only prior Polar tables were empty and aligned to the amended, unshipped migration using a local transaction. The migration compatibility checker and its tests were not weakened. Fresh full-schema migration replay is not claimed.
- NOT VERIFIABLE yet: real Polar sandbox checkout, webhook delivery, portal and invoices; credentials/products are intentionally not configured. Full account-export download also needs the local ACCOUNT_EXPORTS binding.
- No production deployment, migration, commit or push. Streamer audit details: STREAMER_JOURNEY_AUDIT_CHECKLIST.md.

Official contracts checked during implementation: [Checkout](https://polar.sh/docs/features/checkout/session), [customer state](https://polar.sh/docs/integrate/customer-state), [customer portal session](https://polar.sh/docs/api-reference/customer-portal/sessions/create), [webhook signing](https://polar.sh/docs/integrate/webhooks/delivery), and [subscription lifecycle](https://polar.sh/docs/integrate/webhooks/events).

# Viewer export artifact

Viewer exports are separate from streamer/account exports. A viewer must be
authenticated with the `yr_viewer` session cookie; `public_token`, usernames,
provider IDs supplied by the client, and other viewer-supplied identifiers are
never authorization inputs.

The export is queued, written as an NDJSON artifact in R2, and downloaded only
after the Worker re-checks that the authenticated viewer owns the job. It
expires after seven days. One pending or processing export is reused, and
creation is limited to two requests per viewer per hour. Status and download
requests are limited to 60 per viewer per minute.

## R2 availability

The `ACCOUNT_EXPORTS` R2 binding is deliberately deferred until R2 is enabled
for the Cloudflare account. While it is absent, viewer export requests fail
immediately with a temporary-unavailability message; no pending job is
created, and no download is presented.

After enabling R2, restore these exact blocks:

`apps/leaderboard/wrangler.toml` production:

```toml
[[r2_buckets]]
binding = "ACCOUNT_EXPORTS"
bucket_name = "yourrank-account-exports"
```

`apps/leaderboard/wrangler.toml` staging:

```toml
[[env.staging.r2_buckets]]
binding = "ACCOUNT_EXPORTS"
bucket_name = "yourrank-account-exports-staging"
```

`apps/consumer/wrangler.toml` production:

```toml
[[r2_buckets]]
binding = "ACCOUNT_EXPORTS"
bucket_name = "yourrank-account-exports"
```

The consumer configuration currently has no staging environment. If one is
introduced, restore this binding inside its `env.staging` section:

```toml
[[env.staging.r2_buckets]]
binding = "ACCOUNT_EXPORTS"
bucket_name = "yourrank-account-exports-staging"
```

## Collections

The viewer artifact contains only the requesting viewer's records:

- `exportedAt`
- `viewer`
- `sites` — only site slug, name, and channel name for context
- `siteViewers` — the viewer's balances and site relationship
- `creditLedger` — the viewer's own ledger rows with allowlisted metadata
- `redemptions` — the viewer's own redemptions with item context
- `kickRewardEvents` — sanitized events attributable to the viewer's Kick ID
- `viewerUsernameHistory`
- `viewerFeedback` — the viewer's own messages without `ip_hash`

The artifact has a first-line manifest and a final `complete: true` trailer.
The trailer's row counts are authoritative; a missing trailer means the
artifact is incomplete.

## Deliberate exclusions

The following are intentionally absent:

- `viewer_sessions`, session tokens, and token hashes: authentication
  credentials.
- `site_viewers.public_token`: a site-specific bearer credential.
- Kick and Discord OAuth access or refresh tokens, including encrypted values.
- Raw `kick_reward_events.payload`: provider payloads may contain unrelated
  third-party data.
- `provider_events`: raw, difficult-to-attribute provider callbacks.
- `site_visitors`: browser-level pseudonymous identifiers are not viewer-owned
  records.
- `viewer_feedback.ip_hash`: an unnecessary tracking derivative.
- Other viewers' identity, balances, ledger entries, and redemptions.
- Streamer business data such as shop catalogs, reward mappings, stream
  integrations, and site-wide analytics.
- `player_subscriptions`: the current product has no verified
  Telegram-to-viewer identity link. This is a known scope gap, not an
  accidental omission.

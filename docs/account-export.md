# Account export artifact

Account exports use a request → queue → R2 artifact → authenticated download
flow. The Account page shows “Preparing export…” while the job runs, then
provides the authenticated Worker download link. Failed or expired jobs are
visible and can be retried.

The download is one NDJSON file:

1. The first line is a `manifest` containing the export identity, version,
   collection list, and point-in-time row-count estimates.
2. Each data line is `{"table":"…","row":{…}}`.
3. The final line is a `trailer` containing `complete: true` and the actual
   emitted row count for every collection. Consumers must require this trailer
   as the completion marker; a missing trailer indicates a truncated or
   incomplete artifact.

The manifest remains first so the artifact can be streamed immediately. The
trailer is authoritative for what the file actually contains and can be
compared with the manifest to identify changes during export.

## R2 availability

The `ACCOUNT_EXPORTS` R2 binding is deliberately deferred until R2 is enabled
for the Cloudflare account. While it is absent, account export requests fail
immediately with a temporary-unavailability message; no pending job is
created, and the dashboard does not show a job as preparing.

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

## Widened scope and privacy protections

Export version `account-export-v3` includes the account holder's configuration,
owned-site analytics aggregates, credit records, and sanitised viewer-linked
records:

- `viewers`, `siteViewers`, `creditLedger`, `redemptions`,
  `kickRewardEvents`, `viewerUsernameHistory`, and `playerSubscriptions` use
  stable, per-export pseudonyms instead of viewer identifiers. The pseudonym is
  derived from a random export-only salt that is not stored in the artifact,
  so it is stable for reconciliation within one export but cannot be reversed
  by the recipient.
- `siteVisitorStats` contains aggregate visitor counts and first/last-seen
  ranges only. Raw `site_visitors.visitor_hash` values are not exported.
- `creditLedger.metadata` is an explicit allowlisted projection; arbitrary
  JSON fields are discarded.

### Deliberately excluded

The artifact deliberately excludes:

- `viewer_sessions`, because session tokens are bearer credentials.
- `site_viewers.public_token`, because it is a bearer credential.
- Viewer OAuth access and refresh tokens, including encrypted values in
  `viewers`.
- API-key verifier hashes such as `postback_keys.key_hash`.
- Raw `kick_reward_events.payload`, because provider payloads can contain
  third-party personal data and provider-sensitive fields.
- Raw `provider_events`, because they are an unattributed provider callback
  ledger whose payloads can contain third-party payment data.
- Raw `site_visitors`, because their stable hashes are pseudonymous,
  linkable behavioral identifiers. Aggregate visitor statistics are exported
  instead.

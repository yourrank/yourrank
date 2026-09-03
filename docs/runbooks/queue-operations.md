# Queue operations

## Data handling

`yourrank-events` retains unacknowledged messages for 24 hours. Click messages contain:

- a salted SHA-256 IP hash, computed by the bot Worker before enqueue;
- the short-link and random click-reference identifiers required for attribution;
- an optional Telegram user ID required for subscriber segmentation and player attribution.

Raw IP addresses, user-agent strings, referrer URLs, and country headers are not enqueued or persisted with new click records. Raw click rows are rolled up and deleted after 90 days by the nightly bot cron.

## Failed messages

The consumer validates every message against the strict queue schema. Invalid or repeatedly failing messages are retried three times and then moved to `yourrank-events-dlq`.

1. Check `yourrank-consumer` logs for `queue_message_failed`.
2. Fix the producer, schema, provider, or database failure before replaying.
3. Inspect the dead-letter message in Cloudflare Queues and requeue only after confirming that replay is safe for its event type.
4. Confirm `queue_message_processed` appears for the replayed message.

Conversions with a click reference are deduplicated. Clicks, counters, and provider notifications are processed at least once, so replaying them can create duplicates or overcount. Review the event type before replay.

## Rollback

The deploy workflow captures exact production Worker version allocations before migrations. After any failed or cancelled mutation stage, its finalizer re-reads Cloudflare state and restores only changed Leaderboard, Bot, Consumer, or Monitor Workers to those captured versions. Applied migrations remain in place under the expand/N-1 compatibility rule. The manual rollback workflow can deploy a pinned ref for any Worker.

Rollback never applies database migrations. Deployments must keep schema changes backward-compatible with the previous Worker version.

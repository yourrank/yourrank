// Consumer health as seen from the leaderboard /health probe.
//
// Freshness is judged on the cron-driven scheduled heartbeat when present
// (`consumer_heartbeat.name = 'consumer_scheduled'`), falling back to the
// traffic row's last_seen for consumers that predate the split. Zero processed
// work never grants grace: a consumer that has not heartbeated within the
// window is unhealthy regardless of counters.
export const CONSUMER_HEARTBEAT_STALE_SECONDS = 900;

export function evaluateConsumerHealth(
  heartbeat,
  now = Date.now(),
  stalenessWindowSeconds = CONSUMER_HEARTBEAT_STALE_SECONDS
) {
  const failureAt = heartbeat.last_failure_at ? new Date(heartbeat.last_failure_at).getTime() : 0;
  const successAt = heartbeat.last_success_at ? new Date(heartbeat.last_success_at).getTime() : 0;
  const failureRecent = failureAt > 0 && now - failureAt < stalenessWindowSeconds * 1000;
  const failureUnrecovered = failureRecent && successAt < failureAt;
  const scheduledAgo = heartbeat.scheduled_seconds_ago === null || heartbeat.scheduled_seconds_ago === undefined
    ? null
    : Number(heartbeat.scheduled_seconds_ago);
  const heartbeatSource = scheduledAgo !== null && Number.isFinite(scheduledAgo) ? "scheduled" : "traffic";
  const secondsAgo = heartbeatSource === "scheduled" ? scheduledAgo : Number(heartbeat.seconds_ago);
  const fresh = Number.isFinite(secondsAgo) && secondsAgo < stalenessWindowSeconds;
  return {
    healthy: fresh && !failureUnrecovered,
    heartbeat_source: heartbeatSource,
    heartbeat_seconds_ago: Number.isFinite(secondsAgo) ? secondsAgo : null,
    stale: !fresh,
    last_failure_at: heartbeat.last_failure_at ?? null,
    last_success_at: heartbeat.last_success_at ?? null,
  };
}

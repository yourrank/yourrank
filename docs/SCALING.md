# YourRank scaling runbook

This is the short, practical version of the capacity audit. It is written for
the person operating YourRank, not for a developer.

> **Important: every capacity number in this document is a static estimate.**
> No load test has been run. These numbers are arithmetic based on the current
> design, not a promise or a measurement. Turn on the measurements in
> [How to know it is working](#how-to-know-it-is-working) before treating them
> as your real limit.

## The numbers to remember

With the current free-plan setup, use this as the safe planning range:

- **300–500 concurrent viewers** (browser tabs open on boards at the same time)
- **9,000–15,000 viewer-DAU** (viewer daily active users)
- **20–45 requests per second**
- **25–50 database queries per second**

After the required configuration steps below:

- **1,000–1,500 concurrent viewers**
- **30,000–45,000 viewer-DAU**
- **65–115 requests per second**
- **80–150 database queries per second**

These are estimates, not tested limits. “Concurrent viewers” matters more than
registered accounts: an open board tab keeps a live stream connection and
periodically asks whether the board changed.

## Do these changes in this order

Do not treat this list as a menu. Each step removes a different ceiling, and
step 2 is unsafe until step 1 is complete.

### 1. Move Supabase off the free plan

**What this buys viewers:** more database headroom and removal of the free
plan's approximately **5 GB/month public-egress cap**. Egress is data sent from
the database to the application; hitting the cap makes normal pages and live
updates unreliable.

**What it costs:** approximately **$25/month** for the paid starting plan.
Check the current price shown in Supabase before confirming; vendor prices can
change.

**Do this:**

1. Open the Supabase dashboard and select the YourRank project.
2. Open **Billing** (or **Organization billing**) and choose the paid plan.
3. Confirm the plan and payment method.
4. Return to the project overview and confirm the project is no longer on the
   free plan.

**You know it worked when:** the project billing page shows the paid plan and
the usage page no longer shows the free-plan 5 GB egress ceiling as the active
limit. Do not continue to step 2 until that is true.

### 2. Raise Hyperdrive's origin connection limit

Hyperdrive is Cloudflare's database connection pool. The current pool is
limited to about **20 origin connections**. After step 1, change it to about
**100** in the Cloudflare dashboard.

**What this buys viewers:** more simultaneous database work before requests
wait for a connection, reducing slow dashboard pages and live-board delays
during a busy stream.

**Why step 1 must come first:** Supabase Nano currently permits about **60
connections**, with approximately **24 already in use while idle**. A 100
connection Hyperdrive pool would be allowed to open more connections than
Supabase can accept. Doing this first would exhaust Supabase's connection
limit and cause an outage rather than adding capacity.

**Do this:**

1. Open the Cloudflare dashboard and select the YourRank account.
2. Open **Workers & Pages → Hyperdrive**.
3. Open the Hyperdrive configuration used by the Workers.
4. Find **Origin connection limit** and change **20** to approximately **100**.
5. Save the configuration.

**You know it worked when:** the configuration shows the new limit and the
Hyperdrive connection-acquisition errors do not increase in Worker logs during
normal traffic. Watch Supabase active connections too; they should remain below
its new plan's limit with headroom.

### 3. Enable R2 and turn on exports

R2 is Cloudflare's object storage. It stores the account and viewer export
files.

**What this buys viewers:** working data exports instead of an unavailable
export message.

**What it costs:** R2 storage and requests are usage-priced; the amount depends
on how many exports are created and how large they are. There is no useful
fixed monthly estimate until exports are enabled and measured.

**Do this:**

1. Open the Cloudflare dashboard and select the YourRank account.
2. Open **R2 Object Storage** and enable R2 if prompted.
3. Create these two buckets, using the names exactly:
   - `yourrank-account-exports`
   - `yourrank-account-exports-staging`
4. Revert **PR #441**, “Defer unavailable R2 export bindings”. This restores
   the R2 bindings and turns the export feature on.

The Cloudflare API cannot enable R2. If an API attempt returns **code 10042**,
“Please enable R2 through the Cloudflare Dashboard,” use the dashboard steps
above; that response is expected.

**You know it worked when:** the two buckets exist, the deploy's Worker
configuration lists the `ACCOUNT_EXPORTS` binding, and an export reaches
“Preparing” and then downloads successfully. The exact restore blocks and
privacy behavior are documented in
[account-export.md](account-export.md) and
[viewer-export.md](viewer-export.md).

### 4. Create an isolated staging database

Staging is a safe copy of the application for testing. **The current staging
Hyperdrive configuration points at the production database.** Do not run a
load test against it today: that would load-test the live service.

**What this buys viewers:** safer improvements. You can test a capacity change
before it affects real boards, accounts, games, or exports.

**What it costs:** a second Supabase project and its monthly database cost;
the exact price depends on the size selected. Start with the smallest paid
size that can hold a realistic fixture, then increase it only when the test
requires it.

**Do this:**

1. In Supabase, create a second project named clearly as staging.
2. Apply the migrations and seed realistic data: a small board, an active
   board, a large board, a games/credits board, and thousands of viewers.
3. In Cloudflare **Workers & Pages → Hyperdrive**, create a staging
   configuration pointing only to that staging database.
4. Set the staging Worker environments to use that Hyperdrive configuration.
5. Confirm the staging hostname cannot reach the production database before
   running a test.
6. Use the guarded test instructions in
   [load-test.js](load-test.js). It refuses the known production hostname and
   requires an explicit non-production target.

**You know it worked when:** a staging-only test row appears in staging and
the same row does not appear in production.

### 5. Rotate credentials

**What this buys viewers:** it removes long-lived access if credentials have
been exposed or copied during setup. It does not increase capacity.

**What it costs:** no service charge; it requires a short, planned deployment
because applications must receive the replacement credentials.

**Do this:**

1. In Cloudflare, create a replacement API credential with only the permissions
   the deployment needs.
2. Update the repository's encrypted CI secrets and deployment secrets.
3. Verify a dry run and deployment with the replacement credential.
4. Revoke the old Cloudflare global API key.
5. Create a replacement GitHub PAT with the minimum required permissions.
6. Update the secret store and verify one authenticated repository operation.
7. Revoke the old GitHub PAT.

**You know it worked when:** deployment succeeds with the new credentials and
an operation using each old credential fails. Never put either secret in this
document, an issue, or a commit.

## Already done in code

These are not action items:

- **Region placement** (`aws:eu-west-1`) is set for the leaderboard and bot
  Workers so those request paths run next to the Supabase database; each
  statement round trip drops from ~80-250 ms cross-region to a few ms. The
  asynchronous queue consumer and the edge-local monitor keep default
  placement.
- **Bounded analytics timeouts** apply only to the expensive analytics reads.
  They use a five-second transaction-local limit, so one slow tenant cannot
  hold a shared database connection for the server's roughly 120-second
  timeout. Ordinary writes, migrations, backfills, cron work, and unrelated
  reads are not globally changed.

## Going beyond 1,500 concurrent viewers

Do not scale by viewer count alone. Use the signal in each stage. These are
rough cost directions, not quotes.

### Around 10,000 concurrent viewers: remove the polling bottleneck

**Change these in roughly this order:**

1. Enable the board Durable Object fan-out after staging measurement. It is
   disabled by default and retains the existing SSE wire contract. Configure
   `LIVE_BOARD_PUSH_ENABLED`, `LIVE_BOARD_FALLBACK_POLL_MS`, and
   `LIVE_BOARD_MAX_SUBSCRIBERS`; use `LIVE_BOARD_STREAM_KILL_SWITCH` to shed
   SSE without a deploy. See [Live-board stream controls](live-board-push.md).
   A push update tells connected browsers only when a board changes, instead of
   every browser asking repeatedly. The DO still performs one bounded,
   per-board fallback poll while subscribers are active.
2. Add a per-board stream limit and a WAF (Web Application Firewall) rule.
   This stops one abusive or viral board from consuming the whole database.
3. Move analytics to maintained rollups and keep the five-second timeout.
   A rollup is a precomputed total, so the dashboard does not scan a site's
   entire history for every request.
4. Batch queue-consumer writes and keep cron work at bounded concurrency.
5. Keep public board reads bounded and cache anonymous HTML where correctness
   allows it.
6. Move Supabase to a larger paid size if database CPU or connections, rather
   than the Worker, becomes the first measured limit.

**The trigger is a metric or symptom, not “we reached 10,000”:**

- Supabase CPU stays above **80% for 60 seconds** during a normal peak.
- Database queries per second continue rising almost linearly with open tabs.
- Stream update intervals slip, or many viewers see reconnects.
- Hyperdrive reports **“Failed to acquire a connection from the pool.”**
- Board-render p95 exceeds **1.5 seconds**, or HTTP failures exceed **1%**.

**Viewer impact if you wait too long:** boards update late, pages become slow,
and one busy tenant can make unrelated boards slow. A short-lived CPU spike is
not by itself a reason to redesign; confirm the trigger with the metrics below.

**Cost direction:** application work is the main cost (engineering time);
Durable Objects and Worker usage add usage charges. A larger Supabase plan is a
monthly cost increase, but it is a stopgap, not a substitute for removing
linear polling.

### Around 100,000 concurrent viewers: isolate the platform

This is a different operating model, not just a larger pool.

1. Put public board reads on a read path or read replicas with explicitly
   documented staleness.
2. Move analytics off the transactional database.
3. Add per-tenant quotas and isolation so one board cannot consume the shared
   database.
4. Partition and retain high-growth tables such as game rounds, credit ledger,
   and visitor history.
5. Shard hot rate-limit keys across Durable Objects and regions.
6. Separate the leaderboard database from bot and background workloads.
7. Use multiple regions or databases where the audience and data model require
   it.

**Triggers:**

- A single tenant consumes a sustained, disproportionate share of database CPU
  or connections.
- Public reads and writes compete for database capacity even after polling is
  removed.
- Read replicas are needed to keep page p95 healthy while writes remain
  healthy.
- Queue backlog or bot work grows while board traffic is healthy, or vice versa.
- A regional incident makes an otherwise healthy audience fail together.

**Viewer impact if you wait too long:** one viral board, bot outage, or
analytics scan can degrade unrelated boards; recovery becomes a coordinated
incident rather than a single slow page.

**Cost direction:** expect a substantial architecture and operations increase:
larger or dedicated databases, replicas, extra Worker/Durable Object usage,
more monitoring, and potentially multiple regions. Do not buy this capacity
before the signals show that the 10,000-viewer design is actually under
pressure.

### Deliberately ignore these for now

The audit found no capacity benefit from early work on index tuning, classic
request-path N+1 cleanup, `OFFSET` pagination, WebSocket scaling, or weakening
security controls. The important code limits are already bounded in the merged
work; the remaining ceiling is measured database and live-stream pressure.
Do not increase connection pools, add regions, or split databases because a
static estimate looks uncomfortable. Measure the symptom first.

## How to know it is working

`REQUEST_METRICS=true` enables safe per-request measurements in the leaderboard
Worker. It must also be enabled by the request-metrics wrapper; the setting is
deliberately opt-in.

**Turn it on:**

1. Open the Worker environment variables in the Cloudflare dashboard.
2. Set `REQUEST_METRICS` to `true` for the environment you want to observe.
3. Deploy the Worker.
4. Open the Worker **Logs/Observability** view and filter for
   `msg = "request_metrics"`.

Each line reports:

- `site`: the board slug, when the request belongs to a board; no email,
  username, viewer ID, cookie, or secret.
- `route`: a safe route group, such as a board or API route.
- `db_queries`: database statements attempted, including transaction statements
  and retries. If this rises, the database is doing more work.
- `duration_ms`: total request time. This is what a viewer experiences.
- `cache`: whether public HTML was a cache `hit`, `miss`, or `bypass`.
- `payload_bytes`: response size. Larger responses cost more egress and take
  longer to download.

**Use it in practice:**

1. Group logs by `site` and `route`.
2. Compare p95 `duration_ms` for small and popular boards.
3. Sum `db_queries` during the same period and compare with Supabase CPU and
   active connections.
4. Watch whether cache hits have zero board-render queries.
5. Check `payload_bytes` before and after a large-board or “load more” change.

The metrics replace the static arithmetic in this runbook with observations.
Keep the audit's [tenant metrics guide](tenant-request-metrics.md) nearby for
field details.

## What breaks first, and what it looks like

The expected failure chain is:

1. Supabase CPU or connections saturate.
2. Hyperdrive cannot obtain an origin connection quickly enough.
3. Workers return 500s or pages become very slow.
4. Live streams disconnect.
5. Browsers automatically reconnect together.
6. Those reconnects create another burst of database work, making the outage
   worse.

**What you will notice:**

- Viewer reports of a board that stops updating or repeatedly reconnects.
- A sudden rise in Worker 500s.
- `Failed to acquire a connection from the pool` in Worker logs.
- Supabase CPU above 80% or active connections near its limit.
- `duration_ms` and board-render p95 rising together.

**What to do immediately:**

1. Check Cloudflare Worker logs and Supabase usage; do not restart everything
   blindly.
2. Identify whether one board or route dominates `site` and `route`.
3. Pause a load test or nonessential bulk job.
4. Do not raise Hyperdrive's connection limit unless Supabase has already been
   upgraded and still has connection headroom.
5. Record the time, affected board(s), CPU, active connections, p95 duration,
   and error count before changing capacity settings.

This is why the runbook says to measure first: a larger pool cannot fix a
database that is already CPU-bound, and blindly increasing it can turn a slow
service into a full outage.

## Existing detailed references

- [Capacity audit](CAPACITY_AUDIT.md) — measurements, assumptions, arithmetic,
  and the complete bottleneck analysis.
- [Load-test harness](load-test.js) — guarded k6 stages for isolated staging.
- [Per-tenant request metrics](tenant-request-metrics.md) — metric fields and
  log queries.
- [Account export](account-export.md) — export availability and R2 restore
  instructions.
- [Viewer export](viewer-export.md) — viewer scope, exclusions, and R2 restore
  instructions.

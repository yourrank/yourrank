// Creator dashboard list pagination against a real migrated Postgres:
// canonical /api/claims and /api/people/members keyset cursors must reach a
// dataset larger than one page, search the complete dataset, never duplicate
// or skip a record, stay site-isolated, and keep complete/cancel transitions
// working. Skips when AUDIT_TEST_DATABASE_URL is unset.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { handleCreatorClaims, handleCreatorClaimTransition } from "../handlers/claims.js";
import { handlePeopleMembers } from "../handlers/people.js";
import { handleCloseActivity, handleGetActivities } from "../handlers/activities.js";
import { handleClaimCodeDrop } from "../handlers/events.js";

const databaseUrl = process.env.AUDIT_TEST_DATABASE_URL || "";
const integrationIt = (name, fn) => (databaseUrl ? it : it.skip)(name, fn, 60000);
const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
const ownerId = crypto.randomUUID();
const otherOwnerId = crypto.randomUUID();
const siteId = crypto.randomUUID();
const otherSiteId = crypto.randomUUID();
const itemId = crypto.randomUUID();
const otherItemId = crypto.randomUUID();
const site = { id: siteId, user_id: ownerId, slug: `dl-${suffix}`, name: "List site" };
const otherSite = { id: otherSiteId, user_id: otherOwnerId, slug: `dl-other-${suffix}`, name: "Other site" };
const MEMBERS = 130;
const CLAIMS = 130;
const DROPS = 63;
const dropIds = [];
const otherDropId = crypto.randomUUID();
const viewerIds = [];
const membershipIds = [];
const redemptionIds = [];
const otherViewerId = crypto.randomUUID();
const otherMembershipId = crypto.randomUUID();
const otherRedemptionId = crypto.randomUUID();
let sql;
let oldUrl;

const creatorDeps = (ownSite = site) => ({
  requireUser: async () => ({ user: { id: ownSite.user_id }, res: null }),
  getByUser: async () => ownSite,
  getBoardById: async (_env, userId, id) => (userId === ownSite.user_id && id === ownSite.id ? ownSite : null),
  requireSiteCapability: async () => ({ role: "owner", res: null }),
  rateLimit: async () => ({ ok: true }),
});
const get = (path) => new Request(`https://yourrank.site${path}`);
const claims = (params = "", ownSite = site) =>
  handleCreatorClaims(get(`/api/claims?siteId=${ownSite.id}${params}`), {}, creatorDeps(ownSite));
const members = (params = "", ownSite = site) =>
  handlePeopleMembers(get(`/api/people/members?siteId=${ownSite.id}${params}`), {}, creatorDeps(ownSite));
const activities = (params = "", ownSite = site) =>
  handleGetActivities(get(`/api/activities?siteId=${ownSite.id}${params}`), {}, creatorDeps(ownSite));
const closeActivity = (activityId, ownSite = site) =>
  handleCloseActivity(new Request("https://yourrank.site/api/activities/close", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ siteId: ownSite.id, activityId }),
  }), {}, creatorDeps(ownSite));
const claimDrop = (code, viewerId, ownSite = site) =>
  handleClaimCodeDrop(new Request("https://yourrank.site/api/events/drops/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ site: ownSite.slug, code }),
  }), {}, {
    rateLimit: async () => ({ ok: true }),
    requireViewer: async () => ({ viewer: { id: viewerId }, res: null }),
    resolveJoinableCommunity: async (_request, _env, slug) => (slug === ownSite.slug ? ownSite : null),
    markActive: async () => {},
  });

const viewerRow = (id, overrides) => ({
  id, kick_user_id: null, kick_username: null, kick_linked_at: null,
  discord_user_id: null, discord_username: null, discord_linked_at: null, ...overrides,
});

async function collect(fetchPage, key) {
  const ids = [];
  let cursor = null;
  let pages = 0;
  for (;;) {
    const res = await fetchPage(cursor);
    if (res.status !== 200) throw new Error(`page ${pages} failed: ${res.status} ${await res.text()}`);
    const body = await res.json();
    pages++;
    ids.push(...body[key].map((row) => row.id));
    if (!body.page.hasMore) return { ids, pages, unique: new Set(ids).size };
    cursor = body.page.nextCursor;
    if (pages > 50) throw new Error("runaway pagination");
  }
}

beforeAll(async () => {
  if (!databaseUrl) return;
  const parsed = new URL(databaseUrl);
  if (!["127.0.0.1", "localhost", "[::1]", "postgres"].includes(parsed.hostname) || !/test|e2e/.test(parsed.pathname)) throw new Error("A disposable local test database is required");
  sql = postgres(databaseUrl, { max: 4, prepare: false, onnotice: () => {} });
  await sql`INSERT INTO users (id, email, display_name, status, email_verified)
    VALUES (${ownerId}, ${`dl-${suffix}@yourrank.test`}, 'List owner', 'active', true),
           (${otherOwnerId}, ${`dl-other-${suffix}@yourrank.test`}, 'Other owner', 'active', true)`;
  await sql`INSERT INTO sites (id, user_id, slug, name, published, is_draft)
    VALUES (${siteId}, ${ownerId}, ${site.slug}, ${site.name}, true, false),
           (${otherSiteId}, ${otherOwnerId}, ${otherSite.slug}, ${otherSite.name}, true, false)`;
  await sql`INSERT INTO shop_items (id, site_id, name, cost) VALUES
    (${itemId}, ${siteId}, 'VIP role', 10), (${otherItemId}, ${otherSiteId}, 'Other reward', 10)`;

  const viewers = [];
  const memberships = [];
  const redemptions = [];
  for (let i = 0; i < MEMBERS; i++) {
    const viewerId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
    viewerIds.push(viewerId);
    membershipIds.push(membershipId);
    const username = i === MEMBERS - 1 ? `zzlast_${suffix}` : `member${String(i).padStart(3, "0")}_${suffix}`;
    // The mirror trigger turns legacy kick/discord columns into generic
    // `viewer_identities` rows; the last member has a legacy username but no
    // provider link at all, so it must be neither named nor searchable.
    if (i === MEMBERS - 1) {
      viewers.push(viewerRow(viewerId, { kick_username: username }));
    } else if (i % 2 === 0) {
      viewers.push(viewerRow(viewerId, { kick_user_id: `dl-${suffix}-${i}`, kick_username: username, kick_linked_at: new Date() }));
    } else {
      viewers.push(viewerRow(viewerId, { discord_user_id: `dl-${suffix}-${i}`, discord_username: username, discord_linked_at: new Date() }));
    }
    // Ties on balance + activity timestamps stress the id tie-breaker.
    memberships.push({
      id: membershipId, site_id: siteId, viewer_id: viewerId,
      balance: i % 7, created_at: new Date(Date.UTC(2026, 0, 1, 0, i % 5)),
      last_seen_at: new Date(Date.UTC(2026, 0, 2, 0, i % 3)), blocked: i % 11 === 0,
    });
  }
  for (let i = 0; i < CLAIMS; i++) {
    const id = crypto.randomUUID();
    redemptionIds.push(id);
    redemptions.push({
      id, site_viewer_id: membershipIds[i % MEMBERS], shop_item_id: itemId, cost: 10,
      status: i % 10 === 9 ? "fulfilled" : "pending",
      created_at: new Date(Date.UTC(2026, 1, 1, 0, i % 4)),
    });
  }
  viewers.push(viewerRow(otherViewerId, { kick_user_id: `dl-${suffix}-other`, kick_username: `member000_${suffix}`, kick_linked_at: new Date() }));
  await sql`INSERT INTO viewers ${sql(viewers)}`;
  const identityCount = await sql`SELECT count(*)::int AS n FROM viewer_identities WHERE viewer_id IN ${sql(viewerIds)} AND status='active'`;
  if (identityCount[0].n !== MEMBERS - 1) throw new Error(`expected ${MEMBERS - 1} mirrored identities, got ${identityCount[0].n}`);
  memberships.push({ id: otherMembershipId, site_id: otherSiteId, viewer_id: otherViewerId, balance: 999, created_at: new Date(), last_seen_at: new Date(), blocked: false });
  await sql`INSERT INTO site_viewers ${sql(memberships)}`;
  redemptions.push({ id: otherRedemptionId, site_viewer_id: otherMembershipId, shop_item_id: otherItemId, cost: 10, status: "pending", created_at: new Date() });
  await sql`INSERT INTO redemptions ${sql(redemptions)}`;
  // Drops share created_at timestamps in bunches so the id tie-breaker matters.
  const drops = [];
  for (let i = 0; i < DROPS; i++) {
    const id = crypto.randomUUID();
    dropIds.push(id);
    drops.push({
      id, site_id: siteId, code: `DROP${String(i).padStart(3, "0")}`, points_reward: 10, max_claims: 5,
      claimed_count: i % 6, status: i % 9 === 8 ? "exhausted" : "active",
      created_at: new Date(Date.UTC(2026, 2, 1, 0, Math.floor(i / 4))),
    });
  }
  drops.push({ id: otherDropId, site_id: otherSiteId, code: "OTHER", points_reward: 10, max_claims: 5, claimed_count: 0, status: "active", created_at: new Date() });
  await sql`INSERT INTO code_drops ${sql(drops)}`;

  oldUrl = process.env.DATABASE_URL;
  const worker = new URL(databaseUrl);
  worker.username = "yourrank_worker";
  process.env.DATABASE_URL = worker.toString();
});
afterAll(async () => {
  if (!sql) return;
  await sql`DELETE FROM sites WHERE id IN (${siteId}, ${otherSiteId})`;
  await sql`DELETE FROM viewers WHERE id IN ${sql([...viewerIds, otherViewerId])}`;
  await sql`DELETE FROM users WHERE id IN (${ownerId}, ${otherOwnerId})`;
  await sql.end({ timeout: 0 });
  if (oldUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = oldUrl;
});

describe("canonical claims list (Postgres)", () => {
  integrationIt("reaches every claim beyond 100 through cursor pages with no duplicates or gaps", async () => {
    const result = await collect((cursor) => claims(`&status=all&limit=50${cursor ? `&cursor=${cursor}` : ""}`), "claims");
    expect(result.pages).toBe(3);
    expect(result.ids).toHaveLength(CLAIMS);
    expect(result.unique).toBe(CLAIMS);
    expect(new Set(result.ids)).toEqual(new Set(redemptionIds.map((id) => `redemption:${id}`)));
    expect(result.ids).not.toContain(`redemption:${otherRedemptionId}`);
  });

  integrationIt("orders pending oldest-first before settled claims and paginates the default filter", async () => {
    const first = await (await claims("&limit=100")).json();
    expect(first.filter).toBe("action_required");
    expect(first.total).toBe(CLAIMS - CLAIMS / 10);
    expect(first.page.hasMore).toBe(true);
    const submitted = first.claims.map((c) => c.submittedAt);
    expect([...submitted].sort()).toEqual(submitted);
    expect(first.claims.every((c) => c.status === "submitted")).toBe(true);

    const all = await (await claims("&status=all&limit=100")).json();
    const statuses = all.claims.map((c) => c.status);
    expect(statuses.slice(0, 100).every((s) => s === "submitted")).toBe(true);
    const completed = await (await claims("&status=completed")).json();
    expect(completed.claims).toHaveLength(CLAIMS / 10);
    expect(completed.claims.every((c) => c.status === "completed")).toBe(true);
  });

  integrationIt("searches the whole dataset by member or reward name, past page one", async () => {
    const target = `zzlast_${suffix}`;
    const res = await (await claims(`&status=all&q=${encodeURIComponent(target)}`)).json();
    expect(res.claims).toHaveLength(1);
    expect(res.claims[0].subject.displayName).toBe(target);
    expect(res.total).toBeNull();

    const byItem = await collect((cursor) => claims(`&status=all&q=vip&limit=100${cursor ? `&cursor=${cursor}` : ""}`), "claims");
    expect(byItem.unique).toBe(CLAIMS);

    const escaped = await (await claims(`&status=all&q=${encodeURIComponent("%")}`)).json();
    expect(escaped.claims).toHaveLength(0);
  });

  integrationIt("rejects a cursor that belongs to another site or was never issued", async () => {
    const foreign = await claims(`&status=all&cursor=${otherRedemptionId}`);
    expect(foreign.status).toBe(410);
    const missing = await claims(`&status=all&cursor=${crypto.randomUUID()}`);
    expect(missing.status).toBe(410);
    const malformed = await claims("&status=all&cursor=not-a-cursor");
    expect(malformed.status).toBe(400);
    const other = await (await claims("&status=all", otherSite)).json();
    expect(other.claims.map((c) => c.id)).toEqual([`redemption:${otherRedemptionId}`]);
  });

  integrationIt("completes and cancels through the canonical transition and reorders the queue", async () => {
    const [toComplete, toCancel] = redemptionIds;
    const post = (id, action) => handleCreatorClaimTransition(new Request(`https://yourrank.site/api/claims/redemption:${id}/transition?siteId=${siteId}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }),
    }), {}, creatorDeps());
    const done = await post(toComplete, "complete");
    expect(done.status).toBe(200);
    expect((await done.json()).claim.status).toBe("completed");
    const cancelled = await post(toCancel, "cancel");
    expect(cancelled.status).toBe(200);
    expect((await cancelled.json()).claim.status).toBe("cancelled");

    const replay = await post(toComplete, "complete");
    expect(replay.status).toBe(200);
    const conflict = await post(toComplete, "cancel");
    expect(conflict.status).toBe(409);

    const cross = await handleCreatorClaimTransition(new Request(`https://yourrank.site/api/claims/redemption:${redemptionIds[2]}/transition?siteId=${otherSiteId}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "complete" }),
    }), {}, creatorDeps(otherSite));
    expect(cross.status).toBe(404);

    const all = await collect((cursor) => claims(`&status=all&limit=60${cursor ? `&cursor=${cursor}` : ""}`), "claims");
    expect(all.unique).toBe(CLAIMS);
    const pending = await (await claims("&limit=100")).json();
    expect(pending.total).toBe(CLAIMS - CLAIMS / 10 - 2);
    expect(pending.claims.map((c) => c.id)).not.toContain(`redemption:${toComplete}`);
  });
});

describe("people members list (Postgres)", () => {
  integrationIt("reaches every member beyond 100 in each sort mode without duplicates or gaps", async () => {
    for (const sort of ["activity", "balance", "status"]) {
      const result = await collect((cursor) => members(`&sort=${sort}&limit=40${cursor ? `&cursor=${cursor}` : ""}`), "members");
      expect(result.pages).toBe(4);
      expect(result.unique).toBe(MEMBERS);
      expect(new Set(result.ids)).toEqual(new Set(membershipIds));
      expect(result.ids).not.toContain(otherMembershipId);
    }
    const first = await (await members("&sort=balance&limit=10")).json();
    expect(first.total).toBe(MEMBERS);
    const balances = first.members.map((m) => m.balance);
    expect([...balances].sort((a, b) => b - a)).toEqual(balances);
  });

  integrationIt("finds a member outside page one through generic identities of any provider", async () => {
    const kick = await (await members(`&q=${encodeURIComponent(`member128_${suffix}`)}`)).json();
    expect(kick.members.map((m) => m.displayName)).toEqual([`member128_${suffix}`]);
    expect(kick.members[0].linkedIdentities).toEqual([{ provider: "Kick", displayName: `member128_${suffix}` }]);
    expect(kick.total).toBeNull();
    const discord = await (await members(`&q=${encodeURIComponent(`member127_${suffix}`)}`)).json();
    expect(discord.members.map((m) => m.displayName)).toEqual([`member127_${suffix}`]);
    expect(discord.members[0].linkedIdentities).toEqual([{ provider: "Discord", displayName: `member127_${suffix}` }]);
    const prefix = await collect((cursor) => members(`&q=member&limit=50${cursor ? `&cursor=${cursor}` : ""}`), "members");
    expect(prefix.unique).toBe(MEMBERS - 1);
    // An unlinked legacy username is not an identity: not shown, not matched.
    const unlinked = await (await members(`&q=${encodeURIComponent(`zzlast_${suffix}`)}`)).json();
    expect(unlinked.members).toEqual([]);
    // The other site's member shares a username but must never leak.
    const shared = await (await members(`&q=${encodeURIComponent(`member000_${suffix}`)}`)).json();
    expect(shared.members.map((m) => m.id)).toEqual([membershipIds[0]]);
    const none = await (await members("&q=nobody-here")).json();
    expect(none.members).toEqual([]);
    expect(none.page).toEqual({ hasMore: false, nextCursor: null, limit: 25 });
  });

  integrationIt("rejects foreign or expired cursors and unsupported sorts", async () => {
    expect((await members(`&cursor=${otherMembershipId}`)).status).toBe(410);
    expect((await members(`&cursor=${crypto.randomUUID()}`)).status).toBe(410);
    expect((await members("&cursor=oops")).status).toBe(400);
    expect((await members("&sort=fraud")).status).toBe(400);
    const other = await (await members("", otherSite)).json();
    expect(other.members.map((m) => m.id)).toEqual([otherMembershipId]);
    expect(JSON.stringify(other)).not.toMatch(/viewer_id|kick_user_id|fraud/);
  });
});

describe("activities history list (Postgres)", () => {
  integrationIt("reaches every activity beyond the first page, newest first, without duplicates or skips", async () => {
    const first = await (await activities("&limit=5")).json();
    expect(first.activities).toHaveLength(5);
    expect(first.total).toBe(DROPS);
    expect(first.page).toMatchObject({ limit: 5, hasMore: true });
    expect(first.automation).toBeDefined();

    const walked = await collect((cursor) => activities(`&limit=5${cursor ? `&cursor=${cursor}` : ""}`), "activities");
    expect(walked.pages).toBe(Math.ceil(DROPS / 5));
    expect(walked.ids).toHaveLength(DROPS);
    expect(walked.unique).toBe(DROPS);
    expect(new Set(walked.ids)).toEqual(new Set(dropIds.map((id) => `drop:${id}`)));
    expect(walked.ids).not.toContain(`drop:${otherDropId}`);

    const expected = await sql`SELECT id FROM code_drops WHERE site_id=${siteId} ORDER BY created_at DESC, id DESC`;
    expect(walked.ids).toEqual(expected.map((row) => `drop:${row.id}`));

    // The default page still covers the old 50-row window and reports more.
    const defaults = await (await activities()).json();
    expect(defaults.activities).toHaveLength(50);
    expect(defaults.page.hasMore).toBe(true);
    const rest = await (await activities(`&cursor=${defaults.page.nextCursor}`)).json();
    expect(rest.activities).toHaveLength(DROPS - 50);
    expect(rest.page).toEqual({ limit: 50, hasMore: false, nextCursor: null });
    expect(rest.automation).toBeUndefined();
  });

  integrationIt("keeps drop states and rejects foreign, expired or malformed cursors", async () => {
    const all = await collect((cursor) => activities(`&limit=100${cursor ? `&cursor=${cursor}` : ""}`), "activities");
    expect(all.pages).toBe(1);
    const page = await (await activities("&limit=100")).json();
    expect(page.activities.filter((a) => a.stateLabel === "Claimed out")).toHaveLength(dropIds.filter((_, i) => i % 9 === 8).length);

    expect((await activities(`&cursor=${otherDropId}`)).status).toBe(410);
    expect((await activities(`&cursor=${crypto.randomUUID()}`)).status).toBe(410);
    expect((await activities("&cursor=oops")).status).toBe(400);
    const other = await (await activities("", otherSite)).json();
    expect(other.activities.map((a) => a.id)).toEqual([`drop:${otherDropId}`]);
    expect(other.total).toBe(1);
  });
});

describe("creator-controlled Code Drop closure (Postgres)", () => {
  integrationIt("ends an open drop, keeps earlier claims, and rejects claims after closure", async () => {
    const dropId = dropIds[0];
    const before = await claimDrop("DROP000", viewerIds[1]);
    expect(before.status).toBe(200);

    const closed = await (await closeActivity(`drop:${dropId}`)).json();
    expect(closed).toMatchObject({ changed: true, activity: { state: "completed", stateLabel: "Ended by creator", actions: { canEnd: false } } });
    expect(closed.activity.progress.claimed).toBe(1);

    const after = await claimDrop("DROP000", viewerIds[2]);
    expect(after.status).toBe(400);
    expect((await after.json()).error).toBe("This drop has ended.");

    const [row] = await sql`SELECT status, claimed_count::int AS claimed_count, closed_at FROM code_drops WHERE id=${dropId}`;
    expect(row).toMatchObject({ status: "expired", claimed_count: 1 });
    expect(row.closed_at).toBeTruthy();
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM code_drop_claims WHERE code_drop_id=${dropId}`;
    expect(n).toBe(1);
    const [audit] = await sql`SELECT entity_id FROM audit_log WHERE action='code_drop_close' AND entity_id=${dropId}`;
    expect(audit?.entity_id).toBe(dropId);

    const listed = await (await activities("&limit=100")).json();
    expect(listed.activities.find((a) => a.id === `drop:${dropId}`)).toMatchObject({ stateLabel: "Ended by creator", actions: { canEnd: false } });
  });

  integrationIt("is idempotent, refuses exhausted drops, and never crosses sites", async () => {
    const again = await closeActivity(`drop:${dropIds[0]}`);
    expect(again.status).toBe(200);
    expect((await again.json()).changed).toBe(false);

    const exhausted = await closeActivity(dropIds[8]);
    expect(exhausted.status).toBe(409);
    expect((await exhausted.json()).activity.stateLabel).toBe("Claimed out");

    expect((await closeActivity(`drop:${otherDropId}`)).status).toBe(404);
    expect((await closeActivity(dropIds[1], otherSite)).status).toBe(404);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM code_drops WHERE id IN (${otherDropId}, ${dropIds[1]}) AND status='active'`;
    expect(n).toBe(2);
  });
});

// Claim support conversations against a real migrated Postgres: viewer and
// creator authorization is derived from claim ownership, one open request per
// claim, replies on both sides, Needs attention filtering, resolve ->
// read-only. Connects as yourrank_worker so table grants are exercised too.
// Skips when CLAIM_SUPPORT_TEST_DATABASE_URL (or AUDIT_TEST_DATABASE_URL) is unset.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import {
  handleCreatorClaimSupport,
  handleCreatorClaimSupportReply,
  handleCreatorClaimSupportResolve,
  handleViewerClaimSupport,
  handleViewerClaimSupportCreate,
  handleViewerClaimSupportReply,
} from "../handlers/claim-support.js";
import { handleCreatorClaims, handleViewerClaimDetail } from "../handlers/claims.js";
import { handleContact } from "../handlers/contact.js";

const databaseUrl = process.env.CLAIM_SUPPORT_TEST_DATABASE_URL || process.env.AUDIT_TEST_DATABASE_URL || "";
const integrationIt = (name, fn) => (databaseUrl ? it : it.skip)(name, fn, 60000);
const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const ownerId = crypto.randomUUID();
const otherOwnerId = crypto.randomUUID();
const siteId = crypto.randomUUID();
const otherSiteId = crypto.randomUUID();
const viewerId = crypto.randomUUID();
const otherViewerId = crypto.randomUUID();
const membershipId = crypto.randomUUID();
const otherMembershipId = crypto.randomUUID();
const itemId = crypto.randomUUID();
const claimSourceId = crypto.randomUUID();
const plainClaimSourceId = crypto.randomUUID();
const otherViewerClaimSourceId = crypto.randomUUID();
const CLAIM_ID = `redemption:${claimSourceId}`;
const site = { id: siteId, user_id: ownerId, slug: `cs-${suffix}`, name: "Claim support site" };
const otherSite = { id: otherSiteId, user_id: otherOwnerId, slug: `cs-other-${suffix}`, name: "Other creator" };
let sql;
let oldUrl;

const viewerDeps = (viewer = { id: viewerId }) => ({
  requireViewer: async () => ({ viewer, res: null }),
  rateLimit: async () => ({ ok: true }),
});
const creatorDeps = (user = { id: ownerId }, ownSite = site) => ({
  requireUser: async () => ({ user, res: null }),
  getByUser: async () => ownSite,
  getBoardById: async (_env, userId, id) => (userId === ownSite.user_id && id === ownSite.id ? ownSite : null),
  requireSiteCapability: async () => ({ role: "owner", res: null }),
  rateLimit: async () => ({ ok: true }),
});
const post = (path, body) => new Request(`https://yourrank.site${path}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}),
});
const get = (path) => new Request(`https://yourrank.site${path}`);
const viewerSupport = (claimId, viewer) => handleViewerClaimSupport(get(`/api/viewer/claims/${claimId}/support`), {}, viewerDeps(viewer));
const viewerCreate = (claimId, body, viewer) => handleViewerClaimSupportCreate(post(`/api/viewer/claims/${claimId}/support`, body), {}, viewerDeps(viewer));
const viewerReply = (claimId, message, viewer) => handleViewerClaimSupportReply(post(`/api/viewer/claims/${claimId}/support/messages`, { message }), {}, viewerDeps(viewer));
const creatorSupport = (claimId, user, ownSite) => handleCreatorClaimSupport(get(`/api/claims/${claimId}/support?siteId=${(ownSite || site).id}`), {}, creatorDeps(user, ownSite));
const creatorReply = (claimId, message) => handleCreatorClaimSupportReply(post(`/api/claims/${claimId}/support/messages?siteId=${siteId}`, { message }), {}, creatorDeps());
const creatorResolve = (claimId) => handleCreatorClaimSupportResolve(post(`/api/claims/${claimId}/support/resolve?siteId=${siteId}`), {}, creatorDeps());
const creatorClaims = (filter) => handleCreatorClaims(get(`/api/claims?siteId=${siteId}&status=${filter}`), {}, creatorDeps());

beforeAll(async () => {
  if (!databaseUrl) return;
  const parsed = new URL(databaseUrl);
  if (!["127.0.0.1", "localhost", "[::1]", "postgres"].includes(parsed.hostname) || !/test|e2e/.test(parsed.pathname)) throw new Error("A disposable local test database is required");
  sql = postgres(databaseUrl, { max: 4, prepare: false, onnotice: () => {} });
  await sql`INSERT INTO users (id, email, display_name, status, email_verified)
    VALUES (${ownerId}, ${`cs-${suffix}@yourrank.test`}, 'Claim support owner', 'active', true),
           (${otherOwnerId}, ${`cs-other-${suffix}@yourrank.test`}, 'Other owner', 'active', true)`;
  await sql`INSERT INTO sites (id, user_id, slug, name, published, is_draft)
    VALUES (${siteId}, ${ownerId}, ${site.slug}, ${site.name}, true, false),
           (${otherSiteId}, ${otherOwnerId}, ${otherSite.slug}, ${otherSite.name}, true, false)`;
  await sql`INSERT INTO viewers (id, kick_user_id, kick_username, kick_linked_at)
    VALUES (${viewerId}, ${`kick-${suffix}`}, ${`ates_${suffix}`}, now()),
           (${otherViewerId}, ${`kick-other-${suffix}`}, ${`other_${suffix}`}, now())`;
  await sql`INSERT INTO site_viewers (id, site_id, viewer_id) VALUES
    (${membershipId}, ${siteId}, ${viewerId}), (${otherMembershipId}, ${siteId}, ${otherViewerId})`;
  await sql`INSERT INTO shop_items (id, site_id, name, cost) VALUES (${itemId}, ${siteId}, 'VIP role', 250)`;
  await sql`INSERT INTO redemptions (id, site_viewer_id, shop_item_id, cost, status) VALUES
    (${claimSourceId}, ${membershipId}, ${itemId}, 250, 'fulfilled'),
    (${plainClaimSourceId}, ${membershipId}, ${itemId}, 250, 'fulfilled'),
    (${otherViewerClaimSourceId}, ${otherMembershipId}, ${itemId}, 250, 'pending')`;
  oldUrl = process.env.DATABASE_URL;
  const worker = new URL(databaseUrl);
  worker.username = "yourrank_worker";
  process.env.DATABASE_URL = worker.toString();
});
afterAll(async () => {
  if (!sql) return;
  await sql`DELETE FROM sites WHERE id IN (${siteId}, ${otherSiteId})`;
  await sql`DELETE FROM viewers WHERE id IN (${viewerId}, ${otherViewerId})`;
  await sql`DELETE FROM users WHERE id IN (${ownerId}, ${otherOwnerId})`;
  await sql.end({ timeout: 0 });
  if (oldUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = oldUrl;
});

describe("claim support conversations (Postgres)", () => {
  integrationIt("a claim without a support request reads as plain claim for both sides", async () => {
    const viewer = await viewerSupport(CLAIM_ID);
    const body = await viewer.json();
    expect(viewer.status).toBe(200);
    expect(body.support).toBeNull();
    expect(body.claim.id).toBe(CLAIM_ID);
    expect(body.issueTypes.map((i) => i.value)).toEqual(["reward_not_received", "wrong_or_invalid_reward", "taking_too_long", "other"]);

    const detail = await handleViewerClaimDetail(get(`/api/viewer/claims/${CLAIM_ID}`), {}, viewerDeps());
    expect(detail.status).toBe(200);
    expect((await detail.json()).claim.support).toBeNull();

    const attention = await (await creatorClaims("needs_attention")).json();
    expect(attention.claims.map((c) => c.id)).toEqual([`redemption:${otherViewerClaimSourceId}`]);
    expect(attention.counts.needsAttention).toBe(1);
  });

  integrationIt("viewer cannot open support for another viewer's claim", async () => {
    const res = await viewerCreate(`redemption:${otherViewerClaimSourceId}`, { issueType: "reward_not_received", message: "not mine" });
    expect(res.status).toBe(404);
    const rows = await sql`SELECT count(*)::int AS n FROM claim_support_requests WHERE claim_id=${otherViewerClaimSourceId}`;
    expect(rows[0].n).toBe(0);
  });

  integrationIt("viewer opens a support request for their own claim; creator of the same community sees it", async () => {
    const created = await viewerCreate(CLAIM_ID, { issueType: "reward_not_received", message: "I haven't received my reward yet." });
    const body = await created.json();
    expect(created.status).toBe(201);
    expect(body.created).toBe(true);
    expect(body.support.status).toBe("open");
    expect(body.support.claimId).toBe(CLAIM_ID);
    expect(body.support.issueLabel).toBe("Reward not received");
    expect(body.support.messages).toHaveLength(1);
    expect(body.support.messages[0]).toMatchObject({ senderType: "viewer", message: "I haven't received my reward yet." });

    const creator = await creatorSupport(CLAIM_ID);
    const view = await creator.json();
    expect(creator.status).toBe(200);
    expect(view.support.messages[0].senderName).toBe(`ates_${suffix}`);
    expect(view.claim.support).toEqual({ status: "open", issueType: "reward_not_received" });

    const stored = await sql`SELECT viewer_id, claim_id FROM claim_support_requests WHERE claim_id=${claimSourceId}`;
    expect(stored).toEqual([{ viewer_id: viewerId, claim_id: claimSourceId }]);
  });

  integrationIt("another creator cannot read, reply to or resolve it", async () => {
    const otherUser = { id: otherOwnerId };
    const read = await creatorSupport(CLAIM_ID, otherUser, otherSite);
    expect(read.status).toBe(404);
    const reply = await handleCreatorClaimSupportReply(
      post(`/api/claims/${CLAIM_ID}/support/messages?siteId=${otherSiteId}`, { message: "hijack" }), {}, creatorDeps(otherUser, otherSite));
    expect(reply.status).toBe(404);
    const resolve = await handleCreatorClaimSupportResolve(
      post(`/api/claims/${CLAIM_ID}/support/resolve?siteId=${otherSiteId}`), {}, creatorDeps(otherUser, otherSite));
    expect(resolve.status).toBe(404);
    // A creator who claims someone else's siteId is refused by getBoardById.
    const spoof = await handleCreatorClaimSupport(get(`/api/claims/${CLAIM_ID}/support?siteId=${siteId}`), {}, creatorDeps(otherUser, otherSite));
    expect(spoof.status).toBe(404);
    const messages = await sql`SELECT count(*)::int AS n FROM claim_support_messages m JOIN claim_support_requests q ON q.id=m.support_request_id WHERE q.claim_id=${claimSourceId}`;
    expect(messages[0].n).toBe(1);
  });

  integrationIt("another viewer cannot read the conversation", async () => {
    const res = await viewerSupport(CLAIM_ID, { id: otherViewerId });
    expect(res.status).toBe(404);
    const reply = await viewerReply(CLAIM_ID, "not my claim", { id: otherViewerId });
    expect(reply.status).toBe(404);
  });

  integrationIt("a second open request is not created; the existing conversation is returned", async () => {
    const [a, b] = await Promise.all([
      viewerCreate(CLAIM_ID, { issueType: "taking_too_long", message: "duplicate one" }),
      viewerCreate(CLAIM_ID, { issueType: "other", message: "duplicate two" }),
    ]);
    for (const res of [a, b]) {
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.existing).toBe(true);
      expect(body.support.issueType).toBe("reward_not_received");
    }
    const rows = await sql`SELECT count(*)::int AS n FROM claim_support_requests WHERE claim_id=${claimSourceId} AND status='open'`;
    expect(rows[0].n).toBe(1);
  });

  integrationIt("open support puts the claim in Needs attention even when the claim itself is completed", async () => {
    const attention = await (await creatorClaims("needs_attention")).json();
    const ids = attention.claims.map((c) => c.id);
    expect(ids[0]).toBe(CLAIM_ID);
    expect(ids).toContain(`redemption:${otherViewerClaimSourceId}`);
    expect(ids).not.toContain(`redemption:${plainClaimSourceId}`);
    expect(attention.counts.needsAttention).toBe(2);
    const completed = await (await creatorClaims("completed")).json();
    expect(completed.claims.find((c) => c.id === CLAIM_ID).support).toEqual({ status: "open", issueType: "reward_not_received" });
    expect(completed.claims.find((c) => c.id === `redemption:${plainClaimSourceId}`).support).toBeNull();
  });

  integrationIt("creator and viewer reply in turn; the thread stays attached to the claim", async () => {
    const creator = await creatorReply(CLAIM_ID, "I'm checking this now.");
    expect(creator.status).toBe(200);
    const viewer = await viewerReply(CLAIM_ID, "Thanks.");
    expect(viewer.status).toBe(200);
    const thread = (await (await viewerSupport(CLAIM_ID)).json()).support;
    expect(thread.messages.map((m) => [m.senderType, m.message])).toEqual([
      ["viewer", "I haven't received my reward yet."],
      ["creator", "I'm checking this now."],
      ["viewer", "Thanks."],
    ]);
    expect(thread.messages[1].senderName).toBe(site.name);

    const otherClaim = (await (await viewerSupport(`redemption:${plainClaimSourceId}`)).json()).support;
    expect(otherClaim).toBeNull();
  });

  integrationIt("rejects empty and oversized messages", async () => {
    expect((await viewerReply(CLAIM_ID, "   ")).status).toBe(400);
    expect((await viewerReply(CLAIM_ID, "x".repeat(2001))).status).toBe(400);
    expect((await viewerCreate(`redemption:${plainClaimSourceId}`, { issueType: "priority_escalation", message: "hi" })).status).toBe(400);
  });

  integrationIt("creator marks resolved; history stays visible and replies are disabled", async () => {
    const resolved = await creatorResolve(CLAIM_ID);
    const body = await resolved.json();
    expect(resolved.status).toBe(200);
    expect(body.resolved).toBe(true);
    expect(body.support.status).toBe("resolved");
    expect(body.support.canReply).toBe(false);
    expect(body.support.resolvedAt).toBeTruthy();
    expect(body.support.messages).toHaveLength(3);

    expect((await viewerReply(CLAIM_ID, "one more")).status).toBe(409);
    expect((await creatorReply(CLAIM_ID, "one more")).status).toBe(409);
    const again = await creatorResolve(CLAIM_ID);
    expect((await again.json()).resolved).toBe(false);

    const viewerView = (await (await viewerSupport(CLAIM_ID)).json()).support;
    expect(viewerView.status).toBe("resolved");
    expect(viewerView.messages).toHaveLength(3);

    const attention = await (await creatorClaims("needs_attention")).json();
    expect(attention.claims.map((c) => c.id)).not.toContain(CLAIM_ID);
    expect(attention.counts.needsAttention).toBe(1);
  });

  integrationIt("claim support never touches YourRank support (support_messages)", async () => {
    const before = await sql`SELECT count(*)::int AS n FROM support_messages`;
    const contactSql = [];
    const res = await handleContact(post("/api/contact", { name: "Viewer", email: "viewer@example.com", message: "Generic account question." }), {}, {
      rateLimit: async () => ({ ok: true }),
      exec: async (text) => { contactSql.push(text); return [{ id: "receipt", created: true }]; },
      sendEmail: async () => ({ ok: true }),
    });
    expect(res.status).toBe(200);
    expect(contactSql.join("\n")).toContain("support_messages");
    expect(contactSql.join("\n")).not.toContain("claim_support");
    // ...and the claim flow above wrote nothing to the generic inbox.
    const after = await sql`SELECT count(*)::int AS n FROM support_messages`;
    expect(after[0].n).toBe(before[0].n);
    const claimMessages = await sql`SELECT count(*)::int AS n FROM claim_support_messages m JOIN claim_support_requests q ON q.id=m.support_request_id WHERE q.claim_id=${claimSourceId}`;
    expect(claimMessages[0].n).toBe(3);
  });
});

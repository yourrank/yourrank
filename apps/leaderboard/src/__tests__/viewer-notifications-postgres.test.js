// Transactional viewer notifications against a real migrated Postgres: one
// notification per claim completion / cancellation / creator support reply /
// support resolution, idempotent retries, viewer-only read access, unread
// counts, mark-one / mark-all read, precise claim/support hrefs, and the domain
// transition committing even when the notification insert fails.
// Connects as yourrank_worker so table grants are exercised too.
// Skips when CLAIM_SUPPORT_TEST_DATABASE_URL (or AUDIT_TEST_DATABASE_URL) is unset.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { withTransaction } from "@yourrank/shared/db";
import { handleCreatorClaimTransition } from "../handlers/claims.js";
import { transitionRedemptionClaimStatus } from "../handlers/credits.js";
import {
  handleCreatorClaimSupportReply,
  handleCreatorClaimSupportResolve,
  handleViewerClaimSupportCreate,
} from "../handlers/claim-support.js";
import {
  handleViewerNotificationRead,
  handleViewerNotifications,
  handleViewerNotificationsReadAll,
  insertViewerNotificationTx,
} from "../handlers/viewer-notifications.js";

const databaseUrl = process.env.CLAIM_SUPPORT_TEST_DATABASE_URL || process.env.AUDIT_TEST_DATABASE_URL || "";
const integrationIt = (name, fn) => (databaseUrl ? it : it.skip)(name, fn, 60000);
const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
const ownerId = crypto.randomUUID();
const siteId = crypto.randomUUID();
const viewerId = crypto.randomUUID();
const otherViewerId = crypto.randomUUID();
const membershipId = crypto.randomUUID();
const otherMembershipId = crypto.randomUUID();
const itemId = crypto.randomUUID();
const completeSourceId = crypto.randomUUID();
const cancelSourceId = crypto.randomUUID();
const supportSourceId = crypto.randomUUID();
const otherViewerSourceId = crypto.randomUUID();
const failingSourceId = crypto.randomUUID();
const slug = `vn-${suffix}`;
const site = { id: siteId, user_id: ownerId, slug, name: "Notify site" };
let sql;
let oldUrl;

const viewerDeps = (viewer = { id: viewerId }) => ({
  requireViewer: async () => ({ viewer, res: null }),
  rateLimit: async () => ({ ok: true }),
});
const creatorDeps = () => ({
  requireUser: async () => ({ user: { id: ownerId }, res: null }),
  getByUser: async () => site,
  getBoardById: async (_env, userId, id) => (userId === ownerId && id === siteId ? site : null),
  requireSiteCapability: async () => ({ role: "owner", res: null }),
  rateLimit: async () => ({ ok: true }),
});
const post = (path, body) => new Request(`https://yourrank.site${path}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}),
});
const get = (path) => new Request(`https://yourrank.site${path}`);
const transition = (sourceId, action) => handleCreatorClaimTransition(post(`/api/claims/redemption:${sourceId}/transition?siteId=${siteId}`, { action }), {}, creatorDeps());
const creatorReply = (sourceId, message) => handleCreatorClaimSupportReply(post(`/api/claims/redemption:${sourceId}/support/messages?siteId=${siteId}`, { message }), {}, creatorDeps());
const creatorResolve = (sourceId) => handleCreatorClaimSupportResolve(post(`/api/claims/redemption:${sourceId}/support/resolve?siteId=${siteId}`), {}, creatorDeps());
const list = (viewer) => handleViewerNotifications(get("/api/viewer/notifications"), {}, viewerDeps(viewer)).then((r) => r.json());
const readOne = (id, viewer) => handleViewerNotificationRead(post(`/api/viewer/notifications/${id}/read`), {}, viewerDeps(viewer));
const readAll = (viewer) => handleViewerNotificationsReadAll(post("/api/viewer/notifications/read-all"), {}, viewerDeps(viewer));
const rowsFor = (viewer, type) => sql`SELECT * FROM viewer_notifications WHERE viewer_id=${viewer} AND type=${type} ORDER BY created_at`;

beforeAll(async () => {
  if (!databaseUrl) return;
  const parsed = new URL(databaseUrl);
  if (!["127.0.0.1", "localhost", "[::1]", "postgres"].includes(parsed.hostname) || !/test|e2e/.test(parsed.pathname)) throw new Error("A disposable local test database is required");
  sql = postgres(databaseUrl, { max: 4, prepare: false, onnotice: () => {} });
  await sql`INSERT INTO users (id, email, display_name, status, email_verified)
    VALUES (${ownerId}, ${`vn-${suffix}@yourrank.test`}, 'Notify owner', 'active', true)`;
  await sql`INSERT INTO sites (id, user_id, slug, name, published, is_draft)
    VALUES (${siteId}, ${ownerId}, ${slug}, ${site.name}, true, false)`;
  await sql`INSERT INTO viewers (id, kick_user_id, kick_username, kick_linked_at)
    VALUES (${viewerId}, ${`kick-${suffix}`}, ${`ates_${suffix}`}, now()),
           (${otherViewerId}, ${`kick-other-${suffix}`}, ${`other_${suffix}`}, now())`;
  await sql`INSERT INTO site_viewers (id, site_id, viewer_id) VALUES
    (${membershipId}, ${siteId}, ${viewerId}), (${otherMembershipId}, ${siteId}, ${otherViewerId})`;
  await sql`INSERT INTO shop_items (id, site_id, name, cost) VALUES (${itemId}, ${siteId}, 'Discord Nitro', 250)`;
  await sql`INSERT INTO redemptions (id, site_viewer_id, shop_item_id, cost, status) VALUES
    (${completeSourceId}, ${membershipId}, ${itemId}, 250, 'pending'),
    (${cancelSourceId}, ${membershipId}, ${itemId}, 250, 'pending'),
    (${supportSourceId}, ${membershipId}, ${itemId}, 250, 'fulfilled'),
    (${failingSourceId}, ${membershipId}, ${itemId}, 250, 'pending'),
    (${otherViewerSourceId}, ${otherMembershipId}, ${itemId}, 250, 'pending')`;
  oldUrl = process.env.DATABASE_URL;
  const worker = new URL(databaseUrl);
  worker.username = "yourrank_worker";
  process.env.DATABASE_URL = worker.toString();
});
afterAll(async () => {
  if (!sql) return;
  await sql`DELETE FROM sites WHERE id = ${siteId}`;
  await sql`DELETE FROM viewers WHERE id IN (${viewerId}, ${otherViewerId})`;
  await sql`DELETE FROM users WHERE id = ${ownerId}`;
  await sql.end({ timeout: 0 });
  if (oldUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = oldUrl;
});

describe("viewer notifications (Postgres)", () => {
  integrationIt("a viewer with no notifications gets an empty list and zero unread", async () => {
    const body = await list();
    expect(body).toEqual({ ok: true, notifications: [], unreadCount: 0 });
  });

  integrationIt("claim completion creates exactly one notification; retrying is a no-op", async () => {
    expect((await transition(completeSourceId, "complete")).status).toBe(200);
    expect((await transition(completeSourceId, "complete")).status).toBe(200);
    const rows = await rowsFor(viewerId, "claim_completed");
    expect(rows).toHaveLength(1);
    expect(rows[0].claim_id).toBe(completeSourceId);
    expect(rows[0].site_id).toBe(siteId);
    expect(rows[0].title).toBe("Your Discord Nitro claim was completed");
    expect(rows[0].href).toBe(`/${slug}/activity?claim=redemption%3A${completeSourceId}#membership-claims`);
    expect(rows[0].read_at).toBeNull();
  });

  integrationIt("claim cancellation creates exactly one notification and still refunds once", async () => {
    expect((await transition(cancelSourceId, "cancel")).status).toBe(200);
    expect((await transition(cancelSourceId, "cancel")).status).toBe(200);
    const rows = await rowsFor(viewerId, "claim_cancelled");
    expect(rows).toHaveLength(1);
    expect(rows[0].claim_id).toBe(cancelSourceId);
    expect(rows[0].body).toContain("refunded");
    const refunds = await sql`SELECT count(*)::int AS n FROM credit_ledger WHERE site_viewer_id=${membershipId} AND type='revoke' AND description='Cancelled redemption refund'`;
    expect(refunds[0].n).toBe(1);
  });

  integrationIt("creator support reply notifies the viewer once per message; the viewer's own messages do not", async () => {
    const opened = await handleViewerClaimSupportCreate(post(`/api/viewer/claims/redemption:${supportSourceId}/support`, { issueType: "reward_not_received", message: "Still waiting on Nitro." }), {}, viewerDeps());
    expect(opened.status).toBe(201);
    expect(await rowsFor(viewerId, "claim_support_reply")).toHaveLength(0);

    expect((await creatorReply(supportSourceId, "Checking this now, one moment.")).status).toBe(200);
    const rows = await rowsFor(viewerId, "claim_support_reply");
    expect(rows).toHaveLength(1);
    expect(rows[0].claim_id).toBe(supportSourceId);
    expect(rows[0].title).toBe("Notify site replied to your Discord Nitro claim");
    expect(rows[0].body).toBe("Checking this now, one moment.");
    expect(rows[0].href).toBe(`/${slug}/activity?claim=redemption%3A${supportSourceId}&support=1#membership-claims`);
    const request = await sql`SELECT id FROM claim_support_requests WHERE claim_id=${supportSourceId}`;
    expect(rows[0].support_request_id).toBe(request[0].id);

    expect((await creatorReply(supportSourceId, "Second reply.")).status).toBe(200);
    expect(await rowsFor(viewerId, "claim_support_reply")).toHaveLength(2);
  });

  integrationIt("support resolution creates one notification; resolving again does not duplicate", async () => {
    expect((await creatorResolve(supportSourceId)).status).toBe(200);
    const again = await creatorResolve(supportSourceId);
    expect([200, 409]).toContain(again.status);
    const rows = await rowsFor(viewerId, "claim_support_resolved");
    expect(rows).toHaveLength(1);
    expect(rows[0].href).toContain("support=1");
    expect(rows[0].title).toBe("Your Discord Nitro support request was resolved");
  });

  integrationIt("the list is viewer-scoped, unread-first, newest-first, with a correct unread count", async () => {
    expect((await transition(otherViewerSourceId, "complete")).status).toBe(200);
    const body = await list();
    expect(body.unreadCount).toBe(5);
    expect(body.notifications).toHaveLength(5);
    expect(body.notifications.map((n) => n.type)).toEqual([
      "claim_support_resolved", "claim_support_reply", "claim_support_reply", "claim_cancelled", "claim_completed",
    ]);
    expect(body.notifications.every((n) => n.read === false && n.readAt === null)).toBe(true);
    expect(body.notifications.every((n) => n.href.startsWith(`/${slug}/activity?claim=redemption%3A`))).toBe(true);
    expect(body.notifications.find((n) => n.claimId === `redemption:${otherViewerSourceId}`)).toBeUndefined();

    const other = await list({ id: otherViewerId });
    expect(other.unreadCount).toBe(1);
    expect(other.notifications.map((n) => n.claimId)).toEqual([`redemption:${otherViewerSourceId}`]);
  });

  integrationIt("a viewer cannot mark another viewer's notification read", async () => {
    const [foreign] = await rowsFor(otherViewerId, "claim_completed");
    const res = await readOne(foreign.id);
    expect(res.status).toBe(404);
    const [after] = await sql`SELECT read_at FROM viewer_notifications WHERE id=${foreign.id}`;
    expect(after.read_at).toBeNull();
    expect((await readOne("not-a-uuid")).status).toBe(404);
  });

  integrationIt("reading one notification updates its state and the unread count; reading again keeps the first timestamp", async () => {
    const [target] = await rowsFor(viewerId, "claim_completed");
    const res = await readOne(target.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notification.id).toBe(target.id);
    expect(body.notification.read).toBe(true);
    expect(body.unreadCount).toBe(4);
    const first = body.notification.readAt;

    const again = await (await readOne(target.id)).json();
    expect(new Date(again.notification.readAt).getTime()).toBe(new Date(first).getTime());
    expect(again.unreadCount).toBe(4);

    const listed = await list();
    expect(listed.notifications.at(-1).id).toBe(target.id);
    expect(listed.notifications.at(-1).read).toBe(true);
  });

  integrationIt("mark all as read clears only this viewer's unread notifications", async () => {
    const res = await readAll();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, updated: 4, unreadCount: 0 });
    expect((await list()).unreadCount).toBe(0);
    expect((await list({ id: otherViewerId })).unreadCount).toBe(1);
  });

  integrationIt("a failing notification insert does not block the claim transition", async () => {
    const failingTx = (tx) => ({
      one: tx.one.bind(tx),
      query: tx.query.bind(tx),
      unsafe: (text, params) => {
        if (/INSERT INTO viewer_notifications/.test(String(text))) throw new Error("notifications unavailable");
        return tx.unsafe(text, params);
      },
      savepoint: (fn) => tx.savepoint((inner) => fn(failingTx(inner))),
    });
    const result = await withTransaction((tx) => transitionRedemptionClaimStatus(failingTx(tx), {
      siteId, userId: ownerId, sourceId: failingSourceId, nextStatus: "fulfilled",
    }));
    expect(result).toEqual({ id: failingSourceId, status: "fulfilled", replayed: false });
    const [claim] = await sql`SELECT status FROM redemptions WHERE id=${failingSourceId}`;
    expect(claim.status).toBe("fulfilled");
    const audits = await sql`SELECT count(*)::int AS n FROM audit_log WHERE entity_id=${`redemption:${failingSourceId}`} AND action='claim_completed'`;
    expect(audits[0].n).toBe(1);
    const rows = await sql`SELECT count(*)::int AS n FROM viewer_notifications WHERE claim_id=${failingSourceId}`;
    expect(rows[0].n).toBe(0);
  });

  integrationIt("a constraint failure is rolled back to the savepoint and the transaction stays usable", async () => {
    const result = await withTransaction(async (tx) => {
      const inserted = await insertViewerNotificationTx(tx, {
        type: "claim_completed", viewerId, siteId, claimId: completeSourceId,
        dedupeKey: `bad-href:${suffix}`, title: "Bad", body: "", href: "https://evil.example/phish",
      });
      const probe = await tx.one("SELECT 1 AS ok", []);
      return { inserted, probe };
    });
    expect(result.inserted).toEqual({ inserted: false });
    expect(result.probe).toEqual({ ok: 1 });
    const rows = await sql`SELECT count(*)::int AS n FROM viewer_notifications WHERE dedupe_key=${`bad-href:${suffix}`}`;
    expect(rows[0].n).toBe(0);
  });
});

import { describe, expect, it } from "bun:test";
import {
  VIEWER_NOTIFICATION_TYPES,
  claimNotificationSpec,
  handleViewerNotificationRead,
  handleViewerNotifications,
  handleViewerNotificationsReadAll,
  insertViewerNotificationTx,
  viewerClaimHref,
} from "../handlers/viewer-notifications.js";

const claim = {
  source_id: "11111111-1111-4111-8111-111111111111",
  viewer_id: "viewer-1",
  site_id: "site-1",
  site_slug: "kjkj",
  site_name: "kjkj",
  item_name: "Discord Nitro",
};
const viewer = { id: "viewer-1" };
const deps = (over = {}) => ({
  requireViewer: async () => ({ viewer, res: null }),
  rateLimit: async () => ({ ok: true }),
  one: async () => undefined,
  query: async () => [],
  exec: async () => [],
  ...over,
});
const req = (path, method = "GET") => new Request(`https://yourrank.site${path}`, { method });

describe("viewer notification specs", () => {
  it("builds same-origin hrefs that open the claim, and the support dialog for support events", () => {
    expect(viewerClaimHref({ siteSlug: "kjkj", claimId: claim.source_id })).toBe(
      `/kjkj/activity?claim=redemption%3A${claim.source_id}#membership-claims`,
    );
    expect(viewerClaimHref({ siteSlug: "we/ird", claimId: "x", support: true })).toBe(
      "/we%2Fird/activity?claim=redemption%3Ax&support=1#membership-claims",
    );
  });

  it("derives every field from the validated claim row", () => {
    for (const type of VIEWER_NOTIFICATION_TYPES) {
      const spec = claimNotificationSpec(type, claim, { messageId: "m1", message: "  hi\n there ", supportRequestId: "sr1" });
      expect(spec.viewerId).toBe("viewer-1");
      expect(spec.siteId).toBe("site-1");
      expect(spec.claimId).toBe(claim.source_id);
      expect(spec.href.startsWith("/kjkj/activity?claim=")).toBe(true);
      expect(spec.title).toContain("Discord Nitro");
    }
    const reply = claimNotificationSpec("claim_support_reply", claim, { messageId: "m1", message: "  hi\n there " });
    expect(reply).toMatchObject({ dedupeKey: "claim_support_reply:m1", title: "kjkj replied to your Discord Nitro claim", body: "hi there" });
    expect(reply.href).toContain("support=1");
    const done = claimNotificationSpec("claim_completed", claim);
    expect(done.dedupeKey).toBe(`claim_completed:${claim.source_id}`);
    expect(done.href).not.toContain("support=1");
    expect(claimNotificationSpec("claim_support_reply", claim, { messageId: "m2", message: "x".repeat(400) }).body).toHaveLength(140);
    expect(claimNotificationSpec("marketing_blast", claim)).toBeNull();
  });

  it("skips incomplete specs and swallows insert failures", async () => {
    expect(await insertViewerNotificationTx({ unsafe: async () => { throw new Error("no"); } }, null)).toEqual({ inserted: false });
    const calls = [];
    const tx = {
      savepoint: async (fn) => fn(tx),
      unsafe: async (text, params) => { calls.push({ text, params }); return [{ id: "n1" }]; },
    };
    const spec = claimNotificationSpec("claim_completed", claim);
    expect(await insertViewerNotificationTx(tx, spec)).toEqual({ inserted: true, id: "n1" });
    expect(calls[0].text).toContain("ON CONFLICT (dedupe_key) DO NOTHING");
    expect(calls[0].params).toEqual(["viewer-1", "claim_completed", "site-1", claim.source_id, null, spec.dedupeKey, spec.title, spec.body, spec.href]);
    const failing = { savepoint: async () => { throw new Error("relation missing"); }, unsafe: async () => [] };
    expect(await insertViewerNotificationTx(failing, spec)).toEqual({ inserted: false });
  });
});

describe("viewer notification API", () => {
  it("requires a viewer session and passes the denial through with a private cache header", async () => {
    const res = await handleViewerNotifications(req("/api/viewer/notifications"), {}, deps({
      requireViewer: async () => ({ viewer: null, res: new Response("no", { status: 401 }) }),
    }));
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("lists only the signed-in viewer's rows and reports the unread count", async () => {
    const seen = [];
    const res = await handleViewerNotifications(req("/api/viewer/notifications"), {}, deps({
      query: async (text, params) => { seen.push({ text, params }); return [{ id: "n1", type: "claim_completed", claim_id: "c1", title: "t", href: "/kjkj/activity", read_at: null, created_at: "2026-01-01T00:00:00Z" }]; },
      one: async (text, params) => { seen.push({ text, params }); return { unread: 3 }; },
    }));
    const body = await res.json();
    expect(body.unreadCount).toBe(3);
    expect(body.notifications).toEqual([expect.objectContaining({ id: "n1", claimId: "redemption:c1", read: false })]);
    expect(seen.every((c) => c.params[0] === "viewer-1" && /viewer_id=\$1/.test(c.text))).toBe(true);
    expect(seen[0].text).toContain("ORDER BY (read_at IS NULL) DESC");
    expect(seen[0].text).toContain("LIMIT 10");
  });

  it("marks one notification read only when it belongs to the viewer", async () => {
    const id = "22222222-2222-4222-8222-222222222222";
    let params;
    const ok = await handleViewerNotificationRead(req(`/api/viewer/notifications/${id}/read`, "POST"), {}, deps({
      one: async (text, p) => {
        if (text.startsWith("UPDATE")) { params = p; return { id, type: "claim_completed", read_at: "2026-01-01T00:00:00Z" }; }
        return { unread: 0 };
      },
    }));
    expect(ok.status).toBe(200);
    expect(params).toEqual([id, "viewer-1"]);
    expect((await ok.json()).notification.read).toBe(true);

    const missing = await handleViewerNotificationRead(req(`/api/viewer/notifications/${id}/read`, "POST"), {}, deps({ one: async () => undefined }));
    expect(missing.status).toBe(404);
    const bogus = await handleViewerNotificationRead(req("/api/viewer/notifications/evil/read", "POST"), {}, deps());
    expect(bogus.status).toBe(404);
  });

  it("marks all read for the viewer only", async () => {
    let params;
    const res = await handleViewerNotificationsReadAll(req("/api/viewer/notifications/read-all", "POST"), {}, deps({
      exec: async (text, p) => { params = p; expect(text).toContain("WHERE viewer_id=$1 AND read_at IS NULL"); return [{ id: "a" }, { id: "b" }]; },
    }));
    expect(await res.json()).toEqual({ ok: true, updated: 2, unreadCount: 0 });
    expect(params).toEqual(["viewer-1"]);
  });

  it("rate limits", async () => {
    const res = await handleViewerNotifications(req("/api/viewer/notifications"), {}, deps({ rateLimit: async () => ({ ok: false }) }));
    expect(res.status).toBe(429);
  });
});

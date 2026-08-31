import { describe, expect, it } from "bun:test";
import { handleViewerJoin, handleViewerMe } from "../handlers/viewer-dashboard.js";
import { csrfCookie } from "../middleware/csrf.js";
import { getViewerSiteData } from "../site-data.js";

const viewer = { id: "viewer-a", kick_username: "member" };
const allowViewer = async () => ({ viewer, res: null });
const allowRate = async () => ({ ok: true });
const publicCommunity = async () => ({
  id: "site-b",
  slug: "beta",
  data: { siteSections: { me: true } },
});

function joinRequest(origin = "https://yourrank.site", body = { slug: "beta" }, headers = {}) {
  return new Request(`${origin}/api/viewer/membership/join`, {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...headers },
    body: JSON.stringify(body),
  });
}

describe("explicit Viewer membership Join", () => {
  it("uses a host-only CSRF cookie on custom domains and the shared domain on YourRank", () => {
    const custom = csrfCookie("token", new Request("https://creator.example/me"));
    const platform = csrfCookie("token", new Request("https://yourrank.site/beta/me"));
    expect(custom).not.toContain("Domain=");
    expect(platform).toContain("Domain=.yourrank.site");
  });

  it("creates exactly the authenticated Viewer's target-bound membership without activity", async () => {
    const calls = [];
    const response = await handleViewerJoin(
      joinRequest("https://yourrank.site", { slug: "beta", viewerId: "viewer-b" }),
      {},
      {
        requireViewer: allowViewer,
        rateLimit: allowRate,
        getPublicSite: publicCommunity,
        one: async (sql, params) => {
          calls.push({ sql, params });
          return { id: "membership-b", balance: 0, created: true };
        },
      },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, membership: { slug: "beta", balance: 0 } });
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual(["site-b", "viewer-a"]);
    expect(calls[0].sql).toContain("INSERT INTO site_viewers");
    expect(calls[0].sql).toContain("ON CONFLICT (site_id, viewer_id) DO NOTHING");
    expect(calls[0].sql).not.toContain("last_active_at");
    expect(calls[0].sql).not.toContain("last_seen_at");
  });

  it("is idempotent and preserves the one persisted membership", async () => {
    let writes = 0;
    const deps = {
      requireViewer: allowViewer,
      rateLimit: allowRate,
      getPublicSite: publicCommunity,
      one: async () => {
        writes += 1;
        return { id: "membership-b", balance: 7, created: writes === 1 };
      },
    };

    const first = await handleViewerJoin(joinRequest(), {}, deps);
    const replay = await handleViewerJoin(joinRequest(), {}, deps);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(writes).toBe(2);
  });

  it("rejects cross-origin and custom-domain target substitution before writing", async () => {
    let writes = 0;
    const deps = {
      requireViewer: allowViewer,
      rateLimit: allowRate,
      getPublicSite: publicCommunity,
      resolveCustomDomain: async () => "alpha",
      one: async () => { writes += 1; },
    };

    const crossOrigin = await handleViewerJoin(joinRequest("https://yourrank.site", { slug: "beta" }, { origin: "https://evil.example" }), {}, deps);
    const substituted = await handleViewerJoin(joinRequest("https://creator.example", { slug: "beta" }), {}, deps);
    expect(crossOrigin.status).toBe(403);
    expect(substituted.status).toBe(404);
    expect(writes).toBe(0);
  });

  it("rejects unavailable communities without a plan paywall or membership write", async () => {
    let writes = 0;
    const response = await handleViewerJoin(joinRequest(), {}, {
      requireViewer: allowViewer,
      rateLimit: allowRate,
      getPublicSite: async () => null,
      one: async () => { writes += 1; },
    });
    expect(response.status).toBe(404);
    expect(writes).toBe(0);
  });

  it("keeps community B absent across passive surfaces, then lists one B after Join and reload", async () => {
    const memberships = new Map([
      ["site-a:viewer-a", { id: "membership-a", siteId: "site-a", slug: "alpha", balance: 5 }],
    ]);
    let insertAttempts = 0;
    const globalMe = () => handleViewerMe(new Request("https://yourrank.site/api/viewer/me"), {}, {
      requireViewer: allowViewer,
      rateLimit: allowRate,
      query: async (_sql, [viewerId]) => viewerId === "viewer-a"
        ? [...memberships.values()].map((membership) => ({
          slug: membership.slug,
          name: membership.slug === "alpha" ? "Alpha" : "Beta",
          balance: membership.balance,
          blocked: false,
          pending_claims: 0,
        }))
        : [],
    });
    const visitBeta = (options = {}) => getViewerSiteData("site-b", "viewer-a", options, {
      oneImpl: async () => memberships.get("site-b:viewer-a") || null,
      queryImpl: async () => [],
      execImpl: async () => {},
    });

    expect((await (await globalMe()).json()).communities.map(({ slug }) => slug)).toEqual(["alpha"]);
    for (const options of [{}, {}, { shop: true }, { shop: true, claims: true, ledger: true, participation: true }]) {
      const passive = await visitBeta(options);
      expect(passive.membershipStatus).toBe("absent");
    }
    expect((await (await globalMe()).json()).communities.map(({ slug }) => slug)).toEqual(["alpha"]);

    const joinDeps = {
      requireViewer: allowViewer,
      rateLimit: allowRate,
      getPublicSite: publicCommunity,
      one: async (_sql, [siteId, viewerId]) => {
        insertAttempts += 1;
        const key = `${siteId}:${viewerId}`;
        const current = memberships.get(key);
        if (current) return { id: current.id, balance: current.balance, created: false };
        const membership = { id: "membership-b", siteId, slug: "beta", balance: 0 };
        memberships.set(key, membership);
        return { id: membership.id, balance: membership.balance, created: true };
      },
    };
    expect((await handleViewerJoin(joinRequest(), {}, joinDeps)).status).toBe(200);
    expect((await handleViewerJoin(joinRequest(), {}, joinDeps)).status).toBe(200);

    const after = (await (await globalMe()).json()).communities.map(({ slug }) => slug);
    expect(after).toEqual(["alpha", "beta"]);
    expect(memberships.size).toBe(2);
    expect(insertAttempts).toBe(2);
    expect((await visitBeta()).membershipStatus).toBe("member");
  });
});

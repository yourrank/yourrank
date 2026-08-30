import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  handlePeopleReviewDecision,
  handlePeopleReviewDetail,
  handlePeopleReviews,
} from "../handlers/people-reviews.js";

const USER = { id: "creator-1" };
const SITE = { id: "site-1", user_id: "creator-1", name: "Site One", slug: "one" };
const ENTRY_ID = "11111111-1111-4111-8111-111111111111";
const REVIEW_ID = `tournament_entry:${ENTRY_ID}`;

const request = (path, init) => new Request(`https://yourrank.site${path}`, init);

function reviewRow(overrides = {}) {
  return {
    source_id: ENTRY_ID,
    display_name: "Alice",
    viewer_id: "viewer-1",
    source_status: "pending",
    created_at: "2026-08-29T10:00:00.000Z",
    updated_at: "2026-08-29T10:00:00.000Z",
    tournament_id: "tournament-1",
    tournament_title: "Community Cup",
    membership_id: "membership-1",
    member_since: "2026-07-01T10:00:00.000Z",
    kick_username: "alice",
    discord_username: null,
    kick_linked_at: "2026-07-01T10:00:00.000Z",
    discord_linked_at: null,
    review_action: null,
    review_resolved_at: null,
    ...overrides,
  };
}

function dependencies(overrides = {}) {
  const calls = { query: [], one: [], capability: [], rateLimit: [], txOne: [], txUnsafe: [] };
  const deps = {
    requireUser: async () => ({ user: USER, res: null }),
    getByUser: async () => SITE,
    getBoardById: async (_env, userId, siteId) => userId === USER.id && siteId === SITE.id ? SITE : null,
    requireSiteCapability: async (user, site, capability) => {
      calls.capability.push({ user, site, capability });
      return { role: "owner", res: null };
    },
    rateLimit: async (_env, key, max, windowSeconds) => {
      calls.rateLimit.push({ key, max, windowSeconds });
      return { ok: true };
    },
    query: async (sql, params) => {
      calls.query.push({ sql: String(sql), params });
      return [reviewRow()];
    },
    one: async (sql, params) => {
      calls.one.push({ sql: String(sql), params });
      if (String(sql).includes("FILTER")) return { pending: 1, resolved: 0 };
      return reviewRow();
    },
    withTransaction: async (callback) => callback({
      one: async (sql, params) => {
        calls.txOne.push({ sql: String(sql), params });
        if (String(sql).includes("FOR UPDATE")) return reviewRow();
        if (String(sql).includes("UPDATE tournament_entries")) {
          return reviewRow({ source_status: params[0], updated_at: "2026-08-29T11:00:00.000Z" });
        }
        return null;
      },
      query: async () => [],
      unsafe: async (sql, params) => {
        calls.txUnsafe.push({ sql: String(sql), params });
        return [{ created_at: "2026-08-29T11:00:00.000Z" }];
      },
    }),
    ...overrides,
  };
  return { calls, deps };
}

describe("People Reviews queue adapter", () => {
  it("lists only site-scoped zero-cost tournament exceptions without score or raw signal fields", async () => {
    const { calls, deps } = dependencies();
    const response = await handlePeopleReviews(request("/api/people/reviews?siteId=site-1"), {}, deps);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body.site).toEqual({ id: "site-1", name: "Site One", slug: "one" });
    expect(body.filter).toBe("pending");
    expect(body.counts).toEqual({ pending: 1, resolved: 0 });
    expect(body.reviews).toEqual([expect.objectContaining({
      id: REVIEW_ID,
      type: "participant_eligibility_exception",
      status: "pending",
      decision: null,
      subject: expect.objectContaining({ displayName: "Alice", membershipId: "membership-1" }),
      source: expect.objectContaining({ kind: "tournament_entry", workflow: "Tournament signup" }),
      reason: expect.objectContaining({ code: "duplicate_participation_requires_review" }),
    })]);

    expect(calls.capability[0].capability).toBe("canRoleManageReviews");
    expect(calls.query).toHaveLength(1);
    expect(calls.query[0].params).toEqual(["site-1", "pending", 100]);
    expect(calls.query[0].sql).toContain("COALESCE(t.entry_fee, 0) = 0");
    expect(calls.query[0].sql).toContain("te.alt_flag = true");
    expect(calls.query[0].sql).toContain("'waitlist'");
    expect(calls.query[0].sql).toContain("review_decision.action IS NULL");
    expect(calls.query[0].sql).toContain("a.entity_id=te.id::text");
    expect(calls.query[0].sql).toContain("sv.site_id = t.site_id");
    expect(calls.one[0].sql).toContain("a.entity_id=te.id::text");
    expect(calls.query[0].sql).not.toMatch(/trust_score|alt_reason|ip_address|device|network/i);
    expect(JSON.stringify(body)).not.toMatch(/trustScore|fraud|risk|altReason|ipAddress|device|network/i);
  });

  it("keeps authorization failures and site substitution private and query-free", async () => {
    const unauthorized = dependencies({
      requireUser: async () => ({ user: null, res: new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }) }),
    });
    const denied = await handlePeopleReviews(request("/api/people/reviews?siteId=site-1"), {}, unauthorized.deps);
    expect(denied.status).toBe(401);
    expect(denied.headers.get("cache-control")).toContain("no-store");
    expect(unauthorized.calls.query).toHaveLength(0);

    const wrongSite = dependencies({ getBoardById: async () => null });
    const missing = await handlePeopleReviews(request("/api/people/reviews?siteId=site-2"), {}, wrongSite.deps);
    expect(missing.status).toBe(404);
    expect(wrongSite.calls.query).toHaveLength(0);

    const forbidden = dependencies({
      requireSiteCapability: async () => ({ role: null, res: new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }) }),
    });
    const blocked = await handlePeopleReviews(request("/api/people/reviews?siteId=site-1"), {}, forbidden.deps);
    expect(blocked.status).toBe(403);
    expect(forbidden.calls.query).toHaveLength(0);
  });

  it("denies a viewer-only session from the creator queue", async () => {
    const viewerSession = dependencies({
      requireUser: async () => ({ user: null, res: new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }) }),
    });
    const response = await handlePeopleReviews(request("/api/people/reviews?siteId=site-1"), {}, viewerSession.deps);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(viewerSession.calls.query).toHaveLength(0);
    expect(viewerSession.calls.one).toHaveLength(0);
  });

  it("returns a truthful empty queue and caps deterministic list queries", async () => {
    const empty = dependencies({
      query: async () => [],
      one: async () => ({ pending: 0, resolved: 0 }),
    });
    const emptyResponse = await handlePeopleReviews(request("/api/people/reviews?siteId=site-1"), {}, empty.deps);
    const emptyBody = await emptyResponse.json();
    expect(emptyBody.reviews).toEqual([]);
    expect(emptyBody.truncated).toBe(false);

    const capped = dependencies({ one: async () => ({ pending: 101, resolved: 0 }) });
    const cappedResponse = await handlePeopleReviews(request("/api/people/reviews?siteId=site-1"), {}, capped.deps);
    const cappedBody = await cappedResponse.json();
    expect(cappedBody.limit).toBe(100);
    expect(cappedBody.truncated).toBe(true);
    expect(capped.calls.query[0].sql).toContain("te.created_at END ASC");
    expect(capped.calls.query[0].sql).toContain("te.id ASC");
    expect(capped.calls.query[0].sql).toContain("LIMIT $3");
  });

  it("uses real resolved filtering without creating another review type", async () => {
    const { calls, deps } = dependencies({ one: async () => ({ pending: 0, resolved: 1 }) });
    deps.query = async (sql, params) => {
      calls.query.push({ sql: String(sql), params });
      return [reviewRow({
        source_status: "selected",
        review_action: "people_review_allow",
        review_resolved_at: "2026-08-29T11:00:00.000Z",
      })];
    };
    const response = await handlePeopleReviews(request("/api/people/reviews?siteId=site-1&status=resolved"), {}, deps);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.filter).toBe("resolved");
    expect(body.reviews[0]).toEqual(expect.objectContaining({ status: "resolved", decision: "allow" }));
    expect(body.reviews.every((review) => review.type === "participant_eligibility_exception")).toBe(true);
    expect(calls.query[0].params).toEqual(["site-1", "resolved", 100]);
    expect(calls.query[0].sql).toContain("review_decision.created_at END DESC");
  });

  it("keeps neighboring tournament states pending until a review-owned decision exists", async () => {
    const { deps } = dependencies({
      query: async () => [
        reviewRow({ source_status: "selected" }),
        reviewRow({ source_id: "22222222-2222-4222-8222-222222222222", source_status: "removed" }),
        reviewRow({ source_id: "33333333-3333-4333-8333-333333333333", source_status: "waitlist" }),
      ],
      one: async () => ({ pending: 3, resolved: 0 }),
    });
    const response = await handlePeopleReviews(request("/api/people/reviews?siteId=site-1"), {}, deps);
    const body = await response.json();
    expect(body.reviews.every((review) => review.status === "pending" && review.decision === null)).toBe(true);
    expect(body.reviews[0].allowedDecisions).toEqual(["allow"]);
    expect(body.reviews[1].allowedDecisions).toEqual(["allow", "exclude"]);
    expect(body.reviews[2].allowedDecisions).toEqual(["allow", "exclude"]);
  });

  it("loads detail and history only after a site-bound review lookup", async () => {
    const { calls, deps } = dependencies({
      query: async (sql, params) => {
        calls.query.push({ sql: String(sql), params });
        return [{
          action: "people_review_allow",
          created_at: "2026-08-29T11:00:00.000Z",
          actor_id: "creator-1",
          actor_name: "Creator",
        }];
      },
    });
    const response = await handlePeopleReviewDetail(
      request(`/api/people/reviews/${encodeURIComponent(REVIEW_ID)}?siteId=site-1`),
      {},
      deps,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(calls.one[0].params).toEqual(["site-1", ENTRY_ID]);
    expect(calls.one[0].sql).toContain("t.site_id=$1 AND te.id=$2");
    expect(calls.one[0].sql).not.toMatch(/trust_score|alt_reason|ip_address|device|network/i);
    expect(calls.query[0].params).toEqual([ENTRY_ID]);
    expect(body.review.context.membership).toEqual(expect.objectContaining({
      id: "membership-1",
      memberSince: "2026-07-01T10:00:00.000Z",
      linkedIdentities: [{ provider: "Kick", displayName: "alice" }],
    }));
    expect(body.review.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "review_created" }),
      expect.objectContaining({ action: "decision_made", actor: { id: "creator-1", name: "Creator" } }),
    ]));
  });

  it("does not infer a member identity from unverified provider names", async () => {
    const { deps } = dependencies({
      one: async (sql) => String(sql).includes("FILTER")
        ? { pending: 1, resolved: 0 }
        : reviewRow({
            membership_id: "membership-1",
            kick_username: "matching-name",
            discord_username: "matching-name",
            kick_linked_at: null,
            discord_linked_at: null,
          }),
      query: async () => [],
    });
    const response = await handlePeopleReviewDetail(
      request(`/api/people/reviews/${encodeURIComponent(REVIEW_ID)}?siteId=site-1`),
      {},
      deps,
    );
    const body = await response.json();
    expect(body.review.subject.memberDisplayName).toBeNull();
    expect(body.review.context.membership.linkedIdentities).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/telegram|leaderboardPlayer|ipAddress|deviceFingerprint/i);
  });

  it("keeps optional membership context absent instead of synthesizing a person record", async () => {
    const { deps } = dependencies({
      one: async () => reviewRow({ membership_id: null, member_since: null }),
      query: async () => [],
    });
    const response = await handlePeopleReviewDetail(
      request(`/api/people/reviews/${encodeURIComponent(REVIEW_ID)}?siteId=site-1`),
      {},
      deps,
    );
    const body = await response.json();
    expect(body.review.context.membership).toBeNull();
    expect(body.review.subject.membershipId).toBeNull();
  });

  it("returns 404 for a cross-site or malformed review id without loading history", async () => {
    const missing = dependencies({ one: async () => null });
    const crossSite = await handlePeopleReviewDetail(
      request(`/api/people/reviews/${encodeURIComponent(REVIEW_ID)}?siteId=site-1`),
      {},
      missing.deps,
    );
    expect(crossSite.status).toBe(404);
    expect(missing.calls.query).toHaveLength(0);

    const malformed = dependencies();
    const badId = await handlePeopleReviewDetail(
      request("/api/people/reviews/not-a-review?siteId=site-1"),
      {},
      malformed.deps,
    );
    expect(badId.status).toBe(404);
    expect(malformed.calls.one).toHaveLength(0);
  });
});

describe("People Reviews decisions", () => {
  it.each([
    ["allow", "confirmed", "people_review_allow"],
    ["exclude", "blocked", "people_review_exclude"],
  ])("applies %s narrowly and writes the source update plus audit atomically", async (decision, sourceStatus, auditAction) => {
    const { calls, deps } = dependencies();
    const response = await handlePeopleReviewDecision(
      request(`/api/people/reviews/${encodeURIComponent(REVIEW_ID)}/decision?siteId=site-1`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      }),
      {},
      deps,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.replayed).toBe(false);
    expect(body.review).toEqual(expect.objectContaining({ status: "resolved", decision }));
    expect(calls.txOne[0].sql).toContain("FOR UPDATE OF t");
    expect(calls.txOne[0].sql).toContain("COALESCE(t.entry_fee, 0) = 0");
    expect(calls.txOne[1].sql).toContain("FOR UPDATE OF te");
    expect(calls.txOne[1].sql).toContain("t.site_id=$1 AND te.id=$2");
    expect(calls.txOne[2].params).toEqual([sourceStatus, ENTRY_ID, "pending"]);
    expect(calls.txUnsafe).toHaveLength(1);
    expect(calls.txUnsafe[0].sql).toContain("INSERT INTO audit_log");
    expect(calls.txUnsafe[0].params).toEqual(expect.arrayContaining([USER.id, auditAction, ENTRY_ID]));
  });

  it("treats an identical retry as an idempotent replay without another update or audit event", async () => {
    const { calls, deps } = dependencies();
    deps.withTransaction = async (callback) => callback({
      one: async (sql, params) => {
        calls.txOne.push({ sql: String(sql), params });
        if (!String(sql).includes("FOR UPDATE OF te") && String(sql).includes("FOR UPDATE OF t")) return { id: "tournament-1", signup_state: "open", entry_cap: null };
        return reviewRow({
          source_status: "confirmed",
          review_action: "people_review_allow",
          review_resolved_at: "2026-08-29T11:00:00.000Z",
        });
      },
      query: async () => [],
      unsafe: async (sql, params) => { calls.txUnsafe.push({ sql: String(sql), params }); },
    });
    const response = await handlePeopleReviewDecision(
      request(`/api/people/reviews/${encodeURIComponent(REVIEW_ID)}/decision?siteId=site-1`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "allow" }),
      }),
      {},
      deps,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.replayed).toBe(true);
    expect(calls.txOne).toHaveLength(2);
    expect(calls.txUnsafe).toHaveLength(0);
  });

  it("resolves a waitlisted exception without bypassing the tournament cap", async () => {
    const waitlisted = dependencies();
    waitlisted.deps.withTransaction = async (callback) => callback({
      one: async (sql, params) => {
        waitlisted.calls.txOne.push({ sql: String(sql), params });
        if (!String(sql).includes("FOR UPDATE OF te") && String(sql).includes("FOR UPDATE OF t")) return { id: "tournament-1", signup_state: "open", entry_cap: 1 };
        return reviewRow({ source_status: "waitlist" });
      },
      query: async () => [],
      unsafe: async (sql, params) => {
        waitlisted.calls.txUnsafe.push({ sql: String(sql), params });
        return [{ created_at: "2026-08-29T11:00:00.000Z" }];
      },
    });
    const response = await handlePeopleReviewDecision(
      request(`/api/people/reviews/${encodeURIComponent(REVIEW_ID)}/decision?siteId=site-1`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "allow" }),
      }),
      {},
      waitlisted.deps,
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.review).toEqual(expect.objectContaining({ status: "resolved", decision: "allow" }));
    expect(waitlisted.calls.txOne).toHaveLength(2);
    expect(waitlisted.calls.txUnsafe).toHaveLength(1);
    expect(waitlisted.calls.txUnsafe[0].params[3]).toEqual(expect.objectContaining({ status: "waitlist" }));
  });

  it("rejects invalid, stale, and client-owned authoritative fields", async () => {
    const invalid = dependencies();
    const invalidResponse = await handlePeopleReviewDecision(
      request(`/api/people/reviews/${encodeURIComponent(REVIEW_ID)}/decision?siteId=site-1`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "ban", reviewerId: "someone-else", status: "resolved" }),
      }),
      {},
      invalid.deps,
    );
    expect(invalidResponse.status).toBe(400);
    expect(invalid.calls.txOne).toHaveLength(0);

    const stale = dependencies();
    stale.deps.withTransaction = async (callback) => callback({
      one: async (sql, params) => {
        stale.calls.txOne.push({ sql: String(sql), params });
        if (!String(sql).includes("FOR UPDATE OF te") && String(sql).includes("FOR UPDATE OF t")) return { id: "tournament-1", signup_state: "open", entry_cap: null };
        return reviewRow({ source_status: "blocked", review_action: "people_review_exclude" });
      },
      query: async () => [],
      unsafe: async () => [],
    });
    const staleResponse = await handlePeopleReviewDecision(
      request(`/api/people/reviews/${encodeURIComponent(REVIEW_ID)}/decision?siteId=site-1`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "allow" }),
      }),
      {},
      stale.deps,
    );
    expect(staleResponse.status).toBe(409);
    expect(stale.calls.txOne).toHaveLength(2);
  });
});

describe("People Reviews route and UI ownership", () => {
  it("uses the canonical People route, APIs, private fragment delivery, and a real decision surface", async () => {
    const routes = readFileSync(new URL("../routes.js", import.meta.url), "utf8");
    const index = readFileSync(new URL("../index.js", import.meta.url), "utf8");
    const page = readFileSync(new URL("../pages/audience.jsx", import.meta.url), "utf8");
    const client = readFileSync(new URL("../assets/people.js", import.meta.url), "utf8");
    const css = readFileSync(new URL("../assets/people.css", import.meta.url), "utf8");

    expect(routes).toContain('path: "/api/people/reviews"');
    expect(routes).toContain('path: "/api/people/reviews/:id"');
    expect(routes).toContain('path: "/api/people/reviews/:id/decision"');
    expect(index).toContain('clean === "/dashboard/audience/reviews"');
    expect(page).toContain("Human decisions needed for your community.");
    expect(page).toContain("No reviews need your attention.");
    expect(page).toContain('href: "/dashboard/audience/members"');
    expect(page).toContain('href: "/dashboard/audience/reviews"');
    expect(client).toContain('decision: "allow"');
    expect(client).toContain('decision: "exclude"');
    expect(client).toContain('allowButton.disabled = true');
    expect(client).toContain('excludeButton.disabled = true');
    expect(client).toContain('setAttribute("aria-busy", "true")');
    expect(client).not.toMatch(/trustScore|fraudScore|riskScore|altReason|ipAddress|deviceFingerprint/i);
    expect(css).toContain("@media (max-width: 24rem)");
    expect(css).toContain(".people-review-table td {\n    display: flex;");
    expect(css).toContain("height: auto;");
    expect(css).not.toContain("column-reverse");
  });
});

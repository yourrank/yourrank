import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  HOME_LIVE_LIMIT,
  HOME_RECENT_LIMIT,
  HOME_UPCOMING_LIMIT,
  activityHomeState,
  attentionItems,
  comingNextItems,
  communityStatus,
  giveawayHomeState,
  liveNowItems,
  pulseMetrics,
  quickActions,
  recentActivityItems,
  setupProgress,
} from "../assets/dashboard/overview-state.js";
import { HOME_ACTIVITY_LIMIT, handleHomeActivity, normalizeHomeEvent } from "../handlers/home.js";
import { ROUTES } from "../routes.js";

const overviewJs = readFileSync(new URL("../assets/dashboard/overview.js", import.meta.url), "utf8");
const dashboardJsx = readFileSync(new URL("../pages/dashboard.jsx", import.meta.url), "utf8");
const dashboardCss = readFileSync(new URL("../assets/dashboard-v4.css", import.meta.url), "utf8");

const SITE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("Home: community header", () => {
  it("derives the status word from existing publish/verification state", () => {
    expect(communityStatus({ live: true, published: true })).toEqual({ state: "live", label: "Live" });
    expect(communityStatus({ live: false, published: true, emailVerified: false })).toEqual({ state: "attention", label: "Needs attention" });
    expect(communityStatus({ published: false })).toEqual({ state: "draft", label: "Draft" });
  });

  it("offers the public link only while the selected community is live, using its slug", () => {
    expect(overviewJs).toContain("publicLink.hidden = !status.live || !state.SLUG");
    expect(overviewJs).toContain("publicLink.href = state.SLUG ? `/${state.SLUG}` : \"/\"");
    expect(dashboardJsx).not.toContain("ov-hero");
  });
});

describe("Home: needs attention", () => {
  const healthy = { status: { emailVerified: true, published: true }, steps: { brand: true, players: true, publish: true }, siteId: SITE };

  it("is empty for a healthy community so the section hides", () => {
    expect(attentionItems(healthy)).toEqual([]);
    expect(attentionItems({ ...healthy, connection: { homeAttention: false, connected: true } })).toEqual([]);
    expect(overviewJs).toContain("attentionSection.hidden = attention.length === 0");
  });

  it("routes email verification to /verify-email only when publishing is actually blocked", () => {
    expect(attentionItems({ ...healthy, status: { emailVerified: false, published: true } })).toMatchObject([{ key: "verifyEmail", scope: "account", href: "/verify-email" }]);
    expect(attentionItems({ ...healthy, status: { emailVerified: false, published: false } })).toMatchObject([{ key: "verifyEmail" }]);
    // Setup not ready yet: verification is not the blocker, setup progress is.
    expect(attentionItems({ status: { emailVerified: false, published: false }, steps: { brand: true }, siteId: SITE })).toEqual([]);
  });

  it("routes Kick delivery repair to Settings → Connections for the selected site", () => {
    const [item] = attentionItems({ ...healthy, connection: { homeAttention: true, canManage: true, detail: "Token expired." }, siteName: "Night Owls" });
    expect(item).toMatchObject({ key: "kickDelivery", scope: "site", action: "Open Connections", href: `/dashboard/settings/connections?board=${SITE}` });
    expect(item.why).toContain("Night Owls");
    expect(item.why).toContain("Token expired.");
    const [readOnly] = attentionItems({ ...healthy, connection: { homeAttention: true, canManage: false } });
    expect(readOnly).toMatchObject({ action: "View connection", href: `/dashboard/site/connections?siteId=${SITE}` });
  });

  it("routes pending claims to Rewards → Claims with the site preserved", () => {
    expect(attentionItems({ ...healthy, pendingClaims: 1 })).toMatchObject([{ key: "pendingClaims", action: "Review claim", href: `/dashboard/rewards/redemptions?siteId=${SITE}` }]);
    expect(attentionItems({ ...healthy, pendingClaims: 3 })[0].title).toBe("3 claims are waiting for you");
    expect(attentionItems({ ...healthy, pendingClaims: 0 })).toEqual([]);
  });

  it("never carries one site's problems into another site's items", () => {
    const a = attentionItems({ ...healthy, siteId: SITE, pendingClaims: 2, connection: { homeAttention: true } });
    const b = attentionItems({ ...healthy, siteId: OTHER });
    expect(a).toHaveLength(2);
    expect(a.every((item) => item.href.includes(SITE))).toBe(true);
    expect(b).toEqual([]);
  });

  it("states what is wrong, why it matters, and the fixing action for every item", () => {
    const items = attentionItems({
      ...healthy,
      status: { emailVerified: false, published: true },
      pendingClaims: 2,
      connection: { homeAttention: true },
      automationAttention: [{ id: "s1", status: "failed", templateName: "Friday drop" }],
    });
    expect(items.map((item) => item.key)).toEqual(["verifyEmail", "kickDelivery", "pendingClaims", "automation"]);
    for (const item of items) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.why.length).toBeGreaterThan(0);
      expect(item.action.length).toBeGreaterThan(0);
      expect(item.href.startsWith("/")).toBe(true);
    }
    expect(items[3].href).toBe(`/dashboard/activities?siteId=${SITE}`);
  });
});

describe("Home: live now", () => {
  const openDrop = (id, extra = {}) => ({ id, source: { kind: "code_drop" }, type: "drop", state: "open", progress: { claimed: 2, capacity: 10 }, reward: { creditsPerClaim: 25 }, endsAt: "2099-01-01T00:00:00Z", ...extra });

  it("keeps only open Code Drops and active chat giveaways", () => {
    const activities = activityHomeState([openDrop("d1"), openDrop("d2", { state: "completed" }), openDrop("d3", { state: "expired" })]);
    const giveaway = giveawayHomeState({ session: { id: "g1", status: "stopped", keyword: "win" }, entries: [{}] });
    const { items } = liveNowItems({ activities, giveaway, siteId: SITE });
    expect(items.map((item) => item.key)).toEqual(["d1"]);
    expect(giveawayHomeState({ session: { id: "g2", status: "active", keyword: "win" }, entries: [{}, {}] }).active).toMatchObject({ entries: 2 });
  });

  it("links each item to its canonical management page with the site preserved", () => {
    const { items } = liveNowItems({
      activities: activityHomeState([openDrop("d1")]),
      giveaway: giveawayHomeState({ session: { id: "g1", status: "active", keyword: "gg" }, entries: [{}] }),
      siteId: SITE,
    });
    expect(items).toMatchObject([
      { kind: "code_drop", name: "Code drop", status: "Open", meta: "2 of 10 claims · 25 credits each", endsAt: "2099-01-01T00:00:00Z", href: `/dashboard/activities?siteId=${SITE}` },
      { kind: "chat_giveaway", name: "Chat giveaway", status: "Collecting entries", meta: "1 entry · keyword “gg”", href: `/dashboard/giveaways/chat?siteId=${SITE}` },
    ]);
  });

  it("is bounded and reports the overflow instead of listing everything", () => {
    const many = Array.from({ length: HOME_LIVE_LIMIT + 3 }, (_, i) => openDrop(`d${i}`));
    const result = liveNowItems({ activities: activityHomeState(many), siteId: SITE });
    expect(result.items).toHaveLength(HOME_LIVE_LIMIT);
    expect(result.more).toBe(3);
    expect(liveNowItems({ siteId: SITE })).toEqual({ items: [], more: 0 });
  });
});

describe("Home: coming next", () => {
  const now = Date.parse("2026-09-20T12:00:00Z");

  it("orders real future events chronologically and drops the past", () => {
    const items = comingNextItems({
      upcoming: [
        { id: "late", nextRunAt: "2026-09-22T10:00:00Z", templateName: "Weekend drop", recurrence: "weekly" },
        { id: "past", nextRunAt: "2026-09-19T10:00:00Z", templateName: "Missed" },
        { id: "soon", nextRunAt: "2026-09-20T18:00:00Z", templateName: "Tonight", recurrence: "once" },
      ],
      leaderboardEndsAt: "2026-09-21T00:00:00Z",
      siteId: SITE,
      now,
    });
    expect(items.map((item) => item.key)).toEqual(["schedule:soon", "leaderboard:period-end", "schedule:late"]);
    expect(items[0]).toMatchObject({ meta: "One time", href: `/dashboard/activities?siteId=${SITE}` });
    expect(items[1]).toMatchObject({ kind: "leaderboard_period_end", href: `/dashboard/leaderboard/setup?board=${SITE}` });
    expect(items[2].meta).toBe("Repeats weekly");
  });

  it("is empty when nothing is scheduled and never fabricates from other data", () => {
    expect(comingNextItems({ upcoming: [], leaderboardEndsAt: "2020-01-01T00:00:00Z", siteId: SITE, now })).toEqual([]);
    expect(comingNextItems({ upcoming: [{ id: "x", nextRunAt: "not a date" }], siteId: SITE, now })).toEqual([]);
    const many = Array.from({ length: HOME_UPCOMING_LIMIT + 2 }, (_, i) => ({ id: `s${i}`, nextRunAt: `2026-09-2${1 + (i % 8)}T0${i}:00:00Z` }));
    expect(comingNextItems({ upcoming: many, siteId: SITE, now })).toHaveLength(HOME_UPCOMING_LIMIT);
  });
});

describe("Home: community pulse", () => {
  it("labels the time range from the Insights window and stays small", () => {
    const pulse = pulseMetrics({
      window: { effectiveDays: 30 },
      community: { newMembers: 12, returningMembers: 40 },
      participation: { participants: 7 },
      rewards: { claimsSubmitted: 9, claimsCompleted: 5 },
    });
    expect(pulse.rangeLabel).toBe("Last 30 days");
    expect(pulse.metrics).toEqual([
      { key: "newMembers", label: "New members", value: 12 },
      { key: "participants", label: "Activity participants", value: 7 },
      { key: "claimsCompleted", label: "Claims completed", value: 5 },
    ]);
    expect(pulse.metrics.length).toBeLessThanOrEqual(4);
  });

  it("follows the effective plan window rather than the requested one", () => {
    expect(pulseMetrics({ window: { requestedDays: 30, effectiveDays: 7 }, community: { newMembers: 1 } }).rangeLabel).toBe("Last 7 days");
  });

  it("requests the site-scoped 30-day Insights window and never paints zeros before it arrives", () => {
    expect(overviewJs).toContain("/api/insights?${params}&days=${HOME_PULSE_DAYS}");
    expect(overviewJs).toContain('if (insights.status === "ready") setMetricValue(el, number(metric.value));');
    expect(overviewJs).toContain('else if (insights.status === "loading" || insights.status === "idle") setMetricLoading(el);');
    expect(dashboardJsx).not.toContain("<canvas");
  });
});

describe("Home: recent activity projection", () => {
  it("is bounded, newest first, and deduplicated", () => {
    const events = Array.from({ length: HOME_RECENT_LIMIT + 4 }, (_, i) => ({ kind: "member_joined", at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), title: `m${i}` }));
    const result = recentActivityItems([...events, events[0]]);
    expect(result).toHaveLength(HOME_RECENT_LIMIT);
    expect(result[0].title).toBe(`m${HOME_RECENT_LIMIT + 3}`);
    expect(result.every((event, i) => i === 0 || new Date(result[i - 1].at) >= new Date(event.at))).toBe(true);
  });

  it("drops malformed rows instead of rendering them", () => {
    expect(recentActivityItems([{ kind: "claim", at: "nope", title: "x" }, { kind: "claim", at: "2026-01-01T00:00:00Z" }, null])).toEqual([]);
  });
});

describe("Home: quick actions", () => {
  it("offers four canonical creator tasks with the selected site preserved", () => {
    const actions = quickActions({ siteId: SITE });
    expect(actions.map((action) => action.key)).toEqual(["editCommunity", "addPlayer", "startActivity", "createReward"]);
    expect(actions.map((action) => action.href)).toEqual([
      `/dashboard/site?board=${SITE}`,
      `/dashboard/leaderboard/players?board=${SITE}`,
      `/dashboard/activities?siteId=${SITE}`,
      `/dashboard/rewards/shop?siteId=${SITE}`,
    ]);
    expect(actions.length).toBeLessThanOrEqual(4);
    for (const action of actions) expect(action.href).not.toMatch(/\/dashboard\/(credits|analytics|rewards\/history)/);
  });
});

describe("Home: setup progress", () => {
  it("counts only the core milestones and completes without optional products", () => {
    expect(setupProgress({})).toMatchObject({ completed: 0, total: 3, done: false, next: { key: "brand" } });
    expect(setupProgress({ brand: true, players: true })).toMatchObject({ completed: 2, done: false, next: { key: "publish" } });
    expect(setupProgress({ brand: true, players: true, publish: true, kick: false, telegram: false })).toMatchObject({ completed: 3, done: true, next: null });
  });

  it("hides the section once core setup is done unless publishing awaits verification", () => {
    expect(overviewJs).toContain("const showSetup = !progress.done || pendingVerification;");
    expect(overviewJs).toContain("setupSection.hidden = !showSetup");
    expect(overviewJs).not.toContain("state.CREDITS?.channel?.connected");
  });
});

describe("Home: section loading and error isolation", () => {
  it("loads each section independently and resets everything on a site switch", () => {
    for (const key of ["activities", "giveaway", "insights", "recent"]) expect(overviewJs).toContain(`${key}: {`);
    expect(overviewJs).toContain("const token = ++loadToken;");
    expect(overviewJs).toContain("home = { siteId, sections:");
    expect(overviewJs).toContain("if (token !== loadToken || home.siteId !== siteId) return;");
    expect(overviewJs).toContain('if (err?.status === 403) home.sections[key] = { status: "forbidden"');
    expect(overviewJs).toContain('data-home-retry="${key}"');
    expect(overviewJs).toContain("loadHomeSection(button.dataset.homeRetry, state.ACTIVE_SITE_ID, loadToken)");
    expect(overviewJs).not.toContain("Promise.all([\n      fetchDashboardJson");
  });

  it("reloads the dynamic sections whenever Home is navigated to in-app", () => {
    const shellJs = readFileSync(new URL("../assets/dashboard/shell.js", import.meta.url), "utf8");
    expect(shellJs).toContain('import { loadOverviewLiveData, renderOverviewSummary } from "./overview.js";');
    expect(shellJs).toContain('if (page === "home") {\n    renderOverviewSummary();\n    loadOverviewLiveData();\n  }');
  });

  it("hides optional sections when empty and shows a compact skeleton while loading", () => {
    expect(overviewJs).toContain("liveSection.hidden = !liveLoading && !liveError && live.items.length === 0");
    expect(overviewJs).toContain("upcomingSection.hidden = !loading && !error && upcoming.length === 0");
    expect(overviewJs).toContain("SKELETON_ROW");
    for (const id of ["ovAttention", "ovLiveNow", "ovComingNext", "ovSetup"]) expect(dashboardJsx).toMatch(new RegExp(`id="${id}"[^>]*hidden`));
  });

  it("wraps Home content on narrow screens instead of scrolling sideways", () => {
    expect(dashboardCss).toContain(".v3-dash[data-auth-workspace] .ov-quick-grid { grid-template-columns: 1fr; }");
    expect(dashboardCss).toContain(".v3-dash[data-auth-workspace] .ov-quick-action {");
    expect(dashboardCss).toContain("overflow-wrap: anywhere; }");
    const quick = dashboardCss.slice(dashboardCss.indexOf(".ov-quick-grid {"), dashboardCss.indexOf(".ov-quick-action:focus-visible"));
    expect(quick).toContain("minmax(160px, 1fr)");
    expect(quick).not.toMatch(/overflow-x:\s*(auto|scroll)/);
  });
});

describe("GET /api/home/activity", () => {
  const site = { id: SITE, user_id: "u1", name: "Night Owls", slug: "night-owls" };
  const user = { id: "u1" };
  const deps = (overrides = {}) => ({
    requireUser: async () => ({ user, res: null }),
    getBoardById: async (_env, _uid, id) => (id === SITE ? site : null),
    getByUser: async () => site,
    requireSiteCapability: async () => ({ role: "owner", res: null }),
    rateLimit: async () => ({ ok: true }),
    activityQuery: async () => [],
    ...overrides,
  });
  const request = (siteId = SITE) => new Request(`https://yourrank.test/api/home/activity?siteId=${siteId}`);

  it("is registered as a GET route", () => {
    expect(ROUTES.some((route) => route.path === "/api/home/activity" && route.method === "GET")).toBe(true);
  });

  it("scopes the query to the selected site and bounds it to limit + 1", async () => {
    const calls = [];
    const res = await handleHomeActivity(request(), {}, deps({ activityQuery: async (sql, params) => { calls.push({ sql, params }); return []; } }));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual([SITE, HOME_ACTIVITY_LIMIT, HOME_ACTIVITY_LIMIT + 1]);
    for (const branch of ["member_joined", "claim_submitted", "drop_claimed", "drop_ended", "giveaway_drawn"]) expect(calls[0].sql).toContain(`${branch} AS (`);
    expect(calls[0].sql.match(/site_id = \$1/g).length).toBe(5);
    expect(calls[0].sql).toContain("ORDER BY at DESC\n  LIMIT $3");
    expect(res.headers.get("cache-control")).toBe("no-store, no-cache, must-revalidate");
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, site: { id: SITE, name: "Night Owls", slug: "night-owls" }, limit: HOME_ACTIVITY_LIMIT, truncated: false, events: [] });
  });

  it("normalizes rows into creator-readable events, newest first and truncated to the limit", async () => {
    const rows = Array.from({ length: HOME_ACTIVITY_LIMIT + 1 }, (_, i) => ({ kind: "member_joined", at: new Date(Date.UTC(2026, 8, 20, 12 - i)).toISOString(), actor: `viewer${i}` }));
    const res = await handleHomeActivity(request(), {}, deps({ activityQuery: async () => rows }));
    const body = await res.json();
    expect(body.events).toHaveLength(HOME_ACTIVITY_LIMIT);
    expect(body.truncated).toBe(true);
    expect(body.events[0]).toEqual({ kind: "member_joined", at: rows[0].at, title: "viewer0", detail: "Joined your community" });
    expect(Object.keys(body.events[0]).sort()).toEqual(["at", "detail", "kind", "title"]);
  });

  it("writes plain copy for every event kind and drops unknown ones", () => {
    const at = "2026-09-20T10:00:00.000Z";
    expect(normalizeHomeEvent({ kind: "claim", at, actor: "ana", subject: "Hoodie", status: "fulfilled" })).toMatchObject({ detail: "Claim for Hoodie completed" });
    expect(normalizeHomeEvent({ kind: "claim", at, actor: "ana", subject: "Hoodie", status: "pending" })).toMatchObject({ detail: "Claimed Hoodie · waiting for you" });
    expect(normalizeHomeEvent({ kind: "drop_claimed", at, actor: "bo", status: "25" })).toMatchObject({ title: "bo", detail: "Claimed a code drop · 25 credits" });
    expect(normalizeHomeEvent({ kind: "drop_ended", at, subject: "1" })).toMatchObject({ title: "Code drop ended", detail: "1 claim" });
    expect(normalizeHomeEvent({ kind: "giveaway_drawn", at, actor: "cy", subject: "gg" })).toMatchObject({ detail: "cy won the “gg” giveaway" });
    expect(normalizeHomeEvent({ kind: "audit_log", at })).toBeNull();
    expect(normalizeHomeEvent({ kind: "claim", at: "garbage" })).toBeNull();
  });

  it("refuses other users' sites and callers without the members capability", async () => {
    expect((await handleHomeActivity(request(OTHER), {}, deps())).status).toBe(404);
    const forbidden = await handleHomeActivity(request(), {}, deps({ requireSiteCapability: async () => ({ role: "viewer", res: new Response("{}", { status: 403 }) }) }));
    expect(forbidden.status).toBe(403);
    expect(forbidden.headers.get("cache-control")).toBe("no-store, no-cache, must-revalidate");
    expect((await handleHomeActivity(request(), {}, deps({ rateLimit: async () => ({ ok: false }) }))).status).toBe(429);
  });
});

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import {
  actAndFlush,
  clickReactTarget,
  createElement,
  createRoot,
  document,
  installRewardsDomGlobals,
  restoreRewardsDomGlobals,
  setReactInputValue,
  window,
} from "./rewards-react-utils.js";
import { AudiencePage, setAudiencePageDependenciesForTests } from "../react/pages/audience/page.tsx";

let root;
let audienceEntry;
let audienceEntryMounted = false;

function member(id, displayName = id) {
  return {
    id,
    displayName,
    balance: 15,
    totalEarned: 25,
    totalSpent: 10,
    lastSeenAt: "2026-07-02T12:00:00.000Z",
    linkedIdentities: [{ provider: "kick", displayName }],
    recentCreditActivity: [],
  };
}

async function mountAudiencePage({ tab = "viewers", url, deps = {} } = {}) {
  installRewardsDomGlobals();
  await window.happyDOM.setURL(url || `http://localhost/dashboard/audience/members?siteId=site-1`);
  document.body.innerHTML = '<main><div id="audience-app"></div></main>';
  const container = document.getElementById("audience-app");
  root = createRoot(container);
  const injected = {
    api: async (path) => {
      if (path.startsWith("/api/people/members?")) return { members: [member("member-1", "Alice")], page: { hasMore: false }, total: 1 };
      if (path === "/api/people/members/member-1") return { member: member("member-1", "Alice"), site: { name: "Creator site" } };
      if (path.startsWith("/api/people/reviews?")) return { reviews: [], counts: { pending: 0, resolved: 0 } };
      if (path.startsWith("/api/people/linked-accounts?")) return { groups: [], counts: { pending: 0, watching: 0, restricted: 0, dismissed: 0 } };
      if (path === "/api/credits/viewer/history") return { boards: [] };
      if (path.startsWith("/api/credits/activity")) return { events: [], nextCursor: null };
      return {};
    },
    loadBoardShell: async () => ({
      activeSiteId: new URL(window.location.href).searchParams.get("siteId") || "site-1",
      board: { name: "Creator site" },
    }),
    preserveSiteContextLinks: async () => {},
    confirm: async () => true,
    prompt: async () => "Confirmed reason",
    getSessionStorage: () => window.sessionStorage,
    randomUUID: () => "operation-id",
    downloadCsv: () => {},
    ...deps,
  };
  await actAndFlush(() => root.render(createElement(AudiencePage, { tab, dependencies: injected })));
  return { container, injected };
}

async function unmountAudiencePage() {
  if (!root) return;
  await actAndFlush(() => root.unmount());
  root = null;
}

async function unmountAudienceEntry() {
  if (!audienceEntryMounted || !audienceEntry) return;
  await actAndFlush(() => audienceEntry.leave());
  audienceEntryMounted = false;
}

async function cleanupAudience() {
  await unmountAudienceEntry();
  await unmountAudiencePage();
  setAudiencePageDependenciesForTests(null);
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

afterEach(cleanupAudience);
afterAll(restoreRewardsDomGlobals);

describe("React Audience page", () => {
  it("reads the current tab on each SPA island entry", async () => {
    const calls = [];
    setAudiencePageDependenciesForTests({
      api: async (path) => {
        calls.push(path);
        if (path.startsWith("/api/people/members?")) {
          return { members: [member("member-1", "Alice")], page: { hasMore: false }, total: 1 };
        }
        if (path.startsWith("/api/people/reviews?")) {
          return {
            reviews: [{
              id: "review-spa",
              status: "pending",
              statusLabel: "Needs review",
              subject: { displayName: "Review member" },
              reason: { label: "Duplicate entry", explanation: "A matching eligibility signal was found." },
              source: { workflow: "Tournament signup", title: "SPA review signup" },
              createdAt: "2026-07-02T12:00:00.000Z",
            }],
            counts: { pending: 1, resolved: 0 },
          };
        }
        return {};
      },
      loadBoardShell: async () => ({ activeSiteId: "site-1", board: { name: "Creator site" } }),
      preserveSiteContextLinks: async () => {},
    });

    await window.happyDOM.setURL("http://localhost/dashboard/audience/members?siteId=site-1");
    document.body.innerHTML = '<main><div id="audience-app" data-audience-tab="viewers"></div></main>';
    audienceEntry = await import("../react/pages/audience/entry.tsx");
    await actAndFlush(() => audienceEntry.enter());
    audienceEntryMounted = true;

    expect(calls.some((path) => path.startsWith("/api/people/members?"))).toBe(true);

    await unmountAudienceEntry();
    await window.happyDOM.setURL("http://localhost/dashboard/audience/reviews?siteId=site-1");
    document.body.innerHTML = '<main><div id="audience-app" data-audience-tab="reviews"></div></main>';
    await actAndFlush(() => audienceEntry.enter());
    audienceEntryMounted = true;

    expect(calls.some((path) => path.startsWith("/api/people/reviews?"))).toBe(true);
    expect(document.querySelector(".audience-react h1")?.textContent).toBe("Reviews");
    expect(document.getElementById("people-reviews-list")?.textContent).toContain("SPA review signup");
  });

  it("opens the site-scoped member drawer from ?member=", async () => {
    const calls = [];
    await mountAudiencePage({
      url: "http://localhost/dashboard/audience/members?siteId=site-1&member=member-1",
      deps: {
        api: async (path, options, siteId) => {
          calls.push({ path, options, siteId });
          if (path === "/api/people/members/member-1") return { member: member("member-1", "Alice"), site: { name: "Creator site" } };
          if (path.startsWith("/api/people/members?")) return { members: [member("member-1", "Alice")], page: { hasMore: false }, total: 1 };
          return {};
        },
      },
    });

    expect(calls.some((call) => call.path === "/api/people/members/member-1" && call.siteId === "site-1")).toBe(true);
    const drawer = document.getElementById("audience-member-drawer");
    expect(drawer).toBeTruthy();
    expect(drawer.getAttribute("role")).toBe("dialog");
    expect(drawer.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById("cr-member-identity-heading").textContent).toBe("Alice");
  });

  it("keeps the tip recipient read-only and tied to the selected member", async () => {
    await mountAudiencePage();
    await clickReactTarget(document.querySelector('button[data-member-detail="member-1"]'));
    await clickReactTarget(document.getElementById("cr-member-history-tip"));

    const username = document.getElementById("cr-tip-username");
    expect(username.value).toBe("Alice");
    expect(username.readOnly).toBe(true);
    expect(document.getElementById("cr-tip-open-btn")).toBeNull();
  });

  it("exports the selected member snapshot as CSV", async () => {
    const downloads = [];
    await mountAudiencePage({
      deps: {
        api: async (path) => path.startsWith("/api/people/members?")
          ? { members: [member("member-1", "Alice")], page: { hasMore: false }, total: 1 }
          : {},
        downloadCsv: (content, filename) => downloads.push({ content, filename }),
      },
    });
    await clickReactTarget(document.querySelector('button[data-member-select="member-1"]'));
    await clickReactTarget(document.getElementById("cr-bulk-export"));

    expect(downloads).toHaveLength(1);
    expect(downloads[0].content).toContain("\uFEFFname,credits,total_earned,total_spent,blocked,last_active_at");
    expect(downloads[0].content).toContain("Alice,15,25,10,no,2026-07-02T12:00:00.000Z");
    expect(downloads[0].filename).toContain("members-site-1-");
  });

  it("blocks bulk awards above 25 selected recipients", async () => {
    const members = Array.from({ length: 25 }, (_, index) => member(`member-${index + 1}`));
    const awardCalls = [];
    await mountAudiencePage({
      deps: {
        api: async (path, options, siteId) => {
          if (path.startsWith("/api/people/members?")) {
            return path.includes("cursor=")
              ? { members: [member("member-26")], page: { hasMore: false }, total: 26 }
              : { members, page: { hasMore: true, nextCursor: "cursor-25" }, total: 26 };
          }
          awardCalls.push({ path, options, siteId });
          return {};
        },
      },
    });
    await clickReactTarget(document.getElementById("cr-member-select-all"));
    await clickReactTarget([...document.querySelectorAll("button")].find((button) => button.textContent === "Load more"));
    await clickReactTarget(document.querySelector('button[data-member-select="member-26"]'));

    expect(document.getElementById("cr-bulk-count").textContent).toContain("26 selected");
    expect(document.getElementById("cr-bulk-count").textContent).toContain("capped at 25");
    expect(document.getElementById("cr-bulk-award").disabled).toBe(true);
    expect(awardCalls).toEqual([]);
  });

  it("ignores member data that resolves after the site query changes", async () => {
    const pendingPage = deferred();
    await mountAudiencePage({
      deps: {
        api: (path) => path.startsWith("/api/people/members?") ? pendingPage.promise : Promise.resolve({}),
      },
    });
    await window.happyDOM.setURL("http://localhost/dashboard/audience/members?siteId=site-2");
    await actAndFlush(() => pendingPage.resolve({
      members: [member("stale-member", "Old site member")],
      page: { hasMore: false },
      total: 1,
    }));

    expect(document.body.textContent).not.toContain("Old site member");
    expect(document.getElementById("cr-viewer-list")?.textContent || "").not.toContain("Old site member");
  });

  it("loads Activity cursor pages without replacing earlier entries", async () => {
    const calls = [];
    await mountAudiencePage({
      tab: "history",
      url: "http://localhost/dashboard/audience/activity?siteId=site-1",
      deps: {
        api: async (path, options, siteId) => {
          calls.push({ path, options, siteId });
          if (!path.startsWith("/api/credits/activity")) return {};
          return calls.filter((call) => call.path.startsWith("/api/credits/activity")).length === 1
            ? {
              events: [{ id: "event-1", type: "earn", direction: "credit", amount: 10, kickUsername: "alice", description: "First", createdAt: "2026-07-02T12:00:00.000Z" }],
              nextCursor: "cursor-2",
            }
            : {
              events: [{ id: "event-2", type: "spend", direction: "debit", amount: 5, kickUsername: "bob", description: "Second", createdAt: "2026-07-01T12:00:00.000Z" }],
              nextCursor: null,
            };
        },
      },
    });
    await clickReactTarget(document.getElementById("cr-history-load-more"));

    const activityCalls = calls.filter((call) => call.path.startsWith("/api/credits/activity"));
    expect(activityCalls).toHaveLength(2);
    expect(new URL(`http://localhost${activityCalls[1].path}`).searchParams.get("cursor")).toBe("cursor-2");
    expect(document.getElementById("cr-history-feed-list").textContent).toContain("First");
    expect(document.getElementById("cr-history-feed-list").textContent).toContain("Second");
  });

  it("uses and consumes the one-shot Activity ?viewer= query", async () => {
    const calls = [];
    await mountAudiencePage({
      tab: "history",
      url: "http://localhost/dashboard/audience/activity?siteId=site-1&viewer=alice",
      deps: {
        api: async (path, options, siteId) => {
          calls.push({ path, options, siteId });
          if (path.startsWith("/api/credits/viewer/history")) return { boards: [] };
          if (path.startsWith("/api/credits/activity")) return { events: [], nextCursor: null };
          return {};
        },
      },
    });

    expect(calls.some((call) => call.path === "/api/credits/viewer/history?kickUsername=alice" && call.siteId === "site-1")).toBe(true);
    expect(calls.some((call) => call.path === "/api/credits/activity?kickUsername=alice")).toBe(true);
    expect(new URL(window.location.href).searchParams.has("viewer")).toBe(false);
  });

  it("applies Activity username filters only after submission", async () => {
    const calls = [];
    await mountAudiencePage({
      tab: "history",
      url: "http://localhost/dashboard/audience/activity?siteId=site-1",
      deps: {
        api: async (path, options, siteId) => {
          calls.push({ path, options, siteId });
          return path.startsWith("/api/credits/activity") ? { events: [], nextCursor: null } : {};
        },
      },
    });
    const initialActivityCalls = calls.filter((call) => call.path.startsWith("/api/credits/activity")).length;
    await setReactInputValue(document.getElementById("cr-history-username"), "alice");
    expect(calls.filter((call) => call.path.startsWith("/api/credits/activity"))).toHaveLength(initialActivityCalls);
    await actAndFlush(() => document.querySelector(".audience-activity-filters").dispatchEvent(
      new window.Event("submit", { bubbles: true, cancelable: true }),
    ));

    expect(calls.some((call) => call.path === "/api/credits/activity?kickUsername=alice")).toBe(true);
  });

  it("submits only a server-authorized review decision", async () => {
    const calls = [];
    const confirms = [];
    await mountAudiencePage({
      tab: "reviews",
      url: "http://localhost/dashboard/audience/reviews?siteId=site-1",
      deps: {
        confirm: async (...args) => {
          confirms.push(args);
          return true;
        },
        api: async (path, options, siteId) => {
          calls.push({ path, options, siteId });
          if (path.startsWith("/api/people/reviews?")) {
            return {
              reviews: [{
                id: "review-1",
                typeLabel: "Participant eligibility",
                status: "pending",
                statusLabel: "Needs review",
                allowedDecisions: ["allow"],
                subject: { displayName: "Pat", memberDisplayName: "Pat Member" },
                reason: { label: "Duplicate entry", explanation: "Two entries share an eligibility signal." },
                source: { workflow: "Tournament signup", title: "Spring tournament" },
                createdAt: "2026-07-02T12:00:00.000Z",
              }],
              counts: { pending: 1, resolved: 0 },
            };
          }
          if (path === "/api/people/reviews/review-1") {
            return { review: {
              id: "review-1",
              status: "pending",
              allowedDecisions: ["allow"],
              subject: { displayName: "Pat" },
              reason: { label: "Duplicate entry", explanation: "Two entries share an eligibility signal." },
              source: { workflow: "Tournament signup", title: "Spring tournament" },
              createdAt: "2026-07-02T12:00:00.000Z",
              context: { guidance: "Review the source signup." },
            } };
          }
          return {};
        },
      },
    });
    await clickReactTarget(document.querySelector('button[data-open-review="review-1"]'));
    expect(document.getElementById("people-review-exclude").hidden).toBe(true);
    await clickReactTarget(document.getElementById("people-review-allow"));

    const decision = calls.find((call) => call.path === "/api/people/reviews/review-1/decision");
    expect(confirms[0]).toEqual([
      "Allow this signup?",
      "This allows only this participant signup in the named tournament.",
      "Allow signup",
      false,
    ]);
    expect(decision.siteId).toBe("site-1");
    expect(JSON.parse(decision.options.body)).toEqual({ decision: "allow" });
  });

  it("confirms linked-account actions and keeps their existing request contract", async () => {
    const calls = [];
    const confirms = [];
    await mountAudiencePage({
      tab: "linked",
      url: "http://localhost/dashboard/audience/linked?siteId=site-1",
      deps: {
        confirm: async (...args) => {
          confirms.push(args);
          return true;
        },
        api: async (path, options, siteId) => {
          calls.push({ path, options, siteId });
          if (path.startsWith("/api/people/linked-accounts?")) {
            return {
              groups: [{
                id: "pair-1",
                linkIds: ["link-1", "link-2"],
                accounts: [{ displayName: "Alice" }, { displayName: "Alice alt" }],
                confidence: 85,
                reasons: [{ label: "Shared identity" }],
                summary: "These accounts share a verified connection.",
                status: "pending",
                firstDetectedAt: "2026-07-02T12:00:00.000Z",
              }],
              counts: { pending: 1, watching: 0, restricted: 0, dismissed: 0 },
            };
          }
          return { groups: [], counts: { pending: 0, watching: 0, restricted: 0, dismissed: 0 } };
        },
      },
    });
    expect(document.querySelector(".people-linked-pill").textContent).toBe("New");
    expect(document.querySelector('.people-review-filters[aria-label="Linked account status"] button').textContent.trim()).toMatch(/^Active/);
    await clickReactTarget([...document.querySelectorAll("button")].find((button) => button.textContent === "Watch"));

    const decision = calls.find((call) => call.path === "/api/people/linked-accounts/decision");
    expect(confirms[0]).toEqual([
      "Watch this link?",
      "The pair stays flagged for review. No restriction is applied.",
      "Watch",
      false,
    ]);
    expect(decision.siteId).toBe("site-1");
    expect(JSON.parse(decision.options.body)).toEqual({ linkIds: ["link-1", "link-2"], action: "watch" });
  });

  it("offers only remove-restriction and dismiss actions for restricted links", async () => {
    await mountAudiencePage({
      tab: "linked",
      url: "http://localhost/dashboard/audience/linked?siteId=site-1",
      deps: {
        api: async (path) => path.startsWith("/api/people/linked-accounts?")
          ? {
            groups: [{
              id: "pair-1",
              linkIds: ["link-1", "link-2"],
              accounts: [{ displayName: "Alice" }, { displayName: "Alice alt" }],
              confidence: 85,
              summary: "These accounts share a verified connection.",
              status: "restricted",
            }],
            counts: { pending: 0, watching: 0, restricted: 1, dismissed: 0 },
          }
          : { groups: [], counts: {} },
      },
    });

    expect([...document.querySelectorAll(".people-linked-actions button")].map((button) => button.textContent)).toEqual([
      "Remove restriction",
      "Dismiss",
    ]);
  });

  it("ignores an in-flight request after the island leaves", async () => {
    const pendingPage = deferred();
    const { container } = await mountAudiencePage({
      deps: {
        api: (path) => path.startsWith("/api/people/members?") ? pendingPage.promise : Promise.resolve({}),
      },
    });
    await unmountAudiencePage();
    await actAndFlush(() => pendingPage.resolve({
      members: [member("late-member", "Late response")],
      page: { hasMore: false },
      total: 1,
    }));

    expect(container.textContent).toBe("");
  });
});

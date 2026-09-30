import { describe, expect, it } from "bun:test";
import { buildHomeViewModel } from "../assets/dashboard/overview.js";

const SITE = "site-1";
const NOW = Date.parse("2026-09-30T12:00:00Z");

function makeInputs(overrides = {}) {
  return {
    state: {
      ACTIVE_SITE_ID: SITE,
      SLUG: "night-owls",
      BOARDS: [{ id: SITE, name: "Night Owls", userRole: "owner" }],
      ME: { emailVerified: true },
      ONBOARDING: {},
      CREDITS: { usage: { pendingRedemptions: 0 }, channel: null },
    },
    status: { live: false, published: false, emailVerified: true },
    siteName: "Night Owls",
    logoSrc: null,
    leaderboardEndsAt: null,
    steps: { brand: false, players: false, publish: false },
    sections: {
      activities: { status: "idle", data: null, error: null },
      giveaway: { status: "idle", data: null, error: null },
      insights: { status: "idle", data: null, error: null },
      recent: { status: "idle", data: null, error: null },
    },
    now: NOW,
    ...overrides,
  };
}

describe("Home serializable view model", () => {
  it("projects the community header and publication state without dashboard objects", () => {
    const vm = buildHomeViewModel(makeInputs({
      status: { live: true, published: true, emailVerified: true },
      state: { ...makeInputs().state, SLUG: "night-owls" },
      logoSrc: "https://cdn.example/logo.png",
    }));
    expect(vm.header).toMatchObject({
      siteName: "Night Owls",
      initial: "N",
      logoSrc: "https://cdn.example/logo.png",
      statusState: "live",
      statusLabel: "Live",
      publicHidden: false,
      publicHref: "/night-owls",
      headSub: "Your community is running. Here’s the latest.",
    });
    expect(JSON.parse(JSON.stringify(vm))).toEqual(vm);
    expect(JSON.stringify(vm)).not.toContain("ACTIVE_SITE_ID");
    expect(vm).not.toHaveProperty("actions");
  });

  it("includes all live, upcoming, pulse, recent and formatted values", () => {
    const vm = buildHomeViewModel(makeInputs({
      status: { live: true, published: true, emailVerified: true },
      leaderboardEndsAt: "2026-10-01T12:00:00Z",
      sections: {
        activities: {
          status: "ready",
          data: {
            activities: {
              totalOpen: 6,
              open: [{ id: "drop-1", typeLabel: "Code drop", stateLabel: "Open", claimed: 1234, capacity: 2000, creditsPerClaim: 25, endsAt: "2026-10-01T12:00:00Z" }],
            },
            automation: {
              upcoming: [{ id: "schedule-1", nextRunAt: "2026-10-02T12:00:00Z", templateName: "Friday drop", recurrence: "weekly" }],
              needsAttention: [],
            },
          },
          error: null,
        },
        giveaway: { status: "ready", data: { active: { id: "giveaway-1", keyword: "win", entries: 3 } }, error: null },
        insights: {
          status: "ready",
          data: { window: { effectiveDays: 30 }, community: { newMembers: 1234 }, participation: { participants: 6 }, rewards: { claimsCompleted: 2 } },
          error: null,
        },
        recent: {
          status: "ready",
          data: [{ kind: "member_joined", at: "2026-09-30T11:00:00Z", title: "Morgan", detail: "Joined your community" }],
          error: null,
        },
      },
    }));
    expect(vm.header.headSub).toBe("Your community is running. Here’s the latest.");
    expect(vm.live).toMatchObject({
      hidden: false,
      busy: false,
      summary: "7 running right now · showing 2.",
      items: [
        { kind: "code_drop", meta: "1,234 of 2,000 claims · 25 credits each · Ends Oct 1, 2026, 12:00 PM" },
        { kind: "chat_giveaway", meta: "3 entries · keyword “win”" },
      ],
    });
    expect(vm.upcoming.items).toHaveLength(2);
    expect(vm.upcoming.items[0]).toMatchObject({ kind: "leaderboard_period_end", at: "2026-10-01T12:00:00.000Z", formattedAt: "Oct 1, 2026, 12:00 PM" });
    expect(vm.pulse.metrics).toEqual([
      { key: "newMembers", label: "New members", value: "1,234" },
      { key: "participants", label: "Activity participants", value: "6" },
      { key: "claimsCompleted", label: "Claims completed", value: "2" },
    ]);
    expect(vm.recent.events[0]).toMatchObject({
      relative: "1h ago",
      formattedAt: "Sep 30, 2026, 11:00 AM",
    });
  });

  it("projects loading, error, forbidden, retry and empty states with exact copy", () => {
    const vm = buildHomeViewModel(makeInputs({
      sections: {
        activities: { status: "error", data: null, error: "network" },
        giveaway: { status: "idle", data: null, error: null },
        insights: { status: "error", data: null, error: "network" },
        recent: { status: "ready", data: [], error: null },
      },
    }));
    expect(vm.live).toMatchObject({ hidden: false, busy: false, error: { key: "activities", message: "Couldn't check what’s live." } });
    expect(vm.upcoming.error).toEqual({ key: "activities", message: "Couldn't load the schedule." });
    expect(vm.pulse).toMatchObject({ hidden: false, status: "error", error: { key: "insights", message: "Couldn't load the last 30 days." } });
    expect(vm.recent.empty).toEqual({ title: "Nothing yet", body: "New members, reward claims and Activity results will show up here." });

    const loading = buildHomeViewModel(makeInputs({
      sections: {
        activities: { status: "loading", data: null, error: null },
        giveaway: { status: "loading", data: null, error: null },
        insights: { status: "loading", data: null, error: null },
        recent: { status: "loading", data: null, error: null },
      },
    }));
    expect(loading.live).toMatchObject({ hidden: false, busy: true, loading: true });
    expect(loading.upcoming).toMatchObject({ hidden: false, busy: true, loading: true });
    expect(loading.pulse).toMatchObject({ busy: true, status: "loading" });
    expect(loading.recent.loading).toBe(true);

    const forbidden = buildHomeViewModel(makeInputs({
      sections: {
        ...makeInputs().sections,
        insights: { status: "forbidden", data: null, error: null },
        recent: { status: "forbidden", data: null, error: null },
      },
    }));
    expect(forbidden.pulse.hidden).toBe(true);
    expect(forbidden.recent.hidden).toBe(true);
  });

  it("keeps moderator-only setup semantics and derives every action and step label", () => {
    const vm = buildHomeViewModel(makeInputs({
      isModerator: true,
      ownerName: "Ari",
      steps: { brand: false, players: true, publish: false },
      status: { live: false, published: false, emailVerified: true },
    }));
    expect(vm.setup.hidden).toBe(false);
    expect(vm.setup.title).toBe("Setup progress");
    expect(vm.setup.message).toBe("Ask Ari to name the community. You can complete the remaining setup in the meantime.");
    expect(vm.setup.action).toMatchObject({ hidden: false, href: "#publish", label: "Publish community", publicationAction: true });
    expect(vm.setup.steps[0]).toMatchObject({
      ownerOnly: true,
      stateLabel: "Owner action required",
      stateKey: "owner-action",
      description: "Ari manages the community name and public identity.",
      rowClass: "ov-setup-row is-owner-action",
    });
    expect(vm.setup.steps[1]).toMatchObject({ stateLabel: "Done", stateKey: "done" });
    expect(vm.setup.steps[2]).toMatchObject({ stateLabel: "Next", stateKey: "next" });
  });

  it("matches the initial checking placeholder while the dashboard state is idle", () => {
    const vm = buildHomeViewModel(makeInputs({
      state: { ACTIVE_SITE_ID: null, BOARDS: [], SLUG: "", ME: null },
      status: { live: false, published: false, emailVerified: true },
      idle: true,
    }));
    expect(vm.header).toMatchObject({
      siteName: "Checking…",
      initial: "Y",
      statusState: "checking",
      statusLabel: "Checking…",
      headSub: "Your community at a glance.",
    });
  });
});

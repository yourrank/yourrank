import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { buildHomeViewModel, loadOverviewLiveData, openBrandModal, renderOverviewSummary } from "../assets/dashboard/overview.js";
import { state } from "../assets/dashboard/state.js";
import {
  actAndFlush,
  builtOverview,
  clickHomeTarget,
  document,
  flushReactUpdates,
  installOverviewDomGlobals,
  mountHome,
  renderHome,
  restoreOverviewDomGlobals,
  setHomeInputValue,
  unmountHomePage,
  window,
} from "./overview-react-utils.js";

const SITE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const stateKeys = ["ACTIVE_SITE_ID", "SLUG", "BOARDS", "ME", "ONBOARDING", "PUBLISHED", "IS_DRAFT", "SAMPLE_PLAYERS", "PLAYERS", "SAVED_PLAYERS", "CREDITS"];
const originalState = Object.fromEntries(stateKeys.map((key) => [key, state[key]]));

function viewModel(overrides = {}) {
  const stateInput = {
    ACTIVE_SITE_ID: SITE,
    SLUG: "night-owls",
    BOARDS: [{ id: SITE, name: "Night Owls", userRole: "owner" }],
    ME: { emailVerified: true },
    ONBOARDING: {},
    CREDITS: { usage: { pendingRedemptions: 0 }, channel: null },
  };
  return buildHomeViewModel({
    state: stateInput,
    status: { live: false, published: false, emailVerified: true },
    siteName: "Night Owls",
    logoSrc: null,
    steps: { brand: false, players: false, publish: false },
    sections: {
      activities: { status: "idle", data: null, error: null },
      giveaway: { status: "idle", data: null, error: null },
      insights: { status: "idle", data: null, error: null },
      recent: { status: "idle", data: null, error: null },
    },
    now: Date.parse("2026-09-30T12:00:00Z"),
    ...overrides,
  });
}

async function withActualActionBridge(run) {
  await actAndFlush(async () => {
    renderOverviewSummary();
    const root = document.querySelector('[data-page="home"] #ov-app');
    for (let attempt = 0; root && attempt < 20 && !root.querySelector("#ovSiteName"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  });
  return run();
}

afterEach(async () => {
  await unmountHomePage();
  Object.assign(state, originalState);
  restoreOverviewDomGlobals();
});

afterAll(() => {
  Object.assign(state, originalState);
  restoreOverviewDomGlobals();
  window.close();
});

describe("React Home island", () => {
  it("waits for the lazy bundle and commits incomplete setup before Home entry settles", async () => {
    installOverviewDomGlobals();
    document.body.innerHTML = '<section data-page="home"><div id="ov-app" class="yr-react"></div><input id="f_name" value=""><input id="f_ends" value=""></section>';
    state.ACTIVE_SITE_ID = SITE;
    state.SLUG = "night-owls";
    state.BOARDS = [{ id: SITE, name: "Night Owls", userRole: "owner" }];
    state.ME = { emailVerified: true };
    state.ONBOARDING = {};
    state.PUBLISHED = false;
    state.IS_DRAFT = true;
    state.SAMPLE_PLAYERS = false;
    state.PLAYERS = [];
    state.SAVED_PLAYERS = [];
    state.CREDITS = { usage: { pendingRedemptions: 0 }, channel: null };

    let responsesRead = 0;
    let resolveResponsesRead;
    const allResponsesRead = new Promise((resolve) => { resolveResponsesRead = resolve; });
    globalThis.fetch = async (url) => {
      const target = new URL(String(url), "http://localhost");
      const bodies = {
        "/api/activities": { ok: true, total: 0, activities: [], automation: { schedules: [] } },
        "/api/giveaways/chat": { ok: true, session: null, entries: [] },
        "/api/insights": { ok: true, window: { effectiveDays: 30 }, community: { newMembers: 0 }, participation: { participants: 0 }, rewards: { claimsCompleted: 0 } },
        "/api/home/activity": { ok: true, events: [] },
      };
      const body = bodies[target.pathname];
      return {
        ok: true,
        status: 200,
        async json() {
          responsesRead += 1;
          if (responsesRead === Object.keys(bodies).length) resolveResponsesRead();
          return body;
        },
      };
    };

    let releaseBundleImport;
    const bundleImport = new Promise((resolve) => {
      releaseBundleImport = () => resolve(builtOverview);
    });
    let entrySettled = false;
    const { loadOverviewLiveData: loadIsolatedOverviewLiveData } = await import("../assets/dashboard/overview.js?home-entry-barrier");
    const entry = loadIsolatedOverviewLiveData({ loadBundle: () => bundleImport }).then(() => {
      entrySettled = true;
    });
    await allResponsesRead;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(entrySettled).toBe(false);
    expect(document.querySelector("#ovSetup")).toBeNull();

    await actAndFlush(async () => {
      releaseBundleImport();
      await entry;
    });

    const setup = document.querySelector("#ovSetup");
    expect(setup).not.toBeNull();
    expect(setup.hidden).toBe(false);
  });

  it("renders one accessible Home surface in canonical section order", async () => {
    const { root } = await mountHome(viewModel());
    const ids = ["ovAttention", "ovLiveNow", "ovComingNext", "ovPulse", "ovRecent", "ovQuickActions", "ovSetup"];
    const renderedOrder = [...root.querySelectorAll("#ovAttention, #ovLiveNow, #ovComingNext, #ovPulse, #ovRecent, #ovQuickActions, #ovSetup")].map((node) => node.id);
    expect(renderedOrder).toEqual(ids);
    expect(root.querySelectorAll("#ovFigures")).toHaveLength(1);
    expect(root.querySelectorAll("#ovActivityList")).toHaveLength(1);
    expect(root.querySelectorAll("#ovQuickActionsList")).toHaveLength(1);
    expect(root.querySelector("#ovAttention").hidden).toBe(true);
    expect(root.querySelector("#ovAttention").getAttribute("role")).toBe("region");
    expect(root.querySelector("#ovAttention").getAttribute("aria-live")).toBe("polite");
    expect(root.querySelector("#ovLiveNow").hasAttribute("aria-busy")).toBe(false);
    expect(root.querySelector("#ovSetup").hidden).toBe(false);
    expect(root.querySelector("#ovSetup").getAttribute("aria-labelledby")).toBe("ovSetupTitle");
    expect(root.querySelector("#ovQuickActions").getAttribute("aria-labelledby")).toBe("ovQuickActionsTitle");
    expect(root.querySelectorAll("#ovLiveNow[hidden], #ovComingNext[hidden]")).toHaveLength(2);
    expect(root.querySelectorAll("#ovRecent .ov-live-row--skeleton")).toHaveLength(2);
    expect(root.querySelector("#ovSiteName").textContent).toBe("Night Owls");
  });

  it("falls back to the site initial when the logo fails to load", async () => {
    const { root } = await mountHome(viewModel({ logoSrc: "/uploads/site-logo.svg" }));
    const logo = root.querySelector("#ovSiteLogo");
    expect(logo.hidden).toBe(false);
    await actAndFlush(() => logo.dispatchEvent(new window.Event("error")));
    expect(logo.hidden).toBe(true);
    expect(root.querySelector("#ovSiteInitial").hidden).toBe(false);
    expect(root.querySelector("#ovSiteInitial").textContent).toBe("N");
  });

  it("renders the compact Nothing yet state, datetime and title values", async () => {
    const vm = viewModel({
      sections: {
        activities: { status: "ready", data: { activities: { open: [], totalOpen: 0 }, automation: { upcoming: [], needsAttention: [] } }, error: null },
        giveaway: { status: "ready", data: { active: null }, error: null },
        insights: { status: "ready", data: { window: { effectiveDays: 7 }, community: { newMembers: 0 } }, error: null },
        recent: { status: "ready", data: [{ kind: "member_joined", at: "2026-09-30T11:00:00Z", title: "Morgan", detail: "Joined your community" }], error: null },
      },
    });
    const { root } = await mountHome(vm);
    expect(root.querySelector("#ovActivityEmpty").hidden).toBe(true);
    const time = root.querySelector("#ovActivityList time");
    expect(time.getAttribute("datetime")).toBe("2026-09-30T11:00:00Z");
    expect(time.getAttribute("title")).toBe(vm.recent.events[0].formattedAt);

    const empty = viewModel({
      sections: {
        activities: { status: "ready", data: { activities: { open: [], totalOpen: 0 }, automation: { upcoming: [], needsAttention: [] } }, error: null },
        giveaway: { status: "ready", data: { active: null }, error: null },
        insights: { status: "ready", data: null, error: null },
        recent: { status: "ready", data: [], error: null },
      },
    });
    await unmountHomePage(root);
    const { root: emptyRoot } = await mountHome(empty);
    expect(emptyRoot.querySelector("#ovActivityEmpty").hidden).toBe(false);
    expect(emptyRoot.querySelector("#ovActivityEmpty .v3-empty.v3-empty--compact-heading").textContent).toContain("Nothing yet");
    expect(emptyRoot.querySelector("#ovActivityEmpty .v3-empty p").textContent).toBe("New members, reward claims and Activity results will show up here.");
  });

  it("delegates rendered retry and publication actions to the SPA bridge", async () => {
    const retry = [];
    let published = 0;
    const vm = viewModel({
      steps: { brand: true, players: true, publish: false },
      sections: {
        activities: { status: "error", data: null, error: "network" },
        giveaway: { status: "ready", data: { active: null }, error: null },
        insights: { status: "error", data: null, error: "network" },
        recent: { status: "ready", data: [], error: null },
      },
    });
    const { root } = await mountHome(vm, { retry: (key) => retry.push(key), publish: () => { published += 1; } });
    await clickHomeTarget(root.querySelector('[data-home-retry="activities"]'));
    expect(retry).toEqual(["activities"]);
    expect(root.querySelector('[data-home-retry="insights"]').textContent).toBe("Retry");
    expect(root.querySelector("#ovSetupAction").getAttribute("data-publication-action")).toBe("true");
    const clickEvent = new window.MouseEvent("click", { bubbles: true, cancelable: true });
    root.querySelector("#ovSetupAction").dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(true);
    expect(published).toBe(1);
  });

  it("keeps moderator-only setup rows as spans and brand rows as buttons", async () => {
    const vm = viewModel({
      isModerator: true,
      ownerName: "Ari",
      steps: { brand: false, players: false, publish: false },
    });
    const { root } = await mountHome(vm);
    const brand = root.querySelector('[data-setup-step="brand"]');
    expect(brand.tagName).toBe("SPAN");
    expect(brand.className).toContain("is-owner-action");
    expect(brand.getAttribute("data-setup-state")).toBe("owner-action");
    expect(brand.textContent).toContain("Owner action required");
    const players = root.querySelector('[data-setup-step="players"]');
    expect(players.tagName).toBe("A");
    const publish = root.querySelector('[data-setup-step="publish"]');
    expect(publish.tagName).toBe("A");
    expect(root.querySelector("#ovOperatorContext").textContent).toContain("Moderator for Ari");
  });

  it("exports a mounted-island brand opener and no-ops without a Home root", async () => {
    installOverviewDomGlobals();
    document.body.innerHTML = "<div></div>";
    await actAndFlush(() => openBrandModal());
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    const { root } = await mountHome(viewModel());
    const setupAction = root.querySelector("#ovSetupAction");
    expect(setupAction.getAttribute("data-brand-action")).toBe("true");
    await clickHomeTarget(setupAction);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await clickHomeTarget(document.querySelector('[data-brand="cancel"]'));
    await actAndFlush(() => openBrandModal());
    expect(document.querySelector('[role="dialog"] h3').textContent).toBe("Name your site");
    expect(document.activeElement).toBe(document.querySelector("#brandNameInput"));
    await clickHomeTarget(document.querySelector('[data-brand="cancel"]'));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("does not restore focus to the brand trigger on a later Home update", async () => {
    const { root, actions } = await mountHome(viewModel());
    const trigger = root.querySelector('[data-setup-step="brand"]');

    await clickHomeTarget(trigger);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await clickHomeTarget(document.querySelector('[data-brand="cancel"]'));
    expect(document.activeElement).toBe(trigger);

    const elsewhere = document.createElement("button");
    elsewhere.textContent = "Elsewhere";
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    await actAndFlush(() => renderHome(root, viewModel({ siteName: "Day Owls" }), actions));

    expect(document.activeElement).toBe(elsewhere);
  });

  it("lazy-loads the built overview entry and coalesces pre-import publications", async () => {
    installOverviewDomGlobals();
    document.body.innerHTML = '<section data-page="home"><input id="f_name" value="Night Owls"><input id="f_ends" value=""></section>';
    state.ACTIVE_SITE_ID = SITE;
    state.SLUG = "night-owls";
    state.BOARDS = [{ id: SITE, name: "Night Owls", userRole: "owner" }];
    state.ME = { emailVerified: true };
    state.ONBOARDING = {};
    state.PUBLISHED = false;
    state.IS_DRAFT = true;
    state.SAMPLE_PLAYERS = false;
    state.PLAYERS = [];
    state.SAVED_PLAYERS = [];
    state.CREDITS = { usage: { pendingRedemptions: 0 }, channel: null };
    expect(() => renderOverviewSummary()).not.toThrow();
    document.querySelector('[data-page="home"]').insertAdjacentHTML("afterbegin", '<div id="ov-app" class="yr-react"></div>');
    const root = document.getElementById("ov-app");
    await actAndFlush(async () => {
      document.getElementById("f_name").value = "First";
      renderOverviewSummary();
      document.getElementById("f_name").value = "Final";
      renderOverviewSummary();
      for (let attempt = 0; attempt < 20 && !root.querySelector("#ovSiteName"); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });
    expect(root.querySelector("#ovSiteName").textContent).toBe("Final");
    expect(root.querySelector("#ovLiveNow")).not.toBeNull();

    const { unmountHome } = await import("../assets/react/overview.js");
    await actAndFlush(() => unmountHome(root));
  });

  it("saves a brand name successfully through the actual SPA action bridge", async () => {
    installOverviewDomGlobals();
    document.body.innerHTML = '<section data-page="home"><div id="ov-app" class="yr-react"></div><input id="f_name" value=""><input id="f_ends" value=""><button id="publishAction"></button></section>';
    document.cookie = "__csrf=csrf-token";
    state.ACTIVE_SITE_ID = SITE;
    state.SLUG = "night-owls";
    state.BOARDS = [{ id: SITE, name: "Night Owls", userRole: "owner", ownerName: "Ari" }];
    state.ME = { emailVerified: true };
    state.ONBOARDING = {};
    state.PUBLISHED = false;
    state.IS_DRAFT = true;
    state.SAMPLE_PLAYERS = false;
    state.PLAYERS = [];
    state.SAVED_PLAYERS = [];
    state.CREDITS = { usage: { pendingRedemptions: 0 }, channel: null };
    let request;
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith("/api/site")) {
        request = { url, init };
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    };
    await withActualActionBridge(async () => {
      const trigger = document.querySelector('[data-setup-step="brand"]');
      expect(trigger.tagName).toBe("BUTTON");
      await clickHomeTarget(trigger);
      await setHomeInputValue(document.querySelector("#brandNameInput"), "  Night Owls  ");
      await clickHomeTarget(document.querySelector('[data-brand="save"]'));
      await flushReactUpdates();
    });
    expect(request.url).toBe("/api/site");
    expect(request.init.method).toBe("PUT");
    expect(request.init.credentials).toBe("include");
    expect(request.init.headers).toEqual({ "content-type": "application/json", "x-csrf-token": "csrf-token" });
    expect(JSON.parse(request.init.body)).toEqual({ siteId: SITE, name: "Night Owls" });
    expect(document.getElementById("f_name").value).toBe("Night Owls");
    expect(state.ONBOARDING.brand).toBe(true);
    expect(document.querySelector("#yrToastContainer").textContent).toContain("Site named.");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("shows exact save failure copy and busy state in the brand dialog", async () => {
    const pendingSave = {};
    const actions = {
      saveBrandName: () => new Promise((resolve) => { pendingSave.resolve = resolve; }),
    };
    const { root } = await mountHome(viewModel(), actions);
    const trigger = root.querySelector('[data-setup-step="brand"]');
    trigger.focus();
    await clickHomeTarget(trigger);
    const input = document.querySelector("#brandNameInput");
    expect(document.activeElement).toBe(input);
    await setHomeInputValue(input, "  ");
    await clickHomeTarget(document.querySelector('[data-brand="save"]'));
    expect(document.querySelector("#brandNameErr").textContent).toBe("Enter a site name.");
    expect(document.activeElement).toBe(input);
    expect(pendingSave.resolve).toBeUndefined();
    await setHomeInputValue(document.querySelector("#brandNameInput"), "Night Owls");
    await clickHomeTarget(document.querySelector('[data-brand="save"]'));
    expect(document.querySelector("#brandNameErr").textContent).toBe("Saving…");
    expect(document.querySelector(".modal-actions [data-brand=\"save\"]").disabled).toBe(true);
    expect(document.querySelector('[data-brand="save"]').getAttribute("aria-busy")).toBe("true");
    await actAndFlush(() => pendingSave.resolve({ ok: false, error: "This name is already in use." }));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector("#brandNameErr").textContent).toBe("This name is already in use.");
    expect(document.querySelector(".modal-actions [data-brand=\"save\"]").disabled).toBe(false);
    await clickHomeTarget(document.querySelector('[data-brand="cancel"]'));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement === trigger).toBe(true);
  });

  it("hides a section when its request is forbidden", async () => {
    installOverviewDomGlobals();
    document.body.innerHTML = '<section data-page="home"><div id="ov-app" class="yr-react"></div><input id="f_name" value="Night Owls"><input id="f_ends" value=""></section>';
    state.ACTIVE_SITE_ID = SITE;
    state.SLUG = "night-owls";
    state.BOARDS = [{ id: SITE, name: "Night Owls", userRole: "owner" }];
    state.ME = { emailVerified: true };
    state.ONBOARDING = {};
    state.PUBLISHED = false;
    state.IS_DRAFT = true;
    state.SAMPLE_PLAYERS = false;
    state.PLAYERS = [];
    state.SAVED_PLAYERS = [];
    state.CREDITS = { usage: { pendingRedemptions: 0 }, channel: null };
    globalThis.fetch = async (url) => {
      const target = new URL(String(url), "http://localhost");
      if (target.pathname === "/api/insights") {
        return new Response(JSON.stringify({ error: "Not allowed." }), { status: 403, headers: { "content-type": "application/json" } });
      }
      if (target.pathname === "/api/activities") {
        return new Response(JSON.stringify({ ok: true, total: 0, activities: [], automation: { schedules: [] } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (target.pathname === "/api/giveaways/chat") {
        return new Response(JSON.stringify({ ok: true, session: null, entries: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (target.pathname === "/api/home/activity") {
        return new Response(JSON.stringify({ ok: true, events: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    };
    await actAndFlush(() => loadOverviewLiveData());
    const pulse = document.querySelector("#ovPulse");
    expect(pulse.hidden).toBe(true);
    expect(pulse.querySelector('[data-home-retry="insights"]')).toBeNull();
    expect(pulse.textContent).not.toContain("Not allowed.");
  });

  it("ignores a stale selected-site response", async () => {
    installOverviewDomGlobals();
    document.body.innerHTML = '<section data-page="home"><div id="ov-app" class="yr-react"></div><input id="f_name" value=""><input id="f_ends" value=""></section>';
    state.ACTIVE_SITE_ID = SITE;
    state.SLUG = "night-owls";
    state.BOARDS = [
      { id: SITE, name: "Night Owls", userRole: "owner" },
      { id: OTHER, name: "Day Owls", userRole: "owner" },
    ];
    state.ME = { emailVerified: true };
    state.ONBOARDING = {};
    state.PUBLISHED = false;
    state.IS_DRAFT = true;
    state.SAMPLE_PLAYERS = false;
    state.PLAYERS = [];
    state.SAVED_PLAYERS = [];
    state.CREDITS = { usage: { pendingRedemptions: 0 }, channel: null };
    let releaseOldActivities;
    globalThis.fetch = async (url) => {
      const target = new URL(String(url), "http://localhost");
      const siteId = target.searchParams.get("siteId");
      if (target.pathname === "/api/activities" && siteId === SITE) {
        return new Promise((resolve) => { releaseOldActivities = () => resolve(new Response(JSON.stringify({
          ok: true,
          total: 1,
          activities: [{ id: "stale-drop", source: { kind: "code_drop" }, type: "drop", state: "open", progress: { claimed: 1, capacity: 2 }, reward: { creditsPerClaim: 3 } }],
          automation: { schedules: [] },
        }), { status: 200, headers: { "content-type": "application/json" } })); });
      }
      if (target.pathname === "/api/activities") {
        return new Response(JSON.stringify({ ok: true, total: 0, activities: [], automation: { schedules: [] } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (target.pathname === "/api/giveaways/chat") return new Response(JSON.stringify({ ok: true, session: null, entries: [] }), { status: 200, headers: { "content-type": "application/json" } });
      if (target.pathname === "/api/insights") return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      if (target.pathname === "/api/home/activity") return new Response(JSON.stringify({ ok: true, events: [] }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    };

    const oldLoad = loadOverviewLiveData();
    state.ACTIVE_SITE_ID = OTHER;
    state.SLUG = "day-owls";
    const currentLoad = loadOverviewLiveData();
    await currentLoad;
    await flushReactUpdates();
    expect(document.querySelector("#ovSiteName").textContent).toBe("Day Owls");
    expect(document.querySelector("#ovLiveNow").hidden).toBe(true);
    releaseOldActivities();
    await oldLoad;
    await flushReactUpdates();
    expect(document.querySelector("#ovSiteName").textContent).toBe("Day Owls");
    expect(document.body.textContent).not.toContain("stale-drop");
  });
});

// Appearance draft preview: the frame beside the editor shows the current
// unsaved draft, the public site keeps showing the last published state until
// the creator publishes, and the strip between them says which is which.
//
// These are behavior tests against the real Appearance markup in a DOM: real
// toggles fire real change events, the real preview pipeline debounces and
// submits the real form, and the assertions read the draft the frame was
// asked to render. The only stand-ins are the network (the form's `submit`
// and the save's fetch) and layout metrics a headless DOM cannot measure.
//
// Run: bun test src/__tests__/appearance-preview-flow.test.js
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { DashboardContent } from "../pages/dashboard.jsx";
import { handleDashboardPreview, previewDeviceFromParam, PREVIEW_DEVICE_WIDTHS } from "../handlers/preview.js";

const window = new Window({ url: "http://localhost/dashboard/leaderboard/design" });
const { document } = window;
for (const key of ["window", "document", "location", "history", "navigator", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "DOMParser", "getComputedStyle"]) {
  globalThis[key] = key === "getComputedStyle" ? window.getComputedStyle.bind(window) : window[key];
}
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });

// Every mount is "on screen": layout is not what these tests measure.
window.Element.prototype.getClientRects = function () { return [{}]; };

// The preview POSTs a hidden form at a named frame; capture what it would send.
const submissions = [];
window.HTMLFormElement.prototype.submit = function () {
  submissions.push({
    action: this.getAttribute("action") || this.action,
    target: this.target,
    draft: JSON.parse(this.querySelector("input[name='draft']").value),
  });
};

document.body.innerHTML = DashboardContent({ user: { email: "creator@example.com", plan: "pro" }, activePath: "/dashboard/leaderboard/design" }).toString();
// Boot reveals the workspace once the account has loaded (`$("dash").hidden = false`).
document.getElementById("dash").hidden = false;
document.querySelector('section[data-page="board"]').classList.add("is-on");

const { state, markDirty, setState } = await import("../assets/dashboard/state.js");
const site = await import("../assets/dashboard/site.js");
const { publicationCopy } = site;

const DEBOUNCE = 320;
const settle = (ms = DEBOUNCE) => new Promise((resolve) => setTimeout(resolve, ms));
const mount = () => document.querySelector('[data-preview-mount="board"]');
const toggle = (key) => document.querySelector(`[data-section-toggle="${key}"]`);
const lastDraft = () => submissions.at(-1)?.draft;
const publication = () => mount().querySelector("[data-preview-publication]").textContent;

function resetEditor({ published = true } = {}) {
  submissions.length = 0;
  Object.assign(state, {
    ACTIVE_SITE_ID: "site-1",
    SLUG: "kick-cup",
    BOARDS: [{ id: "site-1", name: "Kick Cup", published }],
    ME: { plan: "pro", emailVerified: true },
    PLAYERS: [],
    SAVED_PLAYERS: [],
    CURRENT_BRANDING: { template: "cyber_arcade", accentA: "#5b5bf5", accentB: "#7b7bf8", font: "Inter" },
    EXTRA: { chips: [], whyStats: [], rules: [], socials: [], sections: {}, playerFields: [], prizes: {}, navigation: {} },
    DRAFT_REVISION: 0,
  });
  setState({ PUBLISHED: published, _dirty: false });
  document.getElementById("f_name").value = "Kick Cup";
  document.getElementById("f_font").value = "Inter";
  const m = mount();
  delete m.dataset.previewPaused;
  if (m._yrPreview) { clearTimeout(m._yrPreview.timeout); clearTimeout(m._yrPreview.watchdog); m._yrPreview.draftRevision = -1; }
  site.renderSections();
}

// The last-published state a visitor sees. It only moves when a publish
// request succeeds, so it stands in for the public site in these tests.
function liveSiteServer() {
  const server = { sections: { leaderboard: true }, puts: 0 };
  server.fetch = async (_url, init) => {
    server.puts++;
    const payload = JSON.parse(init.body);
    server.sections = payload.sections;
    return new Response(JSON.stringify({ ok: true, updatedAt: "2026-09-19T14:00:00Z", publishedAt: "2026-09-19T14:00:00Z" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return server;
}

describe("Layout & blocks toggles drive the draft preview", () => {
  beforeEach(() => resetEditor());
  afterEach(() => { document.getElementById("previewLargeModal")?.remove(); });

  it("Show Leaderboard OFF hides the leaderboard in the next draft render and marks the draft unpublished", async () => {
    const input = toggle("leaderboard");
    expect(input.checked).toBe(true);
    input.checked = false;
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
    expect(state.EXTRA.sections.leaderboard).toBe(false);
    expect(state._dirty).toBe(true);
    expect(publication()).toBe("Changes not published");
    expect(publicationCopy().saveLabel).toBe("Publish changes");
    expect(submissions).toHaveLength(0);
    await settle();
    expect(submissions).toHaveLength(1);
    expect(submissions[0].action).toContain("/dashboard/preview?board=site-1&device=desktop");
    expect(submissions[0].target).toBe("designPreview");
    expect(lastDraft().sections.leaderboard).toBe(false);
  });

  it("every Layout & blocks toggle follows the same path and the preview gets the normalized sections", async () => {
    const keys = [...document.querySelectorAll("[data-section-toggle]")].map((input) => input.dataset.sectionToggle);
    expect(keys).toEqual(["leaderboard", "payouts", "countdown", "rules", "socials", "share", "poweredBy"]);
    for (const key of keys) {
      const before = state.DRAFT_REVISION;
      const input = toggle(key);
      input.checked = !input.checked;
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
      expect(state.EXTRA.sections[key]).toBe(input.checked);
      expect(state.DRAFT_REVISION).toBe(before + 1);
    }
    // Seven toggles in one burst cost one render, on the current draft.
    await settle();
    expect(submissions).toHaveLength(1);
    const sections = lastDraft().sections;
    for (const key of keys) {
      expect(typeof sections[key]).toBe("boolean");
      expect(sections[key]).toBe(state.EXTRA.sections[key]);
    }
    expect(sections.leaderboard).toBe(false);
    expect(sections.poweredBy).toBe(true);
  });

  it("keeps the live site on the published state until Publish changes, then both agree", async () => {
    const server = liveSiteServer();
    expect(publication()).toBe("All changes published");

    const input = toggle("leaderboard");
    input.checked = false;
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
    await settle();
    expect(lastDraft().sections.leaderboard).toBe(false);
    expect(server.sections.leaderboard).toBe(true);
    expect(server.puts).toBe(0);
    expect(publication()).toBe("Changes not published");

    const saved = await site.saveEditorDraft({ fetchImpl: server.fetch });
    expect(saved).toBe(true);
    expect(server.puts).toBe(1);
    expect(server.sections.leaderboard).toBe(false);
    expect(state._dirty).toBe(false);
    expect(state.PUBLISHED).toBe(true);
    expect(publication()).toBe("All changes published");
    expect(publicationCopy().saveLabel).toBe("Save changes");
    await settle();
    expect(lastDraft().sections.leaderboard).toBe(false);
  });

  it("does not call an unpublished board published", () => {
    resetEditor({ published: false });
    site.updateDesignPreview();
    expect(publication()).toBe("Not live yet");
  });
});

describe("device modes", () => {
  beforeEach(() => resetEditor());

  it("offers Desktop, Tablet and Mobile, and switching keeps the current draft", async () => {
    const tabs = [...mount().querySelectorAll(".preview-tab")];
    expect(tabs.map((tab) => tab.dataset.device)).toEqual(["desktop", "tablet", "mobile"]);
    expect(tabs.map((tab) => Number(tab.dataset.width))).toEqual([1100, 820, 390]);
    toggle("leaderboard").checked = false;
    toggle("leaderboard").dispatchEvent(new window.Event("change", { bubbles: true }));
    await settle();
    for (const device of ["tablet", "mobile", "desktop"]) {
      for (const tab of tabs) {
        const on = tab.dataset.device === device;
        tab.classList.toggle("is-active", on);
        tab.setAttribute("aria-selected", String(on));
      }
      site.refreshDesignPreview();
      await settle();
      expect(submissions.at(-1).action).toContain(`device=${device}`);
      expect(lastDraft().sections.leaderboard).toBe(false);
      expect(state.EXTRA.sections.leaderboard).toBe(false);
      expect(state._dirty).toBe(true);
    }
  });

  it("the handler renders tablet at its own width and falls back to desktop for unknown devices", async () => {
    expect(previewDeviceFromParam("tablet")).toBe("tablet");
    expect(previewDeviceFromParam("watch")).toBe("desktop");
    expect(previewDeviceFromParam(null)).toBe("desktop");
    expect(PREVIEW_DEVICE_WIDTHS.tablet).toBe(820);
    const deps = {
      currentUserImpl: async () => ({ id: "u1", plan: "pro" }),
      getUserSiteByIdImpl: async () => ({ id: "site-1", slug: "kick-cup", data: { brand: { name: "Kick Cup" }, sections: { leaderboard: true } } }),
    };
    const res = await handleDashboardPreview(new Request("http://localhost/dashboard/preview?board=site-1&device=tablet", { method: "GET", headers: { cookie: "yr_session=x" } }), {}, "nonce", deps);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("min-width: 820px");
    expect(html).not.toContain("min-width: 1100px");
  });
});

describe("preview sizing", () => {
  it("never shrinks the page below a legible scale; a narrow frame scrolls instead", () => {
    const fit = site.previewFit({ deviceWidth: 1100, frameWidth: 310, contentHeight: 1400, maxHeight: 600 });
    expect(fit.scale).toBeCloseTo(0.62);
    expect(fit.overflowsWidth).toBe(true);
    expect(fit.scaledWidth).toBe(682);
    expect(fit.frameHeight).toBe(600);
  });

  it("fits a wide frame exactly and never upscales past 1:1", () => {
    const wide = site.previewFit({ deviceWidth: 1100, frameWidth: 800, contentHeight: 1400, maxHeight: 900 });
    expect(wide.scale).toBeCloseTo(800 / 1100);
    expect(wide.overflowsWidth).toBe(false);
    const mobile = site.previewFit({ deviceWidth: 390, frameWidth: 800, contentHeight: 900, maxHeight: 700 });
    expect(mobile.scale).toBe(1);
    expect(mobile.scaledWidth).toBe(390);
    expect(mobile.frameHeight).toBe(700);
  });

  it("gives a short page only the height it needs", () => {
    const fit = site.previewFit({ deviceWidth: 1100, frameWidth: 880, contentHeight: 700, maxHeight: 900 });
    expect(fit.frameHeight).toBe(fit.scaledHeight);
    expect(fit.scaledHeight).toBe(560);
  });
});

describe("Open large preview", () => {
  beforeEach(() => resetEditor());
  afterEach(() => { document.getElementById("previewLargeModal")?.remove(); delete mount().dataset.previewPaused; });

  it("renders the current unsaved draft on the current device in a dialog, not the public site", async () => {
    toggle("leaderboard").checked = false;
    toggle("leaderboard").dispatchEvent(new window.Event("change", { bubbles: true }));
    await settle();
    const tabs = [...mount().querySelectorAll(".preview-tab")];
    for (const tab of tabs) tab.classList.toggle("is-active", tab.dataset.device === "mobile");
    const before = submissions.length;
    mount().querySelector("[data-preview-expand]").click();
    const overlay = document.getElementById("previewLargeModal");
    expect(overlay).not.toBeNull();
    expect(overlay.getAttribute("role")).toBe("dialog");
    const large = overlay.querySelector('[data-preview-mount="board-large"]');
    expect(large.querySelector(".preview-tab.is-active").dataset.device).toBe("mobile");
    expect(large.querySelector("[data-preview-publication]").textContent).toBe("Changes not published");
    await settle();
    const opened = submissions.slice(before);
    expect(opened.length).toBeGreaterThan(0);
    const last = opened.at(-1);
    expect(last.target).toBe("designPreviewLarge");
    expect(last.action).toContain("/dashboard/preview?board=site-1&device=mobile");
    expect(last.draft.sections.leaderboard).toBe(false);
    expect(overlay.querySelector("a[href*='/kick-cup']")).toBeNull();
  });

  it("pauses the rail while open, re-syncs it on close and hands back the chosen device", async () => {
    mount().querySelector("[data-preview-expand]").click();
    const overlay = document.getElementById("previewLargeModal");
    const large = overlay.querySelector("[data-preview-mount]");
    await settle();
    const before = submissions.length;
    toggle("payouts").checked = false;
    toggle("payouts").dispatchEvent(new window.Event("change", { bubbles: true }));
    await settle();
    const during = submissions.slice(before);
    expect(during).toHaveLength(1);
    expect(during[0].target).toBe("designPreviewLarge");
    expect(during[0].draft.sections.payouts).toBe(false);
    for (const tab of large.querySelectorAll(".preview-tab")) tab.classList.toggle("is-active", tab.dataset.device === "tablet");
    overlay.querySelector("[data-preview-close]").click();
    expect(document.getElementById("previewLargeModal")).toBeNull();
    expect(mount().dataset.previewPaused).toBeUndefined();
    expect(mount().querySelector(".preview-tab.is-active").dataset.device).toBe("tablet");
    await settle();
    const after = submissions.at(-1);
    expect(after.target).toBe("designPreview");
    expect(after.action).toContain("device=tablet");
    expect(after.draft.sections.payouts).toBe(false);
  });
});

describe("a hidden mount catches up when shown", () => {
  beforeEach(() => resetEditor());

  it("skips work while paused and re-renders the newest draft once visible", async () => {
    const m = mount();
    site.updateDesignPreview();
    await settle();
    const before = submissions.length;
    m.dataset.previewPaused = "1";
    markDirty();
    await settle();
    expect(submissions).toHaveLength(before);
    delete m.dataset.previewPaused;
    site.fitDesignPreview();
    await settle();
    expect(submissions).toHaveLength(before + 1);
    site.fitDesignPreview();
    await settle();
    expect(submissions).toHaveLength(before + 1);
  });
});

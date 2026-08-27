// Site settings is the creator's customizer: the public-site branding,
// navigation, links and address a viewer sees, next to a preview of the real
// public site. These tests pin the parts a creator depends on — labelled
// controls, a viewer-accurate preview mount, an honest save state — so the
// section cannot silently lose them.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { DashboardContent } from "../pages/dashboard.jsx";
import { FONT_KEYS } from "../site.js";

const siteJs = readFileSync(new URL("../assets/dashboard/site.js", import.meta.url), "utf8");
const accountJs = readFileSync(new URL("../assets/dashboard/account.js", import.meta.url), "utf8");
const previewTabsJs = readFileSync(new URL("../assets/dashboard/preview-tabs.js", import.meta.url), "utf8");
const dashboardCss = readFileSync(new URL("../assets/dashboard-v4.css", import.meta.url), "utf8");

const html = DashboardContent({ user: { email: "creator@example.com", plan: "pro" }, activePath: "/dashboard/site" }).toString();
const customize = html.slice(
  html.indexOf('data-settings-panel="customize"'),
  html.indexOf('data-settings-panel="notifications"'),
);

describe("markup: Site settings answers what viewers see", () => {
  it("titles the section for the public site and offers the real thing", () => {
    expect(html).toContain("<h1>Site settings</h1>");
    expect(html).toContain("Customize what viewers see on your public site.");
    expect(html).toMatch(/id="sitePublicSiteAction"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
    expect(html).toContain("View public site ↗");
    // One heading level 1 in the rendered section body.
    const start = html.indexOf('data-page="site"');
    const body = html.slice(start, html.indexOf('data-page="', start + 10));
    expect(body.match(/<h1[ >]/g)).toHaveLength(1);
  });

  it("mounts a read-only viewer preview with desktop and mobile viewports", () => {
    expect(customize).toContain('data-preview-mount="site"');
    expect(customize).toContain('data-preview-target="sitePreview"');
    // The editor's in-canvas text editing is the editor's job; here the form
    // beside the preview owns editing.
    expect(customize).toContain('data-preview-edit="0"');
    expect(customize).toMatch(/data-device="desktop"/);
    expect(customize).toMatch(/data-width="390"[^>]*data-device="mobile"/);
    expect(customize).toMatch(/id="sitePreviewStatus"[^>]*aria-live="polite"/);
    expect(customize).toContain('id="sitePreviewRefresh"');
    expect(customize).toContain("data-preview-retry");
  });

  it("labels every brand control and explains its limits", () => {
    expect(customize).toMatch(/<label class="v3-settings-label" for="f_name">Site name<\/label>/);
    expect(customize).toMatch(/id="f_name" maxlength="80"[^>]*aria-describedby="siteNameCounter siteNameError"/);
    expect(customize).toMatch(/id="siteNameCounter"[^>]*aria-live="polite"/);
    expect(customize).toMatch(/id="siteNameError"[^>]*data-field-error="f_name"[^>]*role="alert"/);
    expect(customize).toContain("Short line shown under your name.");
    expect(customize).toMatch(/id="f_tagline" maxlength="120"/);
    // Logo: the accepted types and the size ceiling are stated before upload,
    // and the visible controls are buttons, not a raw file input.
    expect(customize).toMatch(/id="logoFile" accept="image\/png,image\/jpeg,image\/webp"[^>]*hidden/);
    expect(customize).toContain("PNG, JPG or WebP, up to 2 MB.");
    expect(customize).toMatch(/<button class="btn btn--sm" id="logoPick" type="button">Upload logo<\/button>/);
    expect(customize).toContain('id="logoClear"');
    expect(customize).toMatch(/id="logoStatus"[^>]*aria-live="polite"/);
    expect(siteJs).toContain('$("logoPick")?.addEventListener("click", () => $("logoFile")?.click())');
    // Accent: curated choices first, custom picker behind a disclosure.
    expect(customize).toMatch(/id="colorPresets"[^>]*role="group"[^>]*aria-labelledby="siteAccentLabel"/);
    expect(customize).toContain("Used for active navigation, buttons and highlights.");
    expect(customize).toContain('<details class="advanced-colors"><summary>Custom accent color</summary>');
    expect(customize).toContain('<label for="c_a" class="sr-only">Accent color</label>');
  });

  it("offers no template marketplace, only the supported brand controls", () => {
    // The public viewer is one coherent system; three radically different
    // "templates" would promise products that do not exist.
    for (const gone of ["templateSelectorGrid", "template-select-card", "data-template=", "Cyber Arcade", "Esports Arena", "Creator Glass", "glassmorphism"]) {
      expect(customize).not.toContain(gone);
    }
    expect(dashboardCss).not.toContain("template-select");
    expect(siteJs).not.toContain("templateSelectorGrid");
    expect(customize).toContain("Your logo, accent color and text style.");
    // The stored template value still rides through save for legacy rows.
    expect(siteJs).toContain('template: state.CURRENT_BRANDING?.template || "cyber_arcade"');
    expect(siteJs).toContain('template: br.template || "cyber_arcade"');
  });

  it("offers only fonts the public site can serve", () => {
    const options = [...customize.matchAll(/<select id="f_font"[^>]*>([\s\S]*?)<\/select>/g)]
      .flatMap((match) => [...match[1].matchAll(/value="([^"]+)"/g)].map((option) => option[1]));
    expect(options.length).toBeGreaterThan(0);
    expect(options.filter((font) => !FONT_KEYS.includes(font))).toEqual([]);
    expect(customize).toContain("Only fonts your public site can serve are listed.");
  });

  it("keeps navigation, links and the public address on the same page", () => {
    expect(customize).toContain("<h2>Navigation</h2>");
    expect(customize).toContain('id="siteSectionRows"');
    expect(customize).toContain("<h2>Links</h2>");
    expect(customize).toContain('id="socialsList"');
    expect(customize).toContain('id="sitePublicUrl"');
    expect(customize).toContain('id="sitePublicCopy"');
    expect(customize).toMatch(/id="sitePublicOpen"[^>]*rel="noopener noreferrer"/);
    expect(customize).toMatch(/id="sitePublicCopyStatus"[^>]*aria-live="polite"/);
    expect(customize).toContain('id="sitePublicDomainSummary"');
    // Domain infrastructure keeps its own tab; this is a pointer to it.
    expect(customize).toMatch(/id="sitePublicDomainManage"[^>]*data-settings-tab-link="domain"/);
  });

  it("puts the save bar directly under the tabs, ahead of every panel", () => {
    const preview = customize.indexOf("v3-customize-preview");
    const controls = customize.indexOf("v3-customize-controls");
    expect(preview).toBeGreaterThanOrEqual(0);
    expect(preview).toBeLessThan(controls);
    // Desktop reads controls-first; the sticky preview sits beside them.
    expect(dashboardCss).toContain(".v3-dash[data-auth-workspace] .v3-customize-controls {\n    order: -1;\n  }");
    expect(dashboardCss).toContain(".v3-dash[data-auth-workspace] .v3-customize-preview {\n    position: sticky;");
    // The save bar follows the tabs so an edit at the top of Customize
    // surfaces Save without scrolling; sticky CSS keeps it available while
    // scrolling further down.
    const saveBar = html.indexOf('id="settingsSaveBar"');
    expect(saveBar).toBeGreaterThan(html.indexOf('data-settings-tab="danger"'));
    expect(saveBar).toBeLessThan(html.indexOf('data-settings-panel="customize"'));
    expect(dashboardCss).toContain(".v3-dash[data-auth-workspace] .v3-settings-save {\n  position: sticky;");
    expect(html).toMatch(/id="settingsSave" type="button" disabled="">Save changes<\/button>/);
    // One save action only.
    expect(html.match(/id="settingsSave"/g)).toHaveLength(1);
  });

  it("owns no second stylesheet and no games or wagering mechanics", () => {
    expect(dashboardCss).toContain(".v3-dash[data-auth-workspace] .v3-customize {");
    expect(customize).not.toContain("<style");
    expect(customize).not.toContain("style=");
    for (const term of ["Mines", "Flip", "Keno", "wager", "bet", "odds", "payout", "stake"]) {
      expect(customize.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });
});

describe("client: one owner for preview, brand fields and save", () => {
  it("previews through the real public renderer under an ownership check", () => {
    const handler = readFileSync(new URL("../handlers/preview.js", import.meta.url), "utf8");
    expect(handler).toContain('import { renderSite } from "@yourrank/shared/site-render";');
    expect(handler).toContain("const site = await getUserSiteByIdImpl(env, user.id, siteId, plan);");
    expect(handler).toContain('if (!site) return new Response("not found", { status: 404 });');
    // The dashboard posts the unsaved draft to that same owner.
    expect(siteJs).toContain('"/dashboard/preview?"');
    expect(siteJs).toContain('if (mount.dataset.previewEdit === "0") params.edit = "0";');
  });

  it("drives every preview mount and device tablist from one controller", () => {
    expect(siteJs).toContain('document.querySelectorAll("[data-preview-mount]")');
    expect(previewTabsJs).toContain('document.querySelectorAll(\'.preview-tabs[role="tablist"]\')');
    expect(siteJs).not.toMatch(/getElementById\("sitePreview"\)/);
  });

  it("counts brand characters from the field's own limit", () => {
    expect(accountJs).toContain("function wireBrandFields()");
    expect(accountJs).toContain('Number(input.getAttribute("maxlength"))');
    expect(accountJs).toContain("long ${noun}s are shortened on your public site.");
    expect(accountJs).toContain("wireBrandFields();");
  });

  it("validates links and logos before they reach the public site", () => {
    expect(siteJs).toContain('"Enter a valid URL, starting with https://"');
    expect(siteJs).toContain('parsed.protocol === "http:" || parsed.protocol === "https:"');
    expect(siteJs).toContain('const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];');
    expect(siteJs).toContain("const LOGO_MAX_BYTES = 2 * 1024 * 1024;");
    expect(siteJs).toContain("if (f.size > LOGO_MAX_BYTES) {");
    // SVG stays rejected: it can carry script into the public page.
    expect(siteJs).not.toContain("image/svg");
  });
});

describe("markup: accent is one real control, not two fake colors", () => {
  it("exposes a single accent picker and no second color anywhere", () => {
    expect(customize).toContain('<label for="c_a" class="sr-only">Accent color</label>');
    expect(customize).not.toContain('id="c_b"');
    expect(customize).not.toContain("Accent color start");
    expect(customize).not.toContain("Accent color end");
    expect(siteJs).not.toContain('$("c_b")');
  });

  it("offers single-color presets that claim no gradient", () => {
    expect(siteJs).toContain('{ name: "Indigo", accent: "#5b5bf5" }');
    const presetBlock = siteJs.slice(siteJs.indexOf("const COLOR_PRESETS"), siteJs.indexOf("];", siteJs.indexOf("const COLOR_PRESETS")));
    expect(presetBlock).not.toContain("accentB");
    // One swatch per preset button — the two-chip swatch promised a gradient.
    expect(siteJs).toContain('<span class="preset-swatch"><i data-color="${esc(preset.accent)}"></i></span>');
    expect(siteJs).not.toContain('data-color="${esc(preset.accentB)}"');
  });

  it("saves the picker value as accentA while legacy accentB rides through untouched", () => {
    expect(siteJs).toContain('accentA: $("c_a")?.value || state.CURRENT_BRANDING?.accentA || null');
    expect(siteJs).toContain("accentB: state.CURRENT_BRANDING?.accentB || null");
    // The preview posts the same collect() payload, so the preview accent is
    // the accent the public renderer uses.
    expect(siteJs).toContain('local.form.querySelector("input[name=\'draft\']").value = JSON.stringify(draft)');
  });

  it("keeps helper, counter and status text on separate compact lines", () => {
    expect(dashboardCss).toMatch(/\.v3-settings-field > \.v3-settings-muted,[\s\S]*?\.v3-settings-field > \.field-err \{\s*display: block;/);
  });

  it("defaults the Site settings preview device from the dashboard breakpoint", () => {
    // Only this mount opts in; the leaderboard editor preview keeps its
    // desktop-first default.
    expect(customize).toContain('aria-label="Preview viewport" data-preview-default-device="auto"');
    expect(html.match(/data-preview-default-device="auto"/g)).toHaveLength(1);
    expect(previewTabsJs).toContain('"(max-width: 899px)"');
    expect(previewTabsJs).toContain('tablist.dataset.previewDefaultDevice === "auto"');
  });
});

/* --- behavior: dirty, save and public address --- */

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach((value) => this.values.add(value)); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    const next = force === undefined ? !this.values.has(value) : force;
    if (next) this.add(value); else this.remove(value);
    return next;
  }
}

class FakeElement {
  constructor() {
    this.attributes = {};
    this.classList = new FakeClassList();
    this.dataset = {};
    this.hidden = false;
    this.listeners = {};
    this.textContent = "";
    this.value = "";
    this.disabled = false;
  }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  contains(node) { return node === this; }
}

const elements = new Map();
globalThis.document = {
  cookie: "",
  body: new FakeElement(),
  head: new FakeElement(),
  activeElement: null,
  getElementById(id) { return elements.get(id) || null; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {},
  createElement() { return new FakeElement(); },
};
globalThis.window = {
  innerHeight: 900,
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  addEventListener() {},
  removeEventListener() {},
  open() {},
};
globalThis.navigator = {};
globalThis.location = { href: "http://localhost/dashboard/site", origin: "http://localhost", host: "localhost", pathname: "/dashboard/site", search: "" };
globalThis.history = { pushState() {} };
globalThis.requestAnimationFrame = (callback) => callback();
globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });

const site = await import("../assets/dashboard/site.js");
const { setState, state } = await import("../assets/dashboard/state.js");

function register(id) {
  const element = new FakeElement();
  element.id = id;
  elements.set(id, element);
  return element;
}

const collectImpl = () => ({ payload: { siteId: "site-1", name: "Kick Cup" }, invalid: [] });

describe("behavior: save state is honest about unsaved changes", () => {
  beforeEach(() => {
    elements.clear();
    state.ACTIVE_SITE_ID = "site-1";
    state.SLUG = "kick-cup";
    state.SAVED_PLAYERS = [];
    state.SITE_UPDATED_AT = null;
    state.BOARDS = [];
  });

  it("keeps the settings Save action quiet until something changes", () => {
    const saveBar = register("savebar");
    const settingsSave = register("settingsSave");
    const saveText = register("settingsSaveText");
    const settingsSaveBar = register("settingsSaveBar");

    setState({ _dirty: true });
    expect(settingsSave.disabled).toBe(false);
    expect(saveBar.hidden).toBe(false);
    expect(settingsSaveBar.hidden).toBe(false);
    expect(saveText.textContent).toBe("You have unsaved changes.");

    setState({ _dirty: false });
    expect(settingsSave.disabled).toBe(true);
    expect(saveBar.hidden).toBe(true);
    expect(settingsSaveBar.hidden).toBe(true);
    expect(saveText.textContent).toContain("Navigation switches save immediately.");
  });

  it("saves once when both save actions are pressed together", async () => {
    register("publishAction");
    const editorSave = register("save");
    const settingsSave = register("settingsSave");
    const settingsSaveBar = register("settingsSaveBar");
    register("status");
    setState({ _dirty: true });
    expect(settingsSaveBar.hidden).toBe(false);

    let requests = 0;
    const fetchImpl = async () => {
      requests += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response(JSON.stringify({ ok: true, updatedAt: "after" }), { status: 200, headers: { "content-type": "application/json" } });
    };
    await Promise.all([
      site.saveEditorDraft({ collectImpl, fetchImpl, button: settingsSave }),
      site.saveEditorDraft({ collectImpl, fetchImpl, button: editorSave }),
    ]);

    expect(requests).toBe(1);
    expect(state.SITE_UPDATED_AT).toBe("after");
    expect(state._dirty).toBe(false);
    // A saved draft is a clean one: the settings action goes quiet again.
    expect(settingsSave.disabled).toBe(true);
    expect(editorSave.disabled).toBe(false);
    expect(settingsSaveBar.hidden).toBe(true);
  });

  it("re-enables both save actions and keeps the draft after a failed save", async () => {
    register("publishAction");
    const editorSave = register("save");
    const settingsSave = register("settingsSave");
    const settingsSaveBar = register("settingsSaveBar");
    const status = register("status");
    setState({ _dirty: true });

    await site.saveEditorDraft({
      collectImpl,
      fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: "Database unavailable" }), { status: 500, headers: { "content-type": "application/json" } }),
      button: settingsSave,
    });

    expect(status.textContent).toBe("Database unavailable");
    expect(state._dirty).toBe(true);
    expect(settingsSave.disabled).toBe(false);
    expect(editorSave.disabled).toBe(false);
    // A failed save leaves the draft dirty, so the bar stays up and enabled.
    expect(settingsSaveBar.hidden).toBe(false);
  });

  it("shows the public address on the copy and open actions", () => {
    register("sitePublicAddressCard");
    const url = register("sitePublicUrl");
    const open = register("sitePublicOpen");
    const action = register("sitePublicSiteAction");
    register("sitePublicCopy");
    state.SLUG = "kick-cup";

    site.renderSitePublicAddress();

    expect(url.textContent).toBe("http://localhost/kick-cup");
    expect(open.href).toBe("http://localhost/kick-cup");
    expect(action.href).toBe("http://localhost/kick-cup");
  });
});

describe("behavior: the public address follows domain truth", () => {
  function addressElements() {
    elements.clear();
    register("sitePublicAddressCard");
    register("sitePublicCopy");
    state.SLUG = "kick-cup";
    return {
      url: register("sitePublicUrl"),
      open: register("sitePublicOpen"),
      action: register("sitePublicSiteAction"),
    };
  }

  afterEach(() => { site.setActivePublicDomain(null); });

  it("uses the default YourRank address with no custom domain", () => {
    const { url, open, action } = addressElements();
    site.setActivePublicDomain(null);
    expect(site.publicSiteUrl()).toBe("http://localhost/kick-cup");
    expect(url.textContent).toBe("http://localhost/kick-cup");
    expect(open.href).toBe("http://localhost/kick-cup");
    expect(action.href).toBe("http://localhost/kick-cup");
  });

  it("promotes an active custom domain to the primary public URL everywhere", () => {
    const { url, open, action } = addressElements();
    site.setActivePublicDomain("cup.gg");
    expect(site.publicSiteUrl()).toBe("https://cup.gg/");
    // Address, Open site and the header action resolve to one URL.
    expect(url.textContent).toBe("https://cup.gg/");
    expect(open.href).toBe("https://cup.gg/");
    expect(action.href).toBe("https://cup.gg/");
    expect(open.title).toBe("cup.gg");
  });

  it("never advertises a domain the backend has not activated", () => {
    const { url, action } = addressElements();
    // A pending, saved or failed domain would send viewers nowhere.
    site.setActivePublicDomain(null);
    expect(url.textContent).toBe("http://localhost/kick-cup");
    expect(action.href).toBe("http://localhost/kick-cup");
    // Only the "active" branch of the domain status feeds the resolver.
    expect(siteJs).toContain('setActivePublicDomain(domainState === "active" ? data.customDomain : null)');
    // Every address surface reads the resolver, not location.origin directly.
    expect(siteJs.match(/publicSiteUrl\(\)/g).length).toBeGreaterThanOrEqual(2);
  });
});

describe("behavior: the chosen accent is the only accent", () => {
  beforeEach(() => {
    elements.clear();
    state.ACTIVE_SITE_ID = "site-1";
    state.BOARDS = [];
    state.ME = { plan: "pro" };
    state.CURRENT_BRANDING = { template: "cyber_arcade", accentA: "#5b5bf5", accentB: "#7b7bf8", font: "Inter" };
  });

  it("writes the selected accent to accentA and mirrors it into the picker", () => {
    const picker = register("c_a");
    site.applyTheme("#ff7a59", "Sunset");
    expect(state.CURRENT_BRANDING.accentA).toBe("#ff7a59");
    expect(picker.value).toBe("#ff7a59");
  });

  it("never overwrites the legacy accentB when the real accent changes", () => {
    register("c_a");
    site.applyTheme("#06b6d4", "Cyan");
    expect(state.CURRENT_BRANDING.accentA).toBe("#06b6d4");
    expect(state.CURRENT_BRANDING.accentB).toBe("#7b7bf8");
    // A font-only change leaves both stored accents alone.
    site.applyTheme(null, "Font");
    expect(state.CURRENT_BRANDING.accentA).toBe("#06b6d4");
    expect(state.CURRENT_BRANDING.accentB).toBe("#7b7bf8");
  });
});

describe("behavior: the Site settings preview opens on the matching device", () => {
  const tab = (device, active = false) => {
    const el = new FakeElement();
    el.dataset.device = device;
    if (active) el.classList.add("is-active");
    return el;
  };
  const tablist = (auto) => {
    const el = new FakeElement();
    if (auto) el.dataset.previewDefaultDevice = "auto";
    return el;
  };

  it("picks Mobile below 900px and Desktop at 900px and up, once", async () => {
    const { initialTab } = await import("../assets/dashboard/preview-tabs.js");
    const desktop = tab("desktop", true);
    const mobile = tab("mobile");
    const tabs = [desktop, mobile];

    globalThis.window.matchMedia = () => ({ matches: true });
    expect(initialTab(tablist(true), tabs)).toBe(mobile);

    globalThis.window.matchMedia = () => ({ matches: false });
    expect(initialTab(tablist(true), tabs)).toBe(desktop);

    // A tablist without the opt-in keeps its declared active tab either way.
    globalThis.window.matchMedia = () => ({ matches: true });
    expect(initialTab(tablist(false), tabs)).toBe(desktop);

    delete globalThis.window.matchMedia;
  });
});

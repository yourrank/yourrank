// Site settings is the creator's customizer: the public-site branding,
// navigation, links and address a viewer sees, next to a preview of the real
// public site. These tests pin the parts a creator depends on — labelled
// controls, a viewer-accurate preview mount, an honest save state — so the
// section cannot silently lose them.
import { beforeEach, describe, expect, it } from "bun:test";
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
    // Logo: the accepted types and the size ceiling are stated before upload.
    expect(customize).toMatch(/id="logoFile" accept="image\/png,image\/jpeg,image\/webp"/);
    expect(customize).toContain("PNG, JPG or WebP, up to 2 MB.");
    expect(customize).toContain('id="logoClear"');
    expect(customize).toMatch(/id="logoStatus"[^>]*aria-live="polite"/);
    // Accent: curated choices first, custom picker behind a disclosure.
    expect(customize).toMatch(/id="colorPresets"[^>]*role="group"[^>]*aria-labelledby="siteAccentLabel"/);
    expect(customize).toContain("Used for active navigation, buttons and highlights.");
    expect(customize).toContain('<details class="advanced-colors"><summary>Custom colors</summary>');
    expect(customize).toContain('<label for="c_a" class="sr-only">Accent color start</label>');
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

  it("puts the preview before the controls, and the save bar last", () => {
    const preview = customize.indexOf("v3-customize-preview");
    const controls = customize.indexOf("v3-customize-controls");
    expect(preview).toBeGreaterThanOrEqual(0);
    expect(preview).toBeLessThan(controls);
    // Desktop reads controls-first; the sticky preview sits beside them.
    expect(dashboardCss).toContain(".v3-dash[data-auth-workspace] .v3-customize-controls {\n    order: -1;\n  }");
    expect(dashboardCss).toContain(".v3-dash[data-auth-workspace] .v3-customize-preview {\n    position: sticky;");
    // The save bar belongs after every panel, never above one.
    expect(html.indexOf('id="settingsSaveBar"')).toBeGreaterThan(html.indexOf('data-settings-panel="danger"'));
    expect(html).toMatch(/id="settingsSave" type="button" disabled="">Save changes<\/button>/);
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

/* --- behavior: dirty, save and public address --- */

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach((value) => this.values.add(value)); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); }
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

    setState({ _dirty: true });
    expect(settingsSave.disabled).toBe(false);
    expect(saveBar.hidden).toBe(false);
    expect(saveText.textContent).toBe("You have unsaved changes.");

    setState({ _dirty: false });
    expect(settingsSave.disabled).toBe(true);
    expect(saveBar.hidden).toBe(true);
    expect(saveText.textContent).toContain("Navigation switches save immediately.");
  });

  it("saves once when both save actions are pressed together", async () => {
    register("publishAction");
    const editorSave = register("save");
    const settingsSave = register("settingsSave");
    register("status");
    setState({ _dirty: true });

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
  });

  it("re-enables both save actions and keeps the draft after a failed save", async () => {
    register("publishAction");
    const editorSave = register("save");
    const settingsSave = register("settingsSave");
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

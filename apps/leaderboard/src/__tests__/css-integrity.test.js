// A stray closing brace in the dashboard stylesheet silently un-wrapped a
// `@media (max-width: …)` block, so the editor's "stack the live preview below
// the controls" rule applied at every width and the split-screen editor was
// single-column on desktop. Unbalanced braces do not throw anywhere — CSS just
// drops or re-scopes rules — so assert it.
import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const assetsDir = path.resolve(import.meta.dir, "../assets");
const sheets = fs.readdirSync(assetsDir).filter((f) => f.endsWith(".css"));
const cookieScript = fs.readFileSync(path.join(assetsDir, "cookie-consent.js"), "utf8");
const appCss = fs.readFileSync(path.join(assetsDir, "app.css"), "utf8");
const devinSystemCss = fs.readFileSync(path.join(assetsDir, "devin-system.css"), "utf8");
const headersSource = fs.readFileSync(path.resolve(import.meta.dir, "../middleware/headers.js"), "utf8");
const indexSource = fs.readFileSync(path.resolve(import.meta.dir, "../index.js"), "utf8");
const siteRenderSource = fs.readFileSync(path.resolve(import.meta.dir, "../../../../packages/shared/src/site-render.ts"), "utf8");

const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(["'])(?:\\.|(?!\1)[^\\])*\1/g, '""');

describe("stylesheets", () => {
  it("finds the dashboard stylesheets", () => {
    expect(sheets).not.toContain("dashboard-v3.css");
    expect(sheets).toContain("dashboard-v4.css");
    expect(sheets).toContain("app.css");
    expect(sheets).toContain("cookie-consent.css");
  });

  it("keeps cookie consent self-contained on every injection surface", () => {
    expect(cookieScript).toContain('stylesheetHref = "/assets/cookie-consent.css"');
    expect(cookieScript).toContain('rel = "stylesheet"');
    expect(cookieScript).toContain("yr-consent");
    expect(cookieScript).not.toContain("cookie-open");
    expect(cookieScript).not.toMatch(/\bbtn(?:--|["'])/);
    expect(appCss).not.toContain("cookie-banner");
    expect(appCss).not.toContain("cookie-open");
    expect(headersSource).toContain('/assets/cookie-consent.js');
    expect(indexSource).toContain("addCookieConsent");
    expect(siteRenderSource).toContain('/assets/cookie-consent.js');
    const addConsentSource = indexSource.slice(indexSource.indexOf("function addCookieConsent"), indexSource.indexOf("const MAX_BODY_BYTES"));
    expect(addConsentSource).not.toContain('/assets/app.css"');
    expect(headersSource.slice(headersSource.indexOf("function statusPage"), headersSource.indexOf("const HOME_BTN"))).not.toContain('/assets/app.css"');
    expect(siteRenderSource).not.toContain('/assets/app.css"');
  });

  it("keeps the consent banner viewport-bound and usable on narrow screens", () => {
    const consentCss = fs.readFileSync(path.join(assetsDir, "cookie-consent.css"), "utf8");
    expect(consentCss).toContain("position: fixed");
    expect(consentCss).toContain("max-width: 100vw");
    expect(consentCss).toContain("env(safe-area-inset-right)");
    expect(consentCss).toContain("env(safe-area-inset-bottom)");
    expect(consentCss).toContain("env(safe-area-inset-left)");
    expect(consentCss).not.toContain("env(safe-area-inset-top)");
    expect(consentCss).toContain("var(--z-toast, 200)");
    expect(consentCss).toContain("min-height: 44px");
    expect(consentCss).toContain("@media (max-width: 360px)");
    expect(consentCss).toContain(":focus-visible");
  });

  for (const sheet of sheets) {
    it(`${sheet} has balanced braces`, () => {
      const css = stripped(fs.readFileSync(path.join(assetsDir, sheet), "utf8"));
      let depth = 0;
      let line = 1;
      for (const ch of css) {
        if (ch === "\n") line++;
        else if (ch === "{") depth++;
        else if (ch === "}" && --depth < 0) throw new Error(`${sheet}: unmatched } on line ${line}`);
      }
      expect(`${sheet} depth=${depth}`).toBe(`${sheet} depth=0`);
    });
  }
});

describe("authenticated dashboard v4 contract", () => {
  const css = fs.readFileSync(path.join(assetsDir, "dashboard-v4.css"), "utf8");
  const shellJs = fs.readFileSync(path.join(assetsDir, "shell-nav.js"), "utf8");

  it("uses a 12-column workspace with a 24px gutter", () => {
    expect(css).toMatch(/grid-template-columns:\s*repeat\(12,\s*minmax\(0,\s*1fr\)\)/);
    expect(css).toMatch(/\.v3-dash\[data-auth-workspace\] \.lb-bento\s*\{[\s\S]*?gap:\s*24px/);
  });

  it("does not use absolute positioning for v4 structure", () => {
    // Controls may use absolute positioning for their own affordances; this
    // contract is only about the workspace shell and layout primitives.
    const structuralRules = css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("}")
      .filter((rule) => /\{/.test(rule))
      .filter((rule) =>
        /(?:^|[\s,>])(?:\.lb-shell|\.lb-side|\.lb-side-nav|\.lb-main|\.lb-bento|\.lb-page|\.v3-grid|\.v3-stack|#cr-app|#cr-main|\.cr-workspace-content)(?=$|[\s,>:{.#])/.test(rule)
      )
      .join("}");
    expect(structuralRules).not.toMatch(/position:\s*absolute/);
  });

  it("keeps desktop collapse persistent and mobile drawers independent", () => {
    expect(shellJs).toContain('var collapseKey = "yr-side-collapsed"');
    expect(shellJs).toContain('root.setAttribute("data-side-collapsed", "true")');
    expect(shellJs).toContain('data-shell-drawer="shared"');
    expect(shellJs).toContain("trapDrawerFocus");
    expect(css).toContain('@media (min-width: 981px)');
    expect(css).toContain('@media (max-width: 980px)');
    expect(css).toContain('.v3-dash[data-auth-workspace] .lb-side.is-open');
  });

  it("keeps collapsed-rail sizing off the workspace root", () => {
    const collapsedRoot = '.v3-dash[data-auth-workspace][data-side-collapsed="true"]';
    const ruleBlocks = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map(([, selectors, declarations]) => ({
        selectors: selectors.split(",").map((selector) => selector.trim()),
        declarations,
      }))
      .filter(({ selectors }) => selectors.includes(collapsedRoot));
    const sizingDeclarations = ruleBlocks
      .map(({ declarations }) => declarations)
      .filter((declarations) => /\b(?:width|height|overflow)\s*:/.test(declarations));

    // The shell root carries the rail-width token; child rail controls own icon sizing.
    expect(sizingDeclarations).toEqual([]);
    expect(ruleBlocks.some(({ declarations }) => /--ws-sidebar-w:\s*44px\s*;/.test(declarations))).toBe(true);
  });

  it("keeps mobile top-bar controls on the light surface and allows reflow", () => {
    const baseTopbar = css.match(/\.v3-dash\[data-auth-workspace\] \.lb-topbar\s*\{([^{}]*)\}/)?.[1] || "";
    const menuRule = [...css.matchAll(/\.v3-dash\[data-auth-workspace\] \.lb-topbar-menu\s*\{([^{}]*)\}/g)]
      .map(([, declarations]) => declarations)
      .join("\n");
    expect(menuRule).toContain("var(--ws-line)");
    expect(menuRule).toContain("var(--ws-surface)");
    expect(menuRule).toContain("var(--ws-text)");
    expect(menuRule).not.toContain("var(--ws-chrome-line-strong)");
    expect(menuRule).not.toContain("var(--ws-chrome-raised)");
    expect(baseTopbar).toContain("position: sticky");
    expect(baseTopbar).toContain("top: 0");
    expect(baseTopbar).toContain("margin-inline: calc(-1 * var(--ws-main-pad-inline))");
    expect(baseTopbar).not.toContain("position: fixed");
    expect(baseTopbar).not.toContain("inset:");
    expect(baseTopbar).toContain("box-sizing: border-box");
    expect(baseTopbar).toContain("background: var(--ws-surface)");
    expect(baseTopbar).not.toMatch(/\b(?:top|left|right|width|margin|box-sizing)\s*:[^;]*!important/);
    const narrowStart = css.indexOf("@media (max-width: 700px) {");
    const narrowEnd = css.indexOf("\n@media", narrowStart + 1);
    const narrowShell = css.slice(narrowStart, narrowEnd < 0 ? undefined : narrowEnd);
    expect(narrowShell).toContain("--ws-topbar-h: 153px");
    expect(narrowShell).toContain("height: var(--ws-topbar-h)");
    expect(narrowShell).toContain("min-height: var(--ws-topbar-h)");
    expect(narrowShell).toContain("--ws-main-pad-inline: 16px");
    expect(narrowShell).toContain("padding-bottom: 48px");
    expect(narrowShell).toContain("lb-main > .lb-topbar + .lb-bento { padding-top: 24px; }");
    expect(narrowShell).not.toContain("min-height: 112px");
    expect(narrowShell).not.toContain("padding: 136px");
    expect(css).toContain("animation: workspaceFadeIn");
    expect(css).toMatch(/@keyframes workspaceFadeIn\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?opacity:\s*1;/);
    const compactTablet = css.slice(css.indexOf("@media (max-width: 1050px) and (min-width: 981px) {"), css.indexOf("\n@media", css.indexOf("@media (max-width: 1050px) and (min-width: 981px) {") + 1));
    expect(compactTablet).toContain(".lb-topbar-cmd { width: 130px");
    expect(compactTablet).toContain(".lb-topbar-cmd kbd { display: none; }");
    expect(compactTablet).toContain(".lb-availability { gap: 4px; }");
    expect(css).toMatch(/@media \(max-width: 700px\) \{[\s\S]*?\.lb-topbar\s*\{[\s\S]*?flex-wrap:\s*wrap/);
    expect(css).toMatch(/@media \(max-width: 700px\) \{[\s\S]*?\.lb-topbar-hud\s*\{[\s\S]*?flex:\s*1 0 100%/);
    const devinTopbar = devinSystemCss.match(/\.v3-dash\[data-auth-workspace\] \.lb-topbar\s*\{([^{}]*)\}/)?.[1] || "";
    expect(devinTopbar).not.toMatch(/background\s*:/);
    expect(devinTopbar).not.toMatch(/rgba\s*\(/);
  });

  it("does not retain selectors proven unused in the dashboard source tree", () => {
    expect(css).not.toMatch(/\.lb-board-new-side\b/);
    expect(css).not.toMatch(/\.lb-board-add\b/);
    expect(css).not.toMatch(/\.v3-statusbar\b/);
    expect(css).toMatch(/\.lb-side-board\b/);
  });
});

// The same button had three definitions (app.css and the bot
// shell's inlined CSS) that merged by cascade order, so a change to one of them
// only changed the component on some pages. They live in ui.css now.
describe("shared UI primitives", () => {
  const ui = fs.readFileSync(path.join(assetsDir, "ui.css"), "utf8");
  const botShell = fs.readFileSync(path.resolve(import.meta.dir, "../../../../packages/shared/src/page-shell.ts"), "utf8");
  const appCssDocuments = [
    ...fs.readdirSync(path.resolve(import.meta.dir, "../pages"))
      .filter((file) => /\.(js|jsx)$/.test(file))
      .map((file) => [file, fs.readFileSync(path.resolve(import.meta.dir, "../pages", file), "utf8")]),
    ["index.js", fs.readFileSync(path.resolve(import.meta.dir, "../index.js"), "utf8")],
    ["page-shell.ts", botShell],
  ].filter(([, source]) => source.includes("app.css"));

  it("defines the button component", () => {
    expect(ui).toMatch(/\.btn,\s*\.yr-ui button\s*\{/);
  });

  it("loads ui.css wherever app.css is loaded", () => {
    expect(appCssDocuments.length).toBeGreaterThan(0);
    for (const [file, source] of appCssDocuments) {
      expect(`${file} loads ui.css`).toBe(source.includes("ui.css") ? `${file} loads ui.css` : `${file} does not load ui.css`);
    }
    expect(ui).toMatch(/\.field\s*\{[\s\S]*?display:\s*flex/);
    expect(ui).toMatch(/\.field input,\s*\.field select,\s*\.field textarea\s*\{/);
    expect(ui).toMatch(/\.field-err\s*\{/);
  });

  const selectorsOf = (css) =>
    stripped(css)
      .replace(/@[^{]+\{/g, "")
      .split("}")
      .map((block) => block.split("{")[0].trim())
      .filter(Boolean)
      .flatMap((s) => s.split(",").map((x) => x.trim()));

  // A bare `.btn`/`.badge`/`button` rule elsewhere re-forks the component;
  // scoped rules like `.perf-filter .btn` only position it and are fine.
  const OWNED = new Set([".btn", ".btn--accent", ".btn--ghost", ".btn--danger", ".btn--sm", ".btn--xs", ".badge", ".tbl-scroll", ".modal", ".modal-card", ".modal-input", ".modal-actions", ".empty", ".error-state", ".sr-only", ".skip-link"]);

  for (const sheet of sheets.filter((s) => s !== "ui.css")) {
    it(`${sheet} does not redefine them`, () => {
      const clashes = selectorsOf(fs.readFileSync(path.join(assetsDir, sheet), "utf8")).filter((s) =>
        OWNED.has(s.replace(/^\.v2-dash\s+/, "").replace(/:[a-z-]+(\([^)]*\))?$/, ""))
      );
      expect(clashes).toEqual([]);
    });
  }

  // Every page opens with `<a class="sr-only skip-link">`, so any sheet a page
  // can be rendered with alone has to hide it — /` and /pricing load landing.css
  // and ui.css only, and the skip link was visible on both.
  it("hides the skip link on every sheet a page ships with", () => {
    expect(ui).toMatch(/\.sr-only\s*\{[^}]*clip:\s*rect\(0,\s*0,\s*0,\s*0\)/);
    // The bot shell's skip link has no .sr-only class, so .skip-link has to
    // hide itself too rather than relying on the class next to it.
    expect(ui).toMatch(/\.skip-link\s*\{[^}]*transform:\s*translateY\(-200%\)/);
    expect(ui).toMatch(/\.skip-link:focus\s*\{[^}]*transform:\s*none/);
    const pagesDir = path.resolve(import.meta.dir, "../pages");
    const withSkipLink = fs
      .readdirSync(pagesDir)
      .filter((f) => /\.(js|jsx)$/.test(f))
      .filter((f) => fs.readFileSync(path.join(pagesDir, f), "utf8").includes("sr-only skip-link"));
    expect(withSkipLink.length).toBeGreaterThan(0);
    for (const file of withSkipLink) {
      const src = fs.readFileSync(path.join(pagesDir, file), "utf8");
      expect(`${file} links ui.css`).toBe(src.includes('href="/assets/ui.css"') ? `${file} links ui.css` : `${file} does not`);
    }
  });

  it("the bot shell styles buttons through ui.css, not its own copy", () => {
    expect(botShell).toContain('<link rel="stylesheet" href="/assets/ui.css">');
    expect(botShell).toContain('class="yr-ui"');
    const botCss = stripped(botShell.slice(botShell.indexOf("BOT_STYLE_ATTR_CSS")));
    expect(botCss).not.toMatch(/\n\s*button(\.\w+)?\s*\{/);
    expect(botCss).not.toMatch(/\n\s*\.badge\s*\{/);
  });
});

describe("nonce'd CSP pages", () => {
  it("allows the shared shell's font origins in the bot CSP", () => {
    const botDash = fs.readFileSync(
      path.resolve(import.meta.dir, "../../../bot/src/dashboard.ts"),
      "utf8"
    );
    const policies = botDash.match(/default-src 'self';[^`]*/g) || [];
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      expect(policy).toContain("https://fonts.googleapis.com");
      expect(policy).toContain("font-src 'self' https://fonts.gstatic.com");
    }
  });
});

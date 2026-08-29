// Structural guarantees for the authenticated Leaderboard editor body.
//
// These protect the properties a creator depends on and that a layout change
// can silently break: one visible publication action, no unexplained checkbox
// in the chrome, a save affordance that cannot become a navigation-blocking
// overlay, and no editor rule that forces the body wider than a 320px
// viewport. They deliberately assert mechanics, not pixel layout.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DashboardContent } from "../pages/dashboard.jsx";

const SRC_ROOT = path.resolve(import.meta.dir, "..");
const read = (rel) => readFileSync(path.join(SRC_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const dashboardCss = read("assets/dashboard-v4.css");
const appCss = read("assets/app.css");
const boardShellJs = read("assets/dashboard/board-shell.js");
const dynamicSectionJs = read("assets/dashboard/dynamic-section.js");
const siteJs = read("assets/dashboard/site.js");
const utilsJs = read("assets/dashboard/utils.js");
const playersJs = read("assets/dashboard/players.js");

const EDITOR_PATHS = [
  "/dashboard/leaderboard/setup",
  "/dashboard/leaderboard/players",
  "/dashboard/leaderboard/appearance",
  "/dashboard/leaderboard/share",
  "/dashboard/leaderboard/history",
];

const editorHtml = (activePath) =>
  String(DashboardContent({ user: { email: "creator@example.com", plan: "free" }, activePath }));

describe("authenticated editor body", () => {
  it("renders one publication action per editor step", () => {
    for (const activePath of EDITOR_PATHS) {
      const html = editorHtml(activePath);
      // The shell topbar owns publication; the editor body never adds a
      // second always-visible "Publish site" control next to it.
      const topbarActions = html.match(/id="publishAction"/g) || [];
      expect(topbarActions.length).toBe(1);
      const shareAction = html.match(/id="sharePublishAction"/g) || [];
      expect(shareAction.length).toBe(1);
      // The Share affordance only exists inside the hidden "not published"
      // alert, and it delegates to the single owner instead of publishing.
      expect(html).toContain('id="sharePublishWarning" hidden');
    }
    expect(siteJs).toContain('$("publishAction")?.click()');
  });

  it("never turns the topbar live link into a second publish control", () => {
    expect(boardShellJs).not.toMatch(/publicLink\.textContent\s*=\s*[^;]*"Publish site"/);
    expect(siteJs).not.toMatch(/link\.textContent\s*=\s*[^;]*"Publish site"/);
    expect(boardShellJs).toContain("publicLink.hidden =");
  });

  it("keeps the internal publication checkbox presentation-hidden", () => {
    for (const activePath of EDITOR_PATHS) {
      const html = editorHtml(activePath);
      expect(html).toMatch(/<input type="checkbox" id="pubToggle" hidden="" tabindex="-1" aria-hidden="true"\/>/);
    }
    // No context may reveal it; it is an input the publish flow writes to.
    expect(dynamicSectionJs).toContain("if (pubToggle) pubToggle.hidden = true;");
    expect(dynamicSectionJs).not.toContain("pubToggle.hidden = !showPublish");
  });

  it("gives every visible editor checkbox a label", () => {
    const html = editorHtml("/dashboard/leaderboard/setup");
    const checkboxes = html.match(/<input type="checkbox"[^>]*>/g) || [];
    for (const input of checkboxes) {
      if (/hidden/.test(input)) continue;
      const id = /id="([^"]+)"/.exec(input)?.[1];
      const labelled =
        (id && (html.includes(`for="${id}"`) || html.includes(`aria-label`))) ||
        /aria-label=/.test(input) ||
        /title=/.test(input);
      // Every remaining checkbox is either wrapped in a <label class="chk">
      // or referenced by a label/aria-label.
      expect(labelled || html.includes(`class="chk"><input type="checkbox"${id ? ` id="${id}"` : ""}`)).toBe(true);
    }
  });

  it("keeps the save bar inside the editor column instead of over the chrome", () => {
    const html = editorHtml("/dashboard/leaderboard/setup");
    const controls = html.split('class="design-controls"')[1];
    expect(controls).toContain('id="savebar"');
    // A fixed, high z-index save bar could cover the sidebar, the workflow
    // steps or the mobile drawer; a sticky one inside the column cannot.
    const savebarRule = /\.v3-dash\[data-auth-workspace\] \.savebar \{[^}]*\}/g;
    const rules = dashboardCss.match(savebarRule) || [];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule).not.toContain("position: fixed");
      expect(rule).not.toMatch(/z-index:\s*(?:[1-9]\d\d+|\d\d)\b/);
    }
    expect(dashboardCss).toMatch(/\.v3-dash\[data-auth-workspace\] \.savebar \{[\s\S]*?position: sticky/);
    expect(appCss).not.toMatch(/\.savebar\{[^}]*position:fixed/);
    // The Players step hides the other step bodies but must keep the save bar
    // and the workflow steps, which are siblings of those bodies.
    expect(dashboardCss).toContain(
      '.design-controls > *:not([data-egroup="players"]):not(.savebar):not(.editor-steps)',
    );
    expect(editorHtml("/dashboard/leaderboard/players")).toContain('class="editor-steps v3-tabs" id="editorTabs"');
  });

  it("stacks the archive row instead of widening the document on phones", () => {
    // A three-track grid with a single-line button cannot fit a phone
    // viewport; History overflowed the document at 320-500px because of it.
    const base = /\.v3-dash\[data-auth-workspace\] \.arch-form \{([^}]*)\}/.exec(dashboardCss)?.[1] || "";
    expect(base).not.toMatch(/minmax\(220px/);
    expect(base).toContain("minmax(min(100%, 220px), 1fr)");
    const narrow = dashboardCss.slice(dashboardCss.indexOf("@media (max-width: 560px)"));
    expect(narrow).toMatch(/\.arch-form \{ grid-template-columns: 1fr; \}/);
    expect(narrow).toMatch(/\.arch-form \.btn \{[\s\S]*?white-space: normal/);
  });

  it("keeps the editor body inside a 320px viewport", () => {
    // No editor rule may pin a width wider than the narrowest supported
    // viewport minus the page gutters, and label rows must wrap.
    const editorRules = dashboardCss
      .split("}")
      .filter((rule) => /section\[data-page="board"\]|\.editor-step|\.savebar|\.design-/.test(rule));
    for (const rule of editorRules) {
      for (const match of rule.matchAll(/(?:^|[;{\s])(?:min-)?width:\s*(\d+)px/g)) {
        if (/@media/.test(rule)) continue;
        expect(Number(match[1])).toBeLessThanOrEqual(288);
      }
    }
    const chkRule = /section\[data-page="board"\] \.chk \{([^}]*)\}/.exec(dashboardCss)?.[1] || "";
    expect(chkRule).toContain("white-space: normal");
    expect(chkRule).not.toContain("nowrap");
    expect(chkRule).toContain("min-width: 0");
  });

  it("keeps the workflow strip the only top-anchored sticky layer in the editor column", () => {
    // Two sticky layers in one column with the same `top` and `z-index` are
    // resolved by DOM order, so a head declared after the strip swallows its
    // clicks once the body scrolls. Only the strip may anchor to the topbar;
    // the save bar anchors to the bottom, which cannot overlap it.
    const topAnchored = dashboardCss
      .split("}")
      .filter(
        (rule) =>
          /position:\s*sticky/.test(rule) &&
          /top:\s*(?:calc\()?\s*var\(--ws-topbar-h/.test(rule),
      );
    expect(topAnchored.length).toBeGreaterThan(0);
    for (const rule of topAnchored) {
      const selector = rule.slice(0, rule.indexOf("{"));
      if (!/\.design-controls|\.v3-players|\[data-egroup=/.test(selector)) continue;
      expect(selector).toContain(".v3-tabs");
    }
    // The Players head shares the editor column with the strip, so it must
    // scroll with the rest of the step body.
    expect(dashboardCss).not.toContain(".v3-players > .v3-head,");
  });

  it("progressively discloses the rarely-changed editor settings", () => {
    const html = editorHtml("/dashboard/leaderboard/setup");
    // Ranking essentials stay visible. Site-wide identity points to its proven
    // owner; optional sponsor and scheduling detail sit behind disclosures.
    expect(html).toContain('id="setupBrandLink">Edit site identity');
    expect(html).toContain("Leaderboard basics");
    expect(html).toMatch(/<details class="editor-more editor-more--standalone"[^>]*data-editor-more="setup-sponsor">/);
    expect(html).toMatch(/<details class="editor-more" data-editor-more="setup-schedule">/);
    for (const id of ["f_casino", "f_code", "f_cta", "f_blurb", "f_starts", "f_auto_reset", "f_password_enabled"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(dashboardCss).toContain("details.editor-more summary");
  });

  it("associates human-readable schedule errors with the date controls", () => {
    const html = editorHtml("/dashboard/leaderboard/setup");
    expect(html).toContain('id="f_starts" type="datetime-local" aria-describedby="f_starts_hint f_starts_error"');
    expect(html).toContain('id="f_ends" type="datetime-local" aria-describedby="f_ends_hint f_ends_error"');
    expect(html).toContain('id="f_starts_error" data-field-error="f_starts" hidden');
    expect(html).toContain('id="f_ends_error" data-field-error="f_ends" hidden');
    expect(siteJs).toContain("validateScheduleValues");
    expect(utilsJs).toContain("Choose an end time after the start time.");
  });

  it("keeps Players focused on adding and editing the essential fields", () => {
    const html = editorHtml("/dashboard/leaderboard/players");
    const toolbar = html.slice(html.indexOf('class="v3-players-bar"'), html.indexOf('id="playersTableWrap"'));
    expect(toolbar.indexOf('id="addRow"')).toBeLessThan(toolbar.indexOf('id="importMenuBtn"'));
    expect(toolbar).toContain('class="v3-btn v3-btn--accent" id="addRow"');
    expect(html).toContain('id="emptyAddBtn" type="button">Add first player');
    expect(html).not.toContain('id="emptyPasteBtn"');
    expect(playersJs).toContain("const DEFAULT_EDITOR_PLAYER_FIELDS = Object.freeze({");
    for (const field of ["score", "hands", "netProfit", "winRate", "change"]) {
      expect(playersJs).toContain(`${field}: false`);
    }
    expect(playersJs).toContain('data-label="Player"');
    expect(playersJs).toContain('data-label="Actions"');
    const mobileCards = dashboardCss.slice(dashboardCss.indexOf("Wave A creator workflow simplification"));
    expect(mobileCards).toContain("#playersTableWrap");
    expect(mobileCards).toContain("overflow: visible");
    expect(mobileCards).toContain("tbody tr:not([hidden])");
    expect(mobileCards).toContain("grid-template-columns");
    expect(dashboardCss).toContain(".v3-players-table {\n  width: 100%;");
    expect(mobileCards).toContain("td.num input");
    expect(mobileCards).toContain("flex: 1 1 auto");
    expect(mobileCards).toContain("td.act .row-x");
  });

  it("presents History as a close-and-restore workflow", () => {
    const html = editorHtml("/dashboard/leaderboard/history");
    expect(html).toContain("Close the current period and keep a dated copy of its final standings.");
    expect(html).toContain('id="a_go" type="button">Close period');
    expect(html).toContain("<h2>Closed periods</h2>");
    expect(siteJs).toContain("Restore to editor");
    expect(siteJs).toContain("toLocaleDateString");
    expect(siteJs).toContain("<time${datetime}");
    expect(siteJs).toContain("arch-del");
  });

  // A placeholder is not a name: it disappears the moment the field has a value
  // and a screen reader announces "edit text, blank".
  it("names every editor field that only had a placeholder", () => {
    const html = editorHtml("/dashboard/leaderboard/setup");
    expect(html).toContain('<label class="sr-only" for="f_password">Site password</label>');
    expect(siteJs).toContain('aria-label="${esc(c.name)} link"');
    expect(siteJs).toContain('aria-label="Show ${esc(c.name)} on public page"');
  });

  // renderSocials runs on every editor entry; the listeners live on the
  // container that survives it.
  it("wires the socials editor's listeners once", () => {
    expect(siteJs).toContain("if (!list.dataset.socialsWired) {");
  });
});

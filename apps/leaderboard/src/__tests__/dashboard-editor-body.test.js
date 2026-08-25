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
const read = (rel) => readFileSync(path.join(SRC_ROOT, rel), "utf8");

const dashboardCss = read("assets/dashboard-v4.css");
const appCss = read("assets/app.css");
const boardShellJs = read("assets/dashboard/board-shell.js");
const dynamicSectionJs = read("assets/dashboard/dynamic-section.js");
const siteJs = read("assets/dashboard/site.js");

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
    // The Players step hides the other step bodies but must keep the save bar.
    expect(dashboardCss).toContain('.design-controls > *:not([data-egroup="players"]):not(.savebar)');
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

  it("progressively discloses the rarely-changed editor settings", () => {
    const html = editorHtml("/dashboard/leaderboard/setup");
    // The essentials stay visible; optional sponsor and scheduling detail sits
    // behind a disclosure so Setup reads as site identity first.
    expect(html).toContain('for="f_name">Site name');
    expect(html).toMatch(/<details class="editor-more" data-editor-more="setup-sponsor">/);
    expect(html).toMatch(/<details class="editor-more" data-editor-more="setup-schedule">/);
    for (const id of ["f_casino", "f_code", "f_cta", "f_blurb", "f_starts", "f_auto_reset", "f_password_enabled"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(dashboardCss).toContain("details.editor-more summary");
  });
});

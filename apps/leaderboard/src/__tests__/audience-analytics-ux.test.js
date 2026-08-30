import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AudienceMembersPage } from "../pages/audience.jsx";
import { DashboardContent } from "../pages/dashboard.jsx";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(TEST_DIR, "..");

describe("Audience members body", () => {
  it("keeps member identity first and lifetime totals secondary", () => {
    const html = AudienceMembersPage({ fragment: true }).toString();
    expect(html).toContain("Members in this site");
    expect(html).toContain('id="cr-viewer-toolbar"');
    expect(html).toContain("<th>Member</th><th>Membership</th><th>Account connection</th><th>Credits</th>");
    expect(html).not.toContain("<th class=\"num\">Total earned</th>");
    expect(html).toContain("Looking for visitor trends?");
    expect(html).toContain("Anonymous visits and traffic sources live in Insights.");
    expect(html).toContain(">Open Insights</a>");
  });

  it("presents the empty member state without an orphaned table", () => {
    const styles = readFileSync(path.join(SRC_ROOT, "assets", "dashboard-v4.css"), "utf8");
    expect(styles).toContain(".cr-member-list:has(#cr-viewer-empty:not([hidden])) .cr-table-scroll");
    expect(styles).toContain("display: none;");
  });

  it("does not use internal platform IDs as the visible member name", () => {
    const source = readFileSync(path.join(SRC_ROOT, "assets/credits.js"), "utf8");
    const identity = source.match(/function memberIdentity\(v\) \{[\s\S]*?\n\}/)?.[0] || "";
    expect(identity).toContain('v.displayName || "Unnamed member"');
    expect(identity).not.toContain("kick_user_id");
    expect(identity).not.toContain("discord_user_id");
    expect(source).toContain('label: "Recently active"');
    expect(source).toContain('mountListControls($("cr-viewers"), $("cr-viewer-toolbar"), $("cr-viewer-foot"))');
  });

  it("opens site-scoped member detail in an accessible drawer", () => {
    const html = AudienceMembersPage({ fragment: true }).toString();
    const source = readFileSync(path.join(SRC_ROOT, "assets/credits.js"), "utf8");
    expect(html).toContain('id="cr-member-history-drawer"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="cr-member-history-title"');
    expect(html).toContain('aria-label="Close member details"');
    expect(html).toContain("Account connection");
    expect(html).toContain("Site status");
    expect(html).not.toContain("Recognition");
    expect(html).not.toContain("Claims");
    expect(source).toContain('data-member-detail="${esc(v.id)}"');
    expect(source).toContain('aria-controls="cr-member-history-drawer"');
    expect(source).toContain('aria-expanded="false"');
    expect(source).toContain('sitePath(`/api/people/members/${encodeURIComponent(memberDetailId)}`)');
    expect(source).not.toContain("memberHistoryUsername");
    expect(source).toContain('if (!window.YRDialog) await import("./dialog.js")');
    expect(source).toContain("dialog.trap(drawer, closeMemberHistory)");
    expect(source).toContain("renderError(empty, {");
    expect(source).toContain('title: "No credit activity yet"');
  });
});

describe("Analytics bodies", () => {
  it("answers the four Insights questions before secondary traffic detail", () => {
    const html = DashboardContent({
      user: { display_name: "Test operator", plan: "pro" },
      activePath: "/dashboard/analytics/activity",
    }).toString();
    expect(html).toContain("Is the community returning?");
    expect(html).toContain("How are members participating?");
    expect(html).toContain("How are rewards being used?");
    expect(html).toContain("What needs attention?");
    expect(html).toMatch(/class="v3-insight-band"[^>]*hidden/);
    expect(html).not.toContain('class="v3-kpi-grid"');
    expect(html).toContain("Safe code-drop activity only");
    expect(html).toContain("Public site visits");
    expect(html).toContain('<details class="v3-table-card v3-secondary-insight" id="perf-heatmap">');
    expect(html).toContain("Actions people took");
    expect(html).toContain('data-range="7"');
    expect(html).toContain('data-range="30"');
    expect(html).not.toContain('data-range="14"');
  });

  it("states the fixed Sources window without showing the selectable range", () => {
    const html = DashboardContent({
      user: { display_name: "Test operator", plan: "pro" },
      activePath: "/dashboard/analytics/referrals",
    }).toString();
    expect(html).toMatch(/id="perfSourcesRange"[^>]*>Last 30 days/);
    expect(html).toMatch(/id="perfRangeFilter"[^>]*hidden/);
    expect(html).toContain("Direct visits are included in your visit total");
  });

  it("renders grouped creator-facing actions from existing stats", () => {
    const source = readFileSync(path.join(SRC_ROOT, "assets/dashboard/performance.js"), "utf8");
    expect(source).toContain("function renderEvents(days, hasAnyData = false)");
    expect(source).toContain('label: "Viewed your site"');
    expect(source).toContain('label: "Clicked a link"');
    expect(source).toContain('label: "Shared your site"');
    expect(source).toContain('const source = row.domain || "Direct"');
  });

  it("keeps Activity and Events truthful when stats fail to load", () => {
    const site = readFileSync(path.join(SRC_ROOT, "assets/dashboard/site.js"), "utf8");
    expect(site).toContain("function renderStatsError()");
    expect(site).toContain('showLoadError($("perfActivityEmpty"), "daily activity", loadStats)');
    expect(site).toContain('showLoadError($("eventsEmpty"), "site activity", loadStats)');
    expect(site).toContain("renderStatsError()");
  });

  it("keeps the restricted legacy analytics export out of Insights", () => {
    const source = readFileSync(path.join(SRC_ROOT, "assets/dashboard/performance.js"), "utf8");
    const html = DashboardContent({ activePath: "/dashboard/analytics/activity" }).toString();
    expect(html).not.toContain("/api/site/stats/export");
    expect(source).not.toContain("/api/site/stats/export");
    expect(source).toContain("/api/insights?");
  });

  it("keeps the Insights date controls available when public traffic is zero", () => {
    const performanceClient = readFileSync(path.join(SRC_ROOT, "assets/dashboard/performance.js"), "utf8");
    expect(performanceClient).toContain('rangeFilter.hidden = active === "referrals"');
    expect(performanceClient).not.toContain('rangeFilter.hidden = !hasAnyData');
  });
});

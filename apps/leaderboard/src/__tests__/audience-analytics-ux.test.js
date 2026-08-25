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
    expect(html).toContain("Your members");
    expect(html).toContain('id="cr-viewer-toolbar"');
    expect(html).toContain("<th>Member</th><th>Recent activity</th><th>Credits</th>");
    expect(html).not.toContain("<th class=\"num\">Total earned</th>");
    expect(html).toContain("Looking for visitor trends?");
  });

  it("does not use internal platform IDs as the visible member name", () => {
    const source = readFileSync(path.join(SRC_ROOT, "assets/credits.js"), "utf8");
    const identity = source.match(/function memberIdentity\(v\) \{[\s\S]*?\n\}/)?.[0] || "";
    expect(identity).toContain('v.kick_username || v.discord_username || "Member"');
    expect(identity).not.toContain("kick_user_id");
    expect(identity).not.toContain("discord_user_id");
    expect(source).toContain('label: "Recently active"');
    expect(source).toContain('mountListControls($("cr-viewers"), $("cr-viewer-toolbar"), $("cr-viewer-foot"))');
  });
});

describe("Analytics bodies", () => {
  it("uses a restrained summary and progressive secondary detail", () => {
    const html = DashboardContent({
      user: { display_name: "Test operator", plan: "pro" },
      activePath: "/dashboard/analytics/activity",
    }).toString();
    expect(html).toContain('class="v3-insight-band"');
    expect(html).not.toContain('class="v3-kpi-grid"');
    expect(html).toContain("<dt>Link click rate</dt>");
    expect(html).toContain('<details class="v3-table-card v3-secondary-insight" id="perf-heatmap">');
    expect(html).toContain("Actions people took");
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
});

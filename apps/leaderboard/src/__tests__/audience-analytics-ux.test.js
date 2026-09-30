import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AudienceActivityPage, AudienceMembersPage } from "../pages/audience.jsx";
import { DashboardContent } from "../pages/dashboard.jsx";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(TEST_DIR, "..");

describe("Audience members body", () => {
  it("keeps member identity first and lifetime totals secondary", () => {
    const html = AudienceMembersPage({ fragment: true }).toString();
    const source = readFileSync(path.join(SRC_ROOT, "react/pages/audience/page.tsx"), "utf8");
    expect(html).toContain('<div id="audience-app" data-audience-tab="viewers"></div>');
    expect(html).toContain(">Members</a>");
    expect(source).toContain("Members in this site");
    expect(source).toContain('id="cr-viewer-toolbar"');
    expect(source).toContain("<th>Member</th><th>Membership</th><th>Account connection</th><th>Credits</th>");
    expect(source).not.toContain("<th class=\"num\">Total earned</th>");
    expect(source).toContain("Looking for visitor trends?");
    expect(source).toContain("Anonymous visits and traffic sources live in Insights.");
    expect(source).toContain(">Open Insights</a>");
  });

  it("presents the empty member state without an orphaned table", () => {
    const styles = readFileSync(path.join(SRC_ROOT, "assets", "dashboard-v4.css"), "utf8");
    expect(styles).toContain(".cr-member-list:has(#cr-viewer-empty:not([hidden])) .cr-table-scroll");
    expect(styles).toContain("display: none;");
  });

  it("does not use internal platform IDs as the visible member name", () => {
    const source = readFileSync(path.join(SRC_ROOT, "react/pages/audience/page.tsx"), "utf8");
    const identity = source.match(/function memberIdentity\(member: Member\) \{[\s\S]*?\n\}/)?.[0] || "";
    expect(identity).toContain('member.displayName || "Unnamed member"');
    expect(identity).not.toContain("kick_user_id");
    expect(identity).not.toContain("discord_user_id");
    expect(source).toContain('<SelectItem value="activity">Recently active</SelectItem>');
    expect(source).toContain("member.linkedIdentities");
  });

  it("opens site-scoped member detail in an accessible drawer", () => {
    const html = AudienceMembersPage({ fragment: true }).toString();
    const source = readFileSync(path.join(SRC_ROOT, "react/pages/audience/page.tsx"), "utf8");
    const drawer = source.match(/<Dialog open={memberDetailOpen}[\s\S]*?<\/Dialog>/)?.[0] || "";
    expect(html).toContain('<div id="audience-app" data-audience-tab="viewers"></div>');
    expect(source).toContain('<DialogContent id="audience-member-drawer"');
    expect(drawer).toContain('aria-modal="true"');
    expect(source).toContain('aria-label="Close member details"');
    expect(source).toContain('aria-controls="audience-member-drawer"');
    expect(source).toContain("Account connection");
    expect(source).toContain("Site status");
    expect(source).not.toContain("Recognition");
    expect(drawer).not.toContain("Claims");
    expect(source).toContain('request<MemberDetailResponse>(deps, `/api/people/members/${encodeURIComponent(id)}`, requestedSiteId)');
    expect(source).toContain("requestIsCurrent(requestedSiteId, ticket, siteIdRef.current, detailRequestRef.current)");
    expect(source).not.toContain("memberHistoryUsername");
    expect(source).toContain("No credit activity yet");
  });
});

describe("Audience Activity route", () => {
  it("maps manifest Activity chrome to the Activity tab and the React history marker", () => {
    const html = AudienceActivityPage({ fragment: true }).toString();
    expect(html).toContain('href="/dashboard/audience/activity" aria-current="page" data-subnav="activity"');
    expect(html).toContain('<div id="audience-app" data-audience-tab="history"></div>');
  });
});

describe("Analytics bodies", () => {
  it("places the five decision metrics before compact activity and moves daily detail to its own tab", () => {
    const html = DashboardContent({
      user: { display_name: "Test operator", plan: "pro" },
      activePath: "/dashboard/analytics/activity",
    }).toString();
    expect(html).toContain('<h1 id="perfTitle">Insights</h1>');
    expect(html).toContain('class="insights-kpi-row"');
    expect(html).toContain("Community activity");
    expect(html).toContain("Participation");
    expect(html).toContain("Needs attention");
    expect(html).toMatch(/data-perf-summary[^>]*hidden/);
    expect(html).toMatch(/id="perf-events"[^>]*hidden=""[^>]*>[\s\S]*Daily activity/);
    expect(html).toContain("No participation yet");
    expect(html).toContain("Nothing needs attention");
    expect(html).toContain("Claims completed");
    expect(html).toContain("Public site visits");
    expect(html).toContain('id="perf-heatmap"');
    expect(html).toContain("Actions people took");
    expect(html).toContain("How Insights counts activity");
    const insightsNav = html.match(/<nav class="v3-tabs" aria-label="Insights pages"[^>]*>([\s\S]*?)<\/nav>/)?.[1] || "";
    expect(insightsNav).toContain("Detailed analytics");
    expect(insightsNav).not.toContain(">More<");
    expect(html).toContain('data-range="7"');
    expect(html).toContain('data-range="30"');
    expect(html).not.toContain('data-range="14"');
  });

  it("keeps the date range beside the title across Insights tabs", () => {
    const html = DashboardContent({
      user: { display_name: "Test operator", plan: "pro" },
      activePath: "/dashboard/analytics/referrals",
    }).toString();
    expect(html).toContain('id="perfRangeFilter"');
    expect(html).toContain('aria-label="Insights reporting period"');
    expect(html).toContain('data-perf-tab="events"');
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
    expect(performanceClient).toContain('rangeFilter.dataset.hasData = hasAnyData ? "1" : "0"');
    expect(performanceClient).not.toContain('rangeFilter.hidden = !hasAnyData');
  });
});

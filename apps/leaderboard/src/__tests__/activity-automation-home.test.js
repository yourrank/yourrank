import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { automationHomeState } from "../assets/dashboard/overview-state.js";

describe("Wave K Home operational ownership", () => {
  it("shows only a real upcoming safe schedule and removes cancelled work", () => {
    const result = automationHomeState({ schedules: [
      { id: "cancelled", kind: "safe_code_drop", status: "cancelled", templateName: "Old" },
      { id: "next", kind: "safe_code_drop", status: "scheduled", templateName: "Tomorrow" },
      { id: "restricted", kind: "prediction", status: "scheduled", templateName: "Not safe" },
    ] });
    expect(result.comingNext).toMatchObject({ id: "next", templateName: "Tomorrow" });
    expect(result.needsAttention).toEqual([]);
  });

  it("deduplicates failed and paused safe schedules in Needs attention", () => {
    const failed = { id: "failed", kind: "safe_code_drop", status: "failed", templateName: "Break" };
    const result = automationHomeState({ schedules: [failed, failed, { id: "paused", kind: "safe_code_drop", status: "paused" }] });
    expect(result.needsAttention.map((item) => item.id)).toEqual(["failed", "paused"]);
  });

  it("renders Home-owned Coming next and Needs attention surfaces for the selected site", () => {
    const page = readFileSync(new URL("../pages/dashboard.jsx", import.meta.url), "utf8");
    expect(page).toContain('id="ovComingNext"');
    expect(page).toContain('id="ovAutomationAlert"');
    const source = readFileSync(new URL("../assets/dashboard/overview.js", import.meta.url), "utf8");
    expect(source).toContain("new URLSearchParams({ siteId: state.ACTIVE_SITE_ID })");
    expect(source).toContain('buildDashboardPath("activities.overview", { siteId: state.ACTIVE_SITE_ID })');
    const automationBlock = source.slice(
      source.indexOf('const activitiesHref = buildDashboardPath("activities.overview"'),
      source.indexOf("  const relative = (iso) =>"),
    );
    expect(automationBlock).not.toMatch(/prediction|raffle|wager|payout|settlement/i);
    const dashboardCss = readFileSync(new URL("../assets/dashboard-v4.css", import.meta.url), "utf8");
    expect(dashboardCss).toContain("#ovAutomationAlert .btn { min-height: var(--ws-control-h-touch); }");
    const activitiesCss = readFileSync(new URL("../assets/activities.css", import.meta.url), "utf8");
    expect(activitiesCss).toContain(".act-schedule-action .act-state { grid-column: auto; grid-row: auto; justify-self: start; }");
    expect(activitiesCss).toContain(".act-compact-row > div:first-child strong { overflow-wrap: anywhere; }");
  });
});

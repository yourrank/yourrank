import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { activityHomeState, automationHomeState } from "../assets/dashboard/overview-state.js";

describe("Wave K Home operational ownership", () => {
  it("shows only a real upcoming safe schedule and removes cancelled work", () => {
    const result = automationHomeState({ schedules: [
      { id: "cancelled", kind: "safe_code_drop", status: "cancelled", templateName: "Old" },
      { id: "next", kind: "safe_code_drop", status: "scheduled", templateName: "Tomorrow" },
      { id: "restricted", kind: "prediction", status: "scheduled", templateName: "Not safe" },
    ] });
    expect(result.upcoming).toEqual([]);
    const withTime = automationHomeState({ schedules: [{ id: "next", kind: "safe_code_drop", status: "scheduled", templateName: "Tomorrow", nextRunAt: "2099-01-01T00:00:00Z" }] });
    expect(withTime.upcoming.map((item) => item.id)).toEqual(["next"]);
    expect(result.needsAttention).toEqual([]);
  });

  it("deduplicates failed and paused safe schedules in Needs attention", () => {
    const failed = { id: "failed", kind: "safe_code_drop", status: "failed", templateName: "Break" };
    const result = automationHomeState({ schedules: [failed, failed, { id: "paused", kind: "safe_code_drop", status: "paused" }] });
    expect(result.needsAttention.map((item) => item.id)).toEqual(["failed", "paused"]);
  });

  it("projects open safe Activities without exposing their claim codes", () => {
    const result = activityHomeState([
      { id: "drop:1", source: { kind: "code_drop" }, type: "drop", title: "Code drop SECRET", state: "open", endsAt: "2026-09-05T12:00:00Z", progress: { claimed: 3, capacity: 10 }, reward: { creditsPerClaim: 25 } },
      { id: "drop:2", source: { kind: "code_drop" }, type: "drop", title: "Code drop ENDED", state: "completed" },
      { id: "restricted", source: { kind: "prediction" }, type: "prediction", title: "Restricted", state: "open" },
    ]);
    expect(result).toEqual({
      totalOpen: 1,
      open: [{ id: "drop:1", typeLabel: "Code drop", stateLabel: "Open", endsAt: "2026-09-05T12:00:00Z", claimed: 3, capacity: 10, creditsPerClaim: 25 }],
    });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("renders Home-owned Coming next and Needs attention surfaces for the selected site", () => {
    const page = readFileSync(new URL("../pages/dashboard.jsx", import.meta.url), "utf8");
    expect(page).toContain('id="ovAttention"');
    expect(page).toContain('id="ovLiveNow"');
    expect(page).toContain('id="ovComingNext"');
    expect(page).toContain('id="ovAttentionList"');
    const source = readFileSync(new URL("../assets/dashboard/overview.js", import.meta.url), "utf8");
    expect(source).toContain("new URLSearchParams({ siteId })");
    expect(source).not.toMatch(/prediction|raffle|wager|payout|settlement/i);
    const projections = readFileSync(new URL("../assets/dashboard/overview-state.js", import.meta.url), "utf8");
    expect(projections).toContain('buildDashboardPath("activities.overview", { siteId })');
    expect(projections).not.toMatch(/prediction|raffle|wager|payout|settlement/i);
    const dashboardCss = readFileSync(new URL("../assets/dashboard-v4.css", import.meta.url), "utf8");
    expect(dashboardCss).toContain(".ov-attention-row .btn,");
    const activitiesCss = readFileSync(new URL("../assets/activities.css", import.meta.url), "utf8");
    expect(activitiesCss).toContain(".act-schedule-action .act-state { grid-column: auto; grid-row: auto; justify-self: start; }");
    expect(activitiesCss).toContain(".act-compact-row > div:first-child strong { overflow-wrap: anywhere; }");
  });
});

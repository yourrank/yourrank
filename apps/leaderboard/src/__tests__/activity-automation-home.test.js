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
    expect(page).toContain('<div id="ov-app" class="yr-react">');
    expect(page).toContain('class="ov-operations ov-attention" id="ovAttention" aria-labelledby="ovAttentionTitle" role="region" aria-live="polite" aria-atomic="false" hidden>');
    expect(page).toContain('class="ov-operations ov-live" id="ovLiveNow" aria-labelledby="ovLiveNowTitle" data-home-section="live" hidden>');
    expect(page).toContain('class="ov-operations ov-coming-next" id="ovComingNext" aria-labelledby="ovComingNextTitle" data-home-section="upcoming" hidden>');
    const reactPage = readFileSync(new URL("../react/pages/overview/page.tsx", import.meta.url), "utf8");
    expect(reactPage).toContain('id="ovAttention"');
    expect(reactPage).toContain('id="ovLiveNow"');
    expect(reactPage).toContain('id="ovComingNext"');
    expect(reactPage).toContain('id="ovAttentionList"');
    const source = readFileSync(new URL("../assets/dashboard/overview.js", import.meta.url), "utf8");
    expect(source).toContain("new URLSearchParams({ siteId })");
    expect(source).not.toMatch(/prediction|raffle|wager|payout|settlement/i);
    const projections = readFileSync(new URL("../assets/dashboard/overview-state.js", import.meta.url), "utf8");
    expect(projections).toContain('buildDashboardPath("activities.overview", { siteId })');
    expect(projections).not.toMatch(/prediction|raffle|wager|payout|settlement/i);
    const dashboardCss = readFileSync(new URL("../assets/dashboard-v4.css", import.meta.url), "utf8");
    expect(dashboardCss).toContain(".ov-attention-row .btn,");
    const activitiesClient = readFileSync(new URL("../react/pages/activities/page.tsx", import.meta.url), "utf8");
    expect(activitiesClient).toContain('attention && "is-attention bg-amber-50/60 dark:bg-amber-950/20"');
    expect(activitiesClient).toContain('<strong className="wrap-anywhere text-sm">{template.name}</strong>');
    expect(activitiesClient).toContain('<strong className="wrap-anywhere text-sm">{schedule.templateName}</strong>');
  });
});

import { describe, it, expect } from "bun:test";
import {
  RewardsChannelPage,
  RewardsOverviewPage,
  RewardsRulesPage,
  RewardsShopPage,
  RewardsRedemptionsPage,
} from "../pages/rewards.jsx";
import { AudienceMembersPage } from "../pages/audience.jsx";
import { readFileSync } from "node:fs";
import {
  rewardsChannelConfig,
  rewardsOverviewConfig,
  rewardsRulesConfig,
  rewardsShopConfig,
  rewardsRedemptionsConfig,
} from "../pages/rewards.jsx";

const pages = [
  ["channel", RewardsChannelPage],
  ["overview", RewardsOverviewPage],
  ["rules", RewardsRulesPage],
  ["shop", RewardsShopPage],
  ["redemptions", RewardsRedemptionsPage],
];
const rewardsPageSource = readFileSync(new URL("../react/pages/rewards/page.tsx", import.meta.url), "utf8");
const rewardsEntrySource = readFileSync(new URL("../react/pages/rewards/entry.tsx", import.meta.url), "utf8");
const rewardsDispatcherSource = readFileSync(new URL("../assets/credits.js", import.meta.url), "utf8");
const dashboardV4Source = readFileSync(new URL("../assets/dashboard-v4.css", import.meta.url), "utf8");
const viewerClientSource = readFileSync(new URL("../react/pages/viewer-account/page.tsx", import.meta.url), "utf8");
const CHECKIN_AMOUNT_ERROR = "Check-in credits must be a whole number from 1 to 1,000.";

describe("server-rendered rewards entry points", () => {
  for (const [tab, render] of pages) {
    it(`puts the ${tab} tab marker on #cr-app`, () => {
      const html = render().toString();
      expect(html).toContain(`<div id="cr-app" data-cr-tab="${tab}"`);
      expect(html).not.toContain(`<div data-cr-tab="${tab}">`);
    });
  }

  it("mounts Audience Members on its dedicated React root", () => {
    const html = AudienceMembersPage({ fragment: true }).toString();
    expect(html).toContain('<div id="audience-app" data-audience-tab="viewers"></div>');
    expect(html).not.toContain('<div id="cr-app" data-cr-tab="viewers"');
  });

  it("groups every rewards destination under the Rewards workspace", () => {
    for (const config of [rewardsOverviewConfig, rewardsRulesConfig, rewardsShopConfig, rewardsRedemptionsConfig]) {
      expect(config.title).toContain("· Rewards ·");
    }
    for (const config of [rewardsChannelConfig, rewardsOverviewConfig, rewardsRulesConfig, rewardsShopConfig, rewardsRedemptionsConfig]) {
      expect(config.styles).toContain("/assets/react/rewards.css");
    }
    expect(rewardsEntrySource).toContain('document.getElementById("cr-app")?.getAttribute("data-cr-tab")');
    expect(rewardsEntrySource).toContain("export const enter = island.enter");
    expect(rewardsEntrySource).toContain("export const leave = island.leave");
  });

  it("leads with automatic Kick reward creation while preserving manual entry", () => {
    expect(rewardsPageSource).toContain('openForm(canCreateKickReward ? "kick" : "manual", true)');
    expect(rewardsPageSource).toContain('id="cr-add-mapping"');
    expect(rewardsPageSource).toContain('id="cr-reward-create-form"');
    expect(rewardsPageSource).toContain('id="cr-reward-form"');
    expect(rewardsPageSource).toContain("Find this reward in Kick Creator Dashboard");
    expect(dashboardV4Source).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(dashboardV4Source).toContain("#cr-rewards details");
    expect(dashboardV4Source).toContain("overflow-wrap: anywhere");
  });

  it("offers daily check-in settings before Kick rewards", () => {
    expect(rewardsPageSource).toContain('id="cr-checkin"');
    expect(rewardsPageSource).toContain("Daily check-in");
    expect(rewardsPageSource).toContain("Signed-in members can check in once a day (UTC) to earn credits. Works without Kick.");
    expect(rewardsPageSource).toContain('id="cr-checkin-active"');
    expect(rewardsPageSource).toContain('id="cr-checkin-amount"');
    expect(rewardsPageSource).toContain("Save daily check-in");
    expect(rewardsPageSource).toContain('"/api/credits/earning-rules"');
    expect(rewardsPageSource).toContain(CHECKIN_AMOUNT_ERROR);
    expect(rewardsPageSource.indexOf('id="cr-checkin"')).toBeLessThan(rewardsPageSource.indexOf('id="cr-rewards"'));
    expect(rewardsPageSource.indexOf("<StatusText error={checkinError}")).toBeLessThan(rewardsPageSource.indexOf("Save daily check-in"));
    expect(rewardsPageSource).toContain('/dashboard/audience/members">Award credits from Members.</a>');
  });

  it("surfaces Kick OAuth results in the channel status and cleans one-time params", () => {
    expect(rewardsPageSource).toContain('params.get("kick_connected")');
    expect(rewardsPageSource).toContain('clean.searchParams.delete("error")');
    expect(rewardsPageSource).toContain('clean.searchParams.delete("kick_delivery")');
    expect(rewardsPageSource).toContain('clean.searchParams.delete("kick_connected")');
    expect(rewardsPageSource).toContain("Kick connection could not be completed. Try again.");
    expect(rewardsPageSource).toContain("/api/kick/disconnect");
    expect(rewardsDispatcherSource).toContain("applyOAuthContext");
  });

  it("maps Viewer Account sign-in errors to plain language and removes the one-time query", () => {
    expect(viewerClientSource).toContain("LOGIN_ERROR_MESSAGES");
    expect(viewerClientSource).toContain("That sign-in took too long. Try again.");
    expect(viewerClientSource).toContain('url.searchParams.delete("error")');
    expect(viewerClientSource).toContain("url.search");
    expect(viewerClientSource).not.toContain('"Login failed: " + urlParams.get("error")');
  });

  it("reviews shop reward readiness as advisory while preserving the save payload", () => {
    expect(rewardsPageSource).toContain('import { reviewRewardReadiness } from "@yourrank/shared/reward-readiness"');
    expect(rewardsPageSource).toContain("reviewRewardReadiness(item");
    expect(rewardsPageSource).toContain("Before this goes live");
    expect(rewardsPageSource).toContain("Add a contact method");
    expect(rewardsPageSource).toContain("Edit description");
    expect(rewardsPageSource).toContain('description: draft.description.trim()');
    expect(rewardsPageSource).toContain("imageData,");

    const handlerSource = readFileSync(new URL("../handlers/credits.js", import.meta.url), "utf8");
    expect(handlerSource).toContain('import { hasCreatorContactMethod } from "@yourrank/shared/creator-contact"');
    expect(handlerSource).toContain("ready: hasCreatorContactMethod(fromJsonb(site.extra_json))");
    expect(handlerSource).toContain('editHref: "/dashboard/site#siteContactCard"');
    expect(dashboardV4Source).toContain(".cr-shop-review {");
    expect(dashboardV4Source).toContain(".cr-shop-review-chip {");
  });
});

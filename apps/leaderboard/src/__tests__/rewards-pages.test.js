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
  // Members live under Audience now; the credits client still hydrates it via
  // the historical "viewers" tab marker.
  ["viewers", AudienceMembersPage],
];
const rewardsMarkupSource = readFileSync(new URL("../pages/credits-pages.js", import.meta.url), "utf8");
const rewardsClientSource = readFileSync(new URL("../assets/credits.js", import.meta.url), "utf8");
const dashboardV4Source = readFileSync(new URL("../assets/dashboard-v4.css", import.meta.url), "utf8");
const viewerClientSource = readFileSync(new URL("../assets/viewer-dashboard.js", import.meta.url), "utf8");

describe("server-rendered rewards pages", () => {
  for (const [tab, render] of pages) {
    it(`puts the ${tab} tab marker on #cr-app`, () => {
      const html = render().toString();
      expect(html).toContain(`<div id="cr-app" data-cr-tab="${tab}"`);
      expect(html).not.toContain(`<div data-cr-tab="${tab}">`);
    });
  }

  it("groups every rewards destination under the Engage workspace", () => {
    for (const config of [rewardsOverviewConfig, rewardsRulesConfig, rewardsShopConfig, rewardsRedemptionsConfig]) {
      expect(config.title).toContain("· Engage ·");
    }
  });

  it("leads with automatic Kick reward creation while preserving manual entry", () => {
    const html = RewardsRulesPage().toString();
    expect(html.indexOf("cr-reward-create-form")).toBeLessThan(html.indexOf("cr-reward-form"));
    expect(html).toContain('id="cr-add-mapping"');
    expect(html).toContain("#cr-reward-create-form");
    expect(html).toContain('id="cr-reward-form"');
    expect(html).toContain('class="embed-tip cr-reward-id-tip"');
    expect(rewardsMarkupSource).not.toContain("cr-help-tip");
    expect(rewardsMarkupSource).not.toContain('style="background:#eff6ff');
    expect(rewardsClientSource).toContain('capabilities.manageConnections ? "cr-reward-create-form" : "cr-reward-form"');
    expect(rewardsClientSource).toContain('formId === "cr-reward-form" || formId === "cr-reward-create-form"');
    expect(dashboardV4Source).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(dashboardV4Source).toContain("#cr-rewards details");
    expect(dashboardV4Source).toContain("overflow-wrap: anywhere");
  });

  it("surfaces Kick OAuth results in the channel status and cleans one-time params", () => {
    const html = RewardsChannelPage().toString();
    expect((html.match(/id="cr-channel-status"/g) || []).length).toBe(1);
    expect(rewardsClientSource).toContain('params.get("kick_connected")');
    expect(rewardsClientSource).toContain('clean.searchParams.delete("error")');
    expect(rewardsClientSource).toContain('setStatus("cr-channel-status"');
    expect(rewardsClientSource).toContain("applyOAuthContext();");
    expect(rewardsClientSource.indexOf("applyOAuthContext();")).toBeLessThan(rewardsClientSource.indexOf("const shell = await loadBoardShell"));
    expect(rewardsClientSource).toContain('sitePath("/api/kick/disconnect", activeSiteId)');
    expect(rewardsClientSource).toContain("const statusClearTimers = new Map()");
  });

  it("maps Viewer Account sign-in errors to plain language and removes the one-time query", () => {
    expect(viewerClientSource).toContain("LOGIN_ERROR_MESSAGES");
    expect(viewerClientSource).toContain("That sign-in took too long. Try again.");
    expect(viewerClientSource).toContain('url.searchParams.delete("error")');
    expect(viewerClientSource).toContain("url.search");
    expect(viewerClientSource).not.toContain('"Login failed: " + urlParams.get("error")');
  });

  it("reviews reward readiness in the existing shop editor without blocking or rewriting (YR-014)", () => {
    const html = RewardsShopPage().toString();
    // Advisory panel lives inside the existing editor form, after the Active toggle.
    expect(html).toMatch(/id="cr-shop-active"[\s\S]*<section class="cr-shop-review" id="cr-shop-review"[^>]*hidden>/);
    expect(html).toContain("These are warnings, not blockers: you can still save.");
    expect(html).toContain('<ul class="cr-shop-review-list" id="cr-shop-review-list"></ul>');
    expect(html).toMatch(/id="cr-shop-review"[\s\S]*id="cr-shop-submit"/);

    // Client: same pure review for the editor and for already-published rows;
    // findings link to the control that fixes them.
    expect(rewardsClientSource).toContain('import { reviewRewardReadiness } from "@yourrank/shared/reward-readiness"');
    expect(rewardsClientSource).toContain('contactReady: state.creatorContact?.ready !== false');
    expect(rewardsClientSource).toContain('data-review-focus="cr-shop-desc"');
    expect(rewardsClientSource).toContain("Add a contact method</a>");
    expect(rewardsClientSource).toContain("A contact method is required before a new reward goes live.");
    expect(rewardsClientSource).toContain('$("cr-shop-desc")?.addEventListener("input", renderShopReview)');
    expect(rewardsClientSource).toContain('$("cr-shop-active")?.addEventListener("change", renderShopReview)');
    expect(rewardsClientSource).toMatch(/i\.active && !shopReview\(i\)\.ready \? `[^`]*cr-shop-review-chip[^`]*data-edit-shop=/);
    // The save payload is unchanged: the review never edits what is stored.
    expect(rewardsClientSource).toContain('description: $("cr-shop-desc").value.trim(), cost: Number($("cr-shop-cost").value)');
    expect(rewardsClientSource).not.toMatch(/gibberish|looksLikeGibberish/i);

    // Server: contact readiness reuses the public Contact page's rule.
    const handlerSource = readFileSync(new URL("../handlers/credits.js", import.meta.url), "utf8");
    expect(handlerSource).toContain('import { hasCreatorContactMethod } from "@yourrank/shared/creator-contact"');
    expect(handlerSource).toContain("ready: hasCreatorContactMethod(fromJsonb(site.extra_json))");
    expect(handlerSource).toContain('editHref: "/dashboard/site#siteContactCard"');

    expect(dashboardV4Source).toContain(".cr-shop-review {");
    expect(dashboardV4Source).toContain(".cr-shop-review-chip {");
  });
});

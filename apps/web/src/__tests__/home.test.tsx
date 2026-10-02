/// <reference types="@types/bun" />

import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import { Hero } from "../components/home/hero";
import { WorkspacePreview } from "../components/home/workspace-preview";
import { ProofMarquee, HowItWorks, ComparisonSection, PricingSnapshot } from "../components/home/sections";
import { ProductPage } from "../components/product-page";
import { PricingPlans, accountPlanAction } from "../app/pricing/pricing-plans";
import { SiteFooter } from "../components/site-shell";
import { MotionFooter } from "../components/home/motion-footer";

describe("Home & Product components", () => {
  it("keeps legal and contact destinations available in both marketing footers", () => {
    for (const footer of [<SiteFooter />, <MotionFooter />]) {
      const html = renderToString(footer);
      expect(html).toContain('aria-label="Legal and contact"');
      for (const path of ["/terms", "/privacy", "/cookies", "/contact"]) {
        expect(html).toContain(`href="${path}"`);
      }
    }
  });
  it("renders the rotating hero words with one accessible headline", () => {
    const html = renderToString(<Hero />);

    expect(html).toContain("Turn viewers into regulars who come back.");
    for (const word of ["regulars", "fans", "subscribers", "superfans"]) {
      expect(html).toMatch(new RegExp(`>${word}<`));
    }
  });

  it("renders WorkspacePreview with overview stats and player standings", () => {
    const html = renderToString(<WorkspacePreview />);
    expect(html).toContain("YourRank");
    expect(html).toContain("Friday Stream");
    expect(html).toContain("NovaByte");
    expect(html).toContain("Giveaway entries");
    expect(html).toContain("Tournament players");
  });

  it("renders ProofMarquee with product capabilities", () => {
    const html = renderToString(<ProofMarquee />);
    expect(html).toContain("Giveaways from Kick chat");
    expect(html).toContain("One entry per Kick account");
    expect(html).toContain("Tournament brackets");
  });

  it("renders HowItWorks as a meaningful keyboard fragment destination", () => {
    const html = renderToString(<HowItWorks />);
    expect(html).toContain('id="loop"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-labelledby="loop-heading"');
    expect(html).toContain('<h2 id="loop-heading"');
    expect(html).toContain("Connect Kick");
    expect(html).toContain("Run it from chat");
    expect(html).toContain("Reward regulars");
  });

  it("renders ComparisonSection with YourRank vs Manual Stack", () => {
    const html = renderToString(<ComparisonSection />);
    expect(html).toContain("YourRank");
    expect(html).toContain("A manual stack");
    expect(html).toContain("Everything your stream events need");
  });

  it("renders PricingSnapshot with plan tiers", () => {
    const html = renderToString(<PricingSnapshot />);
    expect(html).toContain("Start with the community you have");
    expect(html).toContain("Free");
    expect(html).toContain("Starter");
    expect(html).toContain("Pro");
    expect(html).toContain("50 active viewers");
    expect(html).toContain("250 viewers");
    expect(html).toContain("1 site · 10 leaderboard players");
    expect(html).not.toContain("Get Team");
    expect((html.match(/<article/g) || []).length).toBe(3);
    expect(html).not.toContain("100 active viewers");
  });

  it("renders the full pricing comparison with the corrected Free limits", () => {
    const html = renderToString(<PricingPlans />);
    expect(html).toContain("50 active viewers");
    expect(html).toContain("250 active viewers");
    expect(html).toContain("1 site · 10 leaderboard players");
    expect(html).toContain("100 leaderboard players");
    expect(html).toContain("Community tournaments");
    expect(html).toContain("90 days");
    expect(html).not.toContain("Team</th>");
    expect(html).not.toContain("100 active viewers");
  });

  it("routes paid plan CTAs to signup with the selected plan", () => {
    const html = renderToString(<PricingPlans />);
    expect(html).toMatch(/href="\/signup\?plan=starter&amp;interval=monthly">Get Starter<\/a>/);
    expect(html).toMatch(/href="\/signup\?plan=pro&amp;interval=monthly">Get Pro<\/a>/);
    expect(html).not.toContain("Get Team");
    expect(html).toMatch(/href="\/signup\?plan=free&amp;interval=monthly">Start free<\/a>/);
  });

  it("public pricing shows only public tiers and the Pro-scale support CTA", () => {
    const html = renderToString(<PricingPlans />);
    expect(html).toContain("2,500 active viewers");
    expect(html).toContain("more than 2,500 active viewers, talk to us about higher limits.");
    expect(html).toContain("Start your community");
    expect(html).toContain("Grow and automate your community");
    expect(html).toContain("Need more scale?");
    expect(html).not.toContain("Team is not currently sold");
    expect(html).toMatch(/href="\/help\/support"[^>]*>Talk to us</);
    expect(html).not.toContain("10,000 active viewers");
    expect(html).not.toContain("100 active viewers");
    expect(html).not.toContain("50 leaderboard players");
    expect(html).not.toMatch(/Scale plan|Enterprise/);
  });

  it("signed-in pricing actions mirror the billing plan-change matrix", () => {
    const proMonthly = { plan: "pro" as const, subscription: { plan: "pro" as const, interval: "monthly" as const } };
    expect(accountPlanAction(proMonthly, "pro", "monthly")).toEqual({ label: "Current plan", href: null });
    expect(accountPlanAction(proMonthly, "pro", "annual").label).toMatch(/annual/i);
    expect(accountPlanAction(proMonthly, "team", "monthly").label).toMatch(/upgrade/i);
    expect(accountPlanAction(proMonthly, "team", "annual").href).toBe("/dashboard/settings/billing?plan=team&interval=annual");
    expect(accountPlanAction(proMonthly, "free", "monthly")).toEqual({ label: "Manage in billing", href: "/dashboard/settings/billing" });

    const teamAnnual = { plan: "team" as const, subscription: { plan: "team" as const, interval: "annual" as const } };
    expect(accountPlanAction(teamAnnual, "pro", "annual").label).toMatch(/downgrade/i);
    expect(accountPlanAction(teamAnnual, "team", "monthly").label).toMatch(/monthly/i);

    const free = { plan: "free" as const, subscription: null };
    expect(accountPlanAction(free, "free", "monthly")).toEqual({ label: "Current plan", href: null });
    expect(accountPlanAction(free, "pro", "annual")).toEqual({ label: "Upgrade to Pro", href: "/dashboard/settings/billing?plan=pro&interval=annual" });
  });

  it("renders ProductPage with content and steps", () => {
    const html = renderToString(
      <ProductPage
        content={{
          kind: "sites",
          title: "Give your community a place worth returning to.",
          intro: "Publish a branded destination.",
          outcome: "From a blank page to a live community destination.",
          steps: [
            { number: "01", title: "Choose the experience", body: "Set the public sections." },
          ],
        }}
      />
    );
    expect(html).toContain("Give your community a place worth returning to.");
    expect(html).toContain("Choose the experience");
    expect(html).toContain("Explore the connected suite.");
  });

  it("closes the mobile navigation on Escape and restores trigger focus", async () => {
    const source = await Bun.file(new URL("../components/site-shell.tsx", import.meta.url)).text();
    expect(source).toMatch(/event\.key !== "Escape"/);
    expect(source).toContain("triggerRef.current?.focus()");
    expect(source).toContain("ref={triggerRef}");
    expect(source).toMatch(/useEffect\(\(\) => \{\s*setMobileOpen\(false\);\s*\}, \[pathname\]\);/);
  });

});

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

const PRIMARY_MARKETING_SOURCES = [
  "../components/site-shell.tsx",
  "../components/product-page.tsx",
  "../components/home/sticky-scroll-reveal.tsx",
  "../app/sites/page.tsx",
  "../app/switch/page.tsx",
  "../app/about/page.tsx",
  "../app/credits/page.tsx",
  "../app/docs/page.tsx",
  "../app/changelog/page.tsx",
].map((path) => new URL(path, import.meta.url));

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
    expect(html).toContain("Kick Sub Race");
    expect(html).toContain("NovaByte");
    expect(html).toContain("Page views");
    expect(html).toContain("Subscribers");
  });

  it("renders ProofMarquee with product capabilities", () => {
    const html = renderToString(<ProofMarquee />);
    expect(html).toContain("Branded community sites");
    expect(html).toContain("Telegram commands");
    expect(html).toContain("Viewer credits");
  });

  it("renders HowItWorks as a meaningful keyboard fragment destination", () => {
    const html = renderToString(<HowItWorks />);
    expect(html).toContain('id="loop"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-labelledby="loop-heading"');
    expect(html).toContain('<h2 id="loop-heading"');
    expect(html).toContain("Publish");
    expect(html).toContain("Activate");
    expect(html).toContain("Reward");
  });

  it("renders ComparisonSection with YourRank vs Manual Stack", () => {
    const html = renderToString(<ComparisonSection />);
    expect(html).toContain("YourRank");
    expect(html).toContain("A manual stack");
    expect(html).toContain("Connected by design");
  });

  it("renders PricingSnapshot with plan tiers", () => {
    const html = renderToString(<PricingSnapshot />);
    expect(html).toContain("Start with the community you have");
    expect(html).toContain("Free");
    expect(html).toContain("Pro");
    expect(html).toContain("50 active viewers");
    expect(html).toContain("1 site · 10 leaderboard players");
    expect(html).not.toContain("100 active viewers");
  });

  it("renders the full pricing comparison with the corrected Free limits", () => {
    const html = renderToString(<PricingPlans />);
    expect(html).toContain("50 active viewers");
    expect(html).toContain("1 site · 10 leaderboard players");
    expect(html).not.toContain("100 active viewers");
  });

  it("routes paid plan CTAs to signup with the selected plan", () => {
    const html = renderToString(<PricingPlans />);
    expect(html).toMatch(/href="\/signup\?plan=pro&amp;interval=monthly">Get Pro<\/a>/);
    expect(html).toMatch(/href="\/signup\?plan=team&amp;interval=monthly">Get Team<\/a>/);
    expect(html).toMatch(/href="\/signup\?plan=free&amp;interval=monthly">Start free<\/a>/);
  });

  it("pricing shows the canonical Team capacity and the custom-scale CTA, without stale values", () => {
    const html = renderToString(<PricingPlans />);
    expect(html).toContain("25,000 active viewers");
    expect(html).toContain("2,500 active viewers");
    expect(html).toContain("Start your community");
    expect(html).toContain("Grow and automate your community");
    expect(html).toContain("Run your community with a team");
    expect(html).toContain("Need more scale?");
    expect(html).toContain("more than 25,000 active viewers");
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
    expect(html).not.toContain('href="/games"');
  });

  it("closes the mobile navigation on Escape and restores trigger focus", async () => {
    const source = await Bun.file(new URL("../components/site-shell.tsx", import.meta.url)).text();
    expect(source).toMatch(/event\.key !== "Escape"/);
    expect(source).toContain("triggerRef.current?.focus()");
    expect(source).toContain("ref={triggerRef}");
    expect(source).toMatch(/useEffect\(\(\) => \{\s*setMobileOpen\(false\);\s*\}, \[pathname\]\);/);
  });

  it("keeps restricted legacy mechanics out of primary launch marketing", async () => {
    const source = (await Promise.all(PRIMARY_MARKETING_SOURCES.map((url) => Bun.file(url).text()))).join("\n");
    expect(source).not.toMatch(/\b(?:games?|raffles?|predictions?|wager(?:ed|ing)?|casino)\b/i);
    const retiredPage = await Bun.file(new URL("../app/games/page.tsx", import.meta.url)).text();
    expect(retiredPage).toContain('permanentRedirect("/sites")');
  });
});

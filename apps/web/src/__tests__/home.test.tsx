/// <reference types="@types/bun" />

import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import { Hero } from "../components/home/hero";
import { WorkspacePreview } from "../components/home/workspace-preview";
import { ProofMarquee, HowItWorks, ComparisonSection, PricingSnapshot } from "../components/home/sections";
import { ProductPage } from "../components/product-page";
import { PricingPlans } from "../app/pricing/pricing-plans";
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
    expect(html).toContain("100 active viewers");
    expect(html).toContain("1 site and 50 leaderboard players");
    expect(html).not.toContain("200 active viewers");
  });

  it("renders the full pricing comparison with the corrected Free limits", () => {
    const html = renderToString(<PricingPlans />);
    expect(html).toContain("100 active viewers");
    expect(html).toContain("1 site · 50 leaderboard players");
    expect(html).not.toContain("200 active viewers");
  });

  it("never promises immediate paid activation while checkout is closed", () => {
    const html = renderToString(<PricingPlans />);
    expect(html).not.toMatch(/Start Pro<|Start Team</);
    expect(html).toContain("Start free, Pro selected");
    expect(html).toContain("Pro checkout is not open yet.");
    expect(html).toContain("Team checkout is not open yet.");
    expect(html).toMatch(/<a aria-describedby="plan-pro-availability"[^>]*href="\/signup\?plan=pro&amp;interval=monthly"/);
    expect(html).toMatch(/<a data-magnetic="true"[^>]*href="\/signup\?plan=free&amp;interval=monthly">Start free<\/a>/);
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

/// <reference types="@types/bun" />

import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import { Hero } from "../components/home/hero";
import { WorkspacePreview } from "../components/home/workspace-preview";
import { ProofMarquee, HowItWorks, ComparisonSection, PricingSnapshot } from "../components/home/sections";
import { ProductPage } from "../components/product-page";
import { PricingPlans } from "../app/pricing/pricing-plans";

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

  it("renders HowItWorks loop steps", () => {
    const html = renderToString(<HowItWorks />);
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

  it("keeps restricted legacy mechanics out of primary launch marketing", async () => {
    const source = (await Promise.all(PRIMARY_MARKETING_SOURCES.map((url) => Bun.file(url).text()))).join("\n");
    expect(source).not.toMatch(/\b(?:games?|raffles?|predictions?|wager(?:ed|ing)?|casino)\b/i);
    const retiredPage = await Bun.file(new URL("../app/games/page.tsx", import.meta.url)).text();
    expect(retiredPage).toContain('permanentRedirect("/sites")');
  });
});

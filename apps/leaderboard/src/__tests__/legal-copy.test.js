import { describe, expect, it } from "bun:test";
import { applyLegalIdentity } from "../pages/legal-helper.js";
import { termsPage } from "../pages/terms.js";
import { responsiblePage } from "../pages/responsible.js";
import { privacyPage } from "../pages/privacy.js";
import { cookiesPage } from "../pages/cookies.js";
import { refundPage } from "../pages/refund.js";
import { reviewsPage } from "../pages/reviews.js";

describe("platform legal copy truth", () => {
  it("keeps default legal pages aligned with the free-credit launch boundary", () => {
    const terms = applyLegalIdentity(termsPage, {});
    const responsible = applyLegalIdentity(responsiblePage, {});
    const copy = `${terms}\n${responsible}`;

    expect(copy).toContain("When enabled in Billing, Pro and Team subscriptions are processed by Polar.");
    expect(copy).toContain("Community credits have no cash value.");
    expect(copy).not.toMatch(/sign up or deposit|cryptocurrency|blockchain/i);
  });

  it("keeps legal navigation pointed at the marketing workflow fragment", () => {
    const terms = applyLegalIdentity(termsPage, {});
    const howItWorksTargets = [...terms.matchAll(/<a href="([^"]+)">How it works<\/a>/g)]
      .map((match) => match[1]);

    expect(howItWorksTargets).toEqual(["/#loop", "/#loop"]);
  });
});

describe("global legal pages share the responsive public shell (YR-038)", () => {
  const pages = { terms: termsPage, privacy: privacyPage, cookies: cookiesPage, refund: refundPage, responsible: responsiblePage };

  for (const [key, source] of Object.entries(pages)) {
    it(`renders /${key} inside the public header/footer as one article`, () => {
      const html = applyLegalIdentity(source, {});
      expect(html).toContain('<body class="marketing-page marketing-page--legal" data-identity="devin-reference">');
      expect(html).toContain('<nav class="top wrap" aria-label="Main navigation">');
      expect(html).toContain('class="nav-toggle" type="button" aria-label="Open navigation" aria-expanded="false" aria-controls="public-navigation"');
      expect(html).toContain('<div class="links" id="public-navigation">');
      expect(html).toContain('<a href="/signup" class="btn btn--accent">Get started</a>');
      expect(html).toContain('<script src="/assets/landing.js?v=3"></script>');
      expect(html).toContain('href="/assets/landing.css"');
      expect(html).not.toContain('class="topbar"');
      expect(html).not.toContain("topbar-right");
      expect(html).not.toContain("/assets/app.css");
      expect(html).toContain('<main class="wrap" id="main-content"><article class="legal"><h1>');
      expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
      expect(html).toContain(`<link rel="canonical" href="https://yourrank.site/${key}" />`);
      expect(html).toContain(`<a href="/${key}" aria-current="page">`);
      expect(html).toContain('data-cookie-preferences>Cookie preferences</button>');
      expect(html).toContain('<footer class="ftr ftr--platform"><div class="wrap">');
    });
  }

  it("matches the /reviews header so public pages stay consistent", () => {
    const headerOf = (html) => html.match(/<header>[\s\S]*?<\/header>/)[0].replace(/yr(Legal|Rev)LogoGrad/g, "yrLogoGrad");
    expect(headerOf(applyLegalIdentity(termsPage, {}))).toBe(headerOf(reviewsPage));
  });
});

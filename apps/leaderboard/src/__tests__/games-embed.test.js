import { describe, expect, test } from "bun:test";
import { gamesIslandHead, gamesIslandMount } from "@yourrank/shared/games-embed";

describe("gamesIslandHead", () => {
  test("links the scoped stylesheet only", () => {
    expect(gamesIslandHead()).toBe('<link rel="stylesheet" href="/assets/games.css" />');
  });
});

describe("gamesIslandMount", () => {
  const base = { slug: "acme", nonce: "n0nce" };

  test("boots from a data attribute with the site's identity", () => {
    const html = gamesIslandMount({ ...base, siteName: "Acme TV", logoUrl: "/logo.png" });
    const boot = JSON.parse(html.match(/data-gx-boot="([^"]*)"/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
    expect(boot).toMatchObject({
      slug: "acme",
      siteName: "Acme TV",
      logoUrl: "/logo.png",
      homeUrl: "/acme",
      earnHref: "/acme/credits",
      header: false,
    });
  });

  test("falls back to the slug for the name and a null logo", () => {
    const html = gamesIslandMount(base);
    const boot = JSON.parse(html.match(/data-gx-boot="([^"]*)"/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
    expect(boot.siteName).toBe("acme");
    expect(boot.logoUrl).toBeNull();
  });

  test("escapes hostile site metadata instead of emitting markup", () => {
    const html = gamesIslandMount({ ...base, slug: '"><script>x()</script>', siteName: "<img onerror=1>" });
    expect(html).not.toContain("<script>x()");
    expect(html).not.toContain("<img onerror");
  });

  test("carries the CSP nonce onto the module script", () => {
    expect(gamesIslandMount(base)).toContain('<script type="module" src="/assets/games/games.js" nonce="n0nce"></script>');
  });

  test("carries no demo affordance: the island has one API, the real one", () => {
    const html = gamesIslandMount({ ...base, demoAllowed: true });
    expect(html).not.toContain("demo");
  });

  test("renders a stable skeleton and a no-JS fallback", () => {
    const html = gamesIslandMount(base);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("gx-skeleton__board");
    expect(html).toContain("<noscript>");
  });

  test("carries no game or balance state — the server decides", () => {
    const html = gamesIslandMount({ ...base, siteName: "Acme" });
    const boot = JSON.parse(html.match(/data-gx-boot="([^"]*)"/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
    expect(Object.keys(boot).sort()).toEqual(["earnHref", "header", "homeUrl", "logoUrl", "signInHref", "siteName", "slug"]);
    expect(html).not.toMatch(/mines|plinko|dice|multiplier/i);
  });
});

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderSite } from "@yourrank/shared/site-render";
import { renderNewHallOfFame, renderNewLegalPage, renderNewPlayerProfile } from "../auxiliary-renderers.js";
import { error500Page, notFoundPage, pendingVerificationPage, suspendedPage } from "../middleware/headers.js";

const root = join(import.meta.dir, "../../../../");
const assets = join(root, "apps/leaderboard/src/assets");
const opts = { slug: "creator", homeUrl: "https://example.test", nonce: "n" };

const baseData = {
  brand: { name: "Creator Name", tagline: "Weekly board and free rewards", period: "Monthly", prizePool: "$500" },
  branding: { template: "cyber_arcade", font: "Inter", options: {} },
  players: [
    { name: "Alice", rank: 1, wagered: 5000, prize: "$100" },
    { name: "Bob", rank: 2, wagered: 3000, prize: "$60" },
  ],
  prizes: { currency: "$", wagerLabel: "Wagered", prizeLabel: "Prize" },
  shopItems: [
    { id: 1, name: "Song request", cost: 600, active: true },
    { id: 2, name: "VIP badge", cost: 250, active: true },
    { id: 3, name: "Shoutout", cost: 400, active: true },
    { id: 4, name: "Overlay cameo", cost: 900, active: true },
  ],
  socials: [
    { name: "Kick", type: "kick", url: "https://kick.com/creator" },
    { name: "Discord", type: "discord", url: "https://discord.gg/creator" },
  ],
  siteSections: { home: true, leaderboard: true, shop: true, games: false, me: true },
};

function render(section, { data = baseData, viewer = null, viewerData = null, custom = false } = {}) {
  return renderSite({
    r: { slug: "creator", plan: "pro", data },
    section,
    viewer,
    viewerData,
    opts: { ...opts, isCustomDomain: custom, logoUrl: data.logoUrl || null },
  });
}

const viewer = { kick_username: "viewer_one" };
const viewerData = { viewerOnSite: { balance: 1234 }, ledger: [], redemptions: [] };

describe("public viewer shell", () => {
  it("gives the creator header sole ownership of public chrome", async () => {
    const html = await render("home");
    expect((html.match(/<header class="yr-top">/g) || []).length).toBe(1);
    expect((html.match(/<main\b/g) || []).length).toBe(1);
    expect((html.match(/<h1\b/g) || []).length).toBe(1);
    expect(html).not.toContain("yr-side ");
    expect(html).not.toContain('class="yr-region"');
    expect(html).not.toContain('class="yr-header"');
    expect(html).not.toContain("<aside");
  });

  it("renders only enabled sections and marks the current one as an ordinary link", async () => {
    const html = await render("shop");
    const tabs = html.slice(html.indexOf('class="yr-tabs"'), html.indexOf("</nav>"));
    expect(tabs).toContain(">Home<");
    expect(tabs).toContain(">Leaderboard<");
    expect(tabs).toContain(">Rewards<");
    expect(tabs).toContain(">My credits<");
    expect(tabs).not.toContain(">Games<");
    expect((html.match(/aria-current="page"/g) || []).length).toBe(2); // header link + drawer link
    expect(tabs).toContain('href="https://example.test/creator/shop" aria-current="page"');
    expect(html).not.toContain('role="tab"');
    expect(html).not.toContain('role="tablist"');
  });

  it("keeps the opaque games entry when the streamer enabled it", async () => {
    const html = await render("home", {
      data: { ...baseData, siteSections: { ...baseData.siteSections, games: true } },
    });
    expect(html).toContain('href="https://example.test/creator/games"><span>Games</span>');
  });

  it("builds slug and custom-domain section hrefs from the same helper", async () => {
    const slugged = await render("home");
    const custom = await render("home", { custom: true });
    expect(slugged).toContain('href="https://example.test/creator/leaderboard"');
    expect(custom).toContain('href="https://example.test/leaderboard"');
    expect(custom).not.toContain("/creator/leaderboard");
  });

  it("shows the configured creator mark and never a placeholder one", async () => {
    const withLogo = await render("home", {
      data: { ...baseData, logoUrl: "https://cdn.example.test/logo.png" },
    });
    expect(withLogo).toContain('class="yr-id-logo" src="https://cdn.example.test/logo.png"');
    expect(withLogo).toContain('srcset="https://cdn.example.test/logo.png?w=64 64w');
    expect(withLogo).toContain('width="36" height="36" alt=""');
    expect(withLogo).toContain('class="yr-intro-logo"');

    const withoutLogo = await render("home");
    expect(withoutLogo).not.toContain("yr-id-logo");
    expect(withoutLogo).not.toContain("yr-intro-logo");
    expect(withoutLogo).toContain('<span class="yr-id-name">Creator Name</span>');
  });

  it("clamps a long creator name in the bar without dropping it from the markup", async () => {
    const long =
      "Streamerwithaverylongsinglewordchannelname Extended Championship Board Season Finale";
    const html = await render("home", {
      data: { ...baseData, brand: { ...baseData.brand, name: long } },
    });
    const css = readFileSync(join(assets, "site-shell.css"), "utf8");
    // Full name in the DOM (so it stays the accessible name) even though the bar clips it.
    expect(html).toContain(`<span class="yr-id-name">${long}</span>`);
    expect(html).toContain(`<h1 class="yr-intro-name">${long}</h1>`);
    const bar = css.match(/\.yr-id-name \{([^}]*)\}/);
    expect(bar).not.toBeNull();
    expect(bar[1]).toContain("overflow-wrap: anywhere");
    expect(bar[1]).toContain("-webkit-line-clamp: 2");
    expect(bar[1]).toContain("overflow: hidden");
    // No JS truncation. The home heading breaks inside the word and stops after
    // three lines, the same bound the Rewards and My credits heading uses, so an
    // extreme name cannot push the board and the rewards off the phone.
    expect(readFileSync(join(assets, "site-shell.js"), "utf8")).not.toContain("yr-id-name");
    const intro = css.match(/\.yr-intro-name \{([^}]*)\}/);
    expect(intro).not.toBeNull();
    expect(intro[1]).toContain("overflow-wrap: anywhere");
    expect(intro[1]).toContain("line-clamp: 3");
    expect(intro[1]).toContain("overflow: hidden");
    // Copy that quotes the creator's name must break inside the word too, or a
    // single unbreakable name widens the whole document on a phone.
    expect(css).toMatch(/\.yr-vnote-p \{[^}]*overflow-wrap: anywhere/);
    expect(css).toMatch(/\.yr-foot-c \{[^}]*overflow-wrap: anywhere/);
    expect(css).toMatch(/\.yr-sec-title \{([^}]*)overflow-wrap: anywhere/);
  });

  it("keeps the narrow balance and account controls at a 44px minimum target", async () => {
    const css = readFileSync(join(assets, "site-shell.css"), "utf8");
    const shared = css.match(/\.yr-account-link, \.yr-bal \{([^}]*)\}/);
    expect(shared).not.toBeNull();
    expect(shared[1]).toContain("min-width: 44px");
    expect(shared[1]).toContain("min-height: 44px");
    // The narrow override may only trim padding, never the target box.
    const narrow = css.slice(css.indexOf("@media (max-width: 479px)"));
    expect(narrow).not.toMatch(/\.yr-bal \{[^}]*(width|height): (?!auto)/);

    const signedIn = await render("home", { viewer, viewerData });
    expect(signedIn).toContain('<span class="yr-bal-num" data-credit-balance-num>1,234</span>');
    const big = await render("home", {
      viewer,
      viewerData: { ...viewerData, viewerOnSite: { balance: 1234567 } },
    });
    expect(big).toContain('<span class="yr-bal-num" data-credit-balance-num>1,234,567</span>');
    expect(big).toContain('aria-label="My credits on this site: 1,234,567"');
  });

  it("swaps the sign-in action for the viewer's own controls", async () => {
    const signedOut = await render("home");
    expect(signedOut).toContain(">Sign in<");
    expect(signedOut).not.toContain("yr-bal-num");

    const signedIn = await render("home", { viewer, viewerData });
    expect(signedIn).toContain('<span class="yr-bal-num" data-credit-balance-num>1,234</span>');
    expect(signedIn).toContain('aria-label="My credits on this site: 1,234"');
    expect(signedIn).toContain('<a class="yr-account-link" href="/me"');
    expect(signedIn).not.toContain(">Sign in<");
  });

  it("drops the dashboard reading of home", async () => {
    const html = await render("home", { viewer, viewerData });
    for (const removed of [
      "yr-chart",
      "yr-kpi",
      "Credits earned",
      "7-day average",
      "Recent activity",
      "Lifetime",
      "Pending orders",
      "Welcome back",
    ]) {
      expect(html).not.toContain(removed);
    }
  });

  it("tells the board story from configured data only", async () => {
    const html = await render("home");
    expect(html).toContain('<h2 class="yr-sec-title">Leaderboard</h2>');
    expect(html).toContain("Monthly leaderboard");
    expect(html).toContain("2 players");
    expect(html).toContain('<a class="yr-lead-name" href="/creator/player/Alice">Alice</a>');
    expect(html).toContain(">View leaderboard ");

    const empty = await render("home", { data: { ...baseData, players: [] } });
    expect(empty).toContain("No players on the board yet");
    expect(empty).not.toContain("yr-leads");
  });

  it("previews at most three free-credit rewards, cheapest first", async () => {
    const html = await render("home");
    const section = html.slice(html.indexOf('class="yr-preview"'), html.indexOf("</ul>"));
    const names = (section.match(/yr-preview-n">([^<]+)/g) || []).map((m) => m.split(">")[1]);
    expect(names).toEqual(["VIP badge", "Shoutout", "Song request"]);
    expect(section).toContain("250 credits");
    expect(html).toContain(">View rewards ");

    const noShop = await render("home", {
      data: { ...baseData, siteSections: { ...baseData.siteSections, shop: false } },
    });
    expect(noShop).not.toContain("yr-preview");
  });

  it("gives a signed-in viewer their balance and both credit destinations", async () => {
    const html = await render("home", { viewer, viewerData });
    expect(html).toContain('<span class="yr-vnote-num">1,234</span>');
    expect(html).toContain("credits on this site");
    expect(html).toContain('href="https://example.test/creator/shop">Spend credits</a>');
    expect(html).toContain('href="https://example.test/creator/me">My credits ');
    expect(html).toContain("No purchase, no cash value.");
  });

  it("stays useful when the streamer configured almost nothing", async () => {
    const bare = {
      ...baseData,
      brand: { name: "Bare Board" },
      players: [],
      shopItems: [],
      socials: [],
      siteSections: { home: true, leaderboard: true, shop: false, games: false, me: false },
    };
    const html = await render("home", { data: bare });
    expect(html).toContain("Leaderboard and free-credit rewards.");
    expect(html).toContain('<p class="yr-empty-t">No players on the board yet</p>');
    expect(html).not.toContain("yr-chips");
    expect(html).not.toContain("yr-vnote");
    expect(html).not.toContain(">My credits<");
  });

  it("links the creator's configured channels and nothing else", async () => {
    const html = await render("home");
    expect(html).toContain('<h2 class="yr-sec-title">Find Creator Name</h2>');
    expect(html).toContain('href="https://kick.com/creator" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("Watch on Kick");
    expect(html).toContain(">Discord<");
    expect(html).not.toContain("followers");
    expect(html).not.toContain("viewers");
  });

  it("keeps every stored template id rendering on one foundation", async () => {
    const css = readFileSync(join(assets, "site-shell.css"), "utf8");
    for (const template of ["cyber_arcade", "esports_pro", "creator_glass"]) {
      const html = await render("home", {
        data: { ...baseData, theme: { ...baseData.theme, template } },
      });
      expect(html).toContain(`data-template="${template}"`);
      expect(css).toContain(`.yr-site[data-template="${template}"]`);
    }
    // Templates may only re-tint surface tokens: no template-specific component
    // rules, no glow and no glass anywhere in the public shell.
    const templateRules = css.match(/\.yr-site\[data-template="[^"]+"\][^{]*\{[^}]*\}/g) || [];
    expect(templateRules.length).toBe(3);
    for (const rule of templateRules) {
      expect(rule.slice(0, rule.indexOf("{"))).toMatch(/^\.yr-site\[data-template="\w+"\]\s*$/);
      for (const decl of rule.slice(rule.indexOf("{") + 1, -1).split(";")) {
        if (decl.trim()) expect(decl.trim()).toMatch(/^--yr-[\w-]+:/);
      }
    }
    expect(css).not.toContain("backdrop-filter");
    expect(css).not.toContain("text-shadow");
  });

  it("keeps the drawer a narrow-width disclosure with no second navigation", async () => {
    const html = await render("home");
    const css = readFileSync(join(assets, "site-shell.css"), "utf8");
    const shell = readFileSync(join(assets, "site-shell.js"), "utf8");
    expect((html.match(/<nav\b/g) || []).length).toBe(2); // top bar + drawer disclosure
    expect(html).toContain('id="yr-menu"');
    expect(html).toContain('aria-controls="yr-side"');
    expect(html).toContain('<div class="yr-drawer" id="yr-side"');
    expect(html).toContain('id="yr-scrim"');
    expect(html).toContain('id="yr-side-close"');
    expect(html).not.toContain("yr-nav-group");
    expect(css).toMatch(/@media \(min-width: 900px\) \{\s*\.yr-drawer, \.yr-scrim \{ display: none; \}/);
    expect(css).toMatch(/\.yr-drawer \{[^}]*visibility: hidden/);
    expect(css).toMatch(/\.yr-drawer\[data-open\] \{[^}]*visibility: visible/);
    for (const behaviour of ["aria-modal", "el.inert = true", 'e.key === "Escape"', "opener.focus()"]) {
      expect(shell).toContain(behaviour);
    }
  });

  it("keeps player search with the table it filters", async () => {
    const html = await render("leaderboard");
    const shell = readFileSync(join(assets, "site-shell.js"), "utf8");
    expect(html).toContain('<div class="yr-search-row"><label class="yr-sr" for="yr-search">');
    expect(html.indexOf('id="yr-search"')).toBeGreaterThan(html.indexOf("</header>"));
    expect(html).not.toContain("yr-search-link");
    expect(shell).toContain('document.getElementById("yr-search")');
  });

  it("gives auxiliary pages the same shell", async () => {
    const legal = await renderNewLegalPage(baseData, "terms", opts);
    const profile = await renderNewPlayerProfile(baseData, baseData.players[0], [], opts);
    const archive = await renderNewHallOfFame(baseData, opts);
    for (const html of [legal, profile, archive]) {
      expect(html).toContain('<header class="yr-top">');
      expect(html).toContain('<div class="yr-drawer" id="yr-side"');
      expect((html.match(/<main\b/g) || []).length).toBe(1);
      expect(html).not.toContain('class="yr-region"');
    }
  });

  it("keeps one public stylesheet owner and one font request", async () => {
    const names = readdirSync(assets).filter((f) => f.endsWith(".css"));
    for (const forbidden of [
      "viewer-v2.css",
      "site-shell-v2.css",
      "public-new.css",
      "wave2.css",
      "design-system.css",
      "components.css",
      "theme.css",
      "viewer-final.css",
      "viewer-v5.css",
      "public-final.css",
      "status-pages.css",
      "cookie-v2.css",
      "profile-v2.css",
    ]) {
      expect(names).not.toContain(forbidden);
    }
    const html = await render("home");
    expect((html.match(/fonts\.googleapis\.com\/css2/g) || []).length).toBe(2); // async link + noscript
    expect(html).toContain("family=Fira+Sans");
    expect(html).toContain("family=Fira+Code");
    expect(html).not.toContain("family=Inter");
    expect(html).not.toContain("IBM+Plex+Mono");
  });

  it("does not present a dead hamburger when the shell script never runs", async () => {
    const html = await render("home");
    const shell = readFileSync(join(assets, "site-shell.js"), "utf8");
    const css = readFileSync(join(assets, "site-shell.css"), "utf8");
    // Server-rendered hidden; only the script that implements the drawer reveals it.
    expect(html).toMatch(/<button class="yr-menu" id="yr-menu" type="button" hidden\b/);
    expect(html).toContain('aria-label="Open sections"');
    expect(shell).toContain("if (menu && side) menu.hidden = false;");
    expect(css).toMatch(/\.yr-menu\[hidden\] \{ display: none; \}/);
    // The footer still carries navigation without JS.
    expect(html).toContain("<footer");
    expect(html.split("<footer")[1]).toContain('href="https://example.test/creator/leaderboard"');
  });

  it("keeps the public status pages part of the viewer product and free of internals", async () => {
    const pages = [notFoundPage("creator", "n"), suspendedPage("n"), pendingVerificationPage("n"), error500Page("n")];
    for (const html of pages) {
      expect((html.match(/<h1\b/g) || []).length).toBe(1);
      expect((html.match(/<main\b/g) || []).length).toBe(1);
      expect(html).toContain('name="robots" content="noindex, nofollow"');
      expect(html).toContain('name="viewport"');
      // No external font or stack detail on a failure document.
      expect(html).not.toContain("fonts.googleapis.com");
      expect(html).not.toContain("fonts.gstatic.com");
      expect(html).not.toMatch(/stack trace|Exception|Worker|wrangler|Supabase|SQL/i);
      expect(html).not.toMatch(/error code|ERR_[A-Z]/);
      // One useful way onward.
      expect(html).toMatch(/<a [^>]*href="\//);
    }
    expect(notFoundPage("creator", "n")).toContain("creator");
  });

  it("keeps genuine cookie choice with a keyboard-reachable decline", () => {
    const js = readFileSync(join(assets, "cookie-consent.js"), "utf8");
    const css = readFileSync(join(assets, "cookie-consent.css"), "utf8");
    expect(js).toContain('id="cookieReject" type="button">Essential only');
    expect(js).toContain('id="cookieAccept"');
    expect(js).toContain('href="/cookies"');
    expect(js).toContain('dismiss("essential")');
    expect(js).toContain('dismiss("all")');
    // Nothing consents on the member's behalf, and analytics never defaults on.
    expect(js).not.toMatch(/setConsent\("all"\);?\s*\n?\s*}\s*\)?;?\s*$/m);
    expect(js).not.toContain("setTimeout");
    // Dismissal hands focus to the page instead of dropping it on <body>.
    expect(js).toContain('document.getElementById("main-content")');
    expect(js).toContain("focus({ preventScroll: true })");
    expect(css).toMatch(/\.yr-consent \{[^}]*position: fixed/);
    expect(css).toMatch(/min-height: 44px/);
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(css).toMatch(/\.yr-consent__text \{[^}]*overflow-wrap: anywhere/);
    expect(css).toContain(":focus-visible");
  });

  it("tells a viewer about their own failed order without server vocabulary", () => {
    const shell = readFileSync(join(assets, "site-shell.js"), "utf8");
    expect(shell).toContain("recover(orderErrorText(r.data.error));");
    expect(shell).toContain("You don’t have enough credits for that yet.");
    expect(shell).toContain("That reward just went out of stock.");
    // Unrecognised codes and HTTP wording fall back instead of leaking.
    expect(shell).toMatch(/!\/\^HTTP \/\.test\(message\)/);
  });

  it("gives the creator a visible mark in the header, drawer and home introduction", async () => {
    const plain = await render("home");
    // Without a logo the creator still has a mark: an initial, not a generated
    // SVG whose gradient ids would repeat three times in one document.
    expect(plain).toContain('<span class="yr-mark" aria-hidden="true">C</span>');
    expect(plain).toContain('<span class="yr-mark yr-mark--sm" aria-hidden="true">C</span>');
    expect(plain).toContain('<span class="yr-mark yr-mark--lg" aria-hidden="true">C</span>');
    expect(plain).not.toContain("<linearGradient");
    expect(plain).toContain('<h1 class="yr-intro-name">Creator Name</h1>');

    const logo = await render("home", { data: { ...baseData, logoUrl: "https://cdn.test/logo.png" } });
    expect(logo).toContain('class="yr-id-logo"');
    expect(logo).toContain('class="yr-intro-logo"');
    expect(logo).not.toContain('class="yr-mark"');
  });

  it("leaves one primary action per band and one heading per module", async () => {
    const html = await render("home");
    const intro = html.slice(html.indexOf('class="yr-intro-acts"'), html.indexOf("</section>", html.indexOf('class="yr-intro-acts"')));
    // View rewards is the primary; signing in is the same size but quieter.
    expect((intro.match(/class="yr-btn"/g) || []).length).toBe(1);
    expect(intro).toContain('class="yr-btn yr-btn--ghost"');

    // The leaderboard page named itself in the H1, so its panel does not
    // repeat the word in a second visible heading.
    const board = await render("leaderboard");
    expect((board.match(/>Standings</g) || []).length).toBe(2);
    expect(board).toContain('<h2 class="yr-sr">Standings</h2>');
    expect(board).not.toContain('<h2 class="yr-panel-title">Standings</h2>');
  });

  it("states every empty list in the same shape", async () => {
    const bare = { ...baseData, players: [], shopItems: [], socials: [] };
    const home = await render("home", { data: bare });
    const shop = await render("shop", { data: bare, viewer, viewerData });
    const me = await render("me", { data: bare, viewer, viewerData });
    for (const html of [home, shop, me]) {
      const block = html.slice(html.indexOf('class="yr-empty"'));
      expect(block).toContain('class="yr-empty-ico"');
      expect(block).toContain('class="yr-empty-t"');
      expect(block).toContain('class="yr-empty-p"');
    }
    expect(shop).toContain("Rewards will appear here when Creator Name adds them.");
    expect(me).toContain('<p class="yr-empty-t">No orders yet</p>');
  });

  it("puts the creator's own line first in the footer and keeps section links quiet", async () => {
    const html = await render("home");
    const foot = html.slice(html.indexOf('<footer class="yr-foot">'));
    expect(foot.indexOf('class="yr-foot-c"')).toBeLessThan(foot.indexOf("yr-foot-links--more"));
    expect(foot).toContain("&copy; ");
    expect(foot).toContain("Terms of Service");
    // The no-JS section fallback survives, one step quieter.
    expect(foot).toContain('<div class="yr-foot-links yr-foot-links--more">');
    expect(foot).toContain(">Leaderboard</a>");
  });

  it("preserves canonical, social and section metadata", async () => {
    const html = await render("leaderboard");
    expect(html).toContain('<link rel="canonical" href="https://example.test/creator/leaderboard" />');
    expect(html).toContain('<meta property="og:url" content="https://example.test/creator/leaderboard" />');
    expect(html).toContain('<meta name="twitter:card" content="summary" />');
    expect(html).toContain('data-section="leaderboard"');
    expect(html).toContain('data-slug="creator"');
  });
});

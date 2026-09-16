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
  siteSections: { home: true, activities: true, leaderboard: true, shop: true, games: false, me: true },
};

function render(section, { data = baseData, viewer = null, viewerData = null, custom = false, r = {} } = {}) {
  return renderSite({
    r: { slug: "creator", plan: "pro", data, ...r },
    section,
    viewer,
    viewerData,
    opts: { ...opts, isCustomDomain: custom, logoUrl: data.logoUrl || null },
  });
}

const viewer = { kick_username: "viewer_one" };
const viewerData = { viewerOnSite: { balance: 1234 }, ledger: [], claims: [], participation: [] };

describe("public viewer shell", () => {
  it("keeps viewer support context and makes an empty shop discoverable", async () => {
    const html = await render("home", { data: { ...baseData, shopItems: [] } });
    expect(html).toContain('href="/help/support?audience=viewer&amp;return=%2Fcreator"');
    expect(html).toMatch(/<nav class="viewer-destinations"[\s\S]*?href="\/creator\/shop"/);
    const custom = await render("shop", { custom: true });
    expect(custom).toContain('href="https://yourrank.site/help/support?audience=viewer&amp;return=%2Fcreator%2Fshop"');
  });

  it("gives the shared viewer rail sole ownership of public chrome", async () => {
    const html = await render("home");
    expect((html.match(/class="viewer-rail"/g) || []).length).toBe(1);
    expect((html.match(/<main\b/g) || []).length).toBe(1);
    for (const legacy of ['class="yr-top"', 'id="yr-side"', 'id="yr-menu"', '/assets/devin-system.css', 'data-template=']) expect(html).not.toContain(legacy);
    expect(html).toContain('/assets/viewer-shell.css');
  });

  it("renders enabled sections once in navigation with one current destination", async () => {
    const html = await render("shop");
    const nav = html.match(/<nav class="viewer-destinations"[\s\S]*?<\/nav>/)[0];
    for (const label of ["Home", "Activities", "Leaderboard", "Rewards", "My Activity"]) expect(nav).toContain(`<span>${label}</span>`);
    expect(nav).not.toContain("<span>Games</span>");
    expect((html.match(/aria-current="page"/g) || []).length).toBe(1);
    expect(nav).toContain('href="https://example.test/creator/shop" aria-current="page"');
    expect(html).not.toContain('role="tab"');
    expect(html).not.toContain('role="tablist"');
  });

  it("keeps Games out of the primary nav while leaving the legacy route reachable", async () => {
    const html = await render("home", {
      data: { ...baseData, siteSections: { ...baseData.siteSections, games: true } },
    });
    const nav = html.match(/<nav class="viewer-destinations"[\s\S]*?<\/nav>/)[0];
    expect(nav).not.toContain("<span>Games</span>");
    expect(html).toContain('href="https://example.test/creator/games"');
    const noGames = await render("home");
    expect(noGames).not.toContain('/creator/games');
  });

  it("builds same-origin slug and custom-domain navigation from the same helper", async () => {
    const slugged = await render("home");
    const custom = await render("home", { custom: true });
    expect(slugged).toContain('href="/creator/leaderboard"');
    expect(custom).toContain('href="/leaderboard"');
    expect(custom).not.toContain("/creator/leaderboard");
  });

  it("shows the configured creator mark and never a placeholder one", async () => {
    const withLogo = await render("home", {
      data: { ...baseData, logoUrl: "https://cdn.example.test/logo.png" },
    });
    expect(withLogo).toContain('class="viewer-mark-img" src="https://cdn.example.test/logo.png"');
    expect(withLogo).toContain('srcset="https://cdn.example.test/logo.png?w=64 64w');
    expect(withLogo).toContain('width="40" height="40" alt=""');
    expect(withLogo).toContain('class="viewer-hero-logo" src="https://cdn.example.test/logo.png"');

    const withoutLogo = await render("home");
    expect(withoutLogo).not.toContain("viewer-mark-img");
    expect(withoutLogo).toContain('class="viewer-chip-mark" aria-hidden="true">C</span>');
    expect(withoutLogo).toContain('data-preview-field="f_name">Creator Name</span>');
  });

  it("keeps long creator names intact with wrapping in the brand and hero", async () => {
    const long = "Streamerwithaverylongsinglewordchannelname Extended Championship Board Season Finale";
    const html = await render("home", { data: { ...baseData, brand: { ...baseData.brand, name: long } } });
    expect(html).toContain(`data-preview-field="f_name">${long}</span>`);
    expect(html).toContain(`<h1 class="viewer-hero-name" data-preview-field="f_name">${long}`);
    const css = readFileSync(join(assets, "viewer-shell.css"), "utf8");
    expect(css).toMatch(/\.viewer-rail-name\s*\{[^}]*text-overflow:\s*ellipsis/s);
    expect(css).toMatch(/\.viewer-hero-name\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  });

  it("keeps viewer navigation targets reachable at narrow widths", async () => {
    const css = readFileSync(join(assets, "viewer-shell.css"), "utf8");
    expect(css).toMatch(/\.viewer-nav-link\s*\{[^}]*min-height: 42px/s);
    expect(css).toContain("@media (max-width: 900px)");
    expect(css).not.toMatch(/\.viewer-destinations[^}]*display:none/s);
    expect(css).not.toMatch(/\.viewer-rail\s*\{[^}]*display:none/s);
    const html = await render("me", { viewer, viewerData: { ...viewerData, viewerOnSite: { balance: 1234567 } } });
    expect(html).toContain('data-credit-balance="1234567"');
    expect(html).toContain('data-credit-balance-num>1,234,567</b>');
  });

  it("keeps one real OAuth entry point for a signed-out viewer", async () => {
    for (const provider of ["Kick", "Discord"]) {
      const html = await render("home", { r: { [`viewer${provider}AuthEnabled`]: true } });
      expect(html).toContain(`href="/api/viewer/auth/${provider.toLowerCase()}?returnTo=https%3A%2F%2Fexample.test%2Fcreator&intent=join&site=creator"`);
      expect(html).toContain(`href="/api/viewer/auth/${provider.toLowerCase()}?returnTo=https%3A%2F%2Fexample.test%2Fcreator">Sign in with ${provider}</a>`);
      expect(html).toContain('/creator/me"');
    }
    const member = await render("home", { viewer, viewerData });
    expect(member).not.toContain('/api/viewer/auth/');
    expect(member).toContain('viewer-chip--member');
  });

  it("keeps sign-in and account navigation role-correct", async () => {
    const signedOut = await render("home");
    expect(signedOut).toContain('href="/creator/me">Sign in</a>');
    expect(signedOut).not.toContain('data-credit-balance="1234"');
    const signedIn = await render("home", { viewer, viewerData });
    expect(signedIn).toContain('data-credit-balance-num>1,234</b>');
    expect(signedIn).not.toContain('>Sign in<');
    expect(signedIn).toContain('href="/me"');
    expect(signedIn).not.toContain('href="/dashboard"');
  });

  it("keeps demo content, legal links and OAuth continuation on the supplied origin", async () => {
    const html = await renderSite({
      r: { slug: "demo", plan: "pro", data: baseData, viewerKickAuthEnabled: true },
      section: "home", viewer: null, viewerData: null,
      opts: { slug: "demo", homeUrl: "http://localhost:8787", nonce: "n", isDemo: true },
    });
    expect(html).toContain('href="http://localhost:8787/demo/shop"');
    expect(html).toContain('href="http://localhost:8787/demo/leaderboard"');
    expect(html).toContain('href="http://localhost:8787/demo/terms"');
    expect(html).toContain('returnTo=http%3A%2F%2Flocalhost%3A8787%2Fdemo');
    expect(html).not.toContain('https://yourrank.site/demo');
  });

  it("keeps local membership and global account destinations distinct on custom domains", async () => {
    const html = await render("me", { viewer, viewerData, custom: true });
    expect(html).toMatch(/href="https:\/\/example\.test\/me"[^>]*aria-current="page"/);
    expect(html).toContain('href="https://yourrank.site/me"');
    expect(html).not.toContain('href="/creator/me"');
  });

  it("uses real standings in the home board widget", async () => {
    const html = await render("home");
    expect(html).toContain('viewer-board-widget');
    expect(html).toContain('class="viewer-board-name">Alice</span>');
    expect(html).toContain('class="viewer-board-name">Bob</span>');
    const empty = await render("home", { data: { ...baseData, players: [] } });
    expect(empty).toContain('No standings yet.');
    expect(empty).not.toContain('class="viewer-board-row"');
  });

  it("shows featured reward previews from actual configured rewards", async () => {
    const html = await render("home");
    expect((html.match(/viewer-reward-card/g) || []).length).toBe(1);
    expect(html).toContain('Featured reward');
    // The featured card is the cheapest configured item.
    expect(html).toContain('VIP badge');
    expect(html).toContain('>250</span>');
    expect(html).not.toContain('Overlay cameo');
    const noShop = await render("home", { data: { ...baseData, siteSections: { ...baseData.siteSections, shop: false } } });
    expect(noShop).not.toContain('viewer-reward-card');
  });

  it("gives a signed-in viewer a scoped balance and local/global destinations", async () => {
    const html = await render("home", { viewer, viewerData });
    expect(html).toContain('data-credit-balance="1234"');
    expect(html).toContain('credits in Creator Name');
    expect(html).toContain('href="/creator/shop"');
    expect(html).toContain('No purchase, no cash value, no cashout.');
    expect(html).toContain('href="/me"');
  });

  it("stays useful without linking disabled community destinations", async () => {
    const bare = { ...baseData, brand: { name: 'Bare Board' }, players: [], shopItems: [], socials: [], siteSections: { home: true, activities: false, leaderboard: true, shop: false, games: false, me: false } };
    const html = await render('home', { data: bare });
    expect(html).toContain('No standings yet.');
    const nav = html.match(/<nav class="viewer-destinations"[\s\S]*?<\/nav>/)[0];
    expect(nav).not.toContain('href="/creator/shop"');
    expect(nav).not.toContain('href="/creator/me"');
    expect(nav).not.toContain('href="/creator/activities"');
    expect(html).toContain('<span>Leaderboard</span>');
  });

  it("links the creator's configured channels and nothing else", async () => {
    const html = await render("home");
    expect(html).toContain('href="https://kick.com/creator" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("Watch on Kick");
    expect(html).toContain('https://discord.gg/creator');
    expect(html).not.toContain("followers");
    expect(html).not.toContain("viewers");
  });

  it("prevents every stored template from reactivating the rejected viewer design", async () => {
    for (const template of ["cyber_arcade", "esports_pro", "creator_glass"]) {
      const html = await render("home", { data: { ...baseData, theme: { template } } });
      expect(html).toContain('class="yr-site viewer-shell"');
      expect(html).toContain('/assets/viewer-shell.css');
      expect(html).not.toContain("data-template=");
      expect(html).not.toContain("/assets/devin-system.css");
      expect(html).toContain("Creator Name");
    }
  });

  it("uses the same server-rendered navigation on desktop and mobile", async () => {
    const html = await render('home');
    const css = readFileSync(join(assets, 'viewer-shell.css'), 'utf8');
    expect((html.match(/class="viewer-destinations"/g) || [])).toHaveLength(1);
    expect(html).not.toContain('id="yr-side"');
    expect(css).toMatch(/\.viewer-layout\s*\{[^}]*grid-template-columns: var\(--vr-rail-w\) minmax\(0, 1fr\)/s);
    expect(css).toMatch(/\.viewer-rail\s*\{[^}]*transform: translateX\(-104%\)/s);
    expect(css).not.toMatch(/\.viewer-rail\s*\{[^}]*display:none/s);
  });

  it("keeps the viewer shell mounted while same-origin pages change", async () => {
    const html = await render("home");
    const app = readFileSync(join(assets, "viewer-app.js"), "utf8");
    expect(html).toContain('<script src="/assets/viewer-app.js"');
    expect(app).toContain('existing.replaceChildren.apply(existing, Array.from(next.childNodes))');
    expect(app).toContain('history.pushState');
    expect(app).toContain('window.addEventListener("popstate"');
    expect(app).toContain('!element.hidden && element.getClientRects().length > 0');
    expect(app).toContain('location.assign(target.href)');
    expect(app).not.toContain('document.documentElement.innerHTML');
  });

  it("keeps player search with the table it filters", async () => {
    const html = await render("leaderboard");
    const shell = readFileSync(join(assets, "site-shell.js"), "utf8");
    expect(html).toContain('id="yr-search"');
    expect(html).toContain('data-player-board');
    expect(html.indexOf('id="yr-search"')).toBeGreaterThan(html.indexOf('viewer-card-head'));
    expect(html.indexOf('id="yr-search"')).toBeLessThan(html.indexOf('yr-stand-head'));
    expect(html).not.toContain("yr-search-link");
    expect(shell).toContain('document.getElementById("yr-search")');
  });

  it("gives auxiliary pages the same shell", async () => {
    const legal = await renderNewLegalPage(baseData, "terms", opts);
    const profile = await renderNewPlayerProfile(baseData, baseData.players[0], [], opts);
    const archive = await renderNewHallOfFame(baseData, opts);
    for (const html of [legal, profile, archive]) {
      expect(html).toContain('class="viewer-rail"');
      expect(html).not.toContain('id="yr-side"');
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

  it("keeps navigation and return paths available without JavaScript", async () => {
    const html = await render("me", { viewer, viewerData });
    const rail = html.match(/<aside class="viewer-rail">[\s\S]*?<\/aside>/)[0];
    for (const href of ["/creator", "/creator/shop", "/creator/me"]) expect(rail).toContain(`${href}"`);
    expect(html).toContain('href="/me"');
    expect(rail).toMatch(/aria-label="Community"/);
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
    expect(js).toContain('focus({ preventScroll: true })');
    expect(css).toMatch(/\.yr-consent \{[^}]*position: fixed/);
    expect(css).toMatch(/min-height: 44px/);
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(css).toMatch(/\.yr-consent__text \{[^}]*overflow-wrap: anywhere/);
    expect(css).toContain(":focus-visible");
  });

  it("tells a viewer about their own failed claim without server vocabulary", () => {
    const shell = readFileSync(join(assets, "site-shell.js"), "utf8");
    expect(shell).toContain("recover(orderErrorText(r.data.error));");
    expect(shell).toContain("You don’t have enough credits for that yet.");
    expect(shell).toContain("That reward just went out of stock.");
    // Unrecognised codes and HTTP wording fall back instead of leaking.
    expect(shell).toMatch(/!\/\^HTTP \/\.test\(message\)/);
  });

  it("keeps the real creator identity without duplicating its configured logo", async () => {
    const plain = await render('home');
    expect(plain).toContain('data-preview-field="f_name">Creator Name</span>');
    const logo = await render('home', { data: { ...baseData, logoUrl: 'https://cdn.test/logo.png' } });
    expect((logo.match(/class="viewer-mark-img"/g) || []).length).toBe(2); // rail mark + topbar mark
    expect((logo.match(/class="viewer-hero-logo"/g) || []).length).toBe(1);
  });

  it("uses the supplied dark-rail geometry with a quiet top bar", () => {
    const css = readFileSync(join(assets, 'viewer-shell.css'), 'utf8');
    expect(css).toContain('--vr-rail-w: 252px');
    expect(css).toMatch(/\.viewer-layout\s*\{[^}]*grid-template-columns: var\(--vr-rail-w\) minmax\(0, 1fr\)/s);
    expect(css).toMatch(/\.viewer-topbar\s*\{[^}]*position: sticky; top: 0/s);
    expect(css).toMatch(/\.viewer-rail\s*\{[^}]*background: var\(--vr-rail\)/s);
  });

  it("keeps account and community destinations reachable on mobile", async () => {
    const html = await render('me', { viewer, viewerData });
    expect(html).toContain('href="/me"');
    const css = readFileSync(join(assets, 'viewer-shell.css'), 'utf8');
    expect(css).toMatch(/\.viewer-menu\s*\{[^}]*display: inline-flex/s);
    expect(css).toMatch(/\.viewer-nav-link\s*\{[^}]*min-height: 42px/s);
  });

  it("states empty rewards, standings and claims without fabricating data", async () => {
    const bare = { ...baseData, players: [], shopItems: [], socials: [] };
    const home = await render('home', { data: bare });
    const shop = await render('shop', { data: bare, viewer, viewerData });
    const me = await render('me', { data: bare, viewer, viewerData });
    expect(home).toContain('No rewards');
    expect(home).toContain('No standings yet.');
    expect(shop).toMatch(/Rewards will appear here when Creator Name adds them|No rewards are available right now/);
    expect(me).toMatch(/No claims yet|claims will appear here/i);
  });

  it("puts the creator's own line first in the footer and keeps section links quiet", async () => {
    const html = await render("home");
    const foot = html.slice(html.indexOf('<footer class="yr-foot">'));
    expect(foot.indexOf('class="yr-foot-c"')).toBeLessThan(foot.indexOf("yr-foot-nav"));
    expect(foot).toContain("&copy; ");
    expect(foot).toContain("Terms of Service");
    // The section map is the fallback for a browser that never ran the shell
    // script, and only the stylesheet — keyed on the flag that script sets —
    // hides it, so a blocked or failed script leaves it visible and usable.
    expect(foot).toContain('<nav class="yr-foot-links yr-foot-nav" aria-label="All sections">');
    expect(foot).toContain(">Leaderboard</a>");

    const css = readFileSync(join(assets, "viewer-shell.css"), "utf8");
    expect(css).toMatch(/body\.viewer-shell \.yr-foot-nav \{ display: none; \}/);
    expect(css).toMatch(/html:not\(\[data-yr-shell="ready"\]\) body\.viewer-shell \.yr-foot-nav \{ display: flex; \}/);
    const shell = readFileSync(join(assets, "site-shell.js"), "utf8");
    expect(shell).toContain('document.documentElement.setAttribute("data-yr-shell", "ready");');
    // Quiet in the normal view means the working rail's destinations are not
    // repeated outside that fallback.
    const quiet = foot.slice(0, foot.indexOf("yr-foot-nav"));
    for (const section of [">Home</a>", ">Leaderboard</a>", ">Rewards</a>", ">My Activity</a>"]) {
      expect(quiet).not.toContain(section);
    }
    expect(quiet).toContain("data-feedback-open");
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

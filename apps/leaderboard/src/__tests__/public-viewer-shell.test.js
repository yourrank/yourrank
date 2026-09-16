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
    expect((html.match(/class="viewer-rail"/g)||[]).length).toBe(1);
    expect((html.match(/<main\b/g)||[]).length).toBe(1);
    expect((html.match(/<h1\b/g)||[]).length).toBe(1);
    expect(html).toContain('</aside><div class="viewer-site-footer"><footer');
    expect(html).not.toContain('</aside></div><div class="viewer-site-footer">');
    for (const legacy of ['class="yr-top"', 'id="yr-side"', 'id="yr-menu"', '/assets/devin-system.css', 'data-template=']) expect(html).not.toContain(legacy);
    expect(html).toContain('/assets/viewer-shell.css');
  });

  it("renders enabled sections once in navigation with one current destination", async () => {
    const html = await render("shop");
    const nav = html.match(/<nav class="viewer-destinations"[\s\S]*?<\/nav>/)[0];
    for(const label of ["Home","Leaderboard","Rewards","My Activity"]) expect(nav).toContain(">"+label+"</a>");
    expect(nav).toContain('aria-disabled="true" title="Public activities are not available yet"');
    expect(nav).not.toContain('href="/creator/activities"');
    expect(nav).not.toContain(">Games<");
    expect((html.match(/aria-current="page"/g)||[]).length).toBe(1);
    expect(nav).toContain('href="/creator/shop" aria-current="page"');
    expect(html).not.toContain('role="tab"');
    expect(html).not.toContain('role="tablist"');
  });

  it("does not promote Games in primary viewer navigation when the legacy route is enabled", async () => {
    const html = await render("home", {
      data: { ...baseData, siteSections: { ...baseData.siteSections, games: true } },
    });
    expect(html).not.toContain('href="https://example.test/creator/games"><span>Games</span>');
    expect(html).not.toContain(">Games</a>");
  });

  it("builds same-origin slug and custom-domain navigation from the same helper", async () => {
    const slugged = await render("home");
    const custom = await render("home",{custom:true});
    expect(slugged).toContain('href="/creator/leaderboard"');
    expect(custom).toContain('href="/leaderboard"');
    expect(custom).not.toContain("/creator/leaderboard");
  });

  it("shows the configured creator mark and never a placeholder one", async () => {
    const withLogo = await render("home", {
      data: { ...baseData, logoUrl: "https://cdn.example.test/logo.png" },
    });
    expect(withLogo).toContain('class="yr-id-logo" src="https://cdn.example.test/logo.png"');
    expect(withLogo).toContain('srcset="https://cdn.example.test/logo.png?w=64 64w');
    expect(withLogo).toMatch(/class="yr-id-logo"[^>]*width="[1-9]\d*" height="[1-9]\d*" alt=""/);
    expect(withLogo).not.toContain("yr-intro-logo");

    const withoutLogo = await render("home");
    expect(withoutLogo).not.toContain("yr-id-logo");
    expect(withoutLogo).toContain('<strong>Creator Name</strong>');
  });

  it("keeps long creator names intact with wrapping in the context panel", async () => {
    const long = "Streamerwithaverylongsinglewordchannelname Extended Championship Board Season Finale";
    const html = await render("home", { data: { ...baseData, brand: { ...baseData.brand, name: long } } });
    expect(html).toContain(`data-preview-field="f_name">${long}</p>`);
    const css = readFileSync(join(assets, "viewer-shell.css"), "utf8");
    expect(css).toMatch(/\.viewer-context-name\{[^}]*overflow-wrap:anywhere/);
    expect(css).toMatch(/\.viewer-switch summary strong\{[^}]*overflow-wrap:anywhere/);
  });

  it("keeps viewer navigation targets reachable at narrow widths", async () => {
    const css=readFileSync(join(assets,"viewer-shell.css"),"utf8");
    expect(css).toContain(".viewer-destinations a,.viewer-rail-account a");
    expect(css).toContain("min-height:44px");
    expect(css).toContain("@media(max-width:760px)");
    expect(css).not.toMatch(/viewer-destinations[^}]*display:none/);
    const html=await render("me",{viewer,viewerData:{...viewerData,viewerOnSite:{balance:1234567}}});
    expect(html).toContain('data-credit-balance="1234567"');
    expect(html).toContain('data-credit-balance-num>1,234,567</strong>');
    expect(html).toContain(">credits</p>");
  });

  it("keeps real OAuth continuation and local membership navigation without the obsolete guide", async () => {
    for (const provider of ["Kick", "Discord"]) {
      const html = await render("home", { r: { [`viewer${provider}AuthEnabled`]: true } });
      const membership = await render("me", { r: { [`viewer${provider}AuthEnabled`]: true } });
      expect((html.match(/\/api\/viewer\/auth\//g) || [])).toHaveLength(1);
      expect(html).toContain(`href="/api/viewer/auth/${provider.toLowerCase()}?returnTo=https%3A%2F%2Fexample.test%2Fcreator">Sign in with ${provider}</a>`);
      expect(membership).toContain(`href="/api/viewer/auth/${provider.toLowerCase()}?returnTo=https%3A%2F%2Fexample.test%2Fcreator%2Fme&intent=join&site=creator">Join community</a>`);
      expect(html).not.toContain('data-guide-base');
      expect(html).toContain('href="/creator/me"');
    }
    const member = await render("home", { viewer, viewerData });
    expect(member).not.toContain('/api/viewer/auth/');
    expect(member).not.toContain('data-guide-visit');
    expect(member).toContain('href="/creator/shop"');
  });

  it("keeps sign-in and account navigation role-correct", async () => {
    const signedOut = await render("home");
    expect(signedOut).toContain('href="/creator/me#membership-code">Sign in ');
    expect(signedOut).toContain('id="viewer-account-link" href="/me?community=creator#vd-profile" hidden');
    expect(signedOut).not.toContain('data-credit-balance="1234"');
    const signedIn = await render("home", { viewer, viewerData });
    expect(signedIn).toContain('data-credit-balance-num>1,234</strong>');
    expect(signedIn).toContain('id="viewer-account-link" href="/me?community=creator#vd-profile"');
    expect(signedIn).not.toContain('>Sign in<');
    // Every global account link remembers this community so My communities can lead back.
    expect(signedIn).toContain('id="viewer-communities-link" href="/me?community=creator"');
    expect(signedIn).not.toContain('href="/me"');
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
    expect(html).toMatch(/href="\/me" aria-current="page">[\s\S]*?My Activity<\/a>/);
    expect(html).toContain('id="viewer-account-link" href="https://yourrank.site/me?community=creator#vd-profile"');
    expect(html).toContain('href="https://yourrank.site/me?community=creator"');
    expect(html).not.toContain('href="/creator/me"');
  });

  it("uses the community home composition without inventing viewer statistics", async () => {
    const html = await render("home", { viewer, viewerData });
    for (const removed of ['yr-chart', 'yr-kpi', '7-day average', 'Lifetime', 'Pending orders']) expect(html).not.toContain(removed);
    expect(html).toContain('<h1>Creator Name</h1>');
    expect(html).toContain('class="viewer-home-banner"');
    expect(html).toContain('class="viewer-card viewer-stream-card"');
    expect(html).not.toContain('data-guide-');
  });

  it("uses real standings in the community home preview", async () => {
    const html = await render("home");
    expect(html).toContain('Monthly standings');
    expect(html).toContain('class="viewer-player-name">Alice</span>');
    expect(html).toContain('class="viewer-player-name">Bob</span>');
    expect(html).not.toContain('See the standings');
    const empty = await render("home", { data: { ...baseData, players: [] } });
    expect(empty).toContain('No standings yet.');
    expect(empty).not.toContain('class="viewer-board-row"');
  });

  it("shows a community reward preview from actual configured rewards", async () => {
    const html = await render("home");
    const section = html.slice(html.indexOf('class="viewer-home-columns"'), html.indexOf('<footer class="viewer-panel-footer"'));
    expect((section.match(/class="yr-rwd"/g) || [])).toHaveLength(1);
    expect(section).toContain('Song request');
    expect(section).toContain('600 credits');
    expect(section).not.toContain('Overlay cameo');
    const noShop = await render("home", { data: { ...baseData, siteSections: { ...baseData.siteSections, shop: false } } });
    expect(noShop).not.toContain('Community Rewards');
    expect(noShop).not.toContain('href="/creator/shop"');
  });

  it("gives a signed-in viewer a scoped balance and local/global destinations", async () => {
    const html = await render("home", { viewer, viewerData });
    expect(html).toContain('data-credit-balance="1234"');
    expect(html).toContain('Only in Creator Name');
    expect(html).toContain('href="/creator/shop">Choose a reward');
    expect(html).not.toContain('View my activity');
    expect(html).toContain('No purchase, no cash value, no cashout.');
    expect(html).toContain('href="/me?community=creator"');
  });

  it("stays useful without linking disabled community destinations", async () => {
    const bare = { ...baseData, brand: { name: 'Bare Board' }, players: [], shopItems: [], socials: [], siteSections: { home: true, leaderboard: true, shop: false, games: false, me: false } };
    const html = await render('home', { data: bare });
    expect(html).toContain('No standings yet.');
    expect(html).toContain('<h1>Bare Board</h1>');
    expect(html).not.toContain('href="/creator/shop"');
    expect(html).not.toContain('href="/creator/me"');
    expect(html).not.toContain('Claim free code');
    expect(html).not.toContain('data-guide-total');
  });

  it("links the creator's configured channels and nothing else", async () => {
    const html = await render("home");
    expect(html).toContain('class="viewer-channels" aria-label="Creator Name channels"');
    expect(html).toContain('href="https://kick.com/creator" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("Watch on Kick");
    expect(html).toContain(">Discord<");
    expect(html).not.toContain("followers");
    expect(html).not.toContain("viewers");
  });

  it("prevents every stored template from reactivating the rejected viewer design", async () => {
    for(const template of ["cyber_arcade","esports_pro","creator_glass"]) {
      const html=await render("home",{data:{...baseData,theme:{template}}});
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
    expect(html).not.toContain('id="yr-menu"');
    expect(html).not.toContain('id="yr-side"');
    expect(css).toContain('.viewer-layout{display:flex;flex-direction:column');
    expect(css).toContain('.viewer-destinations{display:flex;flex-wrap:wrap');
    expect(css).not.toMatch(/\.viewer-rail\{[^}]*display:none/);
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
    expect(app).toContain('document.querySelector(".viewer-layout").appendChild(footer)');
    expect(app).not.toContain('document.documentElement.innerHTML');
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
      expect(html).toContain('<aside class="viewer-rail"');
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
    expect(html).not.toContain("family=Fira+Sans");
    expect(html).not.toContain("family=Fira+Code");
    expect(html).toContain("family=Inter");
    expect(html).not.toContain("IBM+Plex+Mono");
  });

  it("keeps navigation and return paths available without JavaScript", async () => {
    const html=await render("me",{viewer,viewerData});
    const nav=html.match(/<aside class="viewer-rail"[\s\S]*?<\/aside>/)[0];
    for(const href of ["/creator","/creator/shop","/creator/me","/me?community=creator","/me?community=creator#vd-profile"]) expect(nav).toContain('href="'+href+'"');
    expect(nav).not.toContain("<button");
    expect(nav).not.toMatch(/<(?:aside|nav|a)[^>]*\shidden\b/);
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

  it("tells a viewer about their own failed claim without server vocabulary", () => {
    const shell = readFileSync(join(assets, "site-shell.js"), "utf8");
    expect(shell).toContain("recover(orderErrorText(r.data.error));");
    expect(shell).toContain("You don’t have enough credits for that yet.");
    expect(shell).toContain("That reward just went out of stock.");
    // Unrecognised codes and HTTP wording fall back instead of leaking.
    expect(shell).toMatch(/!\/\^HTTP \/\.test\(message\)/);
  });

  it("uses the configured creator identity in the rail, banner and channel card", async () => {
    const plain = await render('home');
    expect(plain).toContain('data-preview-field="f_name">Creator Name</p>');
    const logo = await render('home', { data: { ...baseData, logoUrl: 'https://cdn.test/logo.png' } });
    for (const region of [
      logo.match(/<aside class="viewer-rail"[^]*?<\/aside>/)?.[0],
      logo.match(/<header class="viewer-home-banner"[^]*?<\/header>/)?.[0],
      logo.match(/<div class="viewer-channel-art"[^]*?<\/div>/)?.[0],
    ]) {
      expect(region).toBeDefined();
      expect((region.match(/class="yr-id-logo"/g) || [])).toHaveLength(1);
    }
    expect(logo).not.toContain('class="yr-intro-logo"');
  });

  it("uses the supplied three-column geometry with a separate context bar", () => {
    const css = readFileSync(join(assets, 'viewer-shell.css'), 'utf8');
    expect(css).toContain('grid-template-columns:var(--viewer-rail-width) minmax(0,1fr) 320px');
    expect(css).toMatch(/\.viewer-topbar\{[^}]*position:sticky;top:0/);
    expect(css).toContain('.viewer-overview{grid-column:3');
  });

  it("keeps account and community return links reachable on mobile", async () => {
    const html = await render('me', { viewer, viewerData });
    expect(html).toContain('href="/me?community=creator"');
    expect(html).toContain('href="/me?community=creator#vd-profile"');
    const css = readFileSync(join(assets, 'viewer-shell.css'), 'utf8');
    expect(css).not.toMatch(/\.viewer-rail-account\{[^}]*display:none/);
    expect(css).toContain('.viewer-rail-account{display:flex;flex-wrap:wrap');
  });

  it("links the credits rail to local earning activity and gives standings one page heading", async () => {
    const html = await render('home');
    const credit = html.match(/<section class="viewer-rail-panel viewer-credit-panel">[\s\S]*?<\/section>/)[0];
    expect(credit).toContain('href="/creator/me#membership-code"');
    expect(credit).not.toContain('href="/me"');
    expect(credit).not.toContain('Browse rewards');
    const board = await render('leaderboard');
    expect((board.match(/<h1\b/g) || [])).toHaveLength(1);
    expect(board).toContain('<h2 class="yr-sr">Standings</h2>');
    expect(board).not.toContain('<h2 class="yr-panel-title">Standings</h2>');
  });

  it("states empty rewards, standings and claims without fabricating data", async () => {
    const bare = { ...baseData, players: [], shopItems: [], socials: [] };
    const home = await render('home', { data: bare });
    const shop = await render('shop', { data: bare, viewer, viewerData });
    const me = await render('me', { data: bare, viewer, viewerData });
    expect(home).toContain('No rewards yet.');
    expect(home).toContain('No standings yet.');
    expect(shop).toContain('Rewards will appear here when Creator Name adds them.');
    expect(me).toContain('<h3>No claims yet</h3>');
    expect(me).toContain('Choose a reward in the Reward shop.');
    expect(me).not.toContain('class="viewer-claim-preview"');
  });

  it("puts the creator's own line first in the footer and keeps section links quiet", async () => {
    const html = await render("home");
    const foot = html.slice(html.indexOf('<footer class="yr-foot">'));
    expect(foot.indexOf('class="yr-foot-c"')).toBeLessThan(foot.indexOf("yr-foot-nav"));
    expect(foot).toContain("&copy; ");
    expect(foot).toContain("Terms of Service");
    // The section fallback survives for a browser that never ran the shell
    // script, and only the stylesheet — keyed on the flag that script sets —
    // hides it, so a blocked or failed script leaves it visible and usable.
    expect(foot).toContain('<nav class="yr-foot-links yr-foot-nav" aria-label="All sections">');
    expect(foot).toContain(">Leaderboard</a>");

    const css = readFileSync(join(assets, "site-shell.css"), "utf8");
    expect(css).toContain('[data-yr-shell="ready"] .yr-foot-nav { display: none; }');
    expect(css).not.toMatch(/^\.yr-foot-nav \{[^}]*display: none/m);
    const shell = readFileSync(join(assets, "site-shell.js"), "utf8");
    expect(shell).toContain('document.documentElement.setAttribute("data-yr-shell", "ready");');
    // Quiet in the normal view means the working header's destinations are not
    // repeated outside that fallback.
    const quiet = foot.slice(0, foot.indexOf("yr-foot-nav"));
    for (const section of [">Home</a>", ">Leaderboard</a>", ">Reward shop</a>", ">My activity</a>"]) {
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

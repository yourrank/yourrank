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
    expect(html).toContain('href="https://example.test/creator/shop">Browse reward shop');
    const custom = await render("shop", { custom: true });
    expect(custom).toContain('href="https://yourrank.site/help/support?audience=viewer&amp;return=%2Fcreator%2Fshop"');
  });

  it("gives the shared viewer rail sole ownership of public chrome", async () => {
    const html = await render("home");
    expect((html.match(/class="viewer-rail"/g)||[]).length).toBe(1);
    expect((html.match(/<main\b/g)||[]).length).toBe(1);
    expect((html.match(/<h1\b/g)||[]).length).toBe(1);
    for (const legacy of ['class="yr-top"', 'id="yr-side"', 'id="yr-menu"', '/assets/devin-system.css', 'data-template=']) expect(html).not.toContain(legacy);
    expect(html).toContain('/assets/viewer-shell.css');
  });

  it("renders enabled sections once in navigation with one current destination", async () => {
    const html = await render("shop");
    const nav = html.match(/<nav class="viewer-destinations"[\s\S]*?<\/nav>/)[0];
    for(const label of ["Home","Leaderboard","Reward shop","My activity"]) expect(nav).toContain(">"+label+"</a>");
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
    expect(withLogo).toContain('width="36" height="36" alt=""');
    // The bar and the drawer own the mark; Home does not print a second copy.
    expect(withLogo).not.toContain("yr-intro-logo");

    const withoutLogo = await render("home");
    expect(withoutLogo).not.toContain("yr-id-logo");
    expect(withoutLogo).toContain('href="/creator">Creator Name</a>');
  });

  it("clamps a long creator name in the bar without dropping it from the markup", async () => {
    const long =
      "Streamerwithaverylongsinglewordchannelname Extended Championship Board Season Finale";
    const html = await render("home", {
      data: { ...baseData, brand: { ...baseData.brand, name: long } },
    });
    const css = readFileSync(join(assets, "site-shell.css"), "utf8");
    // Full name in the DOM (so it stays the accessible name) even though the bar clips it.
    expect(html).toContain(`href="/creator">${long}</a>`);
    expect(html).toContain(`<h1 class="yr-intro-name">Welcome to <span data-preview-field="f_name">${long}</span>'s channel</h1>`);
    const bar = css.match(/\.yr-id-name \{([^}]*)\}/);
    expect(bar).not.toBeNull();
    expect(bar[1]).toContain("overflow-wrap: anywhere");
    expect(bar[1]).toContain("-webkit-line-clamp: 2");
    expect(bar[1]).toContain("overflow: hidden");
    // No JS truncation. The home heading breaks inside the word; desktop stops
    // after three lines and phones get a fourth so the final word remains
    // readable without letting an extreme name take over the page.
    expect(readFileSync(join(assets, "site-shell.js"), "utf8")).not.toContain("yr-id-name");
    const intro = css.match(/\.yr-intro-name \{([^}]*)\}/);
    expect(intro).not.toBeNull();
    expect(intro[1]).toContain("overflow-wrap: anywhere");
    expect(intro[1]).toContain("line-clamp: 3");
    expect(intro[1]).toContain("overflow: hidden");
    expect(css).toMatch(
      /@media \(max-width: 899px\)[\s\S]*?\.yr-intro-name \{[^}]*-webkit-line-clamp: 4; line-clamp: 4;/,
    );
    // Copy that quotes the creator's name must break inside the word too, or a
    // single unbreakable name widens the whole document on a phone.
    expect(css).toMatch(/\.yr-vnote-p \{[^}]*overflow-wrap: anywhere/);
    expect(css).toMatch(/\.yr-foot-c \{[^}]*overflow-wrap: anywhere/);
    expect(css).toMatch(/\.yr-sec-title \{([^}]*)overflow-wrap: anywhere/);
  });

  it("keeps viewer navigation targets reachable at narrow widths", async () => {
    const css=readFileSync(join(assets,"viewer-shell.css"),"utf8");
    expect(css).toContain(".viewer-destinations a,.viewer-rail-account a");
    expect(css).toContain("min-height:44px");
    expect(css).toContain("@media(max-width:900px)");
    expect(css).not.toMatch(/viewer-destinations[^}]*display:none/);
    const html=await render("me",{viewer,viewerData:{...viewerData,viewerOnSite:{balance:1234567}}});
    expect(html).toContain('data-credit-balance="1234567"');
    expect(html).toContain('data-credit-balance-num>1,234,567</strong>');
    expect(html).toContain(">free credits</span>");
  });

  it("leaves signing in to the bar alone on a signed-out page", async () => {
    const signedOut = await render("home");
    const intro = signedOut.slice(signedOut.indexOf('class="yr-intro"'), signedOut.indexOf("</section>", signedOut.indexOf('class="yr-intro"')));
    // The bar owns authentication on every page, so the introduction carries the
    // creator's own actions and never repeats sign-in in the same viewport.
    // One sign-in action on the page: the bar's. (The drawer's credit row still
    // explains itself with "Sign in for credits" text, which is not a second one.)
    expect((signedOut.match(/Sign in( with (Kick|Discord))?<\/a>/g) || []).length).toBe(1);
    expect(signedOut.search(/Sign in( with (Kick|Discord))?<\/a>/)).toBeLessThan(signedOut.indexOf("</aside>"));
    expect(intro).not.toContain("Sign in");

    // The bar's real Kick and Discord entry points are untouched, and each is
    // still the only sign-in on the page.
    const kick = await render("home", { r: { viewerKickAuthEnabled: true } });
    expect(kick).toContain('href="/api/viewer/auth/kick?returnTo=https%3A%2F%2Fexample.test%2Fcreator">Sign in with Kick</a>');
    expect((kick.match(/\/api\/viewer\/auth\//g) || []).length).toBe(1);
    const discord = await render("home", { r: { viewerDiscordAuthEnabled: true } });
    expect(discord).toContain('href="/api/viewer/auth/discord?returnTo=https%3A%2F%2Fexample.test%2Fcreator">Sign in with Discord</a>');
    expect((discord.match(/\/api\/viewer\/auth\//g) || []).length).toBe(1);
    expect(intro).toContain('<a class="yr-btn" href="https://example.test/creator/shop">View rewards</a>');
    expect(intro).toContain("Watch on Kick");

    // Signed in, the introduction keeps exactly the actions it had before.
    const signedIn = await render("home", { viewer, viewerData });
    const inIntro = signedIn.slice(signedIn.indexOf('class="yr-intro"'), signedIn.indexOf("</section>", signedIn.indexOf('class="yr-intro"')));
    expect(inIntro).toContain("Watch on Kick");
    expect(inIntro).not.toContain("View rewards");
    expect(signedIn).not.toContain("/api/viewer/auth/");
  });

  it("keeps sign-in and account navigation role-correct", async () => {
    const signedOut=await render("home");
    expect(signedOut).toContain(">Sign in<");
    expect(signedOut).toContain('href="/creator/me">Sign in</a>');
    expect(signedOut).not.toContain('>My communities</a>');
    expect(signedOut).toContain('id="viewer-account-link" href="/me#vd-profile" hidden');
    const signedIn=await render("home",{viewer,viewerData});
    expect(signedIn).toContain('<span class="yr-vnote-num">1,234</span>');
    expect(signedIn).toContain('id="viewer-account-link" href="/me#vd-profile"');
    expect(signedIn).not.toContain(">Sign in<");
    expect(signedIn).toContain('href="/me">My communities</a>');
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
    const html=await render("me",{viewer,viewerData,custom:true});
    expect(html).toContain('href="/me" aria-current="page">My activity</a>');
    expect(html).toContain('id="viewer-account-link" href="https://yourrank.site/me#vd-profile"');
    expect(html).toContain('href="https://yourrank.site/me">My communities</a>');
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
    expect(html).toContain(">Browse reward shop ");

    const noShop = await render("home", {
      data: { ...baseData, siteSections: { ...baseData.siteSections, shop: false } },
    });
    expect(noShop).not.toContain("yr-preview");
  });

  it("gives a signed-in viewer their balance and local/global membership destinations", async () => {
    const html = await render("home", { viewer, viewerData });
    expect(html).toContain('<span class="yr-vnote-num">1,234</span>');
    expect(html).toContain("credits on this site");
    expect(html).toContain('href="https://example.test/creator/shop">Spend credits</a>');
    expect(html).toContain('href="https://example.test/creator/me">My activity ');
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
    expect(html).not.toContain(">My activity<");
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

  it("uses the same server-rendered navigation at both sizes without a script gate", async () => {
    const html=await render("home");
    const css=readFileSync(join(assets,"viewer-shell.css"),"utf8");
    expect((html.match(/class="viewer-destinations"/g)||[]).length).toBe(1);
    expect(html).not.toContain('id="yr-menu"');
    expect(html).not.toContain('id="yr-side"');
    expect(css).toContain(".viewer-layout{grid-template-columns:minmax(0,1fr)}");
    expect(css).toContain(".viewer-destinations{grid-column:1/-1;display:flex;flex-wrap:wrap;");
    expect(css).not.toMatch(/\.viewer-rail[^}]*display:none/);
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
    expect(html).toContain("family=Fira+Sans");
    expect(html).toContain("family=Fira+Code");
    expect(html).not.toContain("family=Inter");
    expect(html).not.toContain("IBM+Plex+Mono");
  });

  it("keeps navigation and return paths available without JavaScript", async () => {
    const html=await render("me",{viewer,viewerData});
    const nav=html.match(/<aside class="viewer-rail"[\s\S]*?<\/aside>/)[0];
    for(const href of ["/creator","/creator/shop","/creator/me","/me","/me#vd-profile"]) expect(nav).toContain('href="'+href+'"');
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

  it("keeps the real creator identity without duplicating its logo across chrome", async () => {
    const plain=await render("home");
    expect(plain).toContain('href="/creator">Creator Name</a>');
    expect(plain).toContain('<h1 class="yr-intro-name">Welcome to <span data-preview-field="f_name">Creator Name</span>\'s channel</h1>');
    const logo=await render("home",{data:{...baseData,logoUrl:"https://cdn.test/logo.png"}});
    expect((logo.match(/class="yr-id-logo"/g)||[]).length).toBe(1);
    expect(logo).not.toContain('class="yr-intro-logo"');
  });

  it("keeps Home's opening at its own height beside the balance card", () => {
    const css = readFileSync(join(assets, "site-shell.css"), "utf8");
    const wide = css.slice(css.indexOf("@media (min-width: 900px)"));
    const band = wide.match(/\.yr-home-top \{([^}]*)\}/);
    expect(band).not.toBeNull();
    expect(band[1]).toContain("grid-template-columns");
    // A sparse introduction is never stretched to the balance card's height.
    expect(band[1]).not.toContain("align-items: stretch");
  });

  it("never hides the way back to all communities or the viewer account", async () => {
    const html=await render("me",{viewer,viewerData});
    expect(html).toContain('href="/me">My communities</a>');
    expect(html).toContain('href="/me#vd-profile">Viewer account</a>');
    const css=readFileSync(join(assets,"viewer-shell.css"),"utf8");
    expect(css).not.toMatch(/\.viewer-rail-account[^}]*display:none/);
    expect(css).toContain(".viewer-rail-account{grid-column:1/-1");
  });

  it("leaves one primary action per band and one heading per module", async () => {
    const html = await render("home");
    const intro = html.slice(html.indexOf('class="yr-intro-acts"'), html.indexOf("</section>", html.indexOf('class="yr-intro-acts"')));
    // View rewards is the primary; watching the creator is the quiet second.
    expect((intro.match(/class="yr-btn"/g) || []).length).toBe(1);
    expect(intro).toContain('class="yr-btn yr-btn--ghost"');

    // The leaderboard page named itself in the H1, so its panel does not
    // repeat the word in a second visible heading.
    const board = await render("leaderboard");
    expect(board).toContain('<h1 class="yr-h1 yr-lbh-title">Leaderboard</h1>');
    expect((board.match(/>Standings</g) || []).length).toBe(1);
    expect(board).toContain('<h2 class="yr-sr">Standings</h2>');
    expect(board).not.toContain('<h2 class="yr-panel-title">Standings</h2>');
  });

  it("states every empty list in the same shape", async () => {
    const bare = { ...baseData, players: [], shopItems: [], socials: [] };
    const home = await render("home", { data: bare });
    const shop = await render("shop", { data: bare, viewer, viewerData });
    const me = await render("me", { data: bare, viewer, viewerData });
    for (const html of [home, shop]) {
      const block = html.slice(html.indexOf('class="yr-empty yr-empty--compact"'));
      expect(block).toContain('class="yr-empty-ico"');
      expect(block).toContain('class="yr-empty-t"');
      expect(block).toContain('class="yr-empty-p"');
    }
    expect(shop).toContain("Rewards will appear here when Creator Name adds them.");
    expect(me).toContain('<h3>No claims yet</h3>');
    expect(me).toContain('class="member-empty"');
    expect(me).toContain('href="/creator/shop">Browse reward shop</a>');
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

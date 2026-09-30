// The global /me page owns the Viewer Account and the membership list only.
// Creator-branded My Community pages own per-membership Rewards, credits and
// Claims, so this client must not grow a second site detail or redemption flow.
import { afterEach, describe, expect, it } from "bun:test";
import { viewerDashboardPage } from "../pages/viewer-dashboard.js";
import { makeViewerAccountEnvironment } from "./viewer-account-react-utils.js";

const ACCOUNT = {
  viewer: {
    displayName: "member",
    avatarUrl: null,
    createdAt: "2026-01-02T00:00:00.000Z",
    connections: [{ provider: "kick", username: "member", linkedAt: "2026-01-02T00:00:00.000Z" }],
  },
  communities: [{
    slug: "alpha",
    name: "Alpha Community",
    balance: 1234,
    totalEarned: 1500,
    totalSpent: 266,
    pendingClaims: 1,
    claimingAvailable: true,
  }],
};

const signedInDocument = {
  state: "authenticated",
  viewer: {
    id: "v1",
    kick_username: "member",
    avatar_url: null,
    created_at: "2026-01-02T00:00:00.000Z",
  },
};

const environments = [];
afterEach(async () => {
  for (const environment of environments.splice(0).reverse()) await environment.close();
});

async function makeEnvironment(options) {
  const environment = await makeViewerAccountEnvironment(options);
  environments.push(environment);
  return environment;
}

describe("global Viewer Account client", () => {
  it("renders one account and links each membership to its creator-branded owner", async () => {
    const env = await makeEnvironment({ response: { body: ACCOUNT } });
    await env.ready();

    expect(env.$("vd-login-card").hidden).toBe(true);
    expect(env.$("vd-profile").hidden).toBe(true);
    expect(env.$("viewer-account-link").hidden).toBe(false);
    expect(env.$("vd-communities-card").hidden).toBe(false);
    expect(env.$("vd-username").textContent).toBe("member");
    expect(env.$("vd-identity").textContent).toContain("Connected to Kick as @member");
    expect(env.$("vd-communities").innerHTML).toContain("Alpha Community");
    expect(env.$("vd-communities").innerHTML).toContain("1,234 Credits");
    expect(env.$("vd-communities").innerHTML).toContain("1 Claim needs creator action");
    expect(env.$("vd-communities").innerHTML).toContain('href="/alpha"');
    expect(env.$("vd-communities").innerHTML).not.toContain("Member since");
    expect(env.calls.map(({ path, method }) => ({ path, method }))).toEqual([
      { path: "/api/viewer/me", method: "GET" },
    ]);
  });

  it("shows the truthful empty membership state", async () => {
    const env = await makeEnvironment({ response: { body: { ...ACCOUNT, communities: [] } } });
    await env.ready();
    expect(env.$("vd-communities-empty").hidden).toBe(false);
    expect(env.$("vd-communities").innerHTML).toBe("");
  });

  it("keeps the initial until an avatar loads and restores it after an image failure", async () => {
    const env = await makeEnvironment({
      response: {
        body: {
          ...ACCOUNT,
          viewer: { ...ACCOUNT.viewer, avatarUrl: "https://example.invalid/avatar.png" },
        },
      },
    });
    await env.ready();
    expect(env.$("vd-avatar").hidden).toBe(true);
    expect(env.$("vd-avatar-fallback").hidden).toBe(false);
    await env.fire(env.$("vd-avatar"), "load");
    expect(env.$("vd-avatar").hidden).toBe(false);
    expect(env.$("vd-avatar-fallback").hidden).toBe(true);
    const topAvatar = env.$("viewer-top-mark").querySelector("img");
    expect(topAvatar?.getAttribute("src")).toBe("https://example.invalid/avatar.png");
    await env.navigateHash("vd-data");
    expect(env.$("viewer-top-mark").querySelector("img")?.getAttribute("src"))
      .toBe("https://example.invalid/avatar.png");
    await env.navigateHash("vd-profile");
    await env.fire(env.$("vd-avatar"), "error");
    expect(env.$("vd-avatar").hidden).toBe(true);
    expect(env.$("vd-avatar-fallback").hidden).toBe(false);
  });

  it("never shows sign-in UI while the session is still unresolved", async () => {
    let resolve;
    const env = await makeEnvironment({
      auth: signedInDocument,
      url: "https://yourrank.site/me#vd-data",
      response: () => new Promise((done) => { resolve = done; }),
    });
    expect(env.$("vd-login-card").hidden).toBe(true);
    expect(env.$("vd-loading").hidden).toBe(false);
    expect(env.$("vd-title").textContent).not.toContain("Sign in");
    expect(env.$("viewer-top-name").textContent).not.toBe("Sign in");
    await env.navigateHash("vd-security");
    expect(env.$("vd-title").textContent).not.toContain("Sign in");
    expect(env.activeElement()).not.toBe(env.$("vd-login-card"));
    expect(env.$("vd-login-card").hidden).toBe(true);

    resolve({ body: ACCOUNT });
    await env.ready();
    expect(env.authState()).toBe("authenticated");
    expect(env.$("vd-loading").hidden).toBe(true);
    expect(env.$("vd-login-card").hidden).toBe(true);
    expect(env.$("vd-security").hidden).toBe(false);
    expect(env.$("viewer-top-name").textContent).toBe("member");
  });

  it("reports a load failure on the account, not inside a hidden sign-in card, when the document is signed in", async () => {
    const env = await makeEnvironment({
      auth: signedInDocument,
      response: { status: 500, body: { error: "boom" } },
    });
    await env.ready();
    expect(env.authState()).toBe("authenticated");
    expect(env.$("vd-login-card").hidden).toBe(true);
    expect(env.$("vd-account-status").textContent).toContain("We couldn't load your Viewer Account.");
    expect(env.$("vd-login-status").textContent).toBe("");
  });

  it("only resolves to sign-in once the session is definitively absent", async () => {
    const env = await makeEnvironment({
      auth: { state: "unresolved", viewer: null },
      response: { status: 401, body: { error: "unauthorized" } },
    });
    await env.ready();
    expect(env.authState()).toBe("unauthenticated");
    expect(env.$("vd-login-card").hidden).toBe(false);
    expect(env.$("vd-loading").hidden).toBe(true);
    expect(env.$("viewer-top-name").textContent).toBe("Sign in");
  });

  it("shows sign-in when the Viewer Account session is absent", async () => {
    const env = await makeEnvironment({ response: { status: 401, body: { error: "unauthorized" } } });
    await env.ready();
    expect(env.$("vd-login-card").hidden).toBe(false);
    expect(env.$("viewer-account-link").hidden).toBe(true);
    expect(env.$("vd-profile").hidden).toBe(true);
    expect(env.$("vd-communities-card").hidden).toBe(true);
  });

  it("gates account settings for a guest instead of focusing a hidden section", async () => {
    const env = await makeEnvironment({
      community: { slug: "alpha", name: "Alpha", href: "/alpha" },
      response: { status: 401, body: { error: "unauthorized" } },
      url: "https://yourrank.site/me?community=alpha#vd-data",
    });
    const sections = ["vd-profile", "vd-connections", "vd-notifications", "vd-security", "vd-data"];
    await env.ready();
    expect(sections.every((id) => env.$(id).hidden)).toBe(true);
    expect(env.$("vd-login-card").hidden).toBe(false);
    expect(env.activeElement()).toBe(env.$("vd-login-card"));
    expect(env.$("vd-title").textContent).toBe("Sign in to open Data & Account");
    expect(env.$("vd-subtitle").textContent).toContain("come straight back to it");
    expect(env.$("vd-login-kick").getAttribute("href")).toBe("/api/viewer/auth/kick?returnTo=%2Fme%3Fcommunity%3Dalpha%23vd-data");
    expect(env.$("vd-login-discord").getAttribute("href")).toBe("/api/viewer/auth/discord?returnTo=%2Fme%3Fcommunity%3Dalpha%23vd-data");
    expect(env.navigation.filter((link) => link.getAttribute("aria-current") === "page").map((link) => link.getAttribute("href"))).toEqual(["/me?community=alpha#vd-data"]);

    await env.navigateHash("vd-security");
    expect(sections.every((id) => env.$(id).hidden)).toBe(true);
    expect(env.$("vd-title").textContent).toBe("Sign in to open Privacy & Security");
    expect(env.$("vd-login-kick").getAttribute("href")).toBe("/api/viewer/auth/kick?returnTo=%2Fme%3Fcommunity%3Dalpha%23vd-security");
    expect(env.activeElement()).toBe(env.$("vd-login-card"));

    await env.navigateHash("");
    expect(env.$("vd-title").textContent).toBe("Your Viewer Account");
    expect(env.$("vd-subtitle").textContent).toBe("Sign in to access your communities, rewards and balances.");
    expect(env.$("vd-login-kick").getAttribute("href")).toBe("/api/viewer/auth/kick?returnTo=%2Fme%3Fcommunity%3Dalpha");
    expect(env.navigation.every((link) => !link.hasAttribute("aria-current"))).toBe(true);
  });

  it("opens the requested section once the provider returns a signed-in member", async () => {
    const env = await makeEnvironment({
      response: { body: ACCOUNT },
      url: "https://yourrank.site/me#vd-connections",
    });
    await env.ready();
    expect(env.$("vd-connections").hidden).toBe(false);
    expect(env.$("vd-login-card").hidden).toBe(true);
    expect(env.$("vd-title").textContent).toBe("Connected Accounts");
    expect(env.activeElement()).toBe(env.$("vd-title"));
  });

  it("clears the previous account's memberships before another login", async () => {
    const env = await makeEnvironment({
      response: (_path, options) => options.method === "POST"
        ? { body: { ok: true } }
        : { body: ACCOUNT },
    });
    await env.ready();
    expect(env.$("vd-communities").innerHTML).toContain("Alpha Community");

    await env.click(env.$("vd-logout"));
    expect(env.$("viewer-account-link").hidden).toBe(true);
    expect(env.activeElement()).toBe(env.$("vd-login-card"));
    expect(env.$("vd-profile").hidden).toBe(true);
    expect(env.$("vd-communities-card").hidden).toBe(true);
    expect(env.$("vd-username").textContent).toBe("");
    expect(env.$("vd-communities").innerHTML).toBe("");
  });

  it("keeps an account failure visible and retryable", async () => {
    let failed = true;
    const env = await makeEnvironment({
      response: () => failed
        ? { status: 500, body: { error: "boom" } }
        : { body: ACCOUNT },
    });
    await env.ready();
    expect(env.$("vd-login-status").textContent).toContain("We couldn't load your Viewer Account.");
    failed = false;
    await env.click(env.$("vd-login-status").querySelector(".vd-retry"));
    expect(env.calls.filter((call) => call.path === "/api/viewer/me")).toHaveLength(2);
    expect(env.$("vd-login-status").textContent).toBe("");
    expect(env.$("vd-communities").textContent).toContain("Alpha Community");
  });

  it("selects each account section without showing another section or community balance", async () => {
    const env = await makeEnvironment({ response: { body: ACCOUNT } });
    await env.ready();
    const sections = ["vd-profile", "vd-connections", "vd-notifications", "vd-security", "vd-data"];
    for (const section of sections) {
      await env.navigateHash(section);
      expect(sections.filter((id) => !env.$(id).hidden)).toEqual([section]);
      expect(env.$("vd-communities-card").hidden).toBe(true);
      const active = env.navigation.filter((link) => link.getAttribute("aria-current") === "page");
      const destination = env.navigation.find((link) => new URL(link.href).hash === `#${section}`);
      expect(active.map((link) => link.getAttribute("href")))
        .toEqual(destination ? [destination.getAttribute("href")] : []);
      expect(env.activeElement()).toBe(env.$("vd-title"));
    }
    await env.navigateHash("");
    expect(sections.every((id) => env.$(id).hidden)).toBe(true);
    expect(env.$("vd-communities-card").hidden).toBe(false);
    expect(env.navigation.every((link) => !link.hasAttribute("aria-current"))).toBe(true);
    expect(env.$("viewer-communities-link").getAttribute("aria-current")).toBe("page");
  });
});

describe("global Viewer Account first paint", () => {
  const providers = { kick: true, discord: false };
  const viewer = { id: "v1", kick_username: "member", avatar_url: null, created_at: "2026-01-02T00:00:00.000Z" };

  it("ships a signed-in document with the topbar and content agreeing", () => {
    const html = viewerDashboardPage(null, providers, { state: "authenticated", viewer });
    expect(html).toContain('class="yr-site viewer-shell viewer-account-page viewer-auth-authenticated"');
    expect(html).toContain('<strong id="viewer-top-name">member</strong>');
    expect(html).toContain('id="viewer-top-mark">M</span>');
    expect(html).toContain('<section id="vd-login-card" tabindex="-1" hidden>');
    expect(html).toContain('id="viewer-account-link" href="/me#vd-profile">');
    expect(html).not.toContain('<strong id="viewer-top-name">Sign in</strong>');
    expect(html).toMatch(/<div id="vd-loading" class="vd-loading"[^>]*aria-busy="true">/);
  });

  it("ships a signed-out document that shows sign-in immediately", () => {
    const html = viewerDashboardPage(null, providers, { state: "unauthenticated", viewer: null });
    expect(html).toContain("viewer-auth-unauthenticated");
    expect(html).toContain('<strong id="viewer-top-name">Sign in</strong>');
    expect(html).toContain('<section id="vd-login-card" tabindex="-1">');
    expect(html).toContain('id="vd-login-kick"');
    expect(html).toMatch(/<div id="vd-loading" class="vd-loading"[^>]*aria-busy="true" hidden>/);
    expect(viewerDashboardPage(null, providers)).toContain("viewer-auth-unauthenticated");
  });

  it("ships neither sign-in nor account content while the session is unresolved", () => {
    const html = viewerDashboardPage(null, providers, { state: "unresolved", viewer: null });
    expect(html).toContain("viewer-auth-unresolved");
    expect(html).toContain('<section id="vd-login-card" tabindex="-1" hidden>');
    expect(html).toContain('<strong id="viewer-top-name">Account</strong>');
    expect(html).not.toContain('<strong id="viewer-top-name">Sign in</strong>');
    expect(html).toMatch(/<div id="vd-loading" class="vd-loading"[^>]*aria-busy="true">/);
    expect(html).toContain("Checking your sign-in…");
  });
});

describe("global Viewer Account ownership", () => {
  const providers = { kick: true, discord: true };
  const page = viewerDashboardPage(null, providers);

  it("offers a way back to the originating community without inventing a membership", () => {
    const html = viewerDashboardPage({ slug: "creator", name: "Creator <One>", href: "/creator" }, providers);
    expect(html).toContain('<a class="viewer-return" href="/creator">');
    expect(html).toContain('<a class="yr-sec-link vd-return" href="/creator">');
    expect(html).toContain("Creator &lt;One&gt;");
    expect(html).toContain('id="viewer-communities-link" href="/me?community=creator" aria-current="page"');
    expect(html).toContain('href="/me?community=creator#vd-profile"');
    expect(html).toContain('href="/api/viewer/auth/kick?returnTo=%2Fme%3Fcommunity%3Dcreator"');
    expect(html).toContain('href="/help/support?audience=viewer&amp;return=%2Fme%3Fcommunity%3Dcreator"');
    expect(html).toContain('<div id="vd-communities" class="vd-community-list"></div>');
    expect(html).toContain('id="vd-communities-card" hidden');
    expect(page).not.toContain("viewer-return");
    expect(page).toContain('href="/api/viewer/auth/kick"');
    expect(page).toContain('id="viewer-communities-link" href="/me" aria-current="page"');
  });

  it("names the real account-to-membership hierarchy", () => {
    expect(page).toContain('<h1 class="vd-h1" id="vd-title" tabindex="-1">Your Viewer Account</h1>');
    expect(page).toContain("Sign in to access your communities, rewards and balances.");
    const signedIn = viewerDashboardPage(null, providers, { state: "authenticated", viewer: { id: "v1", kick_username: "m", avatar_url: null, created_at: "2026-01-02T00:00:00.000Z" } });
    expect(signedIn).toContain('<h1 class="vd-h1" id="vd-title" tabindex="-1">My communities</h1>');
    expect(signedIn).toContain("Your rewards and claims stay with each community.");
    expect(page).toContain(">Your memberships<");
    expect(page).toContain("You haven't joined any communities yet.");
    expect(page).not.toContain("appear here automatically");
    expect(page).not.toContain("Your sites");
    expect(page).not.toContain(">My credits<");
  });

  it("does not duplicate a creator's membership product", async () => {
    const env = await makeEnvironment({ response: { body: ACCOUNT } });
    await env.ready();
    expect(env.calls.map((call) => call.path)).toEqual(["/api/viewer/me"]);
    for (const id of ["vd-site-card", "vd-shop-list", "vd-redemptions-list", "vd-drop-claim"]) {
      expect(env.document.getElementById(id)).toBeNull();
    }
    expect(page).not.toContain("vd-site-card");
    expect(page).not.toContain("vd-shop-list");
    expect(page).not.toContain("vd-redemptions-list");
    expect(page).not.toContain("vd-drop-claim");
  });

  it("keeps the skip target on one content landmark outside the navigation", () => {
    expect((page.match(/<main\b/g) || []).length).toBe(1);
    expect((page.match(/id="main-content"/g) || []).length).toBe(1);
    expect(page).not.toContain(' style="');
    expect(page).toContain('<main class="viewer-main" id="main-content" tabindex="-1">');
    expect(page.indexOf('class="viewer-rail"')).toBeLessThan(page.indexOf('<main '));
  });

  it("gives every account failure a visible status owner", () => {
    for (const id of ["vd-login-status", "vd-account-status", "vd-communities-status"]) {
      expect(page).toContain(`id="${id}" role="status" aria-live="polite"`);
    }
  });

  it("uses one replacement material owner and puts memberships before account maintenance", () => {
    expect(page).not.toContain('/assets/devin-system.css');
    expect(page).toContain('A creator destination, not an admin dashboard');
    expect(page.indexOf('id="vd-communities-card"')).toBeLessThan(page.indexOf('id="vd-profile"'));
    expect(page).toContain('<summary>Manage your login</summary>');
    expect(page).not.toContain('href="/dashboard"');
    expect(page).not.toContain('class="viewer-context"');
  });
});

describe("viewer login recovery", () => {
  it("opens a named or pasted YourRank community from the directory without creating a membership", async () => {
    const env = await makeEnvironment({ response: { body: { ...ACCOUNT, communities: [] } } });
    await env.ready();
    expect(env.$("vd-communities-empty").hidden).toBe(false);
    await env.input(env.$("vd-community-name"), " Atlas-Community ");
    await env.submit(env.$("vd-open-community"));
    expect(env.window.location.pathname).toBe("/atlas-community");
    // Existing slugify truncates after trimming, so a stored slug can end in '-'.
    const truncatedSlug = "a".repeat(39) + "-";
    await env.input(env.$("vd-community-name"), truncatedSlug);
    await env.submit(env.$("vd-open-community"));
    expect(env.window.location.pathname).toBe(`/${truncatedSlug}`);
    await env.input(env.$("vd-community-name"), "https://yourrank.site/atlas-community/shop");
    await env.submit(env.$("vd-open-community"));
    expect(env.window.location.pathname).toBe("/atlas-community");
    expect(env.calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("rejects a URL or path entered as a community name", async () => {
    const env = await makeEnvironment({ response: { body: { ...ACCOUNT, communities: [] } } });
    await env.ready();
    for (const invalid of ["https://other.example", "../dashboard", "alpha/me", ""]) {
      await env.input(env.$("vd-community-name"), invalid);
      await env.submit(env.$("vd-open-community"));
      expect(env.window.location.pathname).toBe("/me");
      expect(env.$("vd-community-name").getAttribute("aria-invalid")).toBe("true");
      expect(env.activeElement()).toBe(env.$("vd-community-name"));
    }
  });

  it("keeps a signed-out account deep link on a visible sign-in panel", async () => {
    const env = await makeEnvironment({
      response: { status: 401, body: { error: "unauthorized" } },
      url: "https://yourrank.site/me#vd-profile",
    });
    await env.ready();
    expect(env.$("vd-login-card").hidden).toBe(false);
    expect(env.$("viewer-account-link").getAttribute("href")).toBe("/me#vd-login-card");
    expect(env.activeElement()).toBe(env.$("vd-login-card"));
  });

  it("keeps signed-in account navigation inside the viewer experience", async () => {
    const env = await makeEnvironment({
      response: { body: ACCOUNT },
      url: "https://yourrank.site/me#vd-profile",
    });
    await env.ready();
    expect(env.$("vd-profile").hidden).toBe(false);
    expect(env.$("viewer-account-link").getAttribute("href")).toBe("/me#vd-profile");
    expect(env.activeElement()).toBe(env.$("vd-profile"));
  });

  it("keeps a provider cancellation visible after the account request finishes", async () => {
    const env = await makeEnvironment({
      response: { status: 401, body: { error: "unauthorized" } },
      url: "https://yourrank.site/me?error=access_denied",
    });
    await env.ready();
    expect(env.$("vd-login-status").textContent).toBe("Sign-in was cancelled.");
  });

  it("does not claim a login switch succeeded when sign-out fails", async () => {
    const env = await makeEnvironment({
      response: (_path, options) => options.method === "POST"
        ? { status: 500, body: { error: "failed" } }
        : { body: ACCOUNT },
      url: "https://yourrank.site/me#vd-profile",
    });
    await env.ready();
    await env.click(env.$("vd-switch"));
    expect(env.$("vd-profile").hidden).toBe(false);
    expect(env.$("vd-account-status").textContent).toContain("We couldn't switch your login.");
    expect(env.$("vd-switch").disabled).toBe(false);
  });
});

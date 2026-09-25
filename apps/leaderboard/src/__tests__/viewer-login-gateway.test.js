// Creator authentication (/login, email + password) is separate from Viewer
// Account authentication (/me, provider OAuth). /login must not advertise
// specific viewer providers; /me renders only providers the deployment's
// readiness system reports as available. All assertions are on the
// server-rendered first paint.
import { describe, expect, test } from "bun:test";
import { PAGES } from "../pages.jsx";
import { viewerDashboardPage } from "../pages/viewer-dashboard.js";
import { handleKickViewerAuthStart, handleDiscordViewerAuthStart } from "../handlers/viewer-auth.js";

const loginHtml = PAGES.login.Component().toString();
const signupHtml = PAGES.signup;
const viewer = { id: "v1", kick_username: "member", avatar_url: null, created_at: "2026-01-02T00:00:00.000Z" };
const authed = { state: "authenticated", viewer };
const guest = { state: "unauthenticated", viewer: null };

const providerButtons = (html) => {
  const kick = html.match(/<a[^>]*id="vd-login-kick"[^>]*>([^<]*)<\/a>/);
  const discord = html.match(/<a[^>]*id="vd-login-discord"[^>]*>([^<]*)<\/a>/);
  return { kick: kick ? kick[1] : null, discord: discord ? discord[1] : null };
};

describe("creator login page", () => {
  test("keeps the email + password form and creator links", () => {
    expect(loginHtml).toContain('id="email"');
    expect(loginHtml).toContain('id="password"');
    expect(loginHtml).toContain(">Sign in</button>");
    expect(loginHtml).toContain('No account? <a href="/signup">Create one</a>');
    expect(loginHtml).toContain('<a href="/forgot">Forgot password?</a>');
  });

  test("points viewers at the /me gateway without naming providers", () => {
    expect(loginHtml).not.toContain("Kick or Discord");
    expect(loginHtml).toContain("Are you a viewer?");
    expect(loginHtml).toContain('<a href="/me">Sign in to your Viewer Account</a>');
    expect(loginHtml).not.toContain("/api/viewer/auth/kick");
    expect(loginHtml).not.toContain("/api/viewer/auth/discord");
    expect(signupHtml).not.toContain("Kick or Discord");
    expect(signupHtml).toContain('Are you a viewer? <a href="/me">Sign in to your Viewer Account</a>');
  });
});

describe("guest /me viewer gateway", () => {
  test("renders the simplified Viewer Account sign-in state on first paint", () => {
    const html = viewerDashboardPage(null, { kick: true, discord: false }, guest);
    expect(html).toContain("viewer-auth-unauthenticated");
    expect(html).toContain('<h1 class="vd-h1" id="vd-title" tabindex="-1">Your Viewer Account</h1>');
    expect(html).toContain('<p class="vd-sub" id="vd-subtitle">Sign in to access your communities, rewards and balances.</p>');
    expect(html).toContain('<section id="vd-login-card" tabindex="-1">');
    expect(html).not.toContain("Your communities, together.");
    expect(html).not.toContain('<h1 class="vd-h1" id="vd-title" tabindex="-1">My communities</h1>');
  });

  test("Kick available only → Kick button only", () => {
    const html = viewerDashboardPage(null, { kick: true, discord: false }, guest);
    expect(providerButtons(html)).toEqual({ kick: "Sign in with Kick", discord: null });
    expect(html).not.toContain("/api/viewer/auth/discord");
    expect(html).not.toContain("Viewer sign-in is not available");
  });

  test("Discord available only → Discord button only", () => {
    const html = viewerDashboardPage(null, { kick: false, discord: true }, guest);
    expect(providerButtons(html)).toEqual({ kick: null, discord: "Sign in with Discord" });
    expect(html).not.toContain("/api/viewer/auth/kick");
    expect(html).not.toContain("Viewer sign-in is not available");
  });

  test("both available → both buttons with one consistent label convention", () => {
    const html = viewerDashboardPage(null, { kick: true, discord: true }, guest);
    expect(providerButtons(html)).toEqual({ kick: "Sign in with Kick", discord: "Sign in with Discord" });
    expect(html).not.toMatch(/Log in with (Kick|Discord)/);
    expect(html).not.toMatch(/Continue with (Kick|Discord)/);
    expect(html).not.toMatch(/Connect with (Kick|Discord)/);
  });

  test("neither available → no provider button and a clear unavailable message", () => {
    const html = viewerDashboardPage(null, { kick: false, discord: false }, guest);
    expect(providerButtons(html)).toEqual({ kick: null, discord: null });
    expect(html).not.toContain("/api/viewer/auth/");
    expect(html).toContain("Viewer sign-in is not available on this site right now. Please try again later.");
  });

  test("fails closed on non-boolean availability", () => {
    const html = viewerDashboardPage(null, { kick: "true", discord: 1 }, guest);
    expect(providerButtons(html)).toEqual({ kick: null, discord: null });
  });

  test("community-scoped guest keeps the safe viewer returnTo on each provider button", () => {
    const html = viewerDashboardPage({ slug: "creator", name: "Creator", href: "/creator" }, { kick: true, discord: true }, guest);
    expect(html).toContain('id="vd-login-kick" href="/api/viewer/auth/kick?returnTo=%2Fme%3Fcommunity%3Dcreator"');
    expect(html).toContain('id="vd-login-discord" href="/api/viewer/auth/discord?returnTo=%2Fme%3Fcommunity%3Dcreator"');
  });
});

describe("authenticated /me", () => {
  test("still renders the full Viewer Account", () => {
    const html = viewerDashboardPage(null, { kick: true, discord: true }, authed);
    expect(html).toContain("viewer-auth-authenticated");
    expect(html).toContain('<h1 class="vd-h1" id="vd-title" tabindex="-1">My communities</h1>');
    expect(html).toContain('<section id="vd-login-card" tabindex="-1" hidden>');
    expect(html).not.toContain("Your Viewer Account</h1>");
    for (const id of ["vd-communities", "vd-profile", "vd-connections", "vd-security", "vd-data"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain("<h2>Connected account</h2>");
    expect(html).toContain('id="vd-provider-list"');
    expect(html).toContain('id="vd-security-providers"');
    expect(html).toContain('id="vd-data-name"');
    expect(html).toContain('id="vd-logout" type="button">Sign out</button>');
    expect(html).toContain('id="vd-switch" type="button">Use a different login</button>');
    expect(html).toContain('<strong id="viewer-top-name">member</strong>');
  });
});

describe("viewer OAuth returnTo", () => {
  const ready = () => ({
    kick: { available: true, redirectUri: "https://yourrank.site/auth/kick/callback" },
    discord: { available: true, redirectUri: "https://yourrank.site/api/viewer/auth/discord/callback" },
  });
  const start = async (handler, path) => {
    let stored;
    const res = await handler(new Request(`https://yourrank.site${path}`), {}, {
      rateLimit: async () => ({ ok: true }),
      clientIp: () => "127.0.0.1",
      storeOAuthState: async (_provider, _state, data) => { stored = data; },
      generatePKCE: async () => ({ codeVerifier: "v", codeChallenge: "c" }),
      buildKickViewerAuthorizeURL: () => "https://kick.test/authorize",
      buildDiscordViewerAuthorizeURL: () => "https://discord.test/authorize",
      resolveViewerOAuthStatus: ready,
    });
    expect(res.status).toBe(302);
    return stored.returnTo;
  };

  test("safe community and account-section destinations are preserved", async () => {
    expect(await start(handleKickViewerAuthStart, "/api/viewer/auth/kick?returnTo=%2Fme%3Fcommunity%3Dcreator")).toBe("/me?community=creator");
    expect(await start(handleKickViewerAuthStart, "/api/viewer/auth/kick?returnTo=%2Fme%23vd-data")).toBe("/me#vd-data");
    expect(await start(handleKickViewerAuthStart, "/api/viewer/auth/kick?returnTo=%2Fcreator%2Frewards")).toBe("/creator/rewards");
    expect(await start(handleDiscordViewerAuthStart, "/api/viewer/auth/discord?returnTo=%2Fme%3Fcommunity%3Dcreator")).toBe("/me?community=creator");
  });

  test("unsafe external destinations fall back to /me", async () => {
    for (const bad of ["https://evil.example/", "//evil.example/me", "/\\evil.example", "javascript:alert(1)"]) {
      expect(await start(handleKickViewerAuthStart, `/api/viewer/auth/kick?returnTo=${encodeURIComponent(bad)}`)).toBe("/me");
      expect(await start(handleDiscordViewerAuthStart, `/api/viewer/auth/discord?returnTo=${encodeURIComponent(bad)}`)).toBe("/me");
    }
  });
});

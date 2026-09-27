import { describe, expect, it } from "bun:test";
import { runInNewContext } from "node:vm";
import { SECURE_HTML } from "../middleware/headers.js";
import { telegramAccountLinkHeaders, telegramAccountLinkPage } from "../pages/telegram-account-link.js";
import { handleRequest } from "../index.js";

describe("Telegram account linking page", () => {
  it("submits the widget identity to the account-link API with CSRF protection", () => {
    const html = telegramAccountLinkPage({ botUsername: "@YourRankLoginBot", csrfToken: "csrf123", nonce: "abc123", returnPath: "/dashboard/settings/connections?board=site-1" });
    expect(html).toContain('data-telegram-login="YourRankLoginBot"');
    expect(html).toContain('fetch("/api/auth/telegram/link"');
    expect(html).toContain('"x-csrf-token":"csrf123"');
    expect(html).toContain('location.assign("/dashboard/settings/connections?board=site-1")');
    expect(html).toContain('role="alert"');
  });

  it("links the signed widget identity and returns to the selected site", async () => {
    const html = telegramAccountLinkPage({ botUsername: "YourRankLoginBot", csrfToken: "csrf123", nonce: "abc123", returnPath: "/dashboard/settings/connections?board=site-1" });
    const script = html.match(/<script nonce="abc123">([\s\S]*?)<\/script>/)?.[1];
    const message = { hidden: true, textContent: "" };
    let request;
    let destination;
    const context = {
      window: {},
      document: { getElementById: () => message },
      fetch: async (url, options) => {
        request = { url, options };
        return { ok: true, json: async () => ({ ok: true }) };
      },
      location: { assign: (path) => { destination = path; } },
    };
    runInNewContext(script, context);
    await context.window.onTelegramAccountAuth({ id: 123, hash: "signed" });
    expect(request.url).toBe("/api/auth/telegram/link");
    expect(request.options.headers["x-csrf-token"]).toBe("csrf123");
    expect(JSON.parse(request.options.body)).toEqual({ id: 123, hash: "signed" });
    expect(destination).toBe("/dashboard/settings/connections?board=site-1");
  });

  it("shows a clear unavailable state when the bot is not configured", () => {
    const html = telegramAccountLinkPage({ botUsername: "", csrfToken: "csrf123", nonce: "abc123" });
    expect(html).toContain("Telegram account linking is temporarily unavailable.");
    expect(html).not.toContain("telegram-widget.js");
  });

  it("limits Telegram script and frame permissions to this page", () => {
    const csp = telegramAccountLinkHeaders("abc123")["Content-Security-Policy"];
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'unsafe-eval' https://telegram.org");
    expect(csp).toContain("connect-src 'self' https://telegram.org");
    expect(csp).toContain("frame-src 'self' https://telegram.org https://oauth.telegram.org");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(SECURE_HTML["Content-Security-Policy"]).not.toContain("'unsafe-eval'");
  });

  it("requires a signed-in unlinked account and retains selected-site context", async () => {
    const request = new Request("https://yourrank.site/auth/telegram/connect?board=site-1");
    const env = { LOGIN_BOT_TOKEN: "test-token", LOGIN_BOT_USERNAME: "YourRankLoginBot" };
    const ctx = { waitUntil() {} };
    const signedOut = await handleRequest(request, env, ctx, null, { currentUser: async () => null });
    expect(signedOut.status).toBe(302);
    expect(signedOut.headers.get("location")).toContain("/login");

    const linked = await handleRequest(request, env, ctx, null, { currentUser: async () => ({ id: "owner", telegram_user_id: 123 }) });
    expect(linked.status).toBe(302);
    expect(linked.headers.get("location")).toBe("https://yourrank.site/dashboard/settings/connections?board=site-1");

    const ready = await handleRequest(request, env, ctx, null, { currentUser: async () => ({ id: "owner", telegram_user_id: null }) });
    expect(ready.status).toBe(200);
    expect(await ready.text()).toContain('data-telegram-login="YourRankLoginBot"');
    expect(ready.headers.get("set-cookie")).toContain("__csrf=");
    expect(ready.headers.get("content-security-policy")).toContain("frame-ancestors 'self'");
  });
});

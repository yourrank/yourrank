import { describe, test, expect } from "bun:test";
import { z, validateJson, handlerSchemas } from "../validation.js";

describe("validateJson", () => {
  test("parses and validates a valid JSON body", async () => {
    const request = new Request("http://test/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "user@example.com", password: "password123", name: "User" }),
    });
    const result = await validateJson(request, handlerSchemas.handleSignup);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.email).toBe("user@example.com");
      expect(result.data.password).toBe("password123");
      expect(result.data.name).toBe("User");
    }
  });

  test("rejects invalid JSON", async () => {
    const request = new Request("http://test/api/auth/signup", {
      method: "POST",
      body: "not-json",
    });
    const result = await validateJson(request, handlerSchemas.handleSignup);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Invalid JSON");
  });

  test("rejects missing required fields", async () => {
    const request = new Request("http://test/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "user@example.com" }),
    });
    const result = await validateJson(request, handlerSchemas.handleSignup);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.toLowerCase()).toContain("password");
  });

  test("rejects oversized fields", async () => {
    const request = new Request("http://test/api/contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "A",
        email: "a@b.com",
        message: "x".repeat(5000),
      }),
    });
    const result = await validateJson(request, handlerSchemas.handleContact);
    expect(result.ok).toBe(false);
  });

  test("rejects unknown request fields", async () => {
    const request = new Request("http://test/api/site", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ siteId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", customFutureFlag: true }),
    });
    const result = await validateJson(request, handlerSchemas.handlePutSite);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Unrecognized key");
  });

  test("accepts the dashboard board-save contract", async () => {
    const request = new Request("http://test/api/site", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        siteId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        name: "Board",
        brand: {
          name: "Board",
          tagline: "Monthly race",
          casino: "Example",
          code: "RANK",
          ctaUrl: "https://example.com/ref",
          prizePool: "$1,000",
          period: "Monthly",
        },
        partner: {
          blurb: "Official partner",
          chips: ["Fast payouts"],
        },
        whyStats: [{ big: "24/7", label: "Support", sub: "Always available" }],
        rules: ["One account per player"],
        socials: [{
          name: "Discord",
          handle: "Join the community",
          action: "Join",
          url: "https://discord.example/invite",
          brand: "discord",
        }],
        players: [{ name: "Player", wagered: 10, prize: 1 }],
        branding: { template: "classic", accentA: "#123456", accentB: "#abcdef" },
        notify: {
          discord_webhook_url: null,
          telegram_chat_id: null,
          telegram_notify: false,
        },
      }),
    });

    const result = await validateJson(request, handlerSchemas.handlePutSite);
    expect(result.ok).toBe(true);
  });

  test("accepts the responsive logo set the dashboard uploads", async () => {
    const uri = "data:image/webp;base64,UklGRg==";
    const put = (logo: unknown) => validateJson(
      new Request("http://test/api/site", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ branding: { logo } }),
      }),
      handlerSchemas.handlePutSite,
    );

    expect((await put({ 64: uri, 128: uri, 256: uri, 512: uri })).ok).toBe(true);
    expect((await put(uri)).ok).toBe(true);
    expect((await put(null)).ok).toBe(true);
    // The image itself is still checked further in: the schema only guards shape.
    expect((await put({ 64: 12 })).ok).toBe(false);
  });

  test("validates array lengths on board saves", async () => {
    const request = new Request("http://test/api/site", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ players: Array(5001).fill({ name: "x" }) }),
    });
    const result = await validateJson(request, handlerSchemas.handlePutSite);
    expect(result.ok).toBe(false);
  });

  test("coerces numeric admin action fields", async () => {
    const request = new Request("http://test/api/admin/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        action: "pro",
        days: "31",
        amountUsd: "99.99",
      }),
    });
    const result = await validateJson(request, handlerSchemas.handleAction);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.days).toBe(31);
      expect(result.data.amountUsd).toBe(99.99);
    }
  });
});

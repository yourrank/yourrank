import { describe, expect, it } from "bun:test";
import {
  creatorContactMethods,
  hasCreatorContactMethod,
  isValidDiscordUrl,
  normalizeCreatorContact,
  parseHttpsUrl,
  validateCreatorContact,
} from "../creator-contact.js";

describe("creator contact availability", () => {
  it("reports no methods for an unconfigured or empty community", () => {
    for (const data of [undefined, null, {}, { contact: {} }, { contact: { email: "", discord: "  " } }, { socials: [{ url: "https://kick.com/x", enabled: true }] }]) {
      expect(creatorContactMethods(data)).toEqual({ available: false, methods: [] });
      expect(hasCreatorContactMethod(data)).toBe(false);
    }
  });

  it("exposes an email-only creator as a single mailto method", () => {
    const result = creatorContactMethods({ contact: { email: " Creator@Example.com " } });
    expect(result.available).toBe(true);
    expect(result.methods).toEqual([
      { type: "email", label: "Email creator", href: "mailto:Creator@Example.com", value: "Creator@Example.com", external: false },
    ]);
  });

  it("exposes a Discord-only creator as a single external method", () => {
    const result = creatorContactMethods({ discord: "https://discord.gg/abc123" });
    expect(result.methods).toEqual([
      { type: "discord", label: "Discord", href: "https://discord.gg/abc123", value: "https://discord.gg/abc123", external: true },
    ]);
  });

  it("lists every configured method in a stable order", () => {
    const result = creatorContactMethods({
      contact: { url: "https://creator.example/contact", social: "https://x.com/creator", discord: "https://discord.com/invite/abc", email: "c@example.com" },
    });
    expect(result.methods.map((m) => m.type)).toEqual(["email", "discord", "social", "url"]);
    expect(result.methods.map((m) => m.label)).toEqual(["Email creator", "Discord", "X", "Contact website"]);
    expect(result.methods.filter((m) => m.external).map((m) => m.type)).toEqual(["discord", "social", "url"]);
  });

  it("drops invalid values instead of rendering them", () => {
    const result = creatorContactMethods({
      contact: {
        email: "creator@",
        discord: "https://notdiscord.example/discord.gg/abc",
        social: "javascript:alert(1)",
        url: "http://insecure.example",
      },
    });
    expect(result).toEqual({ available: false, methods: [] });
  });
});

describe("creator contact validation", () => {
  it("validates email format", () => {
    expect(validateCreatorContact({ email: "creator@example.com" }).errors).toEqual([]);
    for (const bad of ["creator", "creator@", "@example.com", "a b@example.com", "<x>@example.com", "creator@example", `${"a".repeat(250)}@example.com`]) {
      const { errors, contact } = validateCreatorContact({ email: bad });
      expect(errors.map((e) => e.field)).toEqual(["email"]);
      expect(contact.email).toBe("");
    }
  });

  it("accepts only https links without embedded credentials", () => {
    expect(parseHttpsUrl("https://example.com/contact?x=1")).not.toBeNull();
    for (const bad of ["http://example.com", "javascript:alert(1)", "data:text/html,hi", "ftp://example.com", "https://user:pw@example.com", "https://", "example.com", "//example.com", ""]) {
      expect(parseHttpsUrl(bad)).toBeNull();
    }
    expect(validateCreatorContact({ url: "http://example.com" }).errors[0]).toMatchObject({ field: "url" });
    expect(validateCreatorContact({ social: "javascript:alert(1)" }).errors[0]).toMatchObject({ field: "social" });
  });

  it("only accepts Discord hosts for the Discord field", () => {
    for (const ok of ["https://discord.gg/abc", "https://discord.com/invite/abc", "https://www.discord.com/invite/abc", "https://discordapp.com/invite/abc", "https://DISCORD.GG/abc"]) {
      expect(isValidDiscordUrl(ok)).toBe(true);
    }
    for (const bad of ["http://discord.gg/abc", "https://discord.gg.evil.example/abc", "https://evil.example/discord.gg/abc", "https://x.com/creator", "discord.gg/abc"]) {
      expect(isValidDiscordUrl(bad)).toBe(false);
    }
    expect(validateCreatorContact({ discord: "https://x.com/creator" }).errors[0]).toMatchObject({ field: "discord" });
  });

  it("trims, drops unknown keys and keeps valid fields when another is invalid", () => {
    const { contact, errors } = validateCreatorContact({ email: " c@example.com ", url: "nope", phone: "123" });
    expect(contact).toEqual({ email: "c@example.com", discord: "", social: "", url: "" });
    expect(errors).toEqual([{ field: "url", message: "Enter a valid link, starting with https://" }]);
    expect(normalizeCreatorContact({ email: "bad", discord: "https://discord.gg/x" })).toEqual({ email: "", discord: "https://discord.gg/x", social: "", url: "" });
    expect(normalizeCreatorContact("garbage")).toEqual({ email: "", discord: "", social: "", url: "" });
  });
});

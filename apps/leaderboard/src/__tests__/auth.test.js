// Unit tests for auth helpers: hashPassword, verifyPassword, safeEqual, isEmail, slugify.
// Uses bun:test. No real DB or KV needed — all crypto runs in the bun runtime.
//
// Run: bun test src/__tests__/auth.test.js
//   or: bun test   (from apps/leaderboard/)

import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";

// ── stub heavy deps so auth.js loads without a real DB or session KV ──────
// We use import.meta.resolve() to get the exact resolved URL that auth.js will
// request, so the mock intercepts regardless of CJS/ESM interop quirks.
const {
  hashPassword,
  verifyPassword,
  safeEqual,
  isEmail,
  slugify,
  RESERVED,
  readToken,
} = await import("../auth.js");

// ── hashPassword ───────────────────────────────────────────────────────────

describe("hashPassword", () => {
  test("returns salt and hash strings", async () => {
    const { salt, hash } = await hashPassword("correcthorsebatterystaple");
    expect(typeof salt).toBe("string");
    expect(typeof hash).toBe("string");
    expect(salt.length).toBeGreaterThan(0);
    expect(hash.length).toBeGreaterThan(0);
  });

  test("hash is versioned: starts with '<iterations>$'", async () => {
    const { hash } = await hashPassword("mypassword");
    expect(hash).toMatch(/^\d+\$/);
  });

  test("uses 100000 iterations (Workers PBKDF2 limit)", async () => {
    const { hash } = await hashPassword("mypassword");
    expect(hash.startsWith("100000$")).toBe(true);
  });

  test("salt is a 32-char hex string (16 bytes)", async () => {
    const { salt } = await hashPassword("mypassword");
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
  });

  test("accepts explicit saltHex and produces deterministic output", async () => {
    const fixedSalt = "deadbeefdeadbeefdeadbeefdeadbeef";
    const { hash: h1 } = await hashPassword("password", fixedSalt);
    const { hash: h2 } = await hashPassword("password", fixedSalt);
    expect(h1).toBe(h2);
  });

  test("different passwords produce different hashes (same salt)", async () => {
    const fixedSalt = "aaaabbbbccccddddaaaabbbbccccdddd";
    const { hash: h1 } = await hashPassword("password1", fixedSalt);
    const { hash: h2 } = await hashPassword("password2", fixedSalt);
    expect(h1).not.toBe(h2);
  });

  test("different salts produce different hashes for the same password", async () => {
    const { salt: s1, hash: h1 } = await hashPassword("samepassword");
    const { salt: s2, hash: h2 } = await hashPassword("samepassword");
    expect(s1).not.toBe(s2);
    expect(h1).not.toBe(h2);
  });
});

describe("readToken", () => {
  test("honors the gm_session cutoff while keeping yr_session valid", () => {
    const previous = process.env.LEGACY_GM_SESSION_CUTOFF;
    const legacyRequest = new Request("https://example.com", {
      headers: { Cookie: "gm_session=legacy-token" },
    });
    const currentRequest = new Request("https://example.com", {
      headers: { Cookie: "yr_session=current-token" },
    });

    try {
      delete process.env.LEGACY_GM_SESSION_CUTOFF;
      expect(readToken(legacyRequest)).toBe("legacy-token");
      expect(readToken(currentRequest)).toBe("current-token");

      process.env.LEGACY_GM_SESSION_CUTOFF = "2099-12-31T23:59:59Z";
      expect(readToken(legacyRequest)).toBe("legacy-token");
      expect(readToken(currentRequest)).toBe("current-token");

      process.env.LEGACY_GM_SESSION_CUTOFF = "2000-01-01T00:00:00Z";
      expect(readToken(legacyRequest)).toBeNull();
      expect(readToken(currentRequest)).toBe("current-token");
    } finally {
      if (previous === undefined) delete process.env.LEGACY_GM_SESSION_CUTOFF;
      else process.env.LEGACY_GM_SESSION_CUTOFF = previous;
    }
  });
});

// ── verifyPassword ─────────────────────────────────────────────────────────

describe("verifyPassword", () => {
  test("correct password verifies successfully", async () => {
    const password = "correcthorsebatterystaple";
    const { salt, hash } = await hashPassword(password);
    const { ok } = await verifyPassword(password, salt, hash);
    expect(ok).toBe(true);
  });

  test("wrong password fails verification", async () => {
    const { salt, hash } = await hashPassword("realpassword");
    const { ok } = await verifyPassword("wrongpassword", salt, hash);
    expect(ok).toBe(false);
  });

  test("needsRehash is false for current iteration count (100000)", async () => {
    const { salt, hash } = await hashPassword("password");
    const { needsRehash } = await verifyPassword("password", salt, hash);
    expect(needsRehash).toBe(false);
  });

  test("needsRehash is true for legacy 50k hash", async () => {
    // Simulate an old hash produced at 50k iterations (pre-upgrade)
    const fixedSalt = "cafebabecafebabecafebabecafebabe";
    const saltBytes = Uint8Array.from({ length: 16 }, (_, i) =>
      parseInt(fixedSalt.slice(i * 2, i * 2 + 2), 16)
    );
    const km = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode("mypassword"), "PBKDF2", false, ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: saltBytes, iterations: 50000, hash: "SHA-256" }, km, 256
    );
    const hex = [...new Uint8Array(bits)].map(x => x.toString(16).padStart(2, "0")).join("");
    const legacyHash = `50000$${hex}`;

    const { ok, needsRehash } = await verifyPassword("mypassword", fixedSalt, legacyHash);
    expect(ok).toBe(true);
    expect(needsRehash).toBe(true);
  });

  test("needsRehash is false for bare-hex (pre-versioned) legacy hash", async () => {
    // Bare-hex hashes predate the versioned format — treated as LEGACY_ITERATIONS (100k).
    // Since current target is 100k, bare-hex at 100k no longer triggers a rehash.
    // This test verifies bare-hex is parsed correctly and verified.
    const fixedSalt = "deadbeefdeadbeefdeadbeefdeadbeef";
    const saltBytes = Uint8Array.from({ length: 16 }, (_, i) =>
      parseInt(fixedSalt.slice(i * 2, i * 2 + 2), 16)
    );
    const km = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode("pw"), "PBKDF2", false, ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: saltBytes, iterations: 100000, hash: "SHA-256" }, km, 256
    );
    const bareHex = [...new Uint8Array(bits)].map(x => x.toString(16).padStart(2, "0")).join("");

    const { ok, needsRehash } = await verifyPassword("pw", fixedSalt, bareHex);
    expect(ok).toBe(true);
    // Bare-hex at 100k matches the current target, so no rehash is needed
    expect(needsRehash).toBe(false);
  });

  test("empty password does not match a real hash", async () => {
    const { salt, hash } = await hashPassword("realpassword");
    const { ok } = await verifyPassword("", salt, hash);
    expect(ok).toBe(false);
  });

  test("returns ok=false for an empty stored hash", async () => {
    const { ok } = await verifyPassword("password", "deadbeefdeadbeefdeadbeefdeadbeef", "");
    expect(ok).toBe(false);
  });
});

// ── safeEqual ─────────────────────────────────────────────────────────────

describe("safeEqual", () => {
  test("equal strings return true", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("", "")).toBe(true);
    expect(safeEqual("x", "x")).toBe(true);
  });

  test("unequal strings return false", () => {
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
    expect(safeEqual("abc", "")).toBe(false);
    expect(safeEqual("", "abc")).toBe(false);
  });

  test("handles null/undefined gracefully (coerces to '')", () => {
    expect(safeEqual(null, null)).toBe(true);
    expect(safeEqual(undefined, undefined)).toBe(true);
    expect(safeEqual(null, undefined)).toBe(true);
    expect(safeEqual("abc", null)).toBe(false);
    expect(safeEqual(null, "abc")).toBe(false);
  });
});

// ── isEmail ───────────────────────────────────────────────────────────────

describe("isEmail", () => {
  test("valid emails pass", () => {
    expect(isEmail("user@example.com")).toBe(true);
    expect(isEmail("a+tag@b.co")).toBe(true);
    expect(isEmail("user.name@sub.domain.org")).toBe(true);
  });

  test("invalid emails fail", () => {
    expect(isEmail("notanemail")).toBe(false);
    expect(isEmail("missing@tld")).toBe(false);
    expect(isEmail("@nodomain.com")).toBe(false);
    expect(isEmail("spaces @example.com")).toBe(false);
    expect(isEmail("")).toBe(false);
    expect(isEmail(null)).toBe(false);
    expect(isEmail(undefined)).toBe(false);
    expect(isEmail(42)).toBe(false);
  });
});

// ── slugify ───────────────────────────────────────────────────────────────

describe("slugify", () => {
  test("lowercases and trims whitespace", () => {
    expect(slugify("  Hello World  ")).toBe("hello-world");
  });

  test("replaces non-alphanumeric runs with a single dash", () => {
    expect(slugify("foo!!bar")).toBe("foo-bar");
    expect(slugify("foo   bar")).toBe("foo-bar");
    expect(slugify("foo_bar-baz")).toBe("foo-bar-baz");
  });

  test("strips leading and trailing dashes", () => {
    expect(slugify("-foo-")).toBe("foo");
    expect(slugify("---hello---")).toBe("hello");
  });

  test("truncates to 40 characters", () => {
    const long = "a".repeat(50);
    expect(slugify(long).length).toBeLessThanOrEqual(40);
  });

  test("handles empty / null / undefined", () => {
    expect(slugify("")).toBe("");
    expect(slugify(null)).toBe("");
    expect(slugify(undefined)).toBe("");
  });

  test("strips unicode non-word chars", () => {
    expect(slugify("café latte")).toBe("caf-latte");
  });
});

describe("RESERVED", () => {
  test("reserves every slug the Worker already serves itself", () => {
    // /demo is a virtual board rendered without a DB row, so a signup that took
    // the slug got a public page it could never reach.
    for (const slug of ["demo", "dashboard", "account", "bot", "api", "login"]) {
      expect(RESERVED.has(slug)).toBe(true);
    }
  });
});

// The shell renders an identity from the session user and the browser refreshes
// it from /api/auth/me. Both read the same column, so the loader has to select
// it or every surface falls back to the email (or the "—" placeholder).
describe("session identity", () => {
  const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

  test("the session user loader selects the display name", () => {
    const source = read("../auth.js");
    const loader = source.slice(source.indexOf("const loadUser"), source.indexOf("FROM users WHERE id=$1"));
    expect(loader).toContain("display_name");
  });

  test("/api/auth/me exposes the display name and the client reads that field", () => {
    expect(read("../handlers/auth.js")).toContain("displayName: user.display_name");
    const menu = read("../assets/dashboard/profile-menu.js");
    expect(menu).toContain("user?.displayName");
    expect(menu).toContain('user?.email || "Account"');
    expect(read("../assets/account.js")).not.toContain("state.ME?.display_name");
  });
});

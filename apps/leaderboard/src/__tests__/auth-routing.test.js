// Apex auth routing: guests see marketing / login / signup, a valid server-side
// session is sent to the dashboard, protected pages bounce to /login with a safe
// `next`, and logout destroys the session and lands on /.
//
// Run: bun test src/__tests__/auth-routing.test.js

import { describe, it, expect } from "bun:test";
import { handleRequest } from "../index.js";
import { redirectToLogin } from "../login-redirect.js";
import { safeNextPath } from "@yourrank/shared/safe-next";

const ctx = { waitUntil: () => {} };
const USER = { id: "u-1", email: "owner@example.com", plan: "pro", status: "active" };
const marketing = { fetch: async () => new Response("marketing", { status: 200 }) };
const apiApp = { fetch: async () => { throw new Error("api router must not see this path"); } };

function run(path, { signedIn = false, method = "GET", destroyed = [] } = {}) {
  return handleRequest(
    new Request(`https://yourrank.site${path}`, { method, headers: signedIn ? { cookie: "yr_session=tok" } : {} }),
    { MARKETING: marketing },
    ctx,
    {},
    {
      resolveCustomDomain: async () => null,
      apiApp,
      currentUser: async () => (signedIn ? USER : null),
      destroySession: async (_env, token) => { destroyed.push(token); },
    },
  );
}

describe("root /", () => {
  it("guest gets the marketing homepage", async () => {
    const res = await run("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("marketing");
  });

  it("authenticated session is redirected to /dashboard", async () => {
    const res = await run("/", { signedIn: true });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")).pathname).toBe("/dashboard");
  });
});

describe("/login and /signup", () => {
  it("guest sees the login and signup forms", async () => {
    for (const path of ["/login", "/signup"]) {
      const res = await run(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") || "").toContain("text/html");
    }
  });

  it("authenticated /login goes to /dashboard, or to a validated safe next", async () => {
    const plain = await run("/login", { signedIn: true });
    expect(plain.status).toBe(302);
    expect(new URL(plain.headers.get("location")).pathname).toBe("/dashboard");

    const nested = await run("/login?next=%2Fdashboard%2Fsettings%2Fbilling", { signedIn: true });
    expect(new URL(nested.headers.get("location")).pathname).toBe("/dashboard/settings/billing");

    const external = await run("/login?next=https%3A%2F%2Fevil.example", { signedIn: true });
    const loc = new URL(external.headers.get("location"));
    expect(loc.origin).toBe("https://yourrank.site");
    expect(loc.pathname).toBe("/dashboard");
  });

  it("authenticated /signup goes to /dashboard", async () => {
    const res = await run("/signup", { signedIn: true });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")).pathname).toBe("/dashboard");
  });
});

describe("protected dashboard routes", () => {
  it("guest is sent to /login with the nested path preserved in next", async () => {
    const res = await run("/dashboard/settings/billing");
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location"));
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toBe("/dashboard/settings/billing");
  });

  it("redirectToLogin never forwards an unsafe return path", () => {
    const base = new URL("https://yourrank.site/dashboard");
    for (const bad of ["https://evil.example", "//evil.example", "javascript:alert(1)", "/\\evil.example", "/x\nhttps://evil.example"]) {
      const res = redirectToLogin(base, bad);
      expect(new URL(res.headers.get("location")).searchParams.has("next")).toBe(false);
    }
  });
});

describe("safe return url", () => {
  it("accepts internal paths and falls back to /dashboard for everything else", () => {
    expect(safeNextPath("/dashboard/settings/billing")).toBe("/dashboard/settings/billing");
    expect(safeNextPath("/pricing?plan=team")).toBe("/pricing?plan=team");
    for (const bad of ["https://evil.example", "//evil.example", "javascript:alert(1)", "/\\evil.example", "/ https://evil.example", "dashboard", "", null, 42]) {
      expect(safeNextPath(bad)).toBe("/dashboard");
    }
  });
});

describe("logout", () => {
  it("destroys the session, clears the cookie and lands on /", async () => {
    const destroyed = [];
    const res = await run("/logout?next=%2Fdashboard%2Fsettings", { signedIn: true, method: "POST", destroyed });
    expect(destroyed).toEqual(["tok"]);
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")).pathname).toBe("/");
    expect(res.headers.get("set-cookie") || "").toMatch(/yr_session=;|max-age=0/i);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("a fresh dashboard request without a session is denied after logout", async () => {
    const res = await run("/dashboard");
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")).pathname).toBe("/login");
  });
});

describe("public pages while authenticated", () => {
  it("/pricing, /docs and /faq stay reachable", async () => {
    for (const path of ["/pricing", "/docs", "/faq"]) {
      const res = await run(path, { signedIn: true });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("marketing");
    }
  });
});

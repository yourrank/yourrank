import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { DashboardRequestError } from "../assets/dashboard/request.js";

function installBrowserGlobals() {
  globalThis.location = {
    href: "",
    pathname: "/dashboard",
    search: "",
    origin: "http://localhost",
  };
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, user: { id: "user-1" } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("session auth handling", () => {
  let session;

  beforeEach(async () => {
    installBrowserGlobals();
    session = await import("../assets/dashboard/session.js");
    session.clearSession();
  });

  afterEach(() => {
    session.clearSession();
  });

  it("handleAuthError redirects and clears the cache on AUTH", async () => {
    await session.getMe();
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls++;
      return new Response(JSON.stringify({ ok: true, user: { id: "user-2" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const redirected = session.handleAuthError(new DashboardRequestError("Your session has ended.", { code: "AUTH" }));

    expect(redirected).toBe(true);
    expect(globalThis.location.href).toBe("/login?next=%2Fdashboard");
    await session.getMe();
    expect(fetchCalls).toBe(1);
  });

  it("handleAuthError does not redirect or clear the cache on FORBIDDEN", async () => {
    await session.getMe();
    let fetchCalls = 0;
    globalThis.fetch = async () => {
      fetchCalls++;
      return new Response(JSON.stringify({ ok: true, user: { id: "user-2" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const redirected = session.handleAuthError(new DashboardRequestError("Your account role is not permitted to perform this action.", { code: "FORBIDDEN" }));

    expect(redirected).toBe(false);
    expect(globalThis.location.href).toBe("");
    await session.getMe();
    expect(fetchCalls).toBe(0);
  });
});

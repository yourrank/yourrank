import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  actAndFlush,
  clickReactTarget,
  defaultAdminPayload,
  document,
  installAdminDomGlobals,
  jsonResponse,
  keyReactTarget,
  mountAdminPage,
  restoreAdminDomGlobals,
  setReactValue,
  unmountAdminPage,
} from "./admin-react-utils.js";

function makeFetcher(handler = () => null, calls = []) {
  return async (input, init = {}) => {
    const url = new URL(String(input), "http://localhost");
    const request = {
      url: `${url.pathname}${url.search}`,
      pathname: url.pathname,
      search: url.search,
      method: init.method || "GET",
      credentials: init.credentials,
      headers: init.headers || {},
      body: init.body,
    };
    calls.push(request);
    const response = await handler(request);
    return response || jsonResponse(defaultAdminPayload(url.pathname));
  };
}

async function activateConfirm(label) {
  const dialog = document.querySelector('[role="alertdialog"]');
  expect(dialog).not.toBeNull();
  const button = [...dialog.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === label);
  expect(button).toBeTruthy();
  await clickReactTarget(button);
}

async function activatePrompt(label, value) {
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  const input = dialog.querySelector("input");
  expect(input).toBeTruthy();
  if (value !== undefined) await setReactValue(input, value);
  const button = [...dialog.querySelectorAll("button")].find((candidate) => candidate.textContent.trim() === label);
  expect(button).toBeTruthy();
  await clickReactTarget(button);
}

async function openUserAction(action, row = 1) {
  await clickReactTarget(document.querySelector(`#usersBody tr:nth-child(${row}) [data-act="${action}"]`));
}

beforeEach(() => {
  installAdminDomGlobals();
  globalThis.fetch = makeFetcher();
});

afterEach(async () => {
  await unmountAdminPage();
  document.body.innerHTML = "";
  restoreAdminDomGlobals();
});

describe("Admin React island", () => {
  test("loads me, overview, and every admin resource before showing the panel", async () => {
    const calls = [];
    await mountAdminPage({ fetcher: makeFetcher(() => null, calls) });

    expect(calls[0].url).toBe("/api/auth/me");
    expect(calls[0].credentials).toBe("include");
    expect(calls[1].url).toBe("/api/admin/overview");
    expect(calls.map((call) => call.pathname)).toEqual(expect.arrayContaining([
      "/api/admin/users",
      "/api/admin/leads",
      "/api/admin/payments",
      "/api/admin/support",
      "/api/admin/features",
      "/api/admin/audit",
      "/api/admin/identity",
    ]));
    expect(document.querySelector("#userEmail")?.textContent).toBe("operator@example.com");
    expect(document.querySelector("#panel h1")?.textContent).toBe("Operator panel");
    expect(document.querySelector("#s_users")?.textContent).toBe("2");
    expect(document.querySelector("#usersBody")?.textContent).toContain("ava@example.com");
  });

  test("redirects 401 and 2FA 403 responses and renders the not-admin panel for other 403s", async () => {
    const authPaths = [];
    await mountAdminPage({
      navigate: (path) => authPaths.push(path),
      fetcher: makeFetcher((request) => request.pathname === "/api/auth/me" ? jsonResponse({}, 401) : null),
    });
    expect(authPaths).toEqual(["/login"]);
    expect(document.querySelector("#loading")).not.toBeNull();
    await unmountAdminPage();

    for (const error of ["2fa_required", "2fa_setup_required", "2fa_stale"]) {
      const paths = [];
      await mountAdminPage({
        navigate: (path) => paths.push(path),
        fetcher: makeFetcher((request) => request.pathname === "/api/admin/overview"
          ? jsonResponse({ error }, 403)
          : null),
      });
      expect(paths).toEqual(["/admin"]);
      await unmountAdminPage();
    }

    await mountAdminPage({
      fetcher: makeFetcher((request) => request.pathname === "/api/admin/overview"
        ? jsonResponse({ error: "forbidden" }, 403)
        : null),
    });
    expect(document.querySelector("#panel")?.textContent).toContain("Not an admin account.");
    expect(document.querySelector("#panel a")?.getAttribute("href")).toBe("/dashboard");
  });

  test("applies the exact user search, status, and plan query", async () => {
    const calls = [];
    await mountAdminPage({ fetcher: makeFetcher(() => null, calls) });
    await setReactValue(document.getElementById("usersSearch"), " ava@example.com ");
    await setReactValue(document.getElementById("usersStatusFilter"), "suspended", "change");
    await setReactValue(document.getElementById("usersPlanFilter"), "pro", "change");
    await clickReactTarget(document.getElementById("usersFilterApply"));

    expect(calls.at(-1).url).toBe("/api/admin/users?page=1&q=ava%40example.com&status=suspended&plan=pro");
  });

  test("sends Starter and Pro plan actions with prompted amounts", async () => {
    const calls = [];
    let overviewCount = 0;
    await mountAdminPage({ fetcher: makeFetcher((request) => {
      if (request.pathname === "/api/admin/action") return jsonResponse({ ok: true });
      if (request.pathname === "/api/admin/overview") {
        overviewCount += 1;
        return jsonResponse({ users: 2, paid: overviewCount, leads: 3, revenue: overviewCount * 10 });
      }
      return null;
    }, calls) });

    await openUserAction("starter");
    expect(document.querySelector('[role="dialog"] input').value).toBe("12");
    await activatePrompt("Activate", "15");
    expect(JSON.parse(calls.find((call) => call.pathname === "/api/admin/action").body)).toEqual({
      userId: "user-1",
      action: "starter",
      amountUsd: 15,
    });
    expect(calls.find((call) => call.pathname === "/api/admin/action").credentials).toBe("include");
    expect(document.getElementById("s_pro").textContent).toBe("2");

    await openUserAction("pro");
    const proDialog = document.querySelector('[role="dialog"]');
    expect(proDialog.querySelector("input").value).toBe("29");
    await activatePrompt("Activate", "43");
    expect(JSON.parse(calls.filter((call) => call.pathname === "/api/admin/action")[1].body)).toEqual({
      userId: "user-1",
      action: "pro",
      amountUsd: 43,
    });
    expect(document.getElementById("s_pro").textContent).toBe("3");
    expect(document.getElementById("s_rev").textContent).toBe("$30");
  });

  test("confirms Free and suspension actions and sends the exact request bodies", async () => {
    const calls = [];
    await mountAdminPage({ fetcher: makeFetcher((request) => {
      if (request.pathname === "/api/admin/action") return jsonResponse({ ok: true });
      return null;
    }, calls) });

    await openUserAction("free");
    await activateConfirm("Downgrade");
    await openUserAction("suspend");
    await activateConfirm("Suspend");
    await activatePrompt("Confirm suspend", "Repeated chargebacks");

    const actions = calls.filter((call) => call.pathname === "/api/admin/action");
    expect(JSON.parse(actions[0].body)).toEqual({ userId: "user-1", action: "free" });
    expect(JSON.parse(actions[1].body)).toEqual({ userId: "user-1", action: "suspend", reason: "Repeated chargebacks" });
  });

  test("treats cancelling a suspension reason as cancellation", async () => {
    const calls = [];
    await mountAdminPage({ fetcher: makeFetcher((request) => {
      if (request.pathname === "/api/admin/action") return jsonResponse({ ok: true });
      return null;
    }, calls) });

    await openUserAction("suspend");
    await activateConfirm("Suspend");
    await activatePrompt("Cancel");
    await openUserAction("starter");
    await activatePrompt("Cancel");
    expect(calls.some((call) => call.pathname === "/api/admin/action")).toBe(false);
  });

  test("sends unsuspend and reset-link actions with their exact bodies", async () => {
    const calls = [];
    await mountAdminPage({ fetcher: makeFetcher((request) => {
      if (request.pathname === "/api/admin/action") return jsonResponse({ ok: true, message: "Reset link generated." });
      return null;
    }, calls) });

    await openUserAction("unsuspend", 2);
    await openUserAction("reset-link");
    expect(calls.filter((call) => call.pathname === "/api/admin/action").map((call) => JSON.parse(call.body))).toEqual([
      { userId: "user-2", action: "unsuspend" },
      { userId: "user-1", action: "reset-link" },
    ]);
    expect(document.getElementById("status").textContent).toContain("Reset link generated.");
  });

  test("paginates users and shows the legacy page summary", async () => {
    const calls = [];
    await mountAdminPage({ fetcher: makeFetcher(() => null, calls) });
    const next = [...document.querySelectorAll("#usersPagination button")].find((button) => button.textContent.includes("Next"));
    await clickReactTarget(next);

    expect(calls.at(-1).url).toBe("/api/admin/users?page=2&q=&status=all&plan=all");
    expect(document.getElementById("usersPagination").textContent).toContain("120 users · page 2 of 3");
  });

  test("shows the Users empty state when no users are returned", async () => {
    await mountAdminPage({
      fetcher: makeFetcher((request) => request.pathname === "/api/admin/users"
        ? jsonResponse({ users: [], total: 0, pageSize: 50 })
        : null),
    });
    expect(document.getElementById("usersEmpty").hidden).toBe(false);
    expect(document.getElementById("usersEmpty").textContent).toBe("No users yet.");
  });

  test("announces when required identity details are incomplete", async () => {
    await mountAdminPage({
      fetcher: makeFetcher((request) => request.pathname === "/api/admin/identity"
        ? jsonResponse({ ok: true, identity: { complete: false } })
        : null),
    });
    expect(document.getElementById("identityStatus").hidden).toBe(false);
    expect(document.getElementById("identityStatus").textContent).toBe("Company name and country are required before launch.");
  });

  test("opens and sends a support reply", async () => {
    const calls = [];
    await mountAdminPage({ fetcher: makeFetcher((request) => {
      if (request.pathname === "/api/admin/support/reply") return jsonResponse({ ok: true, emailSent: true });
      return null;
    }, calls) });
    await clickReactTarget(document.getElementById("tab-btn-support"));
    await setReactValue(document.getElementById("supportFilter"), "pending", "change");
    expect(calls.some((call) => call.url === "/api/admin/support?status=pending&page=1")).toBe(true);
    await clickReactTarget([...document.querySelectorAll("#supportBody button")][0]);
    await setReactValue(document.getElementById("replyText"), "Thanks for letting us know.");
    await actAndFlush(() => document.getElementById("replyForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));

    const request = calls.find((call) => call.pathname === "/api/admin/support/reply");
    expect(request.method).toBe("POST");
    expect(JSON.parse(request.body)).toEqual({ id: "support-1", reply: "Thanks for letting us know." });
    expect(document.getElementById("replyStatus").textContent).toBe("Reply sent by email.");
  });

  test("posts a feature override and preserves Cancel as the disable action", async () => {
    const calls = [];
    await mountAdminPage({ fetcher: makeFetcher((request) => {
      if (request.pathname === "/api/admin/features/override") return jsonResponse({ ok: true });
      return null;
    }, calls) });
    await clickReactTarget(document.getElementById("tab-btn-features"));
    await setReactValue(document.querySelector('[data-feature-override-user="new_dashboard"]'), "user-1");
    await clickReactTarget(document.querySelector('[data-feature-override="new_dashboard"]'));
    await activateConfirm("Cancel");

    const request = calls.find((call) => call.pathname === "/api/admin/features/override");
    expect(request.method).toBe("POST");
    expect(JSON.parse(request.body)).toEqual({ userId: "user-1", featureKey: "new_dashboard", enabled: false });
    expect(document.getElementById("status").textContent).toContain("Override disabled for user-1.");
  });

  test("saves the identity form and shows the server confirmation", async () => {
    const calls = [];
    await mountAdminPage({ fetcher: makeFetcher((request) => {
      if (request.pathname === "/api/admin/identity" && request.method === "PUT") {
        return jsonResponse({ ok: true, identity: { complete: true } });
      }
      return null;
    }, calls) });
    await clickReactTarget(document.getElementById("tab-btn-identity"));
    await setReactValue(document.getElementById("i_company_name"), "  Example Ltd  ");
    await setReactValue(document.getElementById("i_company_country"), "  UK ");
    await setReactValue(document.getElementById("i_company_number"), " 12345 ");
    await setReactValue(document.getElementById("i_support_email"), "legal@example.com");
    await setReactValue(document.getElementById("i_affiliate_disclosure"), " Links may be affiliate links. ");
    await actAndFlush(() => document.getElementById("identityForm").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));

    const request = calls.find((call) => call.pathname === "/api/admin/identity" && call.method === "PUT");
    expect(JSON.parse(request.body)).toEqual({
      company_name: "Example Ltd",
      company_country: "UK",
      company_number: "12345",
      support_email: "legal@example.com",
      affiliate_disclosure: "Links may be affiliate links.",
    });
    expect(document.getElementById("identityStatus").textContent).toContain("Saved. Legal pages and footers now use these details.");
  });

  test("supports Arrow, Home, and End keyboard navigation in the tablist", async () => {
    await mountAdminPage();
    const list = document.querySelector('[role="tablist"]');
    await keyReactTarget(list, "ArrowRight");
    expect(document.getElementById("tab-btn-leads").getAttribute("aria-selected")).toBe("true");
    await keyReactTarget(list, "ArrowLeft");
    expect(document.getElementById("tab-btn-users").getAttribute("aria-selected")).toBe("true");
    await keyReactTarget(list, "End");
    expect(document.getElementById("tab-btn-identity").getAttribute("aria-selected")).toBe("true");
    await keyReactTarget(list, "Home");
    expect(document.getElementById("tab-btn-users").getAttribute("aria-selected")).toBe("true");
  });

  test("keeps the logout endpoint, credentials, CSRF header, and redirect", async () => {
    const calls = [];
    const paths = [];
    await mountAdminPage({
      navigate: (path) => paths.push(path),
      fetcher: makeFetcher((request) => {
        if (request.pathname === "/api/auth/logout") return jsonResponse({ ok: true });
        return null;
      }, calls),
    });
    await clickReactTarget(document.getElementById("logout"));
    const request = calls.find((call) => call.pathname === "/api/auth/logout");
    expect(request.method).toBe("POST");
    expect(request.headers["x-csrf-token"]).toBe("csrf-test-token");
    expect(paths).toEqual(["/login"]);
  });
});

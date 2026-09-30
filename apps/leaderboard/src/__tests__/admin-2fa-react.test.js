import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  clickReactTarget,
  document,
  installAdminDomGlobals,
  jsonResponse,
  keyReactTarget,
  mountAdminTwoFactorPage,
  restoreAdminDomGlobals,
  setReactValue,
  unmountAdminPage,
  window,
} from "./admin-react-utils.js";

function makeFetcher(handler = () => null, calls = []) {
  return async (input, init = {}) => {
    const url = new URL(String(input), "http://localhost");
    const request = {
      url: `${url.pathname}${url.search}`,
      pathname: url.pathname,
      method: init.method || "GET",
      credentials: init.credentials,
      headers: init.headers || {},
      body: init.body,
    };
    calls.push(request);
    const response = await handler(request);
    if (response) return response;
    if (url.pathname === "/api/admin/2fa/status") return jsonResponse({ ok: true, enabled: true, verified: false });
    if (url.pathname === "/api/admin/2fa/enable") return jsonResponse({ ok: true, uri: "otpauth://totp/YourRank", secret: "JBSWY3DPEHPK3PXP" });
    if (url.pathname === "/api/admin/2fa/verify") return jsonResponse({ ok: true, verified: true });
    if (url.pathname === "/api/admin/2fa/recovery") return jsonResponse({ ok: true, verified: true });
    return jsonResponse({ ok: true });
  };
}

beforeEach(() => {
  installAdminDomGlobals();
  globalThis.fetch = makeFetcher();
  window.QRCode = { toDataURL: (uri, size) => `data:image/png;base64,${uri.length}-${size}` };
});

afterEach(async () => {
  await unmountAdminPage();
  document.body.innerHTML = "";
  delete window.QRCode;
  restoreAdminDomGlobals();
});

describe("Admin 2FA React island", () => {
  test("loads the verification view and focuses the six-digit code input", async () => {
    const calls = [];
    await mountAdminTwoFactorPage({ fetcher: makeFetcher(() => null, calls) });
    expect(calls[0].url).toBe("/api/admin/2fa/status");
    expect(document.getElementById("tfaVerify").hidden).toBe(false);
    expect(document.getElementById("tfaLoading").hidden).toBe(true);
    expect(document.activeElement.id).toBe("tfaCode");
    expect(document.getElementById("tfaCode").getAttribute("inputmode")).toBe("numeric");
  });

  test("submits a six-digit verify code on Enter with credentials and CSRF", async () => {
    const calls = [];
    const paths = [];
    await mountAdminTwoFactorPage({
      navigate: (path) => paths.push(path),
      fetcher: makeFetcher(() => null, calls),
    });
    const input = document.getElementById("tfaCode");
    await setReactValue(input, "a1234567");
    expect(input.value).toBe("123456");
    await keyReactTarget(input, "Enter");

    const request = calls.find((call) => call.pathname === "/api/admin/2fa/verify");
    expect(request.method).toBe("POST");
    expect(request.credentials).toBe("include");
    expect(JSON.parse(request.body)).toEqual({ code: "123456" });
    expect(request.headers["content-type"]).toBe("application/json");
    expect(request.headers["x-csrf-token"]).toBe("csrf-test-token");
    expect(paths).toEqual(["/admin"]);
  });

  test("shows the server's verification error in an alert region", async () => {
    await mountAdminTwoFactorPage({
      fetcher: makeFetcher((request) => request.pathname === "/api/admin/2fa/verify"
        ? jsonResponse({ ok: false, error: "Invalid verification code." }, 400)
        : null),
    });
    await setReactValue(document.getElementById("tfaCode"), "123456");
    await clickReactTarget(document.getElementById("tfaSubmit"));
    expect(document.getElementById("tfaErr").getAttribute("role")).toBe("alert");
    expect(document.getElementById("tfaErr").textContent).toBe("Invalid verification code.");
  });

  test("switches to recovery, validates the code, and submits its unmodified value", async () => {
    const calls = [];
    const paths = [];
    await mountAdminTwoFactorPage({
      navigate: (path) => paths.push(path),
      fetcher: makeFetcher(() => null, calls),
    });
    await clickReactTarget(document.getElementById("tfaUseRecovery"));
    expect(document.getElementById("tfaRecovery").hidden).toBe(false);
    expect(document.activeElement.id).toBe("tfaRecoveryCode");
    await setReactValue(document.getElementById("tfaRecoveryCode"), "bad");
    await clickReactTarget(document.getElementById("tfaRecoverySubmit"));
    expect(document.getElementById("tfaRecoveryErr").textContent).toBe("Enter a 16-character recovery code.");
    expect(calls.some((call) => call.pathname === "/api/admin/2fa/recovery")).toBe(false);

    await setReactValue(document.getElementById("tfaRecoveryCode"), "ABCD-EF01-2345-6789");
    await keyReactTarget(document.getElementById("tfaRecoveryCode"), "Enter");
    const request = calls.find((call) => call.pathname === "/api/admin/2fa/recovery");
    expect(request.method).toBe("POST");
    expect(JSON.parse(request.body)).toEqual({ code: "ABCD-EF01-2345-6789" });
    expect(paths).toEqual(["/admin"]);
  });

  test("returns from recovery to six-digit verification", async () => {
    await mountAdminTwoFactorPage();
    await clickReactTarget(document.getElementById("tfaUseRecovery"));
    await clickReactTarget(document.getElementById("tfaBackToCode"));
    expect(document.getElementById("tfaVerify").hidden).toBe(false);
    expect(document.activeElement.id).toBe("tfaCode");
  });

  test("starts setup, renders the QR and secret, and shows returned recovery codes", async () => {
    const calls = [];
    const paths = [];
    await mountAdminTwoFactorPage({
      navigate: (path) => paths.push(path),
      fetcher: makeFetcher((request) => {
        if (request.pathname === "/api/admin/2fa/status") return jsonResponse({ ok: true, enabled: false });
        if (request.pathname === "/api/admin/2fa/verify") {
          return jsonResponse({ ok: true, verified: true, recoveryCodes: ["AAAA-BBBB-CCCC-DDDD", "1111-2222-3333-4444"] });
        }
        return null;
      }, calls),
    });

    expect(calls.map((call) => call.url)).toEqual(["/api/admin/2fa/status", "/api/admin/2fa/enable"]);
    expect(document.getElementById("tfaSetup").hidden).toBe(false);
    expect(document.activeElement.id).toBe("tfaSetupCode");
    expect(document.getElementById("tfaQr").getAttribute("src")).toBe("data:image/png;base64,23-200");
    expect(document.getElementById("tfaSecret").textContent).toBe("JBSWY3DPEHPK3PXP");

    await setReactValue(document.getElementById("tfaSetupCode"), "654321");
    await clickReactTarget(document.getElementById("tfaSetupSubmit"));
    expect(JSON.parse(calls.find((call) => call.pathname === "/api/admin/2fa/verify").body)).toEqual({ code: "654321" });
    expect(document.getElementById("tfaSuccess").hidden).toBe(false);
    expect(document.getElementById("tfaRecoveryList").textContent).toBe("AAAA-BBBB-CCCC-DDDD1111-2222-3333-4444");

    await clickReactTarget(document.getElementById("tfaDone"));
    expect(paths).toEqual(["/admin"]);
  });

  test("shows setup failures and validation errors", async () => {
    await mountAdminTwoFactorPage({
      fetcher: makeFetcher((request) => {
        if (request.pathname === "/api/admin/2fa/status") return jsonResponse({ ok: true, enabled: false });
        if (request.pathname === "/api/admin/2fa/enable") return jsonResponse({ ok: false, error: "Enrollment unavailable." }, 400);
        return null;
      }),
    });
    expect(document.getElementById("tfaSetupErr").textContent).toBe("Enrollment unavailable.");
    await setReactValue(document.getElementById("tfaSetupCode"), "123");
    await clickReactTarget(document.getElementById("tfaSetupSubmit"));
    expect(document.getElementById("tfaSetupErr").textContent).toBe("Enter a 6-digit code.");
  });

  test("keeps locked verification disabled and announces the lock error", async () => {
    await mountAdminTwoFactorPage({
      fetcher: makeFetcher((request) => request.pathname === "/api/admin/2fa/status"
        ? jsonResponse({ ok: true, enabled: true, locked: true })
        : null),
    });
    expect(document.getElementById("tfaCode").disabled).toBe(true);
    expect(document.getElementById("tfaSubmit").disabled).toBe(true);
    expect(document.getElementById("tfaErr").textContent).toBe("2FA is temporarily locked due to too many failed attempts. Try again later.");
  });

  test("redirects expired sessions to login and already-verified sessions to admin", async () => {
    const loginPaths = [];
    await mountAdminTwoFactorPage({
      navigate: (path) => loginPaths.push(path),
      fetcher: makeFetcher((request) => request.pathname === "/api/admin/2fa/status" ? jsonResponse({}, 401) : null),
    });
    expect(loginPaths).toEqual(["/login"]);
    await unmountAdminPage();

    const adminPaths = [];
    await mountAdminTwoFactorPage({
      navigate: (path) => adminPaths.push(path),
      fetcher: makeFetcher((request) => request.pathname === "/api/admin/2fa/status"
        ? jsonResponse({ ok: true, enabled: true, verified: true })
        : null),
    });
    expect(adminPaths).toEqual(["/admin"]);
  });

  test("logs out with the CSRF header before redirecting", async () => {
    const calls = [];
    const paths = [];
    await mountAdminTwoFactorPage({
      navigate: (path) => paths.push(path),
      fetcher: makeFetcher(() => null, calls),
    });
    await clickReactTarget(document.getElementById("logout"));
    const request = calls.find((call) => call.pathname === "/api/auth/logout");
    expect(request.method).toBe("POST");
    expect(request.headers["x-csrf-token"]).toBe("csrf-test-token");
    expect(paths).toEqual(["/login"]);
  });
});

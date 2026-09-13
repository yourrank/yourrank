// Regression tests for the "Viewer preview" failure handling.
//
// Bug history: the preview renders the real public site into an iframe through
// a form POST to /dashboard/preview. Four responses never carry the
// `yr-preview-ready` meta — 400 "board required", 404 "not found", a 302 login
// redirect, and a 500 error page — so the `load` handler ignored the finished
// document and the 8s watchdog eventually painted "Preview could not load."
// with no explanation and no log. The client cannot read the response status
// (it is a form navigation), so the cause has to be diagnosed from the loaded
// document. These tests pin that diagnosis.
//
// Run: bun test src/__tests__/preview-failure.test.js

import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { parseHTML } from "linkedom";

const siteJs = readFileSync(new URL("../assets/dashboard/site.js", import.meta.url), "utf8");
const dashboardJsx = readFileSync(new URL("../pages/dashboard.jsx", import.meta.url), "utf8");

// The preview diagnosis lives in a browser module; import it through the same
// minimal globals the other dashboard suites use.
globalThis.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  addEventListener: () => {},
  body: { innerHTML: "" },
  head: { appendChild: () => {} },
  createElement: () => ({ style: {}, setAttribute: () => {}, addEventListener: () => {}, appendChild: () => {} }),
};
globalThis.window = { addEventListener: () => {}, removeEventListener: () => {}, matchMedia: () => ({ matches: false }), location: null };
globalThis.navigator = {};
globalThis.location = { href: "http://localhost/dashboard/leaderboard/design", origin: "http://localhost", host: "localhost", pathname: "/dashboard/leaderboard/design", search: "" };
globalThis.history = { pushState() {}, replaceState() {}, state: null };
globalThis.requestAnimationFrame = (callback) => callback();
globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });

const { diagnosePreviewDocument } = await import("../assets/dashboard/site.js");

/** A stand-in for an iframe whose document is `html`. */
function frameWith(html) {
  const { document: doc } = parseHTML(`<!doctype html><html>${html}</html>`);
  return { contentDocument: doc };
}

describe("preview failure diagnosis", () => {
  it("accepts a document that carries the ready meta", () => {
    const verdict = diagnosePreviewDocument(
      frameWith('<head><meta name="yr-preview-ready" content="true"></head><body>ok</body>'),
    );
    expect(verdict.ok).toBe(true);
  });

  it("names the 400 board-required response as a board problem", () => {
    const verdict = diagnosePreviewDocument(frameWith("<body>board required</body>"));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("board");
    expect(verdict.detail.status).toBe(400);
  });

  it("names the 404 not-found response as a board problem", () => {
    const verdict = diagnosePreviewDocument(frameWith("<body>not found</body>"));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("board");
    expect(verdict.detail.status).toBe(404);
  });

  it("recognises a login document as an expired session", () => {
    const byTitle = diagnosePreviewDocument(frameWith("<head><title>Sign in</title></head><body>x</body>"));
    expect(byTitle.reason).toBe("session");
    const byForm = diagnosePreviewDocument(
      frameWith('<head><title>YourRank</title></head><body><form action="/login"><input name="password"></form></body>'),
    );
    expect(byForm.reason).toBe("session");
  });

  it("treats an unreadable document as an expired session", () => {
    // A cross-origin navigation (a login redirect) throws on contentDocument.
    const verdict = diagnosePreviewDocument({
      get contentDocument() {
        throw new Error("Blocked a frame with origin");
      },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("session");
    expect(verdict.detail.diagnosis).toBe("cross-origin-redirect");
  });

  it("falls back to a server problem for any other document missing the meta", () => {
    const verdict = diagnosePreviewDocument(
      frameWith("<head><title>Something went wrong</title></head><body>Internal error</body>"),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("server");
    // The captured detail must be enough to debug the cause from the log.
    expect(verdict.detail.title).toBe("Something went wrong");
    expect(verdict.detail.bodyPrefix).toBe("Internal error");
  });

  it("never reports success for a document it cannot confirm", () => {
    for (const html of ["<body>board required</body>", "<body>not found</body>", "<body></body>", ""]) {
      expect(diagnosePreviewDocument(frameWith(html)).ok).toBe(false);
    }
  });
});

describe("preview failure wiring", () => {
  it("routes every failure through one reporter that logs the cause", () => {
    expect(siteJs).toContain("function failPreview(mount, reason, detail = {})");
    const start = siteJs.indexOf("function failPreview(");
    const body = siteJs.slice(start, siteJs.indexOf("\n}", start));
    // The diagnosis must reach the log, not just the screen.
    expect(body).toContain("logError(`preview-${reason}`");
    expect(body).toContain("setPreviewSyncStatus(mount, \"error\")");
  });

  it("writes the reason into the fallback message element", () => {
    expect(siteJs).toContain("PREVIEW_FAILURE_COPY");
    expect(siteJs).toContain('error.querySelector("[data-preview-error-message]")');
    // Both preview mounts expose that element.
    expect(dashboardJsx).toContain('data-preview-error-message');
  });

  it("diagnoses the loaded document instead of waiting for the watchdog", () => {
    const start = siteJs.indexOf('fresh.addEventListener("load"');
    const body = siteJs.slice(start, siteJs.indexOf("current.replaceWith(fresh)", start));
    expect(body).toContain("diagnosePreviewDocument(fresh)");
    expect(body).toContain("failPreview(mount, verdict.reason, verdict.detail)");
  });

  it("keeps the watchdog for a frame that never settles", () => {
    expect(siteJs).toContain('failPreview(mount, "timeout", { afterMs: PREVIEW_TIMEOUT_MS })');
  });

  it("says so when there is no active site instead of stalling on 'syncing'", () => {
    expect(siteJs).toContain('failPreview(mount, "board", { diagnosis: "no-active-site" })');
  });

  it("clears the previous reason when Retry is pressed", () => {
    const start = siteJs.indexOf("function wirePreviewMount(");
    const body = siteJs.slice(start, siteJs.indexOf("\n}", start));
    expect(body).toContain("[data-preview-retry]");
    expect(body).toContain("Retrying the preview…");
  });

  it("keeps a visible Retry affordance on both preview mounts", () => {
    const retries = dashboardJsx.match(/data-preview-retry/g) || [];
    expect(retries.length).toBeGreaterThanOrEqual(2);
  });
});

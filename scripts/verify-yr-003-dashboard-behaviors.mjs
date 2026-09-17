// Browser behavior checks against the canonical authenticated dashboard document.
// The in-process server replaces only auth/persistence dependencies; it serves the
// real dashboard JSX, bundled assets, and dialog implementation without staging.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { DashboardContent, dashboardConfig } from "../apps/leaderboard/src/pages/dashboard.jsx";
import { handleDashboardPreview } from "../apps/leaderboard/src/handlers/preview.js";
import { ASSETS } from "../apps/leaderboard/src/assets_bundled.js";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href
  : "playwright");

const fixtureUser = {
  id: "fixture-owner",
  email: "fixture-owner@example.test",
  display_name: "Fixture owner",
  plan: "pro",
  emailVerified: true,
  isAdmin: false,
};
const fixtureSite = {
  ok: true,
  slug: "fixture-site",
  siteId: "fixture-site-id",
  updatedAt: "2026-09-17T00:00:00.000Z",
  publishedAt: null,
  published: false,
  isDraft: true,
  boards: [],
  archives: [],
  onboarding: {},
  data: {
    brand: { name: "Fixture site", tagline: "Fixture community" },
    branding: { template: "cyber_arcade", font: "Inter" },
    rankBy: "score",
    players: [],
    siteSections: { home: true, leaderboard: true, shop: true, me: true, countdown: true },
    playerFields: {},
    sections: { countdown: true },
  },
};

function dashboardDocument(activePath) {
  const content = DashboardContent({ user: fixtureUser, activePath }).toString();
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="csrf-token" content="fixture-csrf">${dashboardConfig.styles.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}</head><body>${content}${dashboardConfig.scripts.join("")}</body></html>`;
}

let origin;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, origin);
  if (url.pathname.startsWith("/assets/") && ASSETS[url.pathname]) {
    const [body] = ASSETS[url.pathname];
    res.setHeader("content-type", url.pathname.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8");
    res.end(body);
    return;
  }
  if (url.pathname === "/api/auth/me") return json(res, { ok: true, user: fixtureUser });
  if (url.pathname === "/api/site") return json(res, fixtureSite);
  if (url.pathname === "/api/credits/status") return json(res, { enabled: false, channel: null, usage: { rewardMappings: 0 } });
  if (url.pathname === "/api/site/events") return json(res, { ok: true, events: [] });
  if (url.pathname === "/api/overview/live") return json(res, { ok: true, activity: [], players: [] });
  if (url.pathname === "/dashboard/preview") {
    const response = await handleDashboardPreview(new Request(`${origin}${url.pathname}${url.search}`), {}, "fixture-nonce", {
      currentUserImpl: async () => fixtureUser,
      getUserSiteByIdImpl: async () => ({ id: fixtureSite.siteId, slug: fixtureSite.slug, data: fixtureSite.data }),
    });
    return html(res, await response.text());
  }
  if (url.pathname.startsWith("/dashboard")) return html(res, dashboardDocument(url.pathname));
  return json(res, { ok: true, items: [], data: {}, usage: {}, billing: {} });
});
function json(res, body) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(body)); }
function html(res, body) { res.setHeader("content-type", "text/html; charset=utf-8"); res.end(body); }

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.error("dashboard pageerror:", error.message); });
  page.on("console", (message) => { if (message.type() === "error") { errors.push(message.text()); console.error("dashboard console:", message.text()); } });
  page.on("requestfailed", (request) => console.error("dashboard request failed:", request.url(), request.failure()?.errorText));

  await page.goto(`${origin}/dashboard/site`);
  await page.locator("#dash:not([hidden])").waitFor();

  // An authenticated editor draft invokes the real navigation guard. The real
  // dialog opens, exposes its warning, gives Save initial focus, then discards
  // and reloads the requested route through the actual discard branch.
  const siteName = page.locator("#f_name");
  await siteName.fill("Changed fixture site");
  await page.waitForFunction(() => !document.getElementById("savebar").hidden);
  await page.evaluate(async () => {
    const shell = await import("/assets/dashboard/shell.js");
    void shell.requestDashboardRoute("home", "", { query: "?board=fixture-site-id" });
  });
  const dialog = page.locator(".modal");
  await dialog.waitFor();
  assert.match(await dialog.innerText(), /You have unsaved changes\. Save them before leaving, discard them, or cancel navigation\?/);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), "Save");
  await dialog.locator(".dirty-discard").click();
  await page.waitForURL(/\/dashboard(?:\?.*)?$/);
  await page.locator("#dash:not([hidden])").waitFor();
  assert.equal(await page.locator("#f_name").inputValue(), "Fixture site");

  // Save validation is real collection/validation plus real focus movement in
  // the canonical dashboard. The missing name is marked invalid and receives
  // focus instead of issuing a persistence request.
  await page.goto(`${origin}/dashboard/leaderboard/setup`);
  await page.locator("#dash:not([hidden])").waitFor();
  await page.locator("#f_ends").fill("2000-01-01T00:00");
  await page.locator("#save").click();
  await page.waitForFunction(() => document.activeElement === document.getElementById("f_ends"));
  assert.equal(await page.locator("#f_ends").getAttribute("aria-invalid"), "true");
  assert.match(await page.locator("#f_ends_error").innerText(), /Choose a date within 10 years of today\./);

  // The actual dashboard route makes a reduced-motion decision at runtime for
  // in-page navigation. Browser media emulation proves it selects "auto", not
  // smooth scrolling, without relying on a source-text assertion.
  await page.goto(`${origin}/dashboard/leaderboard/setup`);
  await page.locator("#dash:not([hidden])").waitFor();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    const target = document.getElementById("f_ends");
    const calls = [];
    target.scrollIntoView = (options) => calls.push(options);
    window.__yr003ScrollCalls = calls;
  });
  await page.evaluate(async () => {
    const shell = await import("/assets/dashboard/shell.js");
    shell.scrollToHash("f_ends");
  });
  assert.deepEqual(await page.evaluate(() => window.__yr003ScrollCalls), [{ block: "start", behavior: "auto" }]);

  assert.deepEqual(errors, []);
  console.log("PASSED: canonical authenticated dashboard fixture exercised dirty-draft discard warning/reload, invalid-save focus recovery, and reduced-motion scrolling without staging.");
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}

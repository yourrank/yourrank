// Screenshot the creator sign-in page (email-code + password methods) at
// desktop and mobile widths. Renders the real PAGES.login HTML, serves
// /assets from apps/leaderboard/src/assets, and stubs the auth APIs so the
// two-step code flow can be exercised without a backend.
// Usage: bun scripts/screenshot-email-code-login.mjs
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".local-logs", "email-code-login");
const ASSETS_DIR = join(ROOT, "apps", "leaderboard", "src", "assets");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href);

const { PAGES } = await import(pathToFileURL(join(ROOT, "apps", "leaderboard", "src", "pages.jsx")).href);
// auth.js imports "@yourrank/shared/community-handle" for the signup-mode
// handle preview; stub it so the raw asset can run without the bundler.
const AUTH_JS = readFileSync(join(ASSETS_DIR, "auth.js"), "utf8").replace(
  /^import \{ COMMUNITY_HANDLE_HOST, normalizeCommunityHandle \}[^\n]*$/m,
  'const COMMUNITY_HANDLE_HOST = "yourrank.site"; const normalizeCommunityHandle = () => ({ handle: "", ok: true });'
);
const LOGIN_HTML = PAGES.login.Component().toString();

const MIME = { ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

async function shoot(name, width, actions) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  // Playwright matches the most recently registered route first — the
  // catch-all must come first so /assets and /api still reach their handlers.
  await page.route("**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/login") return route.fulfill({ contentType: "text/html", body: LOGIN_HTML });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.route("**/api/auth/**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, message: "ok" }) }));
  await page.route("**/assets/**", (route) => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname.split("?")[0]);
    if (pathname === "/assets/auth.js") return route.fulfill({ body: AUTH_JS, contentType: "text/javascript" });
    const p = join(ASSETS_DIR, pathname.replace(/^\/assets\//, ""));
    if (existsSync(p)) return route.fulfill({ body: readFileSync(p), contentType: MIME[extname(p)] || "application/octet-stream" });
    return route.fulfill({ status: 404, body: "" });
  });
  await page.goto("http://local.test/login");
  if (actions) await actions(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, `${name}-${width}.png`), fullPage: false });
  console.log(`${name}-${width}.png`);
  await page.close();
}

for (const w of [1440, 390]) {
  await shoot("code-step1", w, null);
  await shoot("code-step2", w, async (page) => {
    await page.fill("#codeEmail", "creator@example.com");
    await page.click("#codeSubmit");
    await page.waitForSelector("#codeStep2:not([hidden])");
    await page.fill("#code", "4 8 2 9 1 3".replace(/ /g, ""));
  });
  await shoot("password", w, async (page) => { await page.click("#methodPassword"); });
}
await browser.close();
console.log(`done → ${OUT}`);

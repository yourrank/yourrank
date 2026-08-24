// Wave 2 PR-5 regression gate: ONE dashboard client navigation entry point.
//
// requestDashboardRoute in assets/dashboard/shell.js is the only module
// allowed to mutate history or perform dashboard location navigation. Every
// other dashboard client module requests a destination through it. This gate
// fails when a second navigation path appears: direct history mutation, a
// dashboard location change, or a revival of the deleted yr-nav event bridge.
//
// Exceptions are narrow, documented per occurrence below, and the list must
// only shrink. An exception that no longer matches the source fails the gate
// so stale entries cannot linger.
import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

const assetsUrl = (rel) => new URL(`../assets/${rel}`, import.meta.url);

// The approved navigation owner. Its own history/location use is the point.
const NAVIGATION_OWNER = "dashboard/shell.js";

// Dashboard client modules covered by the gate: the persistent-shell modules
// plus the standalone dashboard document entry modules that share them.
// Public/viewer/auth/admin surfaces (auth.js, viewer-dashboard.js, admin*.js,
// shell-nav.js, invite.js) are separate non-dashboard surfaces.
const ENTRY_MODULES = ["dashboard.js", "account.js", "credits.js", "giveaways.js", "tournaments.js"];

const BANNED = [
  { name: "history.pushState", re: /history\.pushState\s*\(/g },
  { name: "history.replaceState", re: /history\.replaceState\s*\(/g },
  { name: "location.href assignment", re: /location\.href\s*=/g },
  { name: "location.assign", re: /(?:^|[^\w$])location\.assign\s*\(/g },
  { name: "location.replace", re: /(?:^|[^\w$])location\.replace\s*\(/g },
  { name: "yr-nav event", re: /["']yr-nav["']/g },
];

// file -> substring of the offending line -> reason the exception is genuine.
// Session/auth redirects leave the dashboard because the session is gone;
// post-deletion resets leave a destroyed context; checkout/verify are
// off-dashboard destinations; the Games iframe never navigates this document.
const EXCEPTIONS = {
  "dashboard.js": [
    { match: "location.href = loginRedirectPath(location); }", reason: "cross-tab logout: session gone, leave the dashboard" },
    { match: "location.href = loginRedirectPath(location);", reason: "boot without a session: redirect to login" },
    { match: "location.href = planParam.toLowerCase()", reason: "legacy checkout deep link handled once at boot, before the shell exists" },
    { match: 'location.href = "/admin"; return;', reason: "admin accounts without a dashboard: off-dashboard destination" },
  ],
  "account.js": [
    { match: 'location.href = "/login"; return;', reason: "no session on a standalone settings document: redirect to login" },
  ],
  "credits.js": [
    { match: "location.href = loginRedirectPath(location);", reason: "cross-tab logout on a standalone document: session gone" },
    { match: 'if (error?.code === "AUTH") location.href = loginRedirectPath(location);', reason: "session expired mid-request: redirect to login" },
    { match: "history.replaceState({}, \"\", `${clean.pathname}${clean.search}${clean.hash}`);", reason: "one-shot OAuth feedback param scrub: same document, no navigation" },
  ],
  "giveaways.js": [
    { match: "location.href = loginRedirectPath(location);", reason: "cross-tab logout on a standalone document: session gone" },
  ],
  "dashboard/account.js": [
    { match: "location.href = loginRedirectPath(location);", reason: "session expired: redirect to login" },
    { match: 'location.href = "/dashboard";', reason: "post-board-deletion reset: the current context no longer exists" },
  ],
  "dashboard/account-delete-modal.js": [
    { match: 'location.href = "/";', reason: "post-account-deletion: the session and dashboard no longer exist" },
  ],
  "dashboard/utils.js": [
    { match: "location.href = loginRedirectPath();", reason: "401 on a dashboard API call: session gone, redirect to login" },
  ],
  "dashboard/referrals.js": [
    { match: "location.href = loginRedirectPath(); return;", reason: "401 loading referrals: session gone, redirect to login" },
  ],
  "dashboard/session.js": [
    { match: "location.href = loginRedirectPath(location);", reason: "auth failure: redirect to login" },
  ],
  "dashboard/dynamic-section.js": [
    { match: "location.href = loginRedirectPath(location);", reason: "fragment fetch hit an expired session: redirect to login" },
  ],
  "dashboard/site.js": [
    { match: "location.href = d.url; return;", reason: "checkout: external payment provider URL" },
    { match: 'location.href = "/verify-email")', reason: "publish blocked on unverified email: off-dashboard verification flow" },
  ],
  "dashboard/games.js": [
    { match: "frameWindow.location.replace(url);", reason: "Games iframe internal src swap: never navigates this document" },
  ],
};

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

function gateFiles() {
  const files = readdirSync(new URL("../assets/dashboard/", import.meta.url))
    .filter((f) => f.endsWith(".js"))
    .map((f) => `dashboard/${f}`);
  return [...files, ...ENTRY_MODULES];
}

describe("dashboard client navigation gate (PR-5)", () => {
  it("keeps requestDashboardRoute as the only dashboard navigation path", () => {
    const violations = [];
    for (const file of gateFiles()) {
      if (file === NAVIGATION_OWNER) continue;
      const source = stripComments(readFileSync(assetsUrl(file), "utf8"));
      const lines = source.split("\n");
      const allowed = EXCEPTIONS[file] ?? [];
      for (const { name, re } of BANNED) {
        for (const [index, line] of lines.entries()) {
          re.lastIndex = 0;
          if (!re.test(line)) continue;
          if (allowed.some(({ match }) => line.includes(match))) continue;
          violations.push(`${file}:${index + 1} uses ${name}: ${line.trim()}`);
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("keeps every documented exception attached to real source", () => {
    // Stale exceptions must be deleted, not accumulated: when the code an
    // exception covers goes away, this list shrinks with it.
    for (const [file, entries] of Object.entries(EXCEPTIONS)) {
      const source = stripComments(readFileSync(assetsUrl(file), "utf8"));
      for (const { match } of entries) {
        expect(source, `${file} exception "${match}" no longer matches`).toContain(match);
      }
    }
  });

  it("keeps the deleted yr-nav bridge out of the navigation owner too", () => {
    const source = stripComments(readFileSync(assetsUrl(NAVIGATION_OWNER), "utf8"));
    expect(source).not.toContain("yr-nav");
  });

  it("exposes the entry point and renderer registry from the owner", () => {
    const source = readFileSync(assetsUrl(NAVIGATION_OWNER), "utf8");
    expect(source).toContain("export async function requestDashboardRoute");
    expect(source).toContain("export function registerRouteRenderer");
  });
});

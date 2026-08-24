import { destroySession, cookieClear, readToken, RESERVED, currentUser, hasLegacyCookie, cookieClearLegacy, rateLimit, rateLimitHeaders, clientIp } from "./auth.js";
import { sendErrorToDiscord } from "@yourrank/shared/monitoring";
import { withWorkerFetch } from "@yourrank/shared/with-worker";
import { RateLimiter } from "@yourrank/shared/rate-limiter-do";
import { LiveBoard } from "./live-board.js";
import { populateEnv } from "@yourrank/shared/env";
import { getPublicSite, getBySlug, getClickRedirectSite, getArchiveSnapshots, ARCHIVE_LIMITS, PUBLIC_ARCHIVE_LIMIT } from "./site.js";
import { fromJsonb } from "@yourrank/shared/jsonb";
import { parseSitePath, renderSiteRoute } from "./site-routes.js";
import { renderSite } from "@yourrank/shared/site-render";
import { viewerDashboardPage } from "./pages/viewer-dashboard.js";
import { verifyEmailPageHtml } from "./pages/verify-email.js";
import { verifyEmailToken } from "./handlers/auth.js";
import { verifyBoardPassword, issueBoardPasswordToken, boardPasswordSetCookieHeader } from "./board-password.js";
import { PAGES } from "./pages.jsx";
import { DEVIN_DESIGN_CONTRACT, leaderboardPageHtml } from "@yourrank/shared/page-shell";
import { bumpStat } from "./stats.js";
import { runAutoReset } from "./auto-reset.js";
import { createQueueProducer } from "@yourrank/shared/queue-producer";
import { shellNavHtml, publicNavHtml } from "@yourrank/shared/shell-nav";
import apiApp from "./router.js";
import { OG_IMAGE_PNG_BASE64 } from "./og-image.js";
import { PLATFORM_HOST, NON_SITE_PATHS } from "./constants.js";
import {
  generateCsrfToken, csrfCookie,
  resolveCustomDomain, isCustomHost,
  serveStaticAsset,
  serveRobotsTxt, serveSitemapXml, serveFavicon,
  HTML, SECURE_HTML, notFoundPage, suspendedPage, pendingVerificationPage, error500Page, withNonce
} from "./middleware/index.js";
import { handlePublicApiPreflight } from "./middleware/public-api.js";
import { findSiteLogoData, findSiteStatus, findUserTotpSecret } from "./data/sites.js";
import { detectImageMime } from "./site.js";
import { one, query, exec } from "@yourrank/shared/db";
import { logAudit } from "@yourrank/shared/audit";
import { loadPlatformIdentity, getPlatformIdentity } from "./platform-identity.js";
import { applyLegalIdentity } from "./pages/legal-helper.js";
import { hashToken, newClickRef } from "@yourrank/shared/crypto";
import { handleDashboardPreview } from "./handlers/preview.js";
import { demoLeaderboardData } from "./demo-data.js";
import { legacyTelegramRedirect } from "./telegram-routes.js";

// Sections the virtual /demo board renders. `games` is off in the demo data,
// so its shell never links there.
const DEMO_SECTIONS = new Set(["leaderboard", "shop", "me"]);
import { renderPasswordGate } from "./password-gate.js";
import {
  renderNewEmbed,
  renderNewHallOfFame,
  renderNewLegalPage,
  renderNewPlayerProfile,
  renderNewStreamerProfile,
} from "./auxiliary-renderers.js";
import { parseDashboardPath, dashboardPath, resolveSection, legacyDashboardPath, trimTrailingSlashes } from "./assets/dashboard/routes.js";
import { LEGACY_ACCOUNT_PATHS } from "@yourrank/shared/dashboard-nav";
import { deferClickWrite, trackedDestination } from "./tracked-redirect.js";
import { setRequestMetrics } from "@yourrank/shared/request-id";
import { evaluateConsumerHealth } from "./consumer-health.js";
import { readDlqHealth } from "./dlq-health.js";
import { proxyMarketingHome } from "./marketing-proxy.js";
import { redirectResponse, redirectToLogin } from "./login-redirect.js";
import { safeNextPath } from "@yourrank/shared/safe-next";

const LEGAL_PAGES = new Set(["terms", "privacy", "responsible", "cookies", "refund", "contact"]);
const MARKETING_PAGES = new Set(["/", "/index.html", "/sites", "/telegram", "/credits", "/pricing", "/overlays", "/games", "/switch", "/docs", "/faq", "/about", "/changelog", "/brand", "/status"]);
const PUBLIC_API_OPERATIONS = new Set(["standings", "players", "stream", "rank", "data", "stats"]);
const SITE_SECTIONS = new Set(["home", "leaderboard", "shop", "games", "me"]);
const CUSTOM_VIEWER_AUTH_PATHS = new Set([
  "/api/viewer/auth/kick",
  "/api/viewer/auth/kick/callback",
  "/api/viewer/auth/kick/handoff",
]);

export function isCustomViewerAuthPath(method, path) {
  return method === "GET" && CUSTOM_VIEWER_AUTH_PATHS.has(path);
}

function telemetryRoute(path) {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "api") {
    if (parts[1] === "public" && PUBLIC_API_OPERATIONS.has(parts[3])) {
      return "/api/public/:slug/" + parts[3];
    }
    if (parts[1] && NON_SITE_PATHS.has(parts[1])) return "/api/" + parts[1];
    return "/other";
  }
  if (parts[0] === "go") return "/go/:slug";
  if (parts[0] === "logo") return "/logo/:slug";
  if (parts.length >= 2 && parts[1] === "player") return "/:slug/player/:name";
  if (parts.length >= 2 && SITE_SECTIONS.has(parts[1])) return "/:slug/" + parts[1];
  if (parts.length === 1 && !NON_SITE_PATHS.has(parts[0])) return "/:slug";
  if (parts.length === 1 && NON_SITE_PATHS.has(parts[0])) return "/" + parts[0];
  return "/other";
}

function telemetrySite(path) {
  const publicPath = path.match(/^\/api\/public\/([^/]+)/i);
  const redirectPath = path.match(/^\/go\/([^/]+)/i);
  if (publicPath?.[1]) return publicPath[1].toLowerCase();
  if (redirectPath?.[1]) return redirectPath[1].toLowerCase();
  const first = path.split("/").filter(Boolean)[0]?.toLowerCase();
  return first && !NON_SITE_PATHS.has(first) ? first : undefined;
}


function enqueueBump(env, ctx, siteId, field, referer = null, visitorHash = null) {
  const producer = createQueueProducer(
    env.EVENTS_QUEUE,
    async (event) => {
      if (event.type === "bump") {
        await bumpStat(event.siteId, event.field, event.referer, event.visitorHash);
      }
    }
  );
  const p = producer.send({ type: "bump", siteId, field, referer, visitorHash, timestamp: Date.now() });
  ctx.waitUntil(p);
}

function fillYear(html) {
  const year = new Date().getFullYear();
  return html.replace(/{{YEAR}}/g, String(year)).replace(/{{NEXT_YEAR}}/g, String(year + 1));
}

function redirectKeepingSearch(pathname, url, status = 302) {
  const target = new URL(pathname, url);
  target.search = url.search;
  return redirectResponse(target, status);
}

// Maps a dashboard sub-path to the page key + tab needed to render its content
// fragment. Mirrors the routing in handleRequest so the fragment endpoint
// reuses the exact same page components the full-page route serves.
// Exported for the routing-parity tests: the client routing table in
// assets/dashboard/routes.js must agree with this mapping.
export function resolveFragment(targetPath) {
  const clean = trimTrailingSlashes(String(targetPath || "").split("?")[0]) || "/dashboard";
  // Engagement
  if (clean.startsWith("/dashboard/giveaways/")) {
    const tab = clean.slice("/dashboard/giveaways/".length);
    if (["chat", "raffles", "drops", "tournaments"].includes(tab)) return { pageKey: "giveaways", tab };
    if (tab === "predictions") return { pageKey: "giveaways", tab: "preds" };
    return null;
  }
  // Rewards
  if (clean === "/dashboard/rewards") return { pageKey: "rewardsOverview", tab: "overview" };
  if (clean.startsWith("/dashboard/rewards/")) {
    const tab = clean.slice("/dashboard/rewards/".length);
    if (tab === "shop") return { pageKey: "rewardsShop", tab: "shop" };
    if (tab === "rules") return { pageKey: "rewardsRules", tab: "rules" };
    if (tab === "redemptions") return { pageKey: "rewardsRedemptions", tab: "redemptions" };
    if (tab === "activity") return { pageKey: "rewardsHistory", tab: "history" };
    return null;
  }
  // Site settings → Connections (the Kick connection's canonical home).
  if (clean === "/dashboard/site/connections") return { pageKey: "rewardsChannel", tab: "channel" };
  // Audience
  if (clean === "/dashboard/audience/members") return { pageKey: "audienceMembers", tab: "viewers" };
  // Account settings
  if (clean === "/dashboard/settings") return { pageKey: "settingsUnified", tab: "account" };
  if (clean.startsWith("/dashboard/settings/")) {
    const tab = clean.slice("/dashboard/settings/".length);
    if (tab === "account") return { pageKey: "settingsUnified", tab: "account" };
    if (tab === "team") return { pageKey: "settingsUnified", tab: "team" };
    if (tab === "billing") return { pageKey: "settingsUnified", tab: "plan" };
    if (tab === "connections") return { pageKey: "settingsUnified", tab: "connections" };
    if (tab === "data") return { pageKey: "settingsUnified", tab: "data" };
    return null;
  }
  return null;
}

function findProfilePlayer(data, rawName) {
  const name = decodeURIComponent(rawName).trim();
  const players = (data.players || []).slice().sort((a, b) => (Number(b.wagered) || 0) - (Number(a.wagered) || 0));
  const idx = players.findIndex((p) => String(p.name || "").toLowerCase() === name.toLowerCase());
  if (idx === -1) return null;
  return { player: players[idx], rank: idx + 1 };
}

async function buildPlayerHistory(env, siteId, rawName, plan) {
  const name = decodeURIComponent(rawName).trim().toLowerCase();
  const archives = await getArchiveSnapshots(env, siteId, Math.min(ARCHIVE_LIMITS[plan] || 6, PUBLIC_ARCHIVE_LIMIT));
  const out = [];
  for (const a of archives) {
    const parsed = fromJsonb(a.snapshot_json);
    const snap = Array.isArray(parsed) ? parsed : [];
    const sorted = snap.slice().sort((x, y) => (Number(y.wagered) || 0) - (Number(x.wagered) || 0));
    const idx = sorted.findIndex((p) => String(p.name || "").toLowerCase() === name);
    if (idx !== -1) {
      const p = sorted[idx];
      out.push({ label: a.label || "Archived", at: a.created_at, rank: idx + 1, wagered: p.wagered || 0, prize: p.prize || 0 });
    }
  }
  return out;
}

async function serveLogo(request, path) {
  let slug;
  try { slug = decodeURIComponent(path.slice(6)).toLowerCase().replace(/\.(png|jpe?g|webp)$/, ""); } catch { return new Response("not found", { status: 404 }); }
  const width = new URL(request.url).searchParams.get("w") || "orig";
  const site = await findSiteLogoData(slug);
  let logoData = site?.logo_data || "";
  // New uploads can store multiple pre-sized WebP blobs as a JSON object.
  if (logoData.startsWith("{")) {
    try {
      const srcset = JSON.parse(logoData);
      logoData = srcset[width] || srcset["512"] || srcset["orig"] || Object.values(srcset)[0] || "";
    } catch {
      // fall through to legacy single data URI handling
    }
  }
  const m = (logoData || "").match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!m) return new Response("not found", { status: 404 });
  const encoder = new TextEncoder();
  const hashBuf = await crypto.subtle.digest("SHA-256", encoder.encode(logoData));
  const etag = '"' + [...new Uint8Array(hashBuf)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16) + '"';
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch === etag) return new Response(null, { status: 304, headers: { etag, "cache-control": "public, max-age=86400" } });
  let bytes;
  try { bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)); } catch { return new Response("not found", { status: 404 }); }
  // H-19: validate magic bytes even on read so a legacy invalid blob cannot be
  // served under an image MIME type.
  const detected = detectImageMime(bytes);
  if (!detected) return new Response("not found", { status: 404 });
  return new Response(bytes, { headers: { "content-type": detected, "cache-control": "public, max-age=86400", etag } });
}

export default {
  fetch: withWorkerFetch("leaderboard", async (request, env, ctx) => {
    const response = await handleRequest(request, env, ctx);
    // SEC-104: Clear legacy 'sess' cookie on every response (not just authenticated)
    if (hasLegacyCookie(request)) {
      response.headers.append("set-cookie", cookieClearLegacy());
    }
    // SEC-107: Propagate rotated session cookies from currentUser()
    if (request._sessionCookies) {
      for (const c of request._sessionCookies) {
        response.headers.append("set-cookie", c);
      }
    }
    return response;
  }, { telemetry: true }),

  scheduled: handleScheduled,
};

async function handleScheduled(event, env, ctx) {
  populateEnv(env, { setGlobalEnv: true });
  if (event.cron === "*/5 * * * *") {
    ctx.waitUntil(
      runAutoReset(env).catch((err) => {
        console.error("[scheduled] auto-reset failed:", err);
        if (env.DISCORD_MONITORING_WEBHOOK) {
          ctx.waitUntil(
            fetch(env.DISCORD_MONITORING_WEBHOOK, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                embeds: [{
                  title: "⚠️ Auto-reset scheduler failed",
                  description: `\`\`\`\n${String(err?.message || err).slice(0, 1800)}\n\`\`\``,
                  color: 0xff4444,
                  timestamp: new Date().toISOString(),
                }],
              }),
            }).catch(() => {})
          );
        }
      })
    );
    ctx.waitUntil(cleanupExpiredExports(env).catch((err) => {
      console.error("[scheduled] account export cleanup failed:", String(err?.message || err));
    }));
  }
}

async function cleanupExpiredAccountExports(env) {
  const stale = await query(
    `SELECT id, user_id FROM account_export_jobs
      WHERE status='processing' AND started_at < now() - INTERVAL '15 minutes'
      ORDER BY started_at ASC LIMIT 100`,
    []
  );
  for (const job of stale) {
    await exec(
      `UPDATE account_export_jobs
          SET status='failed', error='Export worker stopped before completion', completed_at=now()
        WHERE id=$1 AND status='processing'`,
      [job.id]
    );
    await logAudit({ actorId: job.user_id, action: "account_export_failed", entityType: "account_export", entityId: job.id, details: { export_id: job.id, status: "failed" } });
  }
  for (;;) {
    const expired = await query(
      "SELECT id, artifact_key FROM account_export_jobs WHERE expires_at <= now() ORDER BY expires_at ASC LIMIT 100",
      []
    );
    if (!expired.length) return;
    if (env.ACCOUNT_EXPORTS) {
      for (const job of expired) {
        if (job.artifact_key) await env.ACCOUNT_EXPORTS.delete(job.artifact_key).catch(() => {});
      }
    }
    await exec("DELETE FROM account_export_jobs WHERE id = ANY($1)", [expired.map((job) => job.id)]);
    if (expired.length < 100) return;
  }
}

async function cleanupExpiredViewerExports(env) {
  const stale = await query(
    `SELECT id, viewer_id FROM viewer_export_jobs
      WHERE status='processing' AND started_at < now() - INTERVAL '15 minutes'
      ORDER BY started_at ASC LIMIT 100`,
    []
  );
  for (const job of stale) {
    await exec(
      `UPDATE viewer_export_jobs
          SET status='failed', error='Export worker stopped before completion', completed_at=now()
        WHERE id=$1 AND status='processing'`,
      [job.id]
    );
    await logAudit({ actorId: job.viewer_id, action: "viewer_export_failed", entityType: "viewer_export", entityId: job.id, details: { export_id: job.id, status: "failed" } });
  }
  for (;;) {
    const expired = await query(
      "SELECT id, artifact_key FROM viewer_export_jobs WHERE expires_at <= now() ORDER BY expires_at ASC LIMIT 100",
      []
    );
    if (!expired.length) return;
    if (env.ACCOUNT_EXPORTS) {
      for (const job of expired) {
        if (job.artifact_key) await env.ACCOUNT_EXPORTS.delete(job.artifact_key).catch(() => {});
      }
    }
    await exec("DELETE FROM viewer_export_jobs WHERE id = ANY($1)", [expired.map((job) => job.id)]);
    if (expired.length < 100) return;
  }
}

async function cleanupExpiredExports(env) {
  await cleanupExpiredAccountExports(env);
  await cleanupExpiredViewerExports(env);
}

function addCookieConsent(html) {
  if (typeof html !== "string") return html;
  const supportEmail = (typeof process !== "undefined" && process.env?.SUPPORT_EMAIL) || "contact@yourrank.site";
  html = html.replace(/contact@yourrank\.site/g, supportEmail);
  return html.replace(/<\/body>\s*<\/html>\s*$/i, '<script src="/assets/cookie-consent.js" defer></script></body></html>');
}

const MAX_BODY_BYTES = 1_000_000;
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function bodyExceedsLimit(request, maxBytes) {
  const cl = request.headers.get("content-length");
  if (cl && Number(cl) > maxBytes) return true;
  if (!request.body) return false;
  // H-18: Content-Length can be absent (chunked encoding) or lie. Read a clone
  // of the stream up to the limit so oversized chunked bodies are rejected too.
  const clone = request.clone();
  const reader = clone.body.getReader();
  try {
    let total = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value ? value.length : 0;
      if (total > maxBytes) return true;
    }
  } finally {
    reader.releaseLock();
  }
  return false;
}

export async function handleRequest(request, env, ctx, meta, deps = {}) {
  const resolveCustomDomainImpl = deps.resolveCustomDomain || resolveCustomDomain;
  const apiAppImpl = deps.apiApp || apiApp;
  const { log: workerLog, reqId } = meta || {};
    const nonce = crypto.randomUUID().replace(/-/g, "");
    const HTML_N = withNonce(HTML, nonce);
    try {
      // Load legal company identity once per isolate; cached for 60s.
      await loadPlatformIdentity(env);
      // BE-004 / H-18: Reject oversized request bodies early, before any parsing.
      // 1 MB is generous for JSON payloads (site data, auth forms, etc.) while
      // blocking multi-MB abuse. Applies to all state-changing methods and checks
      // chunked bodies by consuming a clone of the stream up to the limit.
      if (MUTATING_METHODS.has(request.method)) {
        if (await bodyExceedsLimit(request, MAX_BODY_BYTES)) {
          return new Response("payload too large", { status: 413 });
        }
      }

      // Populate process.env so the shared Postgres data layer (db.js) can read
      // the connection string. The Pool is created lazily on first query(), so
      // this must run before any DB call — mirrors the bot Worker's worker.ts.
      populateEnv(env, { setGlobalEnv: true });

      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method === "HEAD" ? "GET" : request.method;
      const host = (request.headers.get("host") || "").toLowerCase().split(":")[0];
      setRequestMetrics({
        route: telemetryRoute(path),
        site: telemetrySite(path),
      });

      // --- custom domain resolution ---
      // If the Host header is not our primary domain, check if it maps to a
      // user's custom domain. If yes, serve their leaderboard at /.
      if (isCustomHost(host)) {
        const customSlug = await resolveCustomDomainImpl(env, host);
        if (customSlug && !isCustomViewerAuthPath(method, path)) {
          // Serve the leaderboard as if the path were /<slug>
          // Rewrite the URL path internally
          url.pathname = "/" + customSlug;
          // Password-unlock submission for custom-domain private boards
          if (method === "POST" && path === "/password") {
            const site = await getBySlug(env, customSlug);
            if (!site || !site.published || !site.password_hash) {
              return new Response(notFoundPage(customSlug, nonce), { status: 404, headers: HTML_N });
            }
            const form = await request.formData().catch(() => null);
            const password = form ? String(form.get("password") || "") : "";
            if (!await verifyBoardPassword(password, site)) {
              return new Response(renderPasswordGate(site, { nonce, isCustomDomain: true }, "Incorrect password."), { headers: { ...HTML_N, "cache-control": "no-store" } });
            }
            const token = await issueBoardPasswordToken(site);
            const cookie = boardPasswordSetCookieHeader(site, token, { isCustomDomain: true });
            return new Response(null, { status: 302, headers: { "location": "/", "set-cookie": cookie } });
          }

          // Only serve GET requests on custom domains (no dashboard/API)
          if (method === "GET" && path.startsWith("/logo/")) {
            return serveLogo(request, path);
          }
          if (method === "GET" && path === "/favicon.ico") {
            return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>', {
              headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" },
            });
          }
          // --- branded site sections (custom domain): /, /leaderboard, /shop, /games, /me ---
          const customSiteRoute = parseSitePath(path, true, customSlug);
          if (customSiteRoute) {
            return renderSiteRoute({ request, env, ctx, nonce, slug: customSiteRoute.slug, section: customSiteRoute.section, isCustomDomain: true });
          }
          if (method === "GET" && path === "/hall-of-fame") {
            const r = await getPublicSite(env, customSlug, request);
            if (r && r.requiresPassword) {
              return new Response(renderPasswordGate(r, { nonce, isCustomDomain: true }), { headers: { ...HTML_N, "cache-control": "no-store" } });
            }
            if (!r || r.suspended) return new Response(notFoundPage(customSlug, nonce), { status: 404, headers: HTML_N });
            const paid = r.plan === "pro" || r.plan === "agency";
            return new Response(
              await renderNewHallOfFame(r.data, {
                nonce, slug: customSlug, plan: r.plan, homeUrl: `https://${host}`, isCustomDomain: true,
                logoUrl: paid && r.data.branding?.hasLogo ? `https://${host}/logo/${customSlug}` : null,
              }),
              { headers: { ...HTML_N, "cache-control": "no-store" } }
            );
          }
          if (method === "GET" && LEGAL_PAGES.has(path.slice(1))) {
            const r = await getPublicSite(env, customSlug, request);
            if (r && r.requiresPassword) {
              return new Response(renderPasswordGate(r, { nonce, isCustomDomain: true }), { headers: { ...HTML_N, "cache-control": "no-store" } });
            }
            if (!r || r.suspended) return new Response(notFoundPage(customSlug, nonce), { status: 404, headers: HTML_N });
            const paid = r.plan === "pro" || r.plan === "agency";
            const page = path.slice(1);
            return new Response(
              await renderNewLegalPage(r.data, page, {
                nonce, slug: customSlug, plan: r.plan, homeUrl: `https://${host}`, isCustomDomain: true,
                logoUrl: paid && r.data.branding?.hasLogo ? `https://${host}/logo/${customSlug}` : null,
              }),
              { headers: { ...HTML_N, "cache-control": "no-store" } }
            );
          }
          if (method === "GET" && path.startsWith("/player/")) {
            const r = await getPublicSite(env, customSlug, request);
            if (r && r.requiresPassword) {
              return new Response(renderPasswordGate(r, { nonce, isCustomDomain: true }), { headers: { ...HTML_N, "cache-control": "no-store" } });
            }
            if (!r || r.suspended) return new Response(notFoundPage(customSlug, nonce), { status: 404, headers: HTML_N });
            const playerName = path.slice(8).split("/")[0];
            const profile = findProfilePlayer(r.data, playerName);
            if (!profile) return new Response(notFoundPage(customSlug, nonce), { status: 404, headers: HTML_N });
            const history = await buildPlayerHistory(env, r.id, playerName, r.plan);
            const paid = r.plan === "pro" || r.plan === "agency";
            return new Response(
              await renderNewPlayerProfile(r.data, { ...profile.player, rank: profile.rank }, history, {
                nonce, slug: customSlug, plan: r.plan, homeUrl: `https://${host}`, isCustomDomain: true,
                logoUrl: paid && r.data.branding?.hasLogo ? `https://${host}/logo/${customSlug}` : null,
              }),
              { headers: { ...HTML_N, "cache-control": "no-store" } }
            );
          }
          if (method === "GET" && path === "/profile") {
            const r = await getPublicSite(env, customSlug, request);
            if (r && r.requiresPassword) {
              return new Response(renderPasswordGate(r, { nonce, isCustomDomain: true }), { headers: { ...HTML_N, "cache-control": "no-store" } });
            }
            if (!r || r.suspended) return new Response(notFoundPage(customSlug, nonce), { status: 404, headers: HTML_N });
            const paid = r.plan === "pro" || r.plan === "agency";
            return new Response(
              await renderNewStreamerProfile(r.data, {
                nonce, slug: customSlug, plan: r.plan, homeUrl: `https://${host}`, isCustomDomain: true,
                logoUrl: paid && r.data.branding?.hasLogo ? `https://${host}/logo/${customSlug}` : null,
                boards: r.boards, botUsername: r.botUsername,
              }),
              { headers: { ...HTML_N, "cache-control": "no-store" } }
            );
          }
          if (method === "GET" && path === "/embed") {
            const r = await getPublicSite(env, customSlug, request);
            if (r && r.requiresPassword) {
              return new Response(renderPasswordGate(r, { nonce, isCustomDomain: true }), { headers: { ...HTML_N, "cache-control": "no-store" } });
            }
            if (!r || r.suspended) return new Response(notFoundPage(customSlug, nonce), { status: 404, headers: HTML_N });
            return new Response(renderNewEmbed(r.data, { nonce, slug: customSlug, plan: r.plan, isCustomDomain: true }), { headers: { ...HTML_N, "cache-control": "no-store" } });
          }
          // Everything else on a custom domain → 404
          return new Response(notFoundPage("", nonce), { status: 404, headers: HTML_N });
        }
        // No matching custom domain — fall through to normal routing
      }

      // --- static assets ---
      if (path.startsWith("/assets/")) {
        return serveStaticAsset(path, request);
      }

      // --- SEO endpoints ---
      if (path === "/robots.txt") return serveRobotsTxt(url.origin);
      if (path === "/sitemap.xml") return await serveSitemapXml(url.origin, env);
      if (path === "/favicon.ico") return serveFavicon();
      // Brand social-share image (og:image). Decoded from the inlined base64 so
      // shares of the homepage/pricing/unbranded boards don't render blank.
      if (method === "GET" && path === "/og.png") {
        const bytes = Uint8Array.from(atob(OG_IMAGE_PNG_BASE64), (c) => c.charCodeAt(0));
        return new Response(bytes, { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
      }

      // --- health check ---
      if (path === "/health") {
        const result = { status: "ok", timestamp: new Date().toISOString() };
        try {
          await one('SELECT 1 AS ok');
          result.db = true;
        } catch (e) {
          if (workerLog) workerLog.warn("health_db_probe_failed", { error: String(e) });
          else console.error("[leaderboard] health_db_probe_failed:", String(e));
          result.db = false;
          result.status = "degraded";
        }

        // Surface analytics consumer health. If the consumer stops processing,
        // dashboard analytics silently starve; this makes that outage visible.
        try {
          const hb = await one("SELECT EXTRACT(EPOCH FROM (now() - last_seen))::int AS seconds_ago, processed_count, failed_count, last_failure_at, last_success_at FROM consumer_heartbeat WHERE name='consumer'");
          const consumerStaleSeconds = 600; // 10 minutes without a batch is an outage
          if (hb) {
            // A brand-new deploy has no queue events yet, so the heartbeat row
            // may be stale even though the consumer is healthy. Once it has
            // processed any events we start enforcing freshness.
            const consumerHealth = evaluateConsumerHealth(hb, Date.now(), consumerStaleSeconds);
            result.consumer = {
              healthy: consumerHealth.healthy,
              last_seen: Number(hb.seconds_ago),
              processed_count: Number(hb.processed_count),
              failed_count: Number(hb.failed_count),
              last_failure_at: consumerHealth.last_failure_at,
              last_success_at: consumerHealth.last_success_at,
            };
            if (!consumerHealth.healthy) result.status = "degraded";
          } else {
            result.consumer = { healthy: false, last_seen: null, note: "no heartbeat row" };
            result.status = "degraded";
          }
        } catch (e) {
          if (workerLog) workerLog.warn("health_consumer_probe_failed", { error: String(e) });
          else console.error("[leaderboard] health_consumer_probe_failed:", String(e));
          result.consumer = { healthy: false, error: "probe_failed" };
          result.status = "degraded";
        }

        const dlqThresholdRaw = Number(env.DLQ_HEALTH_DEGRADE_THRESHOLD ?? "100");
        const dlqThreshold = Number.isFinite(dlqThresholdRaw) && dlqThresholdRaw >= 1
          ? Math.floor(dlqThresholdRaw)
          : 100;
        const dlq = await readDlqHealth(one, dlqThreshold);
        result.dlq = {
          pending: dlq.pending,
          oldest_pending_at: dlq.oldest_pending_at,
          oldest_pending_age_seconds: dlq.oldest_pending_age_seconds,
          pending_capped: dlq.pending_capped,
        };
        if (dlq.error) result.dlq.error = dlq.error;
        if (dlq.degraded) result.status = "degraded";

        const status = result.status === "ok" ? 200 : 503;
        return new Response(JSON.stringify(result), {
          status,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      }

      // --- helper for rendering strings or JSX pages ---
      const renderHtmlPage = async (pageObj, { reqId, activePath, user, theme, accountHref, logoutAction, tab } = {}) => {
        const navOpts = activePath && user ? { activePath, user, theme, accountHref: accountHref || "/dashboard/settings", logoutAction } : null;
        // Pages reachable signed-out (Help) still get a header — the anonymous
        // variant of the same shell rather than a separate marketing top bar.
        const navHtml = () => (navOpts ? shellNavHtml(navOpts) : publicNavHtml({ activePath, theme }));
        // Placeholders every page can carry, whatever it is rendered from.
        const applyPlaceholders = (html) => {
          let result = reqId ? html.replace("{{REQ_ID}}", reqId) : html;
          // Legal company identity (support email, company name, ...).
          result = applyLegalIdentity(result, getPlatformIdentity());
          // Google Business Profile placeholders (optional; set via wrangler secret/vars).
          result = result.replace(/{{GBP_REVIEW_URL}}/g, env.GBP_REVIEW_URL || "#");
          result = result.replace(/{{GBP_PHOTO_URL}}/g, env.GBP_PHOTO_URL || "");
          return fillYear(result);
        };
        if (typeof pageObj === "string") {
          let result = pageObj;
          if (navOpts) result = result.replace("<!--GM_NAV-->", shellNavHtml(navOpts));
          return applyPlaceholders(result);
        }

        if (pageObj.Component) {
          let node = pageObj.Component({ reqId, activePath, user, tab });
          if (node instanceof Promise) node = await node;
          const content = node.toString();
          // Pages that render in two shells (Help: workspace for a creator,
          // public site chrome for a visitor) resolve their document config
          // from the same render options as the content.
          const pageConfig = pageObj.configFor ? pageObj.configFor({ user, activePath, tab }) : pageObj.config;
          if (pageConfig) {
            const result = leaderboardPageHtml({ ...pageConfig, content }).replace("<!--GM_NAV-->", navHtml());
            return applyPlaceholders(result);
          }
          return applyPlaceholders(content);
        }
      }
      const renderDashboardPage = async (pageKey, logLabel, tab) => {
        try {
          const user = await currentUser(request, env);
          if (!user) return redirectToLogin(url);
          const html = addCookieConsent(await renderHtmlPage(PAGES[pageKey], {
            activePath: url.pathname + url.search,
            user,
            reqId: reqId || "",
            theme: "light",
            tab,
          }));
          return new Response(html, { headers: { ...SECURE_HTML, ...csrfHeader, "cache-control": "no-store, no-cache, must-revalidate" } });
        } catch (e) {
          if (workerLog) workerLog.error(logLabel, { error: String(e?.message || e) }); else console.error(`${logLabel.replaceAll("_", " ")}:`, String(e?.message || e));
          return new Response(error500Page(nonce), { status: 500, headers: HTML_N });
        }
      };

      // --- pages ---
      // SEC-108: Issue CSRF cookie on every page load so the JS client can
      // echo it back as X-CSRF-Token on API calls.
      const csrfToken = generateCsrfToken();
      const csrfHeader = { "set-cookie": csrfCookie(csrfToken) };

      if (host === PLATFORM_HOST && (path.startsWith("/_next/") || path.startsWith("/brand/"))) {
        return proxyMarketingHome({ request, binding: env.MARKETING, workerLog });
      }
      if (host === PLATFORM_HOST && MARKETING_PAGES.has(path)) {
        return proxyMarketingHome({ request, binding: env.MARKETING, workerLog });
      }
      if (path === "/login" || path === "/login.html") {
        // AUDIT-B6: a signed-in user hitting /login used to get the login form
        // for a beat before client JS bounced them. Resolve the session
        // server-side and redirect before rendering anything. On a DB hiccup,
        // fall through and render the form — never 500 the login page.
        try {
          const existing = await currentUser(request, env);
          if (existing) {
            const next = safeNextPath(url.searchParams.get("next") || "", "/dashboard");
            return redirectResponse(new URL(next, url), 302);
          }
        } catch { /* render the form */ }
        return new Response(addCookieConsent(await renderHtmlPage(PAGES.login)), { headers: { ...SECURE_HTML, ...csrfHeader } });
      }
      // POST /logout only (BE-003). Previously GET, which allowed CSRF via
      // <img src="/logout">. Now only POST is accepted. The in-page buttons
      // already hit POST /api/auth/logout; the nav link should use a form POST.
      if ((path === "/logout" || path === "/logout.html") && method === "POST") {
        await destroySession(env, readToken(request));
        const next = safeNextPath(url.searchParams.get("next") || "", "/dashboard");
        const loginUrl = new URL("/login", url);
        if (next) loginUrl.searchParams.set("next", next);
        return new Response(null, { status: 302, headers: { "set-cookie": cookieClear(env), location: String(loginUrl) } });
      }
      if (path === "/signup" || path === "/signup.html") return new Response(addCookieConsent(await renderHtmlPage(PAGES.signup)), { headers: { ...SECURE_HTML, ...csrfHeader } });
      if (path === "/verify-email" || path === "/verify-email.html") {
        // Verification happens server-side: the emailed link must work even if
        // client JavaScript fails to load or run.
        const token = url.searchParams.get("token");
        let verifyState = { message: "Open the link we emailed you to confirm your address.", showResend: true };
        let status = 200;
        if (token) {
          const result = await verifyEmailToken(token);
          if (result.ok) {
            const user = await currentUser(request, env);
            if (user) {
              const next = url.searchParams.get("next") || "";
              const safeNext = safeNextPath(next, "/dashboard?verified=1");
              return redirectResponse(new URL(safeNext, url), 302);
            }
            verifyState = { message: "Email confirmed. Sign in below to finish setting up your page." };
          } else {
            verifyState = { message: "We couldn't confirm your email.", error: result.error, showResend: true };
            status = result.status || 400;
          }
        }
        const html = addCookieConsent(await renderHtmlPage(verifyEmailPageHtml(verifyState)));
        return new Response(html, { status, headers: { ...SECURE_HTML, ...csrfHeader } });
      }
      const inviteMatch = path.match(/^\/invite\/([a-zA-Z0-9_-]+)$/);
      if (inviteMatch) {
        const token = inviteMatch[1];
        const inviteRl = await rateLimit(env, `team-invite-page:${clientIp(request)}`, 30, 900);
        if (!inviteRl.ok) {
          return new Response("Invitation is not available.", {
            status: 404,
            headers: { ...SECURE_HTML, ...rateLimitHeaders(inviteRl) },
          });
        }
        const { getInviteByToken } = await import("@yourrank/shared/team");
        const invite = await getInviteByToken(token);
        const validInvite = invite &&
          invite.status === "pending" &&
          new Date(invite.expiresAt).getTime() >= Date.now();
        if (!validInvite) {
          return new Response("Invitation is not available.", {
            status: 404,
            headers: { ...SECURE_HTML, ...rateLimitHeaders(inviteRl) },
          });
        }
        const user = await currentUser(request, env);
        const html = addCookieConsent(await renderHtmlPage(PAGES.invite, { invite, token, user }));
        return new Response(html, {
          headers: { ...SECURE_HTML, ...csrfHeader, ...rateLimitHeaders(inviteRl) },
        });
      }
      // Connect Kick lives under Site settings → Connections now; keep the old URLs working.
      if (path === "/dashboard/settings/integrations") {
        return redirectKeepingSearch("/dashboard/site/connections", url, 301);
      }
      if (path === "/dashboard/settings/board") {
        return redirectKeepingSearch("/dashboard/site", url, 301);
      }
      if (path === "/dashboard/settings/plan") {
        return redirectKeepingSearch("/dashboard/settings/billing", url, 301);
      }
      if (path === "/dashboard/settings" || /^\/dashboard\/settings\/(account|team|billing|connections|data)$/.test(path)) {
        const pathTab = path.split("/").pop();
        const requestedTab = pathTab === "settings"
          ? (url.searchParams.get("tab") || (url.searchParams.has("plan") ? "plan" : null))
          : pathTab;
        const tab = requestedTab === "billing" || requestedTab === "plan"
          ? "plan"
          : ["account", "team", "connections", "data"].includes(requestedTab)
            ? requestedTab
            : "account";
        const user = await currentUser(request, env);
        if (!user) return redirectToLogin(url);
        const html = addCookieConsent(await renderHtmlPage(PAGES.settingsUnified, {
          activePath: url.pathname + url.search,
          user,
          reqId: reqId || "",
          theme: "light",
          tab: tab === "settings" ? "account" : tab,
        }));
        return new Response(html, { headers: { ...SECURE_HTML, ...csrfHeader, "cache-control": "no-store, no-cache, must-revalidate" } });
      }
      if (path === "/dashboard/billing") return redirectKeepingSearch("/dashboard/settings/billing", url, 301);
      if (path === "/dashboard/attribution") return redirectKeepingSearch("/dashboard/settings/connections", url);
      if (path === "/dashboard/security") return redirectKeepingSearch("/dashboard/settings/account", url);
      if (path === "/dashboard/integrations") return redirectKeepingSearch("/dashboard/settings/connections", url);
      if (path === "/dashboard/manage") return redirectKeepingSearch("/dashboard/settings", url);
      // Fragment endpoint: returns the content HTML (without the shell) for
      // dynamic dashboard sections, so the persistent SPA shell can inject
      // them without a document reload. Reuses the same page components and
      // rendering functions as the full-page route — no duplicated pages.
      if (path === "/dashboard/_content" && method === "GET") {
        const targetPath = url.searchParams.get("path");
        if (!targetPath) return new Response("Missing path", { status: 400, headers: { ...SECURE_HTML, ...csrfHeader } });
        try {
          const user = await currentUser(request, env);
          if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json", ...csrfHeader } });
          const fragment = resolveFragment(targetPath);
          if (!fragment) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "content-type": "application/json", ...csrfHeader } });
          const pageObj = PAGES[fragment.pageKey];
          if (!pageObj?.Component) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "content-type": "application/json", ...csrfHeader } });
          let node = pageObj.Component({ user, tab: fragment.tab, fragment: true });
          if (node instanceof Promise) node = await node;
          const html = node.toString();
          const title = (pageObj.configFor ? pageObj.configFor({ user, tab: fragment.tab }) : pageObj.config)?.title || "Dashboard · YourRank";
          return new Response(JSON.stringify({ html, title }), {
            headers: {
              "content-type": "application/json",
              ...csrfHeader,
              "cache-control": "no-store, no-cache, must-revalidate",
            },
          });
        } catch (e) {
          if (workerLog) workerLog.error("fragment_render_failed", { error: String(e?.message || e) });
          // Detail stays in the worker log; the response body carries only a
          // stable error code (the client surfaces its own message).
          return new Response(JSON.stringify({ error: "render_failed" }), { status: 500, headers: { "content-type": "application/json", ...csrfHeader } });
        }
      }
      if (path === "/dashboard/audience/members") {
        return renderDashboardPage("audienceMembers", "audience_render_failed");
      }
      if (path === "/dashboard/audience" || path === "/dashboard/audience/viewers" || path === "/dashboard/audience/activity") {
        const target = path.endsWith("/activity") ? "/dashboard/rewards/activity" : "/dashboard/audience/members";
        return redirectKeepingSearch(target, url, 301);
      }
      if (path === "/dashboard/giveaways/preds") {
        return redirectKeepingSearch("/dashboard/giveaways/predictions", url, 301);
      }
      const legacyDashboard = legacyDashboardPath(path);
      if (legacyDashboard) {
        return redirectResponse(new URL(legacyDashboard + url.search, url), 301);
      }
      // Site settings → Connections: the Kick connection's canonical home.
      // Served as its own document (like the other fragment-booted sections)
      // because it runs the credits client, not the core SPA sections.
      if (path === "/dashboard/site/connections") {
        return renderDashboardPage("rewardsChannel", "site_connections_render_failed");
      }
      // Every dashboard section is a real URL: `/dashboard`, `/dashboard/leaderboard`,
      // `/dashboard/leaderboard/players`, … The section is rendered client-side, so
      // they all serve the same document; the shell reads the path on boot.
      const dashboardRoute = parseDashboardPath(path);
      if (dashboardRoute) {
        if (url.searchParams.get("nav") === "kickrewards") {
          const target = new URL("/dashboard/site/connections", url);
          for (const [k, v] of url.searchParams) if (k !== "nav") target.searchParams.set(k, v);
          return redirectResponse(target, 302);
        }
        // `?nav=` was the old address of a section. Send it to the real one so
        // the URL a user copies is the URL they can share.
        const legacyNav = url.searchParams.get("nav");
        const legacy = resolveSection(legacyNav);
        if (legacy) {
          const target = new URL(LEGACY_ACCOUNT_PATHS[legacyNav] || dashboardPath(legacy), url);
          for (const [k, v] of url.searchParams) if (k !== "nav") target.searchParams.set(k, v);
          return redirectResponse(target, 302);
        }
        try {
          const user = await currentUser(request, env);
          if (!user) return redirectToLogin(url);
          const html = addCookieConsent(await renderHtmlPage(PAGES.dashboard, {
            activePath: url.pathname + url.search,
            user,
            reqId: reqId || "",
            theme: "light"
          }));
          return new Response(html, { headers: { ...SECURE_HTML, ...csrfHeader, "cache-control": "no-store, no-cache, must-revalidate" } });
        } catch (e) {
          // A transient DB/Hyperdrive hiccup on currentUser used to bubble as a
          // raw Cloudflare 1101 after the session cookie redirected past the
          // unauthenticated path. Retry-safe: a plain refresh re-runs the read.
          if (workerLog) workerLog.error("dashboard_render_failed", { error: String(e?.message || e) }); else console.error("dashboard render failed:", String(e?.message || e));
          return new Response(error500Page(nonce), { status: 500, headers: HTML_N });
        }
      }
      // `/account/*` was a second settings implementation; the canonical one is
      // `/dashboard/settings/*`, so every old URL redirects into its tab.
      if (path === "/account" || path === "/account.html") {
        return redirectKeepingSearch("/dashboard/settings", url);
      }
      if (path.startsWith("/account/")) {
        const tab = path.slice("/account/".length).split("?")[0];
        const map = { profile: "account", plan: "plan", postbacks: "connections", connected: "connections", data: "data" };
        const target = map[tab];
        if (!target) return redirectKeepingSearch("/dashboard/settings/account", url);
        return redirectKeepingSearch(`/dashboard/settings/${target}`, url);
      }
      if (path === "/dashboard/preview" && (method === "GET" || method === "POST")) {
        try {
          return await handleDashboardPreview(request, env, nonce);
        } catch (e) {
          if (workerLog) workerLog.error("template_preview_failed", { error: String(e?.message || e) }); else console.error("template preview failed:", String(e?.message || e));
          return new Response(error500Page(nonce), { status: 500, headers: HTML_N });
        }
      }
      // Telegram now lives in the Bot Worker; preserve old leaderboard URLs.
      const telegramTarget = legacyTelegramRedirect(path);
      if (telegramTarget) {
        return redirectResponse(new URL(telegramTarget + url.search, url), 301);
      }
      if (path === "/dashboard/setup") {
        return redirectResponse(new URL("/dashboard", url), 302);
      }
      if (path === "/dashboard/support") {
        const redirectUrl = new URL("/help/support", url);
        redirectUrl.searchParams.set("area", "dashboard");
        redirectUrl.searchParams.set("return", "/dashboard");
        return redirectResponse(redirectUrl, 302);
      }
      if (path === "/dashboard/credits") {
        return redirectKeepingSearch("/dashboard/rewards", url, 301);
      }
      if (path === "/dashboard/giveaways") {
        return redirectKeepingSearch("/dashboard/giveaways/chat", url);
      }
      if (path.startsWith("/dashboard/giveaways/")) {
        const tab = path.slice("/dashboard/giveaways/".length);
        if (["chat", "raffles", "drops", "predictions", "tournaments"].includes(tab)) {
          return renderDashboardPage("giveaways", "giveaways_render_failed", tab === "predictions" ? "preds" : tab);
        }
        return redirectKeepingSearch("/dashboard/giveaways/chat", url);
      }
      if (path === "/dashboard/rewards") {
        return renderDashboardPage("rewardsOverview", "rewards_render_failed");
      }
      if (path.startsWith("/dashboard/rewards/")) {
        const tab = path.slice("/dashboard/rewards/".length).split("?")[0];
        // The Kick connection moved to Site settings → Connections. Keep the
        // old URL working as a permanent redirect that preserves site context.
        if (tab === "channel") return redirectKeepingSearch("/dashboard/site/connections", url, 301);
        if (tab === "overview") return redirectKeepingSearch("/dashboard/rewards", url, 301);
        if (tab === "maps" || tab === "rewards") return redirectKeepingSearch("/dashboard/rewards/rules", url);
        // Member management moved out of Rewards into Audience.
        if (tab === "viewers") return redirectKeepingSearch("/dashboard/audience/members", url, 301);
        if (tab === "activity") return renderDashboardPage("rewardsHistory", "rewards_render_failed");
        if (tab === "history") return redirectKeepingSearch("/dashboard/rewards/activity", url, 301);
        const map = { rules: "rewardsRules", shop: "rewardsShop", redemptions: "rewardsRedemptions" };
        const pageKey = map[tab];
        if (!pageKey) return redirectResponse(new URL("/dashboard/rewards", url), 302);
        return renderDashboardPage(pageKey, "rewards_render_failed");
      }
      // An unknown tab under a real section (a typo, a renamed step) belongs on
      // that section rather than on a 404.
      if (path.startsWith("/dashboard/")) {
        const section = resolveSection(path.slice("/dashboard/".length).split("/")[0]);
        if (section) return redirectResponse(new URL(dashboardPath(section), url), 302);
      }
      if (path.startsWith("/dashboard/")) {
        const user = await currentUser(request, env);
        if (!user) return redirectToLogin(url);
        try {
          const html = addCookieConsent(await renderHtmlPage(PAGES.dashboardNotFound, {
            activePath: url.pathname + url.search,
            user,
            reqId: reqId || "",
            theme: "light",
          }));
          return new Response(html, {
            status: 404,
            headers: { ...SECURE_HTML, ...csrfHeader, "cache-control": "no-store, no-cache, must-revalidate" },
          });
        } catch (e) {
          if (workerLog) workerLog.error("dashboard_not_found_render_failed", { error: String(e?.message || e) });
          else console.error("dashboard not found render failed:", String(e?.message || e));
          return new Response(error500Page(nonce), { status: 500, headers: HTML_N });
        }
      }
      if (path === "/me" || path === "/me.html") {
        return new Response(addCookieConsent(fillYear(viewerDashboardPage)), { headers: { ...HTML_N, ...csrfHeader, "cache-control": "no-store, no-cache, must-revalidate" } });
      }
      if (path === "/forgot") return new Response(addCookieConsent(await renderHtmlPage(PAGES.forgot)), { headers: { ...SECURE_HTML, ...csrfHeader } });
      if (path === "/reset") {
        // BUG-003: Don't show password form when no token is present.
        if (!url.searchParams.get("token")) {
          const invalidLink = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Invalid link · YourRank</title>
<meta name="robots" content="noindex, nofollow" />
<link rel="stylesheet" href="/assets/app.css" /><link rel="stylesheet" href="/assets/ui.css" /><link rel="stylesheet" href="/assets/devin-system.css" /></head><body>${DEVIN_DESIGN_CONTRACT}
<a href="#main-content" class="sr-only skip-link">Skip to content</a>
<div class="auth-wrap"><aside class="auth-side"><div><div class="brand">Your<b>Rank</b></div></div>
<div><h1>That link doesn't work.</h1><p>This reset link is missing, expired, or already used. Request a fresh one below.</p></div>
<div class="feat"></div></aside>
<main class="auth-main" id="main-content"><div class="auth-card"><h2>Invalid reset link</h2>
<p class="sub">This link is invalid or expired.</p>
<a class="btn btn--accent w-full" href="/forgot">Request a new link</a>
<p class="foot"><a href="/login">Back to sign in</a></p></div></main></div></body></html>`;
          return new Response(addCookieConsent(invalidLink), { headers: { ...SECURE_HTML, ...csrfHeader } });
        }
        return new Response(addCookieConsent(await renderHtmlPage(PAGES.reset)), { headers: { ...SECURE_HTML, ...csrfHeader } });
      }
      if (path === "/admin") {
        const u = await currentUser(request, env);
        if (!u || !u.is_admin) return new Response(notFoundPage("admin", nonce), { status: 404, headers: HTML_N });
        // C-10: Mandatory admin MFA. Admins with no enrolled TOTP are forced
        // to the 2FA setup page; enrolled admins must have a fresh session flag.
        const tfaRow = await findUserTotpSecret(u.id);
        if (!tfaRow?.totp_secret) {
          return new Response(addCookieConsent(await renderHtmlPage(PAGES.admin2fa)), { headers: { ...SECURE_HTML, ...csrfHeader } });
        }
        const token = readToken(request);
        const tokenHash = token ? await hashToken(token) : null;
        const tfaRow2 = tokenHash ? await one("SELECT twofa_verified_at FROM sessions WHERE token=$1", [tokenHash]) : null;
        if (!tfaRow2?.twofa_verified_at) {
          // Show 2FA verification page instead of admin dashboard
          return new Response(addCookieConsent(await renderHtmlPage(PAGES.admin2fa)), { headers: { ...SECURE_HTML, ...csrfHeader } });
        }
        return new Response(addCookieConsent(await renderHtmlPage(PAGES.admin)), { headers: { ...SECURE_HTML, ...csrfHeader } });
      }
      if (path === "/terms") return new Response(addCookieConsent(await renderHtmlPage(PAGES.terms)), { headers: { ...HTML_N, ...csrfHeader } });
      if (path === "/privacy") return new Response(addCookieConsent(await renderHtmlPage(PAGES.privacy)), { headers: { ...HTML_N, ...csrfHeader } });
      if (path === "/responsible") return new Response(addCookieConsent(await renderHtmlPage(PAGES.responsible)), { headers: { ...HTML_N, ...csrfHeader } });
      if (path === "/refund") return new Response(addCookieConsent(await renderHtmlPage(PAGES.refund)), { headers: { ...HTML_N, ...csrfHeader } });
      if (path === "/contact" || path === "/contact.html") {
        const redirectUrl = new URL("/help/support", url);
        const type = url.searchParams.get("type");
        if (type === "feedback") redirectUrl.pathname = "/help/feedback";
        for (const key of ["area", "return"]) {
          const value = url.searchParams.get(key);
          if (value) redirectUrl.searchParams.set(key, value);
        }
        return redirectResponse(redirectUrl, 302);
      }
      if (path === "/help.html") {
        return redirectResponse(new URL("/help", url), 302);
      }
      if (path === "/help") {
        const helpUser = await currentUser(request, env).catch(() => null);
        const helpHtml = await renderHtmlPage(PAGES.helpHub, { activePath: "/help", user: helpUser || undefined, theme: "dark" });
        return new Response(addCookieConsent(helpHtml), { headers: { ...HTML_N, ...csrfHeader } });
      }
      if (path.startsWith("/help/")) {
        const tab = path.slice("/help/".length).split("?")[0];
        const map = { support: "helpSupport", feedback: "helpFeedback" };
        const pageKey = map[tab];
        if (!pageKey) return redirectResponse(new URL("/help/support", url), 302);
        const helpUser = await currentUser(request, env).catch(() => null);
        const helpHtml = await renderHtmlPage(PAGES[pageKey], { activePath: path, user: helpUser || undefined, theme: "dark" });
        return new Response(addCookieConsent(helpHtml), { headers: { ...HTML_N, ...csrfHeader } });
      }
      if (path === "/pricing.html") return redirectResponse(`${url.origin}/pricing`, 301);
      if (path === "/faq.html") return redirectResponse(new URL("/faq", url), 301);
      if (path === "/reviews" || path === "/reviews.html") return new Response(addCookieConsent(await renderHtmlPage(PAGES.reviews)), { headers: { ...HTML_N, ...csrfHeader } });
      if (path === "/cookies" || path === "/cookies.html") return new Response(addCookieConsent(await renderHtmlPage(PAGES.cookies)), { headers: { ...HTML_N, ...csrfHeader } });


      // --- streamer logos (uploaded via dashboard, served as real images) ---
      if (path.startsWith("/logo/") && method === "GET") {
        return serveLogo(request, path);
      }

      // --- API routing ---
      if (method === "OPTIONS") {
        const preflight = handlePublicApiPreflight(path);
        if (preflight) return preflight;
      }

      // Pass all /api/ endpoints, Kick webhooks, and auth routes to Hono router.
      if (path.startsWith("/api/") || path.startsWith("/overlay/") || path === "/webhooks/kick" || path.startsWith("/auth/")) {
        const apiResponse = await apiAppImpl.fetch(request, { workerContext: { request, env, ctx, meta } }, ctx);
        // Return the handler's response, INCLUDING a legitimate 404 it produced.
        // Only fall through to page routing when no API route matched at all,
        // which the router tags with the x-no-api-route sentinel header.
        if (!(apiResponse.status === 404 && apiResponse.headers.get("x-no-api-route") === "1")) {
          return apiResponse;
        }
      }



      // --- /setup → /dashboard redirect (legacy bookmark fixup) ---
      if (method === "GET" && path === "/setup") {
        return redirectResponse(url.origin + "/dashboard", 302);
      }

      // --- permanent demo leaderboard (always works, no DB needed) ---
      // The demo board is virtual (no DB row), so the sections and legal pages
      // its own shell links to have to be served here too — otherwise
      // /demo/leaderboard, /demo/shop, /demo/me and every footer legal link
      // 404 and the demo tour is a dead end.
      const demoSub = method === "GET" && path.startsWith("/demo/")
        ? trimTrailingSlashes(path.slice("/demo/".length))
        : "";
      if (demoSub && LEGAL_PAGES.has(demoSub)) {
        return redirectResponse(`${url.origin}/${demoSub}`, 302);
      }
      if (method === "GET" && (path === "/demo" || DEMO_SECTIONS.has(demoSub))) {
        const demoSection = path === "/demo" ? "home" : demoSub;
        return new Response(
          await renderSite({
            r: {
              id: "demo",
              slug: "demo",
              plan: "pro",
              data: demoLeaderboardData(),
              viewerKickAuthEnabled: false,
              viewerDiscordAuthEnabled: false,
            },
            section: demoSection,
            viewer: null,
            viewerData: null,
            opts: {
              watermark: false,
              isDemo: true,
              homeUrl: url.origin,
              slug: "demo",
              isCustomDomain: false,
              nonce,
            },
          }),
          { headers: { ...HTML_N, "cache-control": "no-store" } }
        );
      }

      // --- tracked Join redirect: /go/<slug> → streamer's referral URL ---
      if (method === "GET" && path.startsWith("/go/")) {
        const ip = clientIp(request);
        if (!(await rateLimit(env, `go:${ip}`, 120, 60)).ok) return new Response("Too many requests", { status: 429, headers: HTML_N });
        let slug;
        try { slug = decodeURIComponent(path.slice(4).split("/")[0]).toLowerCase(); } catch { return new Response(notFoundPage("", nonce), { status: 404, headers: HTML_N }); }
        // Demo board has no DB row — send demo clicks to signup so the homepage CTA
        // isn't a dead 404.
        if (slug === "demo") {
          return redirectResponse(`${url.origin}/signup`, 302);
        }
        const clickRef = newClickRef();
        const r = await getClickRedirectSite(env, slug, request);
        if (!r) return new Response(notFoundPage(slug, nonce), { status: 404, headers: HTML_N });
        if (r.id && r.user_id) {
          deferClickWrite(ctx, () => one(
            "INSERT INTO site_clicks (click_ref, site_id, owner_id, cta_url) VALUES ($1, $2, $3, $4)",
            [clickRef, r.id, r.user_id, r.cta_url || null]
          ).then(() => enqueueBump(env, ctx, r.id, "clicks")));
        }
        // E2E-008: Only redirect to the CTA URL if it's a valid https:// URL.
        // If empty/null or non-https (javascript:, data:, relative paths),
        // redirect to the board page instead of risking a redirect loop.
        return trackedDestination(url.origin, slug, r.cta_url, clickRef);
      }

      // --- referral redirect: /ref/<code> → /signup?ref=<code> ---
      if (method === "GET" && path.startsWith("/ref/")) {
        let code;
        try { code = decodeURIComponent(path.slice(5).split("/")[0]); } catch { return new Response(notFoundPage("", nonce), { status: 404, headers: HTML_N }); }
        if (!code) return new Response(notFoundPage("", nonce), { status: 404, headers: HTML_N });
        return redirectResponse(`${url.origin}/signup?ref=${encodeURIComponent(code)}`, 302);
      }

      // --- OBS overlay: /<slug>/overlay ---
      if (method === "GET" && /^\/[^/]+\/overlay$/.test(path)) {
        let slug;
        try { slug = decodeURIComponent(path.slice(1).split("/")[0]).toLowerCase(); } catch { return new Response(notFoundPage("", nonce), { status: 404, headers: HTML_N }); }
        const layout = url.searchParams.get("layout") || "card";
        // Demo overlay: use hardcoded data (no DB)
        if (slug === "demo") {
          const overlayHtml = PAGES.overlay(demoLeaderboardData(), { slug: "demo", nonce, layout });
          return new Response(overlayHtml, { headers: { ...HTML_N, "cache-control": "no-store" } });
        }
        if (RESERVED.has(slug)) return new Response(notFoundPage(slug, nonce), { status: 404, headers: HTML_N });
        const r = await getPublicSite(env, slug, request, { limit: 100, offset: 0 });
        if (!r || r.suspended || r.requiresPassword) return new Response(notFoundPage(slug, nonce), { status: 404, headers: HTML_N });
        const paid = r.plan !== "free";
        if (!paid) {
          // Upsell page for free users
          const upsell = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>OBS Overlay — Pro Feature</title><style nonce="${nonce}">*{margin:0;padding:0;box-sizing:border-box}body{width:320px;background:rgba(8,8,12,0.95);font-family:'Segoe UI',system-ui,sans-serif;color:#fff;padding:20px;border-radius:12px;text-align:center}
h2{font-size:16px;margin-bottom:8px;background:linear-gradient(135deg,#5b5bf5,#5b5bf5);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
p{font-size:11px;color:rgba(255,255,255,0.5);line-height:1.5}
a{color:#5b5bf5;text-decoration:none;font-weight:600}</style></head><body>
<h2>🎬 OBS Overlay</h2>
<p>This is a Pro feature.<br/>Upgrade at <a href="/" target="_blank">yourrank.site</a> to unlock the live stream overlay with animated rankings.</p>
</body></html>`;
          return new Response(upsell, { headers: { ...HTML_N, "cache-control": "no-store" } });
        }
        const overlayHtml = PAGES.overlay(r.data, { slug, nonce, layout });
        return new Response(overlayHtml, { headers: { ...HTML_N, "cache-control": "no-store" } });
      }

      // --- per-site Hall of Fame at /<slug>/hall-of-fame ---
      if (method === "GET" && /^\/[^/]+\/hall-of-fame$/.test(path)) {
        let slug;
        try { slug = decodeURIComponent(path.slice(1).split("/")[0]).toLowerCase(); } catch { return new Response(notFoundPage("", nonce), { status: 404, headers: HTML_N }); }
        if (RESERVED.has(slug)) return new Response(notFoundPage(slug, nonce), { status: 404, headers: HTML_N });
        const r = await getPublicSite(env, slug, request);
        if (r && r.requiresPassword) {
          return new Response(renderPasswordGate(r, { nonce, isCustomDomain: false }), { headers: { ...HTML_N, "cache-control": "no-store" } });
        }
        if (!r || r.suspended) return new Response(notFoundPage(slug, nonce), { status: 404, headers: HTML_N });
        const paid = r.plan !== "free";
        return new Response(
          await renderNewHallOfFame(r.data, {
            nonce, slug, plan: r.plan, homeUrl: url.origin, isCustomDomain: false,
            logoUrl: paid && r.data.branding?.hasLogo ? `${url.origin}/logo/${slug}` : null,
          }),
          { headers: { ...HTML_N, "cache-control": "no-store" } }
        );
      }

      // --- embed widget: /<slug>/embed ---
      if (method === "GET" && /^\/[^/]+\/embed$/.test(path)) {
        let slug;
        try { slug = decodeURIComponent(path.slice(1).split("/")[0]).toLowerCase(); } catch { return new Response(notFoundPage("", nonce), { status: 404, headers: HTML_N }); }
        if (RESERVED.has(slug)) return new Response(notFoundPage(slug, nonce), { status: 404, headers: HTML_N });
        const r = await getPublicSite(env, slug, request);
        if (r && r.requiresPassword) {
          return new Response(renderPasswordGate(r, { nonce, isCustomDomain: false }), { headers: { ...HTML_N, "cache-control": "no-store" } });
        }
        if (!r || r.suspended) return new Response(notFoundPage(slug, nonce), { status: 404, headers: HTML_N });
        return new Response(renderNewEmbed(r.data, { nonce, slug, plan: r.plan, isCustomDomain: false }), { headers: { ...HTML_N, "cache-control": "no-store" } });
      }
      // --- per-site legal pages at /<slug>/<legal> ---
      if (method === "GET" && /^\/[^/]+\/(terms|privacy|responsible|cookies|refund|contact)$/.test(path)) {
        let slug;
        try { slug = decodeURIComponent(path.slice(1).split("/")[0]).toLowerCase(); } catch { return new Response(notFoundPage("", nonce), { status: 404, headers: HTML_N }); }
        if (RESERVED.has(slug)) return new Response(notFoundPage(slug, nonce), { status: 404, headers: HTML_N });
        const page = path.split("/").pop();
        const r = await getPublicSite(env, slug, request);
        if (r && r.requiresPassword) {
          return new Response(renderPasswordGate(r, { nonce, isCustomDomain: false }), { headers: { ...HTML_N, "cache-control": "no-store" } });
        }
        if (!r || r.suspended) return new Response(notFoundPage(slug, nonce), { status: 404, headers: HTML_N });
        const paid = r.plan !== "free";
        return new Response(
          await renderNewLegalPage(r.data, page, {
            nonce, slug, plan: r.plan, homeUrl: url.origin, isCustomDomain: false,
            logoUrl: paid && r.data.branding?.hasLogo ? `${url.origin}/logo/${slug}` : null,
          }),
          { headers: { ...HTML_N, "cache-control": "no-store" } }
        );
      }

      // --- per-player profile pages at /<slug>/player/<name> ---
      if (method === "GET" && /^\/[^/]+\/player\/.+/.test(path)) {
        let slug;
        try { slug = decodeURIComponent(path.slice(1).split("/")[0]).toLowerCase(); } catch { return new Response(notFoundPage("", nonce), { status: 404, headers: HTML_N }); }
        if (RESERVED.has(slug)) return new Response(notFoundPage(slug, nonce), { status: 404, headers: HTML_N });
        const r = await getPublicSite(env, slug, request);
        if (r && r.requiresPassword) {
          return new Response(renderPasswordGate(r, { nonce, isCustomDomain: false }), { headers: { ...HTML_N, "cache-control": "no-store" } });
        }
        if (!r || r.suspended) return new Response(notFoundPage(slug, nonce), { status: 404, headers: HTML_N });
        const playerName = path.split("/").slice(3).join("/");
        const profile = findProfilePlayer(r.data, playerName);
        if (!profile) return new Response(notFoundPage(slug, nonce), { status: 404, headers: HTML_N });
        const history = await buildPlayerHistory(env, r.id, playerName, r.plan);
        const paid = r.plan !== "free";
        return new Response(
          await renderNewPlayerProfile(r.data, { ...profile.player, rank: profile.rank }, history, {
            nonce, slug, plan: r.plan, homeUrl: url.origin, isCustomDomain: false,
            logoUrl: paid && r.data.branding?.hasLogo ? `${url.origin}/logo/${slug}` : null,
          }),
          { headers: { ...HTML_N, "cache-control": "no-store" } }
        );
      }

      // --- streamer profile pages at /<slug>/profile ---
      if (method === "GET" && /^\/[^/]+\/profile$/.test(path)) {
        let slug;
        try { slug = decodeURIComponent(path.slice(1).split("/")[0]).toLowerCase(); } catch { return new Response(notFoundPage("", nonce), { status: 404, headers: HTML_N }); }
        if (RESERVED.has(slug)) return new Response(notFoundPage(slug, nonce), { status: 404, headers: HTML_N });
        const r = await getPublicSite(env, slug, request);
        if (r && r.requiresPassword) {
          return new Response(renderPasswordGate(r, { nonce, isCustomDomain: false }), { headers: { ...HTML_N, "cache-control": "no-store" } });
        }
        if (!r || r.suspended) return new Response(notFoundPage(slug, nonce), { status: 404, headers: HTML_N });
        const paid = r.plan !== "free";
        return new Response(
          await renderNewStreamerProfile(r.data, {
            nonce, slug, plan: r.plan, homeUrl: url.origin, isCustomDomain: false,
            logoUrl: paid && r.data.branding?.hasLogo ? `${url.origin}/logo/${slug}` : null,
            boards: r.boards, botUsername: r.botUsername,
          }),
          { headers: { ...HTML_N, "cache-control": "no-store" } }
        );
      }

      // --- legacy public credits URL: the new shell's Shop is the canonical page ---
      if (method === "GET" && /^\/[^/]+\/credits$/.test(path)) {
        let slug;
        try { slug = decodeURIComponent(path.slice(1).split("/")[0]).toLowerCase(); } catch { return new Response(notFoundPage("", nonce), { status: 404, headers: HTML_N }); }
        if (RESERVED.has(slug)) return new Response(notFoundPage(slug, nonce), { status: 404, headers: HTML_N });
        const r = await getPublicSite(env, slug, request);
        if (r && r.requiresPassword) {
          return new Response(renderPasswordGate(r, { nonce, isCustomDomain: false }), { headers: { ...HTML_N, "cache-control": "no-store" } });
        }
        if (!r || r.suspended) return new Response(notFoundPage(slug, nonce), { status: 404, headers: HTML_N });
        const shopUrl = new URL(url);
        shopUrl.pathname = `/${slug}/shop`;
        return redirectResponse(shopUrl, 302);
      }

      // --- password unlock submission for public boards ---
      if (method === "POST" && /^\/[^/]+\/password$/.test(path)) {
        let slug;
        try { slug = decodeURIComponent(path.slice(1).split("/")[0]).toLowerCase(); } catch { return new Response(notFoundPage("", nonce), { status: 404, headers: HTML_N }); }
        if (RESERVED.has(slug)) return new Response(notFoundPage(slug, nonce), { status: 404, headers: HTML_N });
        const site = await getBySlug(env, slug);
        if (!site || !site.published || !site.password_hash) {
          return new Response(notFoundPage(slug, nonce), { status: 404, headers: HTML_N });
        }
        const form = await request.formData().catch(() => null);
        const password = form ? String(form.get("password") || "") : "";
        if (!await verifyBoardPassword(password, site)) {
          return new Response(renderPasswordGate(site, { nonce, isCustomDomain: false }, "Incorrect password."), { headers: { ...HTML_N, "cache-control": "no-store" } });
        }
        const token = await issueBoardPasswordToken(site);
        const cookie = boardPasswordSetCookieHeader(site, token, { isCustomDomain: false });
        return new Response(null, { status: 302, headers: { "location": `/${slug}`, "set-cookie": cookie } });
      }
      // --- branded site sections: /<slug>, /<slug>/leaderboard, /shop, /games, /me ---
      const siteRoute = parseSitePath(path, false);
      if (siteRoute) {
        return renderSiteRoute({ request, env, ctx, nonce, slug: siteRoute.slug, section: siteRoute.section, isCustomDomain: false });
      }
      // --- public leaderboard at /<slug> ---
      if (method === "GET" && path.length > 1 && !path.includes(".")) {
        let slug;
        try { slug = decodeURIComponent(path.slice(1).split("/")[0]).toLowerCase(); } catch { return new Response(notFoundPage("", nonce), { status: 404, headers: HTML_N }); }
        // BUG-004: Reject paths with extra segments (e.g., /slug/widget).
        // /<slug>/overlay is handled above; anything else is a 404.
        if (path !== `/${slug}` && path !== `/${slug}/`) return new Response(notFoundPage(slug, nonce), { status: 404, headers: HTML_N });
        if (RESERVED.has(slug)) return new Response(notFoundPage(slug, nonce), { status: 404, headers: HTML_N });
        const r = await getPublicSite(env, slug, request);
        if (r && r.requiresPassword) {
          return new Response(renderPasswordGate(r, { nonce, isCustomDomain: false }), { headers: { ...HTML_N, "cache-control": "no-store" } });
        }
        if (!r) {
          // Check if site exists but is unpublished — return 404 with noindex
          // BUG-002 FIX: sites table has no 'suspended' column; join users to get status.
          const rawSite = await findSiteStatus(slug);
          if (rawSite && rawSite.suspended) return new Response(suspendedPage(nonce), { status: 403, headers: HTML_N });
          return new Response(notFoundPage(slug, nonce), { status: 404, headers: HTML_N });
        }
        if (r.pendingVerification) return new Response(pendingVerificationPage(nonce), { status: 403, headers: HTML_N });
        if (r.suspended) return new Response(suspendedPage(nonce), { status: 403, headers: HTML_N });
        // Stable visitor token for new-vs-returning analytics. 1-year cookie, hashed before DB storage.
        // Only set analytics cookies when the user has explicitly opted in via the cookie banner.
        const respHeaders = new Headers({ ...HTML_N, "cache-control": "no-store" });
        let visitorHash = null;
        const cookies = request.headers.get("cookie") || "";
        let vid = "";
        let consent = "";
        for (const c of cookies.split(";")) {
          const [k, v] = c.trim().split("=");
          if (k === "yr_vid") { vid = decodeURIComponent(v || ""); }
          if (k === "yr_consent") { consent = decodeURIComponent(v || ""); }
        }
        const analyticsAllowed = consent === "all";
        if (analyticsAllowed) {
          if (!vid) {
            vid = crypto.randomUUID();
            respHeaders.append("set-cookie", `yr_vid=${vid}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`);
          }
          if (vid && r.id) visitorHash = await hashToken(`${vid}:${r.id}`);

          // Only count one view per slug per browser per 24h (cookie-based cooldown).
          const viewCookieName = `__v_${slug}`;
          const alreadyViewed = new RegExp(`(?:^|;\\s*)${viewCookieName}=`).test(cookies);
          if (r.id && !alreadyViewed) {
            const ref = request.headers.get("referer") || request.headers.get("Referer") || "";
            enqueueBump(env, ctx, r.id, "views", ref, visitorHash);
            respHeaders.append("set-cookie", `${viewCookieName}=1; Path=/${slug}; Max-Age=86400; SameSite=Lax; Secure`);
          }
        }
        return new Response(
          await renderSite({
            r,
            section: "home",
            viewer: null,
            viewerData: null,
            opts: {
              homeUrl: url.origin,
              slug,
              nonce,
              isCustomDomain: false,
              logoUrl: r.plan !== "free" && r.data.branding?.hasLogo
                ? `${url.origin}/logo/${slug}`
                : null,
            },
          }),
          { headers: respHeaders }
        );
      }

      return new Response(notFoundPage("", nonce), { status: 404, headers: HTML_N });
    } catch (err) {
      const errPath = (() => { try { return new URL(request.url).pathname; } catch { return "unknown"; } })();
      if (workerLog) workerLog.error("unhandled_error", { error: String(err?.message || err), stack: err?.stack, path: errPath });
      else console.error(`[leaderboard] unhandled error on ${errPath}:`, String(err?.message || err), err?.stack || "");
      // Fire-and-forget Discord monitoring webhook
      if (env.DISCORD_MONITORING_WEBHOOK) {
        ctx.waitUntil(sendErrorToDiscord({
          webhookUrl: env.DISCORD_MONITORING_WEBHOOK,
          title: "YourRank Error",
          message: String(err?.stack || err?.message || err),
          path: errPath,
          worker: "leaderboard",
        }));
      }
      return new Response(error500Page(nonce), { status: 500, headers: HTML_N });
    }
}

// Durable Object classes must be exported from the main module.
export { RateLimiter, LiveBoard };

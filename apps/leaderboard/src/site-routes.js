// Public multi-section site route handler.
// This is the single entry-point for /<slug> and /<slug>/<section> on the
// primary domain, plus the matching paths on custom domains. It enforces
// section visibility server-side, resolves the viewer session, and renders
// the shared site shell.
import { getPublicSite as defaultGetPublicSite } from "./site.js";
import { resolveViewer as defaultResolveViewer } from "@yourrank/shared/viewer-session";
import { createQueueProducer as defaultCreateQueueProducer } from "@yourrank/shared/queue-producer";
import { directQueueFallback } from "@yourrank/shared/queue-effects";
import { decideBoardView } from "@yourrank/shared/board-views";
import { parseViewerIntent } from "@yourrank/shared/viewer-intent";
import { isRewardId } from "@yourrank/shared/reward-detail";
import { hashToken as defaultHashToken } from "@yourrank/shared/crypto";
import { HTML, withNonce, notFoundPage, pendingVerificationPage, error500Page } from "./middleware/headers.js";
import { generateCsrfToken, csrfCookie } from "./middleware/csrf.js";
import { renderPasswordGate as defaultRenderPasswordGate } from "./password-gate.js";
import { renderSite as defaultRenderSite, effectivePublicSections, parsePublicBoard, publicLeaderboardBoards, siteSectionFromPath, siteSectionHref, siteSectionPath } from "@yourrank/shared/site-render";
import { getViewerSiteData as defaultGetViewerSiteData, getShopItem as defaultGetShopItem, getLoyaltyBoard as defaultGetLoyaltyBoard } from "./site-data.js";
import { gamesIslandHead, gamesIslandMount } from "@yourrank/shared/games-embed";
import {
  cachedPublicBoardResponse,
  getPublicBoardCache,
  isPublicBoardCacheRequest,
  isPublicBoardCacheSite,
  PUBLIC_HTML_CSRF_PLACEHOLDER,
  PUBLIC_HTML_NONCE_PLACEHOLDER,
  putPublicBoardCache,
} from "./public-html-cache.js";
import { setRequestMetrics } from "@yourrank/shared/request-id";

const SECTIONS = new Set(["home", "leaderboard", "shop", "games", "me"]);
// Former public segments; requests using them resolve to the section and carry
// `redirectTo`, the canonical path, so old links and bookmarks keep working.
const LEGACY_SEGMENTS = new Map([["me", "me"]]);

function sectionRoute(seg, slug, isCustomDomain) {
  const legacy = LEGACY_SEGMENTS.get(seg);
  if (legacy) return { slug, section: legacy, redirectTo: siteSectionHref(legacy, slug, isCustomDomain) };
  const section = siteSectionFromPath(seg);
  // A renamed section answers only to its public segment, never its internal id.
  if (!SECTIONS.has(section) || siteSectionPath(section) !== seg) return null;
  return { slug, section };
}

export function parseSitePath(path, isCustomDomain, customSlug) {
  const clean = (path || "").replace(/\/$/, "") || "/";
  if (isCustomDomain) {
    if (clean === "/") return { slug: customSlug, section: "home" };
    const [seg, rewardId, ...rest] = clean.slice(1).split("/");
    if (rest.length) return null;
    const route = sectionRoute(seg, customSlug, true);
    if (!route) return null;
    if (rewardId === undefined) return route;
    return route.section === "shop" && isRewardId(rewardId) ? { ...route, rewardId } : null;
  }
  const parts = clean.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  const slug = decodeURIComponent(parts[0]).toLowerCase();
  if (parts.length === 1) return { slug, section: "home" };
  const route = sectionRoute(parts[1].toLowerCase(), slug, false);
  if (!route) return null;
  if (parts.length === 2) return route;
  // Only Rewards has a stable per-item URL: /<slug>/shop/<rewardId>.
  if (parts.length === 3 && route.section === "shop" && isRewardId(parts[2])) return { ...route, rewardId: parts[2] };
  return null;
}

function enqueueBump(env, ctx, siteId, field, referer, visitorHash, deps) {
  const producer = deps.createQueueProducer(env.EVENTS_QUEUE, deps.queueFallback, env);
  const p = producer.send({ type: "bump", siteId, field, referer, visitorHash, timestamp: Date.now() });
  ctx.waitUntil(p);
}

async function bumpView(env, ctx, request, siteId, slug, headers, deps) {
  const decision = await decideBoardView({
    request,
    siteId,
    slug,
    hashToken: deps.hashToken,
  });
  for (const cookie of decision.setCookies) headers.append("set-cookie", cookie);
  if (decision.shouldBump) {
    enqueueBump(env, ctx, siteId, "views", decision.referer, decision.visitorHash, deps);
  }
}

export async function renderSiteRoute({ request, env, ctx, nonce, slug, section, rewardId = "", isCustomDomain, deps = {} }) {
  const {
    getPublicSite = defaultGetPublicSite,
    resolveViewer = defaultResolveViewer,
    createQueueProducer = defaultCreateQueueProducer,
    queueFallback = directQueueFallback,
    hashToken = defaultHashToken,
    renderPasswordGate = defaultRenderPasswordGate,
    renderSite = defaultRenderSite,
    getViewerSiteData = defaultGetViewerSiteData,
    getShopItem = defaultGetShopItem,
    getLoyaltyBoard = defaultGetLoyaltyBoard,
  } = deps;
  const collaborators = { createQueueProducer, queueFallback, hashToken };
  setRequestMetrics({ route: rewardId ? "/site/shop/:rewardId" : `/site/${section}`, site: slug });
  const cacheableRequest = isPublicBoardCacheRequest(request, section);
  const HTML_N = withNonce(HTML, nonce);
  const respHeaders = new Headers({ ...HTML_N, "cache-control": "no-store" });

  try {
    if (cacheableRequest) {
      const cached = await getPublicBoardCache(request);
      if (cached) {
        setRequestMetrics({ cache: "hit" });
        const csrfToken = generateCsrfToken();
        return cachedPublicBoardResponse(cached, nonce, csrfToken, csrfCookie(csrfToken, request));
      }
      setRequestMetrics({ cache: "miss" });
    }

    const url = new URL(request.url);
    const isDemo = url.searchParams.get("demo") === "1" || url.searchParams.get("preview") === "1" || url.searchParams.get("embed") === "1";

    const r = await getPublicSite(env, slug, request, { limit: 100, offset: 0 });
    if (r && r.requiresPassword && !isDemo) {
      return new Response(renderPasswordGate(r, { nonce, isCustomDomain }), { headers: respHeaders });
    }
    if (r && r.pendingVerification && !isDemo) {
      return new Response(pendingVerificationPage(nonce), { status: 403, headers: HTML_N });
    }
    if (!r || r.suspended) {
      return new Response(notFoundPage(slug, nonce), { status: 404, headers: HTML_N });
    }

    const siteSections = effectivePublicSections(r.data);
    if (!siteSections[section] && !(section === "games" && isDemo)) {
      // A disabled leaderboard is not a public section at all: send visitors
      // (and stale bookmarks) to Home rather than rendering standings or
      // answering a bare 404. Other disabled sections keep the 404 contract.
      if (section === "leaderboard") {
        return new Response(null, {
          status: 302,
          headers: { location: siteSectionHref("home", slug, isCustomDomain), "cache-control": "no-store" },
        });
      }
      return new Response(notFoundPage(slug, nonce), { status: 404, headers: HTML_N });
    }

    // `?board=` is URL state inside the one Leaderboard section. Main is the
    // default; a Loyalty link whose board the creator has since turned off
    // falls back to Main instead of exposing the standings.
    let board = "main";
    if (section === "leaderboard") {
      board = parsePublicBoard(url.searchParams.get("board"));
      if (board !== "main" && !publicLeaderboardBoards(r.data).includes(board)) {
        return new Response(null, {
          status: 302,
          headers: { location: siteSectionHref("leaderboard", slug, isCustomDomain), "cache-control": "no-store" },
        });
      }
    }

    const cacheableSite = cacheableRequest && isPublicBoardCacheSite(r);
    const { viewer, cookie: viewerCookie } = await resolveViewer(request, env, { siteId: r.id });
    if (viewer) {
      respHeaders.set("cache-control", "private, no-store");
      respHeaders.append("vary", "Cookie");
    }
    if (viewerCookie) respHeaders.append("set-cookie", viewerCookie);

    const renderNonce = cacheableSite ? PUBLIC_HTML_NONCE_PLACEHOLDER : nonce;
    const csrfToken = cacheableSite ? PUBLIC_HTML_CSRF_PLACEHOLDER : generateCsrfToken();
    respHeaders.append("set-cookie", csrfCookie(csrfToken, request));

    const homeUrl = url.origin;
    const paid = r.plan !== "free";
    const watermark = !paid;
    const logoUrl = paid && r.data?.branding?.hasLogo ? `${homeUrl}/logo/${slug}` : null;
    const bannerUrl = paid && r.data?.branding?.hasBanner ? `${homeUrl}/banner/${slug}` : null;

    let viewerData = null;
    if (section === "home" || section === "shop" || section === "me") {
      // Each surface composes only the canonical reads it owns. Personalized
      // history is loaded only after site-scoped Membership resolution.
      const opts = section === "home"
        ? { shop: true, claims: !!viewer, ledger: !!viewer }
        : section === "shop"
          ? { shop: true, claims: !!viewer }
          : { shop: siteSections.shop !== false, claims: !!viewer, ledger: !!viewer, participation: !!viewer };
      viewerData = await getViewerSiteData(r.id, viewer?.id || null, opts);
    } else if (viewer) {
      // The viewer overview reads membership Claims; Games keeps its balance-only contract.
      viewerData = await getViewerSiteData(r.id, viewer.id, section === "games" ? {} : { shop: siteSections.shop !== false, claims: true });
    }

    // The detail page reads its reward directly so a withdrawn (inactive) reward
    // can still be described honestly instead of vanishing from the catalog list.
    let reward = null;
    let status = 200;
    if (rewardId) {
      reward = await getShopItem(r.id, rewardId);
      if (!reward || reward.active === false) status = 404;
    }

    if (section === "home" || section === "leaderboard") {
      await bumpView(env, ctx, request, r.id, slug, respHeaders, collaborators);
    }

    const loyalty = board === "loyalty" ? await getLoyaltyBoard(r.id) : [];

    if (section === "games" && (url.searchParams.get("embed") === "1" || url.searchParams.get("isolated") === "1")) {
      const b = r.data?.brand || {};
      const mount = gamesIslandMount({
        slug,
        nonce,
        siteName: b.name || slug,
        logoUrl: logoUrl || null,
        creditsUrl: `/${slug}/credits`,
        signInUrl: r.viewerKickAuthEnabled
          ? `/api/viewer/auth/kick?returnTo=${encodeURIComponent(isCustomDomain ? "/games" : `/${slug}/games`)}`
          : (r.viewerDiscordAuthEnabled
            ? `/api/viewer/auth/discord?returnTo=${encodeURIComponent(isCustomDomain ? "/games" : `/${slug}/games`)}`
            : "/me"),
        header: false,
      });
      const embedHtml = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Mini-games preview</title>
${gamesIslandHead()}
<style nonce="${nonce}">
  html, body { margin: 0; padding: 0; background: #0c1017; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow-x: hidden; }
  .gx-embed-wrap { max-width: 100%; margin: 0 auto; padding: 12px; }
</style>
</head><body><div class="gx-embed-wrap">${mount}</div></body></html>`;
      return new Response(embedHtml, { headers: { ...Object.fromEntries(respHeaders.entries()), "content-type": "text/html; charset=utf-8" } });
    }

    const html = await renderSite({
      r,
      section,
      viewer,
      viewerData,
      opts: {
        nonce: renderNonce,
        homeUrl,
        slug,
        isCustomDomain,
        logoUrl,
        bannerUrl,
        watermark,
        csrfToken,
        boards: r.boards,
        board,
        loyalty,
        botUsername: r.botUsername,
        isDemo,
        viewerAuthError: section === "me" ? url.searchParams.get("error") : null,
        viewerIntent: section === "me" ? parseViewerIntent(url) : null,
        rewardId,
        reward,
      },
    });
    const responseHeaders = cacheableSite
      ? new Headers({
        ...Object.fromEntries(respHeaders.entries()),
        ...withNonce(HTML, PUBLIC_HTML_NONCE_PLACEHOLDER),
      })
      : respHeaders;
    const response = new Response(html, { status, headers: responseHeaders });
    setRequestMetrics({ payloadBytes: new TextEncoder().encode(html).byteLength });
    if (cacheableSite) {
      if (ctx?.waitUntil) ctx.waitUntil(putPublicBoardCache(request, response));
      else await putPublicBoardCache(request, response);
      const servedCsrfToken = generateCsrfToken();
      return cachedPublicBoardResponse(response, nonce, servedCsrfToken, csrfCookie(servedCsrfToken, request));
    }
    return response;
  } catch (err) {
    console.error("[site-routes]", String(err?.message || err), err?.stack);
    return new Response(error500Page(nonce), { status: 500, headers: HTML_N });
  }
}

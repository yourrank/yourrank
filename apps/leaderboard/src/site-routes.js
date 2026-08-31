// Public multi-section site route handler.
// This is the single entry-point for /<slug> and /<slug>/<section> on the
// primary domain, plus the matching paths on custom domains. It enforces
// section visibility server-side, resolves the viewer session, and renders
// the shared site shell.
import { getPublicSite as defaultGetPublicSite } from "./site.js";
import { resolveViewer as defaultResolveViewer } from "@yourrank/shared/viewer-session";
import { createQueueProducer as defaultCreateQueueProducer } from "@yourrank/shared/queue-producer";
import { decideBoardView } from "@yourrank/shared/board-views";
import { bumpStat as defaultBumpStat } from "./stats.js";
import { hashToken as defaultHashToken } from "@yourrank/shared/crypto";
import { HTML, withNonce, notFoundPage, pendingVerificationPage, error500Page } from "./middleware/headers.js";
import { generateCsrfToken, csrfCookie } from "./middleware/csrf.js";
import { renderPasswordGate as defaultRenderPasswordGate } from "./password-gate.js";
import { renderSite as defaultRenderSite } from "@yourrank/shared/site-render";
import { getViewerSiteData as defaultGetViewerSiteData } from "./site-data.js";
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

export function parseSitePath(path, isCustomDomain, customSlug) {
  const clean = (path || "").replace(/\/$/, "") || "/";
  if (isCustomDomain) {
    if (clean === "/") return { slug: customSlug, section: "home" };
    const seg = clean.slice(1).split("/")[0];
    if (SECTIONS.has(seg) && clean === `/${seg}`) return { slug: customSlug, section: seg };
    return null;
  }
  const parts = clean.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  const slug = decodeURIComponent(parts[0]).toLowerCase();
  if (parts.length === 1) return { slug, section: "home" };
  if (parts.length === 2) {
    const section = parts[1].toLowerCase();
    if (SECTIONS.has(section)) return { slug, section };
  }
  return null;
}

function enqueueBump(env, ctx, siteId, field, referer, visitorHash, deps) {
  const producer = deps.createQueueProducer(
    env.EVENTS_QUEUE,
    async (event) => {
      if (event.type === "bump") {
        await deps.bumpStat(event.siteId, event.field, event.referer, event.visitorHash);
      }
    }
  );
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

export async function renderSiteRoute({ request, env, ctx, nonce, slug, section, isCustomDomain, deps = {} }) {
  const {
    getPublicSite = defaultGetPublicSite,
    resolveViewer = defaultResolveViewer,
    createQueueProducer = defaultCreateQueueProducer,
    bumpStat = defaultBumpStat,
    hashToken = defaultHashToken,
    renderPasswordGate = defaultRenderPasswordGate,
    renderSite = defaultRenderSite,
    getViewerSiteData = defaultGetViewerSiteData,
  } = deps;
  const collaborators = { createQueueProducer, bumpStat, hashToken };
  setRequestMetrics({ route: `/site/${section}`, site: slug });
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

    const siteSections = r.data?.siteSections || { home: true, leaderboard: true, shop: true, games: false, me: true };
    if (!siteSections[section] && !(section === "games" && isDemo)) {
      return new Response(notFoundPage(slug, nonce), { status: 404, headers: HTML_N });
    }

    const cacheableSite = cacheableRequest && isPublicBoardCacheSite(r);
    const { viewer, cookie: viewerCookie } = await resolveViewer(request, env);
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

    let viewerData = null;
    if (section === "home" || section === "shop" || section === "me") {
      // Each surface composes only the canonical reads it owns. Personalized
      // history is loaded only after site-scoped Membership resolution.
      const opts = section === "home"
        ? { shop: true }
        : section === "shop"
          ? { shop: true, claims: !!viewer }
          : { claims: !!viewer, ledger: !!viewer, participation: !!viewer };
      viewerData = await getViewerSiteData(r.id, viewer?.id || null, opts);
    } else if (viewer) {
      // Leaderboard and Games only need the balance shown in the header.
      viewerData = await getViewerSiteData(r.id, viewer.id);
    }

    if (section === "home" || section === "leaderboard") {
      await bumpView(env, ctx, request, r.id, slug, respHeaders, collaborators);
    }

    if (section === "games" && (url.searchParams.get("embed") === "1" || url.searchParams.get("isolated") === "1")) {
      const b = r.data?.brand || {};
      const mount = gamesIslandMount({
        slug,
        nonce,
        siteName: b.name || slug,
        logoUrl: logoUrl || null,
        creditsUrl: `/${slug}/credits`,
        signInUrl: `/api/viewer/auth/kick?returnTo=${encodeURIComponent(isCustomDomain ? "/games" : `/${slug}/games`)}`,
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
        watermark,
        csrfToken,
        boards: r.boards,
        botUsername: r.botUsername,
        isDemo,
        viewerAuthError: section === "me" ? url.searchParams.get("error") : null,
      },
    });
    const responseHeaders = cacheableSite
      ? new Headers({
        ...Object.fromEntries(respHeaders.entries()),
        ...withNonce(HTML, PUBLIC_HTML_NONCE_PLACEHOLDER),
      })
      : respHeaders;
    const response = new Response(html, { headers: responseHeaders });
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

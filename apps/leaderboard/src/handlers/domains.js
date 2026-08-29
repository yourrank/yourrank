// Domain purchase, automated DNS setup, and transfer management API handlers.
import { requireUser, ok, bad, readJson } from "../auth.js";
import { getByUser, getBoardById, invalidateSiteCache, invalidateUserCache } from "../site.js";
import { one, exec, withTransaction } from "@yourrank/shared/db";
import { getDomainProvider, SUPPORTED_TLDS } from "@yourrank/shared/domain-provider";
import { rateLimit } from "@yourrank/shared/ratelimit";
import { PLATFORM_HOST } from "../constants.js";
import { invalidateCustomDomain } from "../middleware/custom-domain.js";
import { logAudit } from "@yourrank/shared/audit";
import { effectivePlan, BOARD_LIMITS } from "@yourrank/shared/plans";
import { requireSiteCapability } from "../site-authorization.js";

const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;

function cleanDomainName(raw) {
  return String(raw || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

function isDisallowedDomain(domain) {
  if (!domain) return true;
  if (domain === "localhost" || domain.endsWith(".localhost") || domain.endsWith(".internal")) return true;
  if (domain === PLATFORM_HOST || domain.endsWith(`.${PLATFORM_HOST}`)) return true;
  return false;
}

/**
 * POST /api/domains/search — Search domain availability across popular TLDs with retail pricing
 */
export async function handleDomainSearch(request, env) {
  try {
    const { user, res } = await requireUser(request, env);
    if (res) return res;

    const rl = await rateLimit(env, `domain:search:${user.id}`, 60, 60);
    if (!rl.ok) return bad("Too many domain searches. Please wait a moment.", 429);

    const body = await readJson(request);
    const rawQuery = String(body?.query || "").trim().toLowerCase();
    if (!rawQuery) return bad("Please enter a domain name to search.");

    const provider = getDomainProvider(env);
    const cleanKeyword = rawQuery.replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
    if (!cleanKeyword || cleanKeyword.length < 2) {
      return bad("Domain keyword must be at least 2 characters.");
    }

    const results = await provider.searchSuggestions(cleanKeyword, SUPPORTED_TLDS);

    return ok({
      query: cleanKeyword,
      results: results.map((r) => ({
        domain: r.domain,
        tld: r.tld,
        available: r.available && !isDisallowedDomain(r.domain),
        priceFormatted: `$${(r.price / 100).toFixed(2)}/yr`,
        priceCents: r.price,
        currency: r.currency,
      })),
    });
  } catch (err) {
    console.error("[domain-search] error:", String(err?.message || err));
    return bad("An error occurred while searching domains.", 500);
  }
}

/**
 * POST /api/domains/purchase — Purchase a domain with instant 1-click CNAME DNS & SSL linking
 */
export async function handleDomainPurchase(request, env, {
  requireUserImpl = requireUser,
  rateLimitImpl = rateLimit,
  getByUserImpl = getByUser,
  getBoardByIdImpl = getBoardById,
  oneImpl = one,
  getDomainProviderImpl = getDomainProvider,
  requireSiteCapabilityImpl = requireSiteCapability,
} = {}) {
  try {
    const { user, res } = await requireUserImpl(request, env);
    if (res) return res;

    if (user.status === "suspended") return bad("This account is suspended.", 403);

    const rl = await rateLimitImpl(env, `domain:purchase:${user.id}`, 5, 300);
    if (!rl.ok) return bad("Too many domain purchase attempts. Please try again later.", 429);

    const body = await readJson(request);
    const domain = cleanDomainName(body?.domain);
    if (!domain || !DOMAIN_REGEX.test(domain) || domain.length > 253) {
      return bad("Invalid domain name format.");
    }

    if (isDisallowedDomain(domain)) {
      return bad("Cannot purchase or assign this domain name.");
    }

    const url = new URL(request.url);
    const siteId = body?.siteId || url.searchParams.get("siteId");
    const site = siteId ? await getBoardByIdImpl(env, user.id, siteId) : await getByUserImpl(env, user.id);
    if (!site) return bad("No site found for this account.", 404);
    const authorization = await requireSiteCapabilityImpl(
      user,
      site,
      "canRoleManageBilling"
    );
    if (authorization.res) return authorization.res;

    const plan = effectivePlan(user);
    if (plan !== "pro" && plan !== "team") return bad("Custom domains require Pro or Team.", 403);
    const activeOrderFilter = "status NOT IN ('cancelled', 'expired') AND expires_at > now()";
    const siteOrder = await oneImpl(
      `SELECT id FROM domain_orders WHERE site_id=$1 AND ${activeOrderFilter} LIMIT 1`,
      [site.id]
    );
    if (siteOrder) return bad("This site already has an active domain order.", 400);
    const userOrderCount = await oneImpl(
      `SELECT count(*)::int AS count FROM domain_orders WHERE user_id=$1 AND ${activeOrderFilter}`,
      [user.id]
    );
    if (Number(userOrderCount?.count || 0) >= (BOARD_LIMITS[plan] || 1)) {
      return bad(`Your plan allows up to ${BOARD_LIMITS[plan]} active domain orders.`, 400);
    }

    // Check if domain is already owned in our database
    const existingOrder = await oneImpl("SELECT id, user_id FROM domain_orders WHERE domain=$1", [domain]);
    if (existingOrder) {
      return bad("This domain has already been purchased or is currently active.", 400);
    }

    const provider = getDomainProviderImpl(env);
    const check = await provider.checkAvailability(domain);
    if (!check.available) {
      return bad("This domain is no longer available for registration.", 400);
    }

    // Execute registrar registration
    const purchaseResult = await provider.purchaseDomain({
      domain,
      years: 1,
      registrant: {
        firstName: user.display_name?.split(" ")[0] || "Creator",
        lastName: user.display_name?.split(" ").slice(1).join(" ") || "Streamer",
        email: user.email || "domain@yourrank.site",
        address: "100 Creator Blvd",
        city: "San Francisco",
        country: "US",
        phone: "+1.5555555555",
      },
      cnameTarget: PLATFORM_HOST,
    });

    if (!purchaseResult.success) {
      return bad(purchaseResult.error || "Failed to register domain with registrar.", 400);
    }

    // Record order in database and attach domain to the streamer's site
    await withTransaction(async (tx) => {
      await tx.unsafe(
        `INSERT INTO domain_orders (user_id, site_id, domain, provider, provider_order_id, amount_paid, wholesale_cost, currency, status, locked, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', true, $9)`,
        [
          user.id,
          site.id,
          domain,
          "namecheap",
          purchaseResult.orderId,
          purchaseResult.chargedAmount,
          purchaseResult.wholesaleCost,
          purchaseResult.currency,
          purchaseResult.expiresAt,
        ]
      );

      await tx.unsafe(
        `UPDATE sites SET custom_domain=$1, domain_status='active', updated_at=now() WHERE id=$2`,
        [domain, site.id]
      );
    });

    // Provision Cloudflare Custom Hostname SSL/TLS if credentials present
    const zoneId = env.CF_ZONE_ID;
    const cfToken = env.CF_API_TOKEN;
    if (zoneId && cfToken) {
      try {
        const cfRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/custom_hostnames`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${cfToken}`, "Content-Type": "application/json" },
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({
            hostname: domain,
            ssl: { method: "http", type: "dv" },
          }),
        });
        const cfData = await cfRes.json();
        if (cfData.success && cfData.result?.id) {
          await exec("UPDATE sites SET custom_hostname_id=$1 WHERE id=$2", [cfData.result.id, site.id]);
        }
      } catch (e) {
        console.error("[domain-purchase] CF custom hostname error:", String(e?.message || e));
      }
    }

    invalidateSiteCache(env, site.slug);
    invalidateUserCache(env, user.id);
    invalidateCustomDomain(domain);

    await logAudit({
      actorId: user.id,
      action: "domain_purchase",
      entityType: "domain",
      entityId: site.id,
      request,
      details: { domain, orderId: purchaseResult.orderId, amount: purchaseResult.chargedAmount },
    });

    return ok({
      domain,
      orderId: purchaseResult.orderId,
      expiresAt: purchaseResult.expiresAt,
      status: "active",
      message: `Domain ${domain} registered and linked to your site! 🚀`,
    });
  } catch (err) {
    console.error("[domain-purchase] error:", String(err?.message || err));
    return bad("An error occurred while processing domain purchase.", 500);
  }
}

/**
 * GET /api/domains/my-domain — Get active custom domain details & transfer status for current site/user
 */
export async function handleGetMyDomain(request, env, {
  getByUserImpl = getByUser,
  getBoardByIdImpl = getBoardById,
  requireSiteCapabilityImpl = requireSiteCapability,
} = {}) {
  try {
    const { user, res } = await requireUser(request, env);
    if (res) return res;

    const url = new URL(request.url);
    const siteId = url.searchParams.get("siteId");
    const site = siteId ? await getBoardByIdImpl(env, user.id, siteId) : await getByUserImpl(env, user.id);
    if (!site) return bad("Site not found", 404);
    const authorization = await requireSiteCapabilityImpl(
      user,
      site,
      "canRoleManageBilling"
    );
    if (authorization.res) return authorization.res;

    const order = await one(
      `SELECT id, domain, provider, status, auto_renew, locked, expires_at, created_at
         FROM domain_orders
        WHERE user_id=$1 AND (site_id=$2 OR domain=$3)
        ORDER BY created_at DESC LIMIT 1`,
      [user.id, site.id, site.custom_domain || ""]
    );

    return ok({
      customDomain: site.custom_domain || null,
      domainStatus: site.domain_status || null,
      order: order || null,
      isDirectlyPurchased: Boolean(order),
    });
  } catch (err) {
    console.error("[domain-get] error:", String(err?.message || err));
    return bad("An error occurred while fetching domain details.", 500);
  }
}

/**
 * POST /api/domains/toggle-lock — Enable/disable ICANN registrar transfer lock
 */
export async function handleDomainToggleLock(request, env, {
  getDomainProviderImpl = getDomainProvider,
  requireSiteCapabilityImpl = requireSiteCapability,
} = {}) {
  try {
    const { user, res } = await requireUser(request, env);
    if (res) return res;

    const body = await readJson(request);
    const domain = cleanDomainName(body?.domain);
    if (!domain || !DOMAIN_REGEX.test(domain)) {
      return bad("Invalid domain name format.");
    }
    const lock = Boolean(body?.lock);

    const order = await one(
      "SELECT id, site_id, domain FROM domain_orders WHERE domain=$1 AND user_id=$2 AND status='active'",
      [domain, user.id]
    );
    if (!order) return bad("You do not own this domain through YourRank.", 404);
    const site = await getBoardById(env, user.id, order.site_id);
    const authorization = await requireSiteCapabilityImpl(user, site, "canRoleManageBilling");
    if (authorization.res) return authorization.res;

    const provider = getDomainProviderImpl(env);
    await provider.setTransferLock(domain, lock);

    await exec("UPDATE domain_orders SET locked=$1, updated_at=now() WHERE id=$2", [lock, order.id]);

    await logAudit({
      actorId: user.id,
      action: "domain_toggle_lock",
      entityType: "domain",
      entityId: order.id,
      request,
      details: { domain, locked: lock },
    });

    return ok({
      domain,
      locked: lock,
      message: lock ? "Transfer lock enabled." : "Transfer lock disabled. You may now initiate a transfer.",
    });
  } catch (err) {
    console.error("[domain-toggle-lock] error:", String(err?.message || err));
    return bad("An error occurred while toggling domain lock.", 500);
  }
}

/**
 * POST /api/domains/transfer-auth-code — Retrieve EPP Authorization code to transfer domain out
 */
export async function handleDomainTransferAuthCode(request, env, {
  getDomainProviderImpl = getDomainProvider,
  requireSiteCapabilityImpl = requireSiteCapability,
} = {}) {
  try {
    const { user, res } = await requireUser(request, env);
    if (res) return res;

    const rl = await rateLimit(env, `domain:authcode:${user.id}`, 5, 600);
    if (!rl.ok) return bad("Too many transfer code requests. Please wait a few minutes.", 429);

    const body = await readJson(request);
    const domain = cleanDomainName(body?.domain);
    if (!domain || !DOMAIN_REGEX.test(domain)) {
      return bad("Invalid domain name format.");
    }

    const order = await one(
      "SELECT id, site_id, domain, created_at FROM domain_orders WHERE domain=$1 AND user_id=$2 AND status='active'",
      [domain, user.id]
    );
    if (!order) return bad("You do not own this domain through YourRank.", 404);
    const site = await getBoardById(env, user.id, order.site_id);
    const authorization = await requireSiteCapabilityImpl(user, site, "canRoleManageBilling");
    if (authorization.res) return authorization.res;

    // Check ICANN 60-day rule for newly registered domains
    const createdTime = new Date(order.created_at).getTime();
    const sixtyDaysMs = 60 * 24 * 60 * 60 * 1000;
    const isWithinSixtyDays = Date.now() - createdTime < sixtyDaysMs;
    const unlockDate = new Date(createdTime + sixtyDaysMs).toISOString().split("T")[0];

    const provider = getDomainProviderImpl(env);
    const result = await provider.getTransferAuthCode(domain);

    await logAudit({
      actorId: user.id,
      action: "domain_request_auth_code",
      entityType: "domain",
      entityId: order.id,
      request,
      details: { domain },
    });

    return ok({
      domain,
      authCode: result.authCode,
      isWithinSixtyDays,
      icannNote: isWithinSixtyDays
        ? `ICANN requires a 60-day waiting period from initial registration before transferring to another registrar. Your domain will be eligible on ${unlockDate}.`
        : "Your domain is eligible for transfer. Provide this EPP code to your new registrar.",
    });
  } catch (err) {
    console.error("[domain-transfer-auth-code] error:", String(err?.message || err));
    return bad("An error occurred while retrieving transfer code.", 500);
  }
}

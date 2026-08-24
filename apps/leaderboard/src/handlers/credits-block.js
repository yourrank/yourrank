// Block / unblock / flag a viewer for anti-fraud purposes.
import { requireUser, bad, ok, readJson } from "../auth.js";
import { getByUser, getBoardById } from "../site.js";
import { exec } from "@yourrank/shared/db";
import { requireSiteCapability } from "../site-authorization.js";
import { routeContext } from "../middleware/handler.js";

function getSite(env, user, url) {
  const siteId = url.searchParams.get("siteId");
  return siteId ? getBoardById(env, user.id, siteId) : getByUser(env, user.id);
}

export async function handleCreditsBlockViewer(request, env) {
  const { user, res } = await requireUser(request, env);
  if (res) return res;
  const url = new URL(request.url);
  const site = await getSite(env, user, url);
  if (!site) return bad("no site", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageCredits");
  if (authorization.res) return authorization.res;

  const id = routeContext(request).slug || url.pathname.split("/").pop();
  const body = await readJson(request);
  const blocked = body?.blocked === true;
  const reason = String(body?.reason || "").trim();

  if (!id) return bad("missing viewer id");
  if (blocked && !reason) return bad("reason is required to block a viewer");

  const result = await exec(
    `UPDATE site_viewers
        SET blocked = $1,
            block_reason = CASE WHEN $1 THEN $2 ELSE NULL END,
            fraud_score = CASE WHEN $1 THEN GREATEST(fraud_score, 100) ELSE fraud_score END,
            updated_at = now()
      WHERE id = $3 AND site_id = $4
      RETURNING id`,
    [blocked, reason, id, site.id]
  );
  if (!result || result.length === 0) return bad("viewer not found", 404);

  return ok({ id: result[0].id, blocked, reason });
}

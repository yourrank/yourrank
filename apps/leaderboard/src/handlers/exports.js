// One-Click CSV Data Exports for Streamers.
import { requireUser as defaultRequireUser, bad } from "../auth.js";
import { getByUser as defaultGetByUser, getBoardById as defaultGetBoardById } from "../site.js";
import { requireSiteCapability } from "../site-authorization.js";
import {
  query as defaultQuery,
} from "@yourrank/shared/db";

function csvEscape(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

function buildCsvResponse(rows, headers, filename) {
  const headerLine = headers.map(csvEscape).join(",");
  const dataLines = rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
  const csvContent = `${headerLine}\r\n${dataLines}`;

  return new Response(csvContent, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * GET /api/export/drop-claims.csv — Export flash drop claims report
 */
export async function handleExportDropClaimsCsv(request, env, deps = {}) {
  const {
    requireUser = defaultRequireUser,
    getByUser = defaultGetByUser,
    getBoardById = defaultGetBoardById,
    query = defaultQuery,
  } = deps;

  const { user, res } = await requireUser(request, env);
  if (res) return res;

  const url = new URL(request.url);
  const siteId = url.searchParams.get("siteId");
  const site = siteId ? await getBoardById(env, user.id, siteId) : await getByUser(env, user.id);
  if (!site) return bad("Site not found", 404);
  const authorization = await requireSiteCapability(user, site, "canRoleManageBilling");
  if (authorization.res) return authorization.res;

  const claims = await query(
    `SELECT cd.code, cd.points_reward, v.kick_username AS username, cdc.created_at AS claimed_at
       FROM code_drop_claims cdc
       JOIN code_drops cd ON cd.id = cdc.code_drop_id
       JOIN viewers v ON v.id = cdc.viewer_id
      WHERE cd.site_id=$1
      ORDER BY cdc.created_at DESC`,
    [site.id]
  );

  const headers = ["Drop Code", "Points Awarded", "Viewer Username", "Claimed Timestamp"];
  const rows = (claims || []).map((c) => [
    c.code,
    c.points_reward,
    c.username,
    new Date(c.claimed_at).toISOString(),
  ]);

  return buildCsvResponse(rows, headers, `drop-claims-${site.slug || "export"}.csv`);
}

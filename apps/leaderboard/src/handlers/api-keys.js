// Board-scoped API key management: list, create, rotate, and revoke the keys
// used by the signed score API (POST/PATCH /api/scores). Board keys are the
// same postback_keys rows with a site_id scope; account-level keys stay on
// /api/account/postbacks and are read-only here.
import { json, bad, requireUser as defaultRequireUser, rateLimit as defaultRateLimit } from "../auth.js";
import { getBoardById as defaultGetBoardById } from "../site.js";
import { effectivePlan as defaultEffectivePlan } from "@yourrank/shared/plans";
import { one as defaultOne } from "@yourrank/shared/db";
import {
  createPostbackKeyRecord as defaultCreatePostbackKeyRecord,
  listApiKeys as defaultListApiKeys,
  revokePostbackKeyById as defaultRevokePostbackKeyById,
} from "@yourrank/shared/postback";

function apiKeyObject(row, scope) {
  return {
    id: row.id,
    scope,
    label: row.label ?? null,
    createdAt: row.createdAt ?? null,
    lastUsedAt: row.lastUsedAt ?? null,
    expiresAt: row.expiresAt ?? null,
    key: row.key,
  };
}

// Resolves the site from /api/sites/:id/... and enforces owner + Pro/Team.
// Returns { site } or { res }.
async function resolveKeyOwnerSite(request, env, deps, user) {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/sites\/([^/]+)\/api-keys/);
  const siteId = match ? match[1] : null;
  if (!siteId) return { res: bad("Invalid board ID", 400) };
  const site = await deps.getBoardById(env, user.id, siteId);
  if (!site) return { res: bad("Board not found", 404) };
  if (site.user_id !== user.id) return { res: bad("Only the board owner can manage API keys.", 403) };
  const plan = deps.effectivePlan(user);
  if (plan !== "pro" && plan !== "team") return { res: bad("The signed score API requires Pro or Team.", 403) };
  return { site };
}

function keyIdFromPath(request, suffix = "") {
  const match = new URL(request.url).pathname.match(new RegExp(`^/api/sites/[^/]+/api-keys/([^/]+)${suffix}$`));
  return match ? match[1] : null;
}

// GET /api/sites/:id/api-keys
export async function handleListApiKeys(request, env, injected = {}) {
  const deps = { requireUser: defaultRequireUser, rateLimit: defaultRateLimit, getBoardById: defaultGetBoardById, effectivePlan: defaultEffectivePlan, listApiKeys: defaultListApiKeys, ...injected };
  const { user, res } = await deps.requireUser(request, env);
  if (res) return res;
  if (user.status === "suspended") return bad("This account is suspended.", 403);
  if (!(await deps.rateLimit(env, `api-keys:${user.id}`, 60, 60)).ok) return bad("Too many requests. Try again shortly.", 429);
  const { site, res: siteRes } = await resolveKeyOwnerSite(request, env, deps, user);
  if (siteRes) return siteRes;
  const rows = await deps.listApiKeys(user.id, site.id);
  return json({ ok: true, keys: rows.map((row) => apiKeyObject(row, row.siteId ? "board" : "account")) });
}

// POST /api/sites/:id/api-keys
export async function handleCreateApiKey(request, env, injected = {}) {
  const deps = { requireUser: defaultRequireUser, rateLimit: defaultRateLimit, getBoardById: defaultGetBoardById, effectivePlan: defaultEffectivePlan, createPostbackKeyRecord: defaultCreatePostbackKeyRecord, ...injected };
  const { user, res } = await deps.requireUser(request, env);
  if (res) return res;
  if (user.status === "suspended") return bad("This account is suspended.", 403);
  if (!(await deps.rateLimit(env, `api-keys:${user.id}`, 60, 60)).ok) return bad("Too many requests. Try again shortly.", 429);
  const { site, res: siteRes } = await resolveKeyOwnerSite(request, env, deps, user);
  if (siteRes) return siteRes;
  if (!(await deps.rateLimit(env, `api-keys-create:${user.id}`, 10, 60)).ok) return bad("Too many requests. Try again shortly.", 429);
  const created = await deps.createPostbackKeyRecord(user.id, { label: site.slug, siteId: site.id });
  return json({ ok: true, key: apiKeyObject(created, "board") });
}

// POST /api/sites/:id/api-keys/:keyId/rotate
export async function handleRotateApiKey(request, env, injected = {}) {
  const deps = { requireUser: defaultRequireUser, rateLimit: defaultRateLimit, getBoardById: defaultGetBoardById, effectivePlan: defaultEffectivePlan, createPostbackKeyRecord: defaultCreatePostbackKeyRecord, revokePostbackKeyById: defaultRevokePostbackKeyById, one: defaultOne, ...injected };
  const { user, res } = await deps.requireUser(request, env);
  if (res) return res;
  if (user.status === "suspended") return bad("This account is suspended.", 403);
  if (!(await deps.rateLimit(env, `api-keys:${user.id}`, 60, 60)).ok) return bad("Too many requests. Try again shortly.", 429);
  const { site, res: siteRes } = await resolveKeyOwnerSite(request, env, deps, user);
  if (siteRes) return siteRes;
  const keyId = keyIdFromPath(request, "/rotate");
  const existing = keyId && await deps.one(
    `SELECT id FROM postback_keys
      WHERE id = $1::uuid AND user_id = $2 AND site_id = $3::uuid AND revoked_at IS NULL`,
    [keyId, user.id, site.id]
  );
  if (!existing) return bad("API key not found.", 404);
  if (!(await deps.rateLimit(env, `api-keys-create:${user.id}`, 10, 60)).ok) return bad("Too many requests. Try again shortly.", 429);
  const created = await deps.createPostbackKeyRecord(user.id, { label: site.slug, siteId: site.id });
  await deps.revokePostbackKeyById(user.id, keyId, site.id);
  return json({ ok: true, key: apiKeyObject(created, "board") });
}

// DELETE /api/sites/:id/api-keys/:keyId
export async function handleDeleteApiKey(request, env, injected = {}) {
  const deps = { requireUser: defaultRequireUser, rateLimit: defaultRateLimit, getBoardById: defaultGetBoardById, effectivePlan: defaultEffectivePlan, revokePostbackKeyById: defaultRevokePostbackKeyById, ...injected };
  const { user, res } = await deps.requireUser(request, env);
  if (res) return res;
  if (user.status === "suspended") return bad("This account is suspended.", 403);
  if (!(await deps.rateLimit(env, `api-keys:${user.id}`, 60, 60)).ok) return bad("Too many requests. Try again shortly.", 429);
  const { site, res: siteRes } = await resolveKeyOwnerSite(request, env, deps, user);
  if (siteRes) return siteRes;
  const keyId = keyIdFromPath(request);
  const revoked = keyId ? await deps.revokePostbackKeyById(user.id, keyId, site.id) : 0;
  if (!revoked) return bad("API key not found.", 404);
  return json({ ok: true });
}

import { one, exec } from "@yourrank/shared/db";
import { createQueueProducer } from "@yourrank/shared/queue-producer";
import { logAudit } from "@yourrank/shared/audit";
import { rateLimit } from "@yourrank/shared/ratelimit";
import { bad, ok, rateLimitHeaders } from "../auth.js";
import { requireViewer } from "./viewer-auth.js";
import { routeContext } from "../middleware/handler.js";

const EXPORT_TTL_SECONDS = 7 * 24 * 60 * 60;
const CREATION_LIMIT = 2;
const STATUS_LIMIT = 60;

async function viewerJob(request, env) {
  const { viewer, res } = await requireViewer(request, env);
  if (res) return { viewer: null, res };
  return { viewer, res: null };
}

export async function handleCreateViewerExportJob(request, env, {
  requireViewerImpl = viewerJob,
  rateLimitImpl = rateLimit,
  oneImpl = one,
  execImpl = exec,
  sendImpl,
  logAuditImpl = logAudit,
} = {}) {
  try {
    const { viewer, res } = await requireViewerImpl(request, env);
    if (res) return res;
    if (!env.ACCOUNT_EXPORTS) return bad("Data export is temporarily unavailable. Please try again later.", 503);
    const rl = await rateLimitImpl(env, `viewer-export:${viewer.id}`, CREATION_LIMIT, 3600);
    if (!rl.ok) return bad("Too many exports. Try again later.", 429, rateLimitHeaders(rl));

    const existing = await oneImpl(
      `SELECT id, status, created_at, expires_at FROM viewer_export_jobs
        WHERE viewer_id=$1 AND status IN ('pending', 'processing') AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1`,
      [viewer.id]
    );
    if (existing) return ok({ exportId: existing.id, status: existing.status, createdAt: existing.created_at, expiresAt: existing.expires_at });

    const exportId = crypto.randomUUID();
    try {
      await execImpl(
        `INSERT INTO viewer_export_jobs (id, viewer_id, status, expires_at)
         VALUES ($1, $2, 'pending', now() + make_interval(secs => $3))`,
        [exportId, viewer.id, EXPORT_TTL_SECONDS]
      );
    } catch (error) {
      if (!/duplicate|unique/i.test(String(error?.message || error))) throw error;
      const duplicate = await oneImpl(
        `SELECT id, status, created_at, expires_at FROM viewer_export_jobs
          WHERE viewer_id=$1 AND status IN ('pending', 'processing') AND expires_at > now()
          ORDER BY created_at DESC LIMIT 1`,
        [viewer.id]
      );
      if (duplicate) return ok({ exportId: duplicate.id, status: duplicate.status, createdAt: duplicate.created_at, expiresAt: duplicate.expires_at });
      throw error;
    }
    await logAuditImpl({
      actorId: viewer.id,
      action: "viewer_export_requested",
      entityType: "viewer_export",
      entityId: exportId,
      request,
      details: { export_id: exportId, status: "pending" },
    });
    try {
      const event = { type: "viewer-export", exportId, viewerId: viewer.id };
      if (sendImpl) await sendImpl(event);
      else await createQueueProducer(env.EVENTS_QUEUE, async () => {
        throw new Error("EVENTS_QUEUE binding is not configured");
      }).send(event);
    } catch (error) {
      await execImpl(
        "UPDATE viewer_export_jobs SET status='failed', error=$1, completed_at=now() WHERE id=$2 AND viewer_id=$3",
        [String(error?.message || error).slice(0, 500), exportId, viewer.id]
      ).catch(() => {});
      await logAuditImpl({
        actorId: viewer.id,
        action: "viewer_export_failed",
        entityType: "viewer_export",
        entityId: exportId,
        request,
        details: { export_id: exportId, status: "failed" },
      });
      return bad("Could not start data export. Please try again.", 503);
    }
    return ok({ exportId, status: "pending" });
  } catch (error) {
    console.error("viewer export job creation failed:", String(error?.message || error));
    return bad("Could not start data export. Please try again.", 500);
  }
}

export async function handleViewerExportStatus(request, env, {
  requireViewerImpl = viewerJob,
  rateLimitImpl = rateLimit,
  oneImpl = one,
} = {}) {
  try {
    const { viewer, res } = await requireViewerImpl(request, env);
    if (res) return res;
    const rl = await rateLimitImpl(env, `viewer-export-status:${viewer.id}`, STATUS_LIMIT, 60);
    if (!rl.ok) return bad("Too many requests.", 429, rateLimitHeaders(rl));
    const id = routeContext(request).slug || new URL(request.url).searchParams.get("id");
    const job = await oneImpl(
      `SELECT id, status, error, manifest, created_at, started_at, completed_at, expires_at
         FROM viewer_export_jobs WHERE id=$1 AND viewer_id=$2`,
      [id, viewer.id]
    );
    if (!job) return bad("Export is not available.", 404);
    if (new Date(job.expires_at).getTime() <= Date.now()) return ok({ exportId: job.id, status: "expired", expiresAt: job.expires_at });
    return ok({
      exportId: job.id, status: job.status, error: job.error, manifest: job.manifest,
      createdAt: job.created_at, startedAt: job.started_at, completedAt: job.completed_at, expiresAt: job.expires_at,
    });
  } catch (error) {
    console.error("viewer export status failed:", String(error?.message || error));
    return bad("Could not load export status.", 500);
  }
}

export async function handleViewerExportDownload(request, env, {
  requireViewerImpl = viewerJob,
  rateLimitImpl = rateLimit,
  oneImpl = one,
} = {}) {
  try {
    const { viewer, res } = await requireViewerImpl(request, env);
    if (res) return res;
    const rl = await rateLimitImpl(env, `viewer-export-download:${viewer.id}`, STATUS_LIMIT, 60);
    if (!rl.ok) return bad("Too many requests.", 429, rateLimitHeaders(rl));
    const id = routeContext(request).slug || new URL(request.url).searchParams.get("id");
    const job = await oneImpl(
      `SELECT id, status, artifact_key, expires_at
         FROM viewer_export_jobs WHERE id=$1 AND viewer_id=$2`,
      [id, viewer.id]
    );
    if (!job || job.status !== "completed" || !job.artifact_key || new Date(job.expires_at).getTime() <= Date.now()) {
      return bad("Export is not available.", 404);
    }
    if (!env.ACCOUNT_EXPORTS) return bad("Data export is temporarily unavailable.", 503);
    const object = await env.ACCOUNT_EXPORTS.get(job.artifact_key);
    if (!object) return bad("Export is not available.", 404);
    return new Response(object.body, {
      status: 200,
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "content-disposition": `attachment; filename="yourrank-viewer-export-${job.id}.ndjson"`,
      },
    });
  } catch (error) {
    console.error("viewer export download failed:", String(error?.message || error));
    return bad("Could not download export.", 500);
  }
}

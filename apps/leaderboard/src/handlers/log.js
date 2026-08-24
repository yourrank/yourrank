// Client-side error / log ingestion endpoint.
// Dashboard JS posts here so client errors are correlated with server logs,
// Sentry, and the original request ID.
import { json, bad, rateLimit, clientIp, readJsonLimited } from "../auth.js";
import { requestMeta } from "../middleware/handler.js";

const ALLOWED_LEVELS = new Set(["error", "warn", "info"]);
const MAX_BODY_BYTES = 16 * 1024;
const LIMITS = {
  message: 1000,
  stack: 4000,
  context: 64,
  url: 500,
  clientReqId: 128,
  userAgent: 256,
  extraKey: 256,
};

const truncate = (value, max) => typeof value === "string" ? value.slice(0, max) : undefined;

export async function handleLog(request, env, deps = {}) {
  const { log, sentry, reqId } = requestMeta(request);
  const {
    rateLimit: rateLimitImpl = rateLimit,
    clientIp: clientIpImpl = clientIp,
    readJsonLimited: readJsonLimitedImpl = readJsonLimited,
  } = deps;
  const ip = clientIpImpl(request);
  const limit = await rateLimitImpl(env, `clientlog:${ip}`, 30, 60);
  if (!limit.ok) return bad("Too many logs. Slow down.", 429);

  const { value: body, tooLarge } = await readJsonLimitedImpl(request, MAX_BODY_BYTES);
  if (tooLarge) return bad("Request body too large", 413);
  if (!body) return bad("Invalid JSON", 400);

  const level = ALLOWED_LEVELS.has(body?.level) ? body.level : "error";
  const context = truncate(body?.context, LIMITS.context) || "dashboard";
  const message = truncate(body?.message, LIMITS.message) || "";
  const stack = truncate(body?.stack, LIMITS.stack);
  const clientReqId = truncate(body?.req_id, LIMITS.clientReqId);
  const userAgent = truncate(request.headers.get("user-agent") || "", LIMITS.userAgent);
  const url = truncate(body?.extra?.url, LIMITS.url);
  const extra = {};
  if (body?.extra && typeof body.extra === "object" && !Array.isArray(body.extra)) {
    for (const key of Object.keys(body.extra).slice(0, 20)) {
      extra[key.slice(0, LIMITS.extraKey)] = String(body.extra[key]).slice(0, LIMITS.extraKey);
    }
  }

  if (!message) return bad("message is required", 400);

  const payload = {
    ...extra,
    ctx: "client_log",
    level,
    client_context: context,
    message,
    stack,
    client_req_id: clientReqId,
    req_id: reqId,
    ip,
    url,
    user_agent: userAgent || undefined,
  };

  if (log && typeof log[level] === "function") {
    log[level]("client_log", payload);
  } else {
    console.error(JSON.stringify(payload));
  }

  if (sentry) {
    sentry.setTags({ context, client_req_id: clientReqId, req_id: reqId });
    const sentryLevel = level === "warn" ? "warning" : level;
    sentry.captureMessage(message, sentryLevel);
  }

  return json({ ok: true });
}

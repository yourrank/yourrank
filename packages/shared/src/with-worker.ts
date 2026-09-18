// Shared entry-point wrapper for YourRank Workers.
// Wraps fetch/scheduled handlers to guarantee:
//   1. Request ID generated and echoed as X-Request-Id
//   2. Sentry (Toucan) initialized if DSN present
//   3. All errors caught, reported to Sentry + Discord, and returned as 500
//   4. Structured JSON logging on every error

import {
  generateRequestId,
  createLogger,
  getRequestMetrics,
  installConsoleRedirect,
  runRequestCleanup,
  runWithLogger,
} from "./request-id.js";
import { sendErrorToDiscord } from "./monitoring.js";
import { errMessage, errStack } from "./errors.js";

// One-time install: raw console.* inside a request context now flow through
// the request-scoped logger with levels and sampling.
installConsoleRedirect();

interface ToucanClient {
  setTag(key: string, value: string): void;
  setTags(tags: Record<string, string>): void;
  captureException(err: unknown): void;
}

interface WorkerContext {
  sentry: ToucanClient | null;
  log: ReturnType<typeof createLogger>;
  reqId: string;
}

type FetchHandler = (
  request: Request,
  env: Record<string, any>,
  ctx: any,
  extras: WorkerContext
) => Promise<Response>;

interface WorkerOptions {
  telemetry?: boolean;
}

export function withWorkerFetch(workerName: string, handler: FetchHandler, options: WorkerOptions = {}) {
  return async function fetch(
    request: Request,
    env: Record<string, any>,
    ctx: any
  ): Promise<Response> {
    const incomingReqId = request.headers.get("x-request-id");
    const reqId = incomingReqId || generateRequestId();
    const log = createLogger(workerName, reqId, env);

    let sentry: ToucanClient | null = null;
    try {
      if (env.SENTRY_DSN) {
        const { Toucan } = await import("toucan-js");
        const s = new Toucan({
          dsn: env.SENTRY_DSN,
          request,
          context: ctx,
          environment: env.ENVIRONMENT || "production",
          release: `yourrank@${(typeof process !== "undefined" && process.env?.npm_package_version) || "dev"}`,
        });
        s.setTags({ worker: workerName, req_id: reqId });
        sentry = s;
      }
    } catch (sentryErr) {
      log.warn("sentry_init_failed", { error: String(sentryErr) });
    }

    return runWithLogger(log, async () => {
      try {
        const response = await handler(request, env, ctx, { sentry, log, reqId });
        if (options.telemetry === true && env.REQUEST_METRICS === "true") {
          const metrics = getRequestMetrics();
          log.info("request_metrics", {
            route: metrics?.route || "other",
            site: metrics?.site || null,
            db_queries: metrics?.dbQueries || 0,
            db_ms: Math.round(metrics?.dbMs || 0),
            db_clients: metrics?.dbClients || 0,
            db_slowest_ms: Math.round(metrics?.dbSlowestMs || 0),
            db_slowest: metrics?.dbSlowest || null,
            auth_ms: metrics?.authMs == null ? null : Math.round(metrics.authMs),
            duration_ms: Date.now() - (metrics?.startedAt || Date.now()),
            cache: metrics?.cache || "bypass",
            payload_bytes: metrics?.payloadBytes || null,
          });
        }
        // Response.redirect() creates responses with immutable headers.
        // Clone to get mutable headers before setting X-Request-Id.
        const mutable = new Response(response.body, response);
        mutable.headers.set("X-Request-Id", reqId);
        if (request.url.startsWith("https://")) {
          mutable.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
        }
        return mutable;
      } catch (err: unknown) {
        const errMsg = errMessage(err);
        const stack = errStack(err);

        sentry?.captureException(err);
        log.error("unhandled_error", { error: errMsg, stack });

        const errPath = (() => {
          try { return new URL(request.url).pathname; } catch { return "unknown"; }
        })();
        if (env.DISCORD_MONITORING_WEBHOOK) {
          ctx.waitUntil(
            sendErrorToDiscord({
              webhookUrl: env.DISCORD_MONITORING_WEBHOOK,
              title: `${workerName} Error`,
              message: stack || errMsg,
              path: errPath,
              worker: workerName,
            })
          );
        }

        const errHeaders: Record<string, string> = { "X-Request-Id": reqId };
        if (request.url.startsWith("https://")) {
          errHeaders["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload";
        }
        return new Response("Internal Server Error", {
          status: 500,
          headers: errHeaders,
        });
      } finally {
        await runRequestCleanup();
      }
    });
  };
}

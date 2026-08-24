// withHandler — standardised async error boundary for route handlers, and the
// single place that defines the route-handler calling convention.
//
// THE CONTRACT (there is exactly one):
//
//   export async function handleFoo(request, env, deps = defaults) { … }
//
// - `request` and `env` are the only positional arguments the dispatcher ever
//   supplies. The third parameter is reserved for dependency injection, so a
//   handler's declared defaults always apply in production.
// - Route context (`slug`, `waitUntil`) and observability (`sentry`, `log`,
//   `reqId`) travel on the request: read them with `routeContext(request)` and
//   `requestMeta(request)`. They are never positional.
//
// Passing the dispatcher's context positionally is what made nine routes throw
// `deps.<collaborator> is not a function` in production while their unit tests
// passed: the tests called the handler directly, so the default deps applied,
// but the router supplied `{ slug, waitUntil }` into that same slot.
// `routeHandlerContract` (see __tests__/route-handler-contract.test.js) keeps
// the convention from coming back.

import { bad } from "../auth.js";
import { getLogger } from "@yourrank/shared/request-id";
import { handlerSchemas, validateJson } from "@yourrank/shared/validation";

const VALIDATE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const NOOP_WAIT_UNTIL = () => {};
const EMPTY_META = Object.freeze({});

/**
 * Route context attached by the dispatcher: the matched `:slug`/`:id` path
 * param and the Worker's `waitUntil`. Safe to call on a hand-built request.
 * @param {Request} request
 * @returns {{ slug: string | undefined, waitUntil: (promise: Promise<unknown>) => void }}
 */
export function routeContext(request) {
  const ctx = request?.routeContext;
  return {
    slug: ctx?.slug,
    waitUntil: typeof ctx?.waitUntil === "function" ? ctx.waitUntil : NOOP_WAIT_UNTIL,
  };
}

/**
 * Attach the dispatcher's route context and per-request observability to the
 * request. The router does this through `withHandler`; tests that exercise a
 * handler directly use it to supply a `:slug`/`:id` or a `waitUntil` spy.
 * @param {Request} request
 * @param {{ slug?: string, waitUntil?: (promise: Promise<unknown>) => void } | null} [ctx]
 * @param {object | null} [meta]
 * @returns {Request} the same request, for call chaining
 */
export function attachRouteContext(request, ctx = null, meta = null) {
  request.routeContext = ctx || undefined;
  request.requestMeta = meta || undefined;
  return request;
}

/**
 * Per-request observability passed by withWorkerFetch: { sentry, log, reqId }.
 * @param {Request} request
 * @returns {{ sentry?: object, log?: object, reqId?: string }}
 */
export function requestMeta(request) {
  return request?.requestMeta || EMPTY_META;
}

/**
 * @template {(request: Request, env: object, deps?: object) => Promise<Response>} T
 * @param {T} fn  The actual handler function
 * @returns {(request: Request, env: object, ctx?: object, meta?: object) => Promise<Response>}
 */
export function withHandler(fn) {
  const handlerWrapper = async function handlerWrapper(request, env, ctx, meta) {
    try {
      attachRouteContext(request, ctx, meta);
      const label = fn.name || "anonymous";
      const schema = handlerSchemas[label];
      if (schema && VALIDATE_METHODS.has(request.method)) {
        const result = await validateJson(request, schema);
        if (!result.ok) return bad(result.error, 400);
        request.validatedBody = result.data;
      }
      return await fn(request, env);
    } catch (err) {
      // Log with enough context to locate the failure without leaking internals.
      const label = fn.name || "anonymous";
      const log = meta?.log || getLogger();
      const logContext = { handler: label, req_id: meta?.reqId };
      log.error("unhandled_error", { error: String(err?.message || err), stack: err?.stack, ...logContext });
      return bad("Internal server error. Please try again.", 500);
    }
  };
  // Exposed so the contract test can inspect the wrapped handler's signature.
  handlerWrapper.handler = fn;
  return handlerWrapper;
}

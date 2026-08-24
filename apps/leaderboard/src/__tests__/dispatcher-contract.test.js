// Dispatcher-level gate for the route-handler calling convention.
//
// Every other test in this suite calls handlers directly, which is exactly why
// nine production routes could throw `deps.<collaborator> is not a function`
// with a fully green test suite: calling `handleFoo(request, env)` applies the
// declared `deps = defaults`, while the router used to pass its own
// `{ slug, waitUntil }` into that same third slot.
//
// This file drives the REAL Hono app (`src/router.js`) over the REAL route
// table (`src/routes.js`) and asserts two things for every registered route:
//   1. the route is actually reachable (not the notFound sentinel), and
//   2. dispatching it never produces a calling-convention TypeError.
//
// Environment failures (no DATABASE_URL, no queue binding) are expected here
// and tolerated; a `… is not a function` / `Cannot read properties of
// undefined` is not, because that is the signature of the dispatcher passing
// the wrong thing into a handler's parameter list.
//
// Run: bun test src/__tests__/dispatcher-contract.test.js

import { describe, it, expect } from "bun:test";
import apiApp from "../router.js";
import { ROUTES } from "../routes.js";
import { withHandler, routeContext, requestMeta } from "../middleware/handler.js";

const CSRF_TOKEN = "c".repeat(64);
const CONTRACT_VIOLATION =
  /is not a function|is not a constructor|Cannot read propert(?:y|ies) of (?:undefined|null)|undefined is not an object/i;

const PARAM_SAMPLES = {
  slug: "demo",
  id: "11111111-1111-4111-8111-111111111111",
};

function concretePath(path) {
  return path.replace(/:([A-Za-z]+)/g, (_m, name) => PARAM_SAMPLES[name] || "sample");
}

// Top-level parameter names of a function, keeping destructured or
// default-valued parameters (`{ a = x } = {}`) as a single entry.
function declaredParams(fn) {
  const source = fn.toString();
  const start = source.indexOf("(");
  let depth = 0;
  let end = start;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (char === "(" || char === "{" || char === "[") depth++;
    else if (char === ")" || char === "}" || char === "]") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  const list = source.slice(start + 1, end);
  const params = [];
  let current = "";
  depth = 0;
  for (const char of list) {
    if ("({[".includes(char)) depth++;
    else if (")}]".includes(char)) depth--;
    if (char === "," && depth === 0) { params.push(current.trim()); current = ""; continue; }
    current += char;
  }
  if (current.trim()) params.push(current.trim());
  return params;
}

function buildRequest(route) {
  const method = route.method.toUpperCase();
  const url = `https://yourrank.site${concretePath(route.path)}`;
  const headers = {
    cookie: `__csrf=${CSRF_TOKEN}`,
    "x-csrf-token": CSRF_TOKEN,
    "user-agent": "dispatcher-contract-test",
  };
  if (method === "GET" || method === "HEAD") return new Request(url, { method, headers });
  return new Request(url, {
    method,
    headers: { ...headers, "content-type": "application/json" },
    body: "{}",
  });
}

async function dispatch(route) {
  const request = buildRequest(route);
  const messages = [];
  const record = (value) => messages.push(String(value));
  const log = {
    error: (event, fields) => record(`${event} ${fields?.error ?? ""}`),
    warn: () => {},
    info: () => {},
    debug: () => {},
  };
  const ctx = { waitUntil: () => {} };
  const meta = { log, reqId: "dispatcher-contract" };

  // Handlers that catch their own failures report through console.error, so the
  // gate has to watch both channels to see a calling-convention TypeError.
  const realConsoleError = console.error;
  console.error = (...args) => record(args.join(" "));
  let response;
  try {
    response = await apiApp.fetch(request, { workerContext: { request, env: {}, ctx, meta } }, ctx);
  } finally {
    console.error = realConsoleError;
  }
  return { response, messages };
}

describe("route-handler calling convention", () => {
  it("passes only (request, env) into handlers, so declared deps defaults apply", async () => {
    const seen = [];
    const defaults = { collaborator: () => "default-collaborator" };
    async function handleProbe(request, env, deps = defaults) {
      seen.push({ argCount: arguments.length, deps, collaborator: deps.collaborator?.() });
      return new Response("ok");
    }
    const wrapped = withHandler(handleProbe);
    const request = new Request("https://yourrank.site/api/probe");
    const routeCtx = { slug: "demo", waitUntil: () => {} };

    const response = await wrapped(request, {}, routeCtx, { reqId: "r1" });

    expect(response.status).toBe(200);
    expect(seen[0].argCount).toBe(2);
    expect(seen[0].deps).toBe(defaults);
    expect(seen[0].collaborator).toBe("default-collaborator");
  });

  it("exposes route context and request meta on the request, not positionally", async () => {
    let captured;
    const waited = [];
    async function handleProbeContext(request) {
      captured = { ctx: routeContext(request), meta: requestMeta(request) };
      captured.ctx.waitUntil(Promise.resolve("bg"));
      return new Response("ok");
    }
    const request = new Request("https://yourrank.site/api/probe/demo");
    await withHandler(handleProbeContext)(
      request,
      {},
      { slug: "demo", waitUntil: (p) => waited.push(p) },
      { reqId: "r2", log: { error: () => {} } },
    );

    expect(captured.ctx.slug).toBe("demo");
    expect(captured.meta.reqId).toBe("r2");
    expect(waited).toHaveLength(1);
  });

  it("tolerates a handler invoked outside the dispatcher (no route context)", async () => {
    let captured;
    async function handleProbeBare(request) {
      captured = routeContext(request);
      captured.waitUntil(Promise.resolve("dropped"));
      return new Response("ok");
    }
    await handleProbeBare(new Request("https://yourrank.site/api/probe"));
    expect(captured.slug).toBeUndefined();
    expect(typeof captured.waitUntil).toBe("function");
  });

  it("declares no route handler that takes the dispatcher context positionally", () => {
    const offenders = [];
    for (const route of ROUTES) {
      const fn = route.handler.handler;
      if (typeof fn !== "function") {
        offenders.push(`${route.method} ${route.path}: not wrapped by withHandler`);
        continue;
      }
      const params = declaredParams(fn);
      const third = (params[2] || "").split("=")[0].trim();
      if (/^(ctx|context|executionContext|meta|nonce)$/.test(third)) {
        offenders.push(`${route.method} ${route.path}: ${fn.name}(…, ${third})`);
      }
      if (params.length > 3) {
        offenders.push(`${route.method} ${route.path}: ${fn.name} declares ${params.length} positional parameters`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("every registered route is dispatched under the contract", () => {
  // Swap every handler in the live route table for a probe with the canonical
  // signature and drive the real Hono app: this covers the whole table instead
  // of only the routes whose failure happens to surface as a 500.
  it("delivers exactly (request, env) to all registered routes", async () => {
    const PROBE_DEFAULTS = Object.freeze({ probeDefaults: true });
    const observed = [];
    const originals = ROUTES.map((route) => route.handler);
    try {
      for (const route of ROUTES) {
        const label = `${route.method} ${route.path}`;
        const handleContractProbe = async function handleContractProbe(request, env, deps = PROBE_DEFAULTS) {
          observed.push({ label, argCount: arguments.length, deps, env });
          return new Response("ok");
        };
        route.handler = withHandler(handleContractProbe);
      }
      for (const route of ROUTES) {
        const request = buildRequest(route);
        const ctx = { waitUntil: () => {} };
        await apiApp.fetch(
          request,
          { workerContext: { request, env: { probeEnv: true }, ctx, meta: { reqId: "probe" } } },
          ctx,
        );
      }
    } finally {
      ROUTES.forEach((route, index) => { route.handler = originals[index]; });
    }

    expect(observed).toHaveLength(ROUTES.length);
    const violations = observed
      .filter((entry) => entry.argCount !== 2 || entry.deps !== PROBE_DEFAULTS || !entry.env?.probeEnv)
      .map((entry) => `${entry.label}: ${entry.argCount} args, deps=${JSON.stringify(entry.deps)}`);
    expect(violations).toEqual([]);
  });
});

describe("every registered route survives real dispatch", () => {
  const cases = ROUTES.map((route) => [`${route.method} ${route.path}`, route]);

  it.each(cases)("%s is reachable and honours the handler contract", async (_label, route) => {
    const { response, messages } = await dispatch(route);

    expect(response.headers.get("x-no-api-route")).toBeNull();

    const violations = messages.filter((message) => CONTRACT_VIOLATION.test(message));
    expect(violations).toEqual([]);
  });
});

import { Hono } from "hono";
import { ROUTES } from "./routes.js";
import { shouldRequireCsrf, verifyCsrf } from "./middleware/index.js";
import { bad, handleAccountDelete } from "./auth.js";
import { withPublicApiCors } from "./middleware/public-api.js";

const apiApp = new Hono();

apiApp.use('*', async (c, next) => {
  const { request } = c.env.workerContext;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method === "HEAD" ? "GET" : request.method;

  if (shouldRequireCsrf(method, path)) {
    if (!verifyCsrf(request)) {
      return bad("CSRF validation failed. Please refresh the page.", 403);
    }
  }

  await next();

  // Apply public-API CORS to real handler responses (any status, matching the
  // pre-Hono behavior). The notFound sentinel below is left untouched so
  // index.js can detect a genuine no-match and fall through to page routing.
  if (c.res && !c.res.headers.get("x-no-api-route")) {
    c.res = withPublicApiCors(c.res, path);
  }
});

// Sentinel for "no API route matched" so the caller can tell this apart from a
// matched handler that legitimately returned 404 (e.g. unknown public slug).
apiApp.notFound(() => new Response(null, { status: 404, headers: { "x-no-api-route": "1" } }));

for (const route of ROUTES) {
  const method = route.method.toLowerCase();
  
  apiApp[method](route.path, async (c) => {
    const { request, env, ctx, meta } = c.env.workerContext;
    const slug = c.req.param("slug") || c.req.param("id");
    const routeCtx = { slug, id: c.req.param("id"), waitUntil: (p) => ctx.waitUntil(p) };
    return await route.handler(request, env, routeCtx, meta);
  });
}

apiApp.post("/api/account/delete", async (c) => {
  const { request, env } = c.env.workerContext;
  return await handleAccountDelete(request, env);
});

export default apiApp;

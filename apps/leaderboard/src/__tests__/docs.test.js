// Developer docs surface: the Scalar page at /docs/api, the legacy /api/docs
// redirect, /openapi.json, and the contract between the published OpenAPI
// spec and the real routes + validation schemas.
//
// Run: bun test src/__tests__/docs.test.js

import { describe, expect, it } from "bun:test";
import { Validator } from "@seriousme/openapi-schema-validator";
import {
  spec,
  renderDocsPage,
  handleDocsPage,
  handleApiDocs,
  handleOpenApiJson,
  DOCS_PATH,
  OPENAPI_PATH,
  LEGACY_OPENAPI_PATH,
  SCALAR_SCRIPT_URL,
  SCALAR_SCRIPT_INTEGRITY,
} from "../handlers/docs.js";
import { scoreBodySchema, scorePatchBodySchema } from "../handlers/scores.js";
import { SCORE_MAX, WIN_RATE_MAX, INT32_MAX, INT32_MIN } from "../player-rules.js";
import { ROUTES } from "../routes.js";

const origin = "https://yourrank.site";

describe("docs handlers", () => {
  it("serves the Scalar page with the pinned script and a tight CSP", async () => {
    const res = await handleDocsPage(new Request(`${origin}${DOCS_PATH}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("Developer API");
    expect(body).toContain(SCALAR_SCRIPT_URL);
    expect(body).toContain(`integrity="${SCALAR_SCRIPT_INTEGRITY}"`);

    const csp = res.headers.get("content-security-policy");
    expect(csp).toContain("script-src 'self' https://cdn.jsdelivr.net");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("redirects /api/docs to /docs/api and serves openapi.json", async () => {
    const redirect = await handleApiDocs(new Request(`${origin}/api/docs`));
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get("location")).toBe(`${origin}${DOCS_PATH}`);

    const res = await handleOpenApiJson();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.openapi).toBe("3.1.0");
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

describe("OpenAPI document", () => {
  it("validates against the OpenAPI 3.1 schema", async () => {
    const validator = new Validator();
    const result = await validator.validate(spec);
    expect(result.valid).toBe(true);
  });

  const routeSet = new Set(ROUTES.map((r) => `${r.method} ${r.path}`));
  const specPathToRoute = (path) => path.replace(/\{([^}]+)\}/g, ":$1");

  it("documents only routes that exist", () => {
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const method of Object.keys(item)) {
        expect(routeSet).toContain(`${method.toUpperCase()} ${specPathToRoute(path)}`);
      }
    }
    expect(routeSet).toContain(`GET ${DOCS_PATH}`);
    expect(routeSet).toContain(`GET ${OPENAPI_PATH}`);
    expect(routeSet).toContain(`GET ${LEGACY_OPENAPI_PATH}`);
  });

  it("documents every public read route and both score write routes", () => {
    const documented = new Set();
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const method of Object.keys(item)) documented.add(`${method.toUpperCase()} ${specPathToRoute(path)}`);
    }
    for (const route of ROUTES) {
      // The public-API CORS surface marks the routes that are part of the
      // documented public contract; reward-images and /api/public/credits are
      // internal endpoints under the same prefix and intentionally undocumented.
      if (
        route.path === "/api/scores" ||
        route.path === "/api/public/:slug/stream" ||
        (/^\/api\/public\/[^/]+(?:\/(?:standings|players|rank|stats))?$/.test(route.path) && route.path !== "/api/public/credits")
      ) {
        expect(documented).toContain(`${route.method} ${route.path}`);
      }
    }
  });

  it("request examples pass the real body schemas", () => {
    const post = spec.paths["/api/scores"].post.requestBody.content["application/json"];
    expect(scoreBodySchema.safeParse(post.example).success).toBe(true);

    const patch = spec.paths["/api/scores"].patch.requestBody.content["application/json"];
    for (const example of Object.values(patch.examples)) {
      const parsed = scorePatchBodySchema.safeParse(example.value);
      expect(parsed.success).toBe(true);
    }
  });

  it("PlayerWrite bounds and players limits match the handler validation", () => {
    const props = spec.components.schemas.PlayerWrite.properties;
    for (const field of ["wagered", "prize", "score"]) {
      expect(props[field].minimum).toBe(0);
      expect(props[field].maximum).toBe(SCORE_MAX);
    }
    expect(props.hands.minimum).toBe(0);
    expect(props.hands.maximum).toBe(INT32_MAX);
    expect(props.netProfit.minimum).toBe(-SCORE_MAX);
    expect(props.netProfit.maximum).toBe(SCORE_MAX);
    expect(props.winRate.minimum).toBe(-WIN_RATE_MAX);
    expect(props.winRate.maximum).toBe(WIN_RATE_MAX);
    expect(props.change.minimum).toBe(INT32_MIN);
    expect(props.change.maximum).toBe(INT32_MAX);

    expect(spec.paths["/api/scores"].post.requestBody.content["application/json"].schema.properties.players.maxItems).toBe(9999);
    const patchPlayers = spec.paths["/api/scores"].patch.requestBody.content["application/json"].schema.properties.players;
    expect(patchPlayers.minItems).toBe(1);
    expect(patchPlayers.maxItems).toBe(9999);
  });

  it("leaks no secrets in the spec or the rendered page", () => {
    const serialized = JSON.stringify(spec);
    expect(serialized).not.toMatch(/pk_[a-z0-9]{20,}/i);
    const html = renderDocsPage({ origin });
    expect(html).not.toMatch(/pk_[a-z0-9]{20,}/i);
    // The only key-shaped placeholder anywhere is the YOURRANK_API_KEY env var.
    for (const hex of serialized.match(/[0-9a-f]{64}/gi) || []) {
      expect(serialized).toContain(`X-Postback-Signature: ${hex}`);
    }
    expect(serialized).toContain("YOURRANK_API_KEY");
  });
});

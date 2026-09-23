import { describe, expect, test } from "bun:test";
import { handlePublicApiPreflight, withPublicApiCors } from "../middleware/public-api.js";

describe("public API CORS", () => {
  test("allows browser reads and conditional requests", () => {
    const response = withPublicApiCors(
      new Response("ok", { headers: { etag: '"v1"' } }),
      "/api/public/example/players"
    );

    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-methods")).toContain("GET");
    expect(response.headers.get("access-control-allow-headers")).toContain("If-None-Match");
    expect(response.headers.get("access-control-expose-headers")).toContain("ETag");
    expect(response.headers.get("etag")).toBe('"v1"');
  });

  test("allows signed score API headers", () => {
    const response = handlePublicApiPreflight("/api/scores");

    expect(response?.status).toBe(204);
    expect(response?.headers.get("access-control-allow-methods")).toBe("POST, PATCH, OPTIONS");
    expect(response?.headers.get("access-control-allow-headers")).toContain("X-Postback-Signature");
    expect(response?.headers.get("access-control-allow-headers")).toContain("Idempotency-Key");
    expect(response?.headers.get("access-control-max-age")).toBe("86400");

    const write = withPublicApiCors(new Response("ok"), "/api/scores");
    expect(write.headers.get("access-control-expose-headers")).toContain("Idempotency-Replayed");
  });

  test("serves the OpenAPI document with read CORS and keeps /docs/api private", () => {
    const preflight = handlePublicApiPreflight("/openapi.json");
    expect(preflight?.status).toBe(204);
    expect(preflight?.headers.get("access-control-allow-methods")).toContain("GET");

    const openapi = withPublicApiCors(new Response("{}"), "/openapi.json");
    expect(openapi.headers.get("access-control-allow-origin")).toBe("*");

    const legacy = withPublicApiCors(new Response("{}"), "/api/openapi.json");
    expect(legacy.headers.get("access-control-allow-origin")).toBe("*");
    const docs = withPublicApiCors(new Response("{}"), "/api/docs");
    expect(docs.headers.get("access-control-allow-origin")).toBe("*");

    const page = new Response("html");
    expect(handlePublicApiPreflight("/docs/api")).toBeNull();
    expect(withPublicApiCors(page, "/docs/api")).toBe(page);
  });

  test("does not add CORS to private dashboard APIs", () => {
    const response = new Response("private");

    expect(handlePublicApiPreflight("/api/site")).toBeNull();
    expect(withPublicApiCors(response, "/api/site")).toBe(response);
  });
});

// Public API documentation handlers
// Serves an OpenAPI 3.1 JSON spec for the public leaderboard API.
import { json } from "../auth.js";

const spec = {
  openapi: "3.1.0",
  info: {
    title: "YourRank Public API",
    version: "1.0.0",
    description: "Read-only leaderboard endpoints are public on every plan. The signed score API requires an active Pro or Team plan.",
    contact: { url: "https://yourrank.site" },
  },
  servers: [{ url: "https://yourrank.site", description: "Production" }],
  paths: {
    "/api/public/{slug}": {
      get: {
        summary: "Full leaderboard data",
        description: "Returns the complete leaderboard data object for the given slug.",
        parameters: [{ $ref: "#/components/parameters/Slug" }],
        responses: {
          200: { description: "Leaderboard data", content: { "application/json": { schema: { type: "object" } } } },
          404: { $ref: "#/components/responses/NotFound" },
          429: { $ref: "#/components/responses/RateLimit" },
        },
      },
    },
    "/api/public/{slug}/standings": {
      get: {
        summary: "Sorted player standings",
        description: "Returns players sorted by the board's configured ranking metric (score by default) with positions and countdown.",
        parameters: [{ $ref: "#/components/parameters/Slug" }],
        responses: {
          200: { description: "Standings object", content: { "application/json": { schema: { $ref: "#/components/schemas/Standings" } } } },
          404: { $ref: "#/components/responses/NotFound" },
          429: { $ref: "#/components/responses/RateLimit" },
        },
      },
    },
    "/api/public/{slug}/players": {
      get: {
        summary: "Lightweight players list",
        description: "Returns a paginated sorted player page. Use limit, offset, and search for subsequent pages or board-wide name search.",
        parameters: [{ $ref: "#/components/parameters/Slug" }],
        responses: {
          200: { description: "Players array", content: { "application/json": { schema: { type: "object", properties: { players: { type: "array", items: { $ref: "#/components/schemas/Player" } } } } } } },
          404: { $ref: "#/components/responses/NotFound" },
          429: { $ref: "#/components/responses/RateLimit" },
        },
      },
    },
    "/api/public/{slug}/rank": {
      get: {
        summary: "Rank lookup",
        description: "Plain-text rank lookup for Nightbot / Streamlabs. Use `?user=PLAYER`.",
        parameters: [
          { $ref: "#/components/parameters/Slug" },
          { name: "user", in: "query", required: true, schema: { type: "string" }, description: "Player name (case-insensitive partial match)." },
        ],
        responses: {
          200: { description: "Rank text", content: { "text/plain": { schema: { type: "string" } } } },
          400: { description: "Missing `user` parameter." },
          404: { description: "Leaderboard or player not found." },
          429: { $ref: "#/components/responses/RateLimit" },
        },
      },
    },
    "/api/public/{slug}/stats": {
      get: {
        summary: "Public stats",
        description: "Returns view/copy/click summaries plus a 14-day daily series.",
        parameters: [{ $ref: "#/components/parameters/Slug" }],
        responses: {
          200: { description: "Stats object", content: { "application/json": { schema: { $ref: "#/components/schemas/Stats" } } } },
          404: { $ref: "#/components/responses/NotFound" },
          429: { $ref: "#/components/responses/RateLimit" },
        },
      },
    },
    "/api/scores": {
      post: {
        summary: "Score postback",
        description: "Replace the player list for a board. Requires a Pro/Team plan, `X-Postback-Key` and an HMAC-SHA256 `X-Postback-Signature` of the raw request body.",
        security: [{ PostbackKey: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["players"],
                properties: {
                  slug: { type: "string", description: "Target board slug. Required unless `siteId` or `X-Postback-Site` is provided." },
                  siteId: { type: "string", format: "uuid", description: "Target board ID. Required unless `slug` or `X-Postback-Site` is provided." },
                  players: {
                    type: "array",
                    items: { $ref: "#/components/schemas/Player" },
                    description: "Up to the plan limit (Pro: 1,000; Team: 5,000).",
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Players accepted", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, players: { type: "integer" } } } } } },
          400: { description: "Validation error." },
          401: { description: "Missing or invalid postback key/signature." },
          403: { description: "Not on a Pro/Team plan." },
          429: { $ref: "#/components/responses/RateLimit" },
        },
      },
    },
  },
  components: {
    parameters: {
      Slug: {
        name: "slug",
        in: "path",
        required: true,
        schema: { type: "string" },
        description: "Board slug.",
      },
    },
    schemas: {
      Player: {
        type: "object",
        properties: {
          name: { type: "string" },
          wagered: { type: "number" },
          prize: { type: "number" },
          position: { type: "integer" },
        },
      },
      Standings: {
        type: "object",
        properties: {
          slug: { type: "string" },
          name: { type: "string" },
          casino: { type: "string" },
          period: { type: "string" },
          prizePool: { type: "string" },
          players: { type: "array", items: { $ref: "#/components/schemas/Player" } },
          countdown: { type: ["object", "null"], properties: { endsAt: { type: "string" }, remaining: { type: "integer" } } },
        },
      },
      Stats: {
        type: "object",
        properties: {
          slug: { type: "string" },
          name: { type: "string" },
          playerCount: { type: "integer" },
          summary: { type: "object" },
          days: { type: "array" },
        },
      },
    },
    securitySchemes: {
      PostbackKey: {
        type: "apiKey",
        in: "header",
        name: "X-Postback-Key",
        description: "Also requires an HMAC-SHA256 signature in the `X-Postback-Signature` header of the raw request body.",
      },
    },
    responses: {
      NotFound: {
        description: "Leaderboard not found or suspended.",
        content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean", example: false }, error: { type: "string" } } } } },
      },
      RateLimit: {
        description: "Rate limit exceeded. Headers include `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `Retry-After`.",
        headers: {
          "X-RateLimit-Limit": { schema: { type: "integer" } },
          "X-RateLimit-Remaining": { schema: { type: "integer" } },
          "Retry-After": { schema: { type: "integer" } },
        },
        content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean", example: false }, error: { type: "string" } } } } },
      },
    },
  },
};

export async function handleApiDocs() {
  return json(spec);
}

export async function handleOpenApiJson() {
  return json(spec, 200, { "cache-control": "public, max-age=300" });
}

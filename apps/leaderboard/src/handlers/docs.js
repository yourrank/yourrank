// Developer documentation: one authoritative OpenAPI 3.1 spec for the public
// leaderboard API, served raw at /openapi.json and rendered at /docs/api.
import { json } from "../auth.js";
import { SECURE_HTML } from "../middleware/headers.js";
import { PLAN_LIMITS } from "@yourrank/shared/plans";
import { SCORE_MAX, WIN_RATE_MAX, INT32_MAX, INT32_MIN } from "../player-rules.js";
import { IDEMPOTENCY_KEY_MAX_LENGTH } from "@yourrank/shared/api-idempotency";

export const DOCS_PATH = "/docs/api";
export const OPENAPI_PATH = "/openapi.json";
export const LEGACY_OPENAPI_PATH = "/api/openapi.json";

// Pinned renderer bundle. Bump the version and integrity hash together.
export const SCALAR_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.68.0/dist/browser/standalone.js";
export const SCALAR_SCRIPT_INTEGRITY = "sha384-PhSzhE9ihf7z/cKeRSKAeP+oJMMzotyFv0EjvNYgL798a2ODBQVuJLTP4Klle6IB";

const EXAMPLE_KEY = "EXAMPLE_KEY_DO_NOT_USE";
const EXAMPLE_SIGNATURE = "3f8e6c1a…(64 hex characters)…9b2d";

const ERROR_SCHEMA = { $ref: "#/components/schemas/Error" };
const errorContent = (example) => ({ "application/json": { schema: ERROR_SCHEMA, example: { ok: false, error: example } } });

const RATE_LIMIT_HEADERS = {
  "X-RateLimit-Limit": { description: "Requests allowed in the current 60-second window.", schema: { type: "integer" } },
  "X-RateLimit-Remaining": { description: "Requests left in the current window.", schema: { type: "integer" } },
};

const publicBoardResponses = (okResponse) => ({
  200: okResponse,
  401: { $ref: "#/components/responses/PasswordRequired" },
  404: { $ref: "#/components/responses/NotFound" },
  429: { $ref: "#/components/responses/RateLimit" },
});

const writeErrorResponses = {
  400: {
    description: "Validation error. The `error` string names the first failing field (`players.0.name: …`) or the missing board reference.",
    content: errorContent("players.0.wagered: Number must be greater than or equal to 0"),
  },
  401: {
    description: "Missing `X-Postback-Key` / `X-Postback-Signature`, signature does not match the raw body, or the key is unknown, revoked, expired, or does not own the referenced board.",
    content: errorContent("Invalid postback signature."),
  },
  403: {
    description: "The account is not on Pro or Team, or the key is board-scoped to a different board.",
    content: errorContent("This API key is scoped to another board."),
  },
  409: {
    description: "The leaderboard has not started / has ended, an identical request without `Idempotency-Key` was already accepted in the last 24 hours (`Duplicate postback.`), or a request with the same `Idempotency-Key` is still in progress.",
    content: errorContent("This leaderboard has ended. Change the end date or start a new race before posting scores."),
  },
  422: {
    description: "`Idempotency-Key` was already used with a different request payload.",
    content: errorContent("Idempotency-Key was already used with a different request payload."),
  },
  429: { $ref: "#/components/responses/RateLimit" },
  500: { description: "Unexpected server error. Safe to retry with the same `Idempotency-Key`.", content: errorContent("Internal error.") },
};

const idempotencyHeaderParam = {
  name: "Idempotency-Key",
  in: "header",
  required: false,
  schema: { type: "string", minLength: 1, maxLength: IDEMPOTENCY_KEY_MAX_LENGTH },
  description: "Optional client-generated key (for example a UUID) that makes retries safe. Retrying with the same key and the same body returns the original result with `Idempotency-Replayed: true`. Reusing the key with a different body returns `422`. Keys are scoped to the API key owner, the target board and the endpoint, and are kept for 24 hours.",
};

const signingParams = [
  { name: "X-Postback-Key", in: "header", required: true, schema: { type: "string" }, description: "Your API signing key (account-level or board-scoped). Sent in plain text over HTTPS; never put it in a URL." },
  { name: "X-Postback-Signature", in: "header", required: true, schema: { type: "string", pattern: "^[0-9a-f]{64}$" }, description: "Lowercase hex HMAC-SHA256 of the exact raw JSON request body, keyed with the API signing key. Any re-serialisation of the body (whitespace, key order) changes the signature." },
  { name: "X-Postback-Site", in: "header", required: false, schema: { type: "string" }, description: "Board slug or board ID. Alternative to `slug` / `siteId` in the body." },
  idempotencyHeaderParam,
];

const playerWriteSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 80, description: "Display name. Names are matched case-insensitively with whitespace collapsed; two players in one request may not normalise to the same name." },
    wagered: { type: ["number", "string"], minimum: 0, maximum: SCORE_MAX, description: "Amount wagered. Numeric strings are accepted." },
    prize: { type: ["number", "string"], minimum: 0, maximum: SCORE_MAX, description: "Prize amount." },
    score: { type: ["number", "string"], minimum: 0, maximum: SCORE_MAX, description: "Points. Used for ranking when the board ranks by score." },
    hands: { type: ["integer", "string"], minimum: 0, maximum: INT32_MAX, description: "Rounds / hands played." },
    netProfit: { type: ["number", "string"], minimum: -SCORE_MAX, maximum: SCORE_MAX, description: "Net profit. Defaults to `prize - wagered` for players created without it." },
    winRate: { type: ["number", "string"], minimum: -WIN_RATE_MAX, maximum: WIN_RATE_MAX, description: "Win rate percentage." },
    change: { type: ["integer", "string"], minimum: INT32_MIN, maximum: INT32_MAX, description: "Rank movement indicator (positive = moved up)." },
  },
};

const boardSelectionProps = {
  slug: { type: "string", minLength: 1, maxLength: 80, description: "Target board slug. Provide exactly one of `slug`, `siteId` or the `X-Postback-Site` header." },
  siteId: { type: "string", format: "uuid", description: "Target board ID (shown in the dashboard Developer tools card)." },
};

const bulkBodyExample = {
  slug: "your-board",
  players: [
    { name: "Alex", wagered: 12500.5, prize: 1000, score: 4820, hands: 312, netProfit: -11500.5, winRate: 48.2, change: 1 },
    { name: "Sam", wagered: 9800, prize: 500, score: 4100 },
  ],
};
const patchBodyExample = {
  slug: "your-board",
  players: [
    { name: "Alex", score: 5100 },
    { name: "Jordan", wagered: 300, score: 120 },
  ],
};

const SCALAR_CONFIG = {
  url: OPENAPI_PATH,
  proxyUrl: "",
  darkMode: true,
  forceDarkModeState: "dark",
  hideDarkModeToggle: true,
  hideClientButton: true,
  withDefaultFonts: false,
  hideTestRequestButton: true,
  agent: { disabled: true },
  defaultOpenAllTags: true,
  showSidebar: true,
  layout: "modern",
  theme: "none",
  hiddenClients: true,
  defaultHttpClient: { targetKey: "shell", clientKey: "curl" },
  metaData: { title: "Developer API — YourRank" },
  documentDownloadType: "json",
};
const SCALAR_CONFIG_JSON = JSON.stringify(SCALAR_CONFIG);

const curlSample = (method, body) => `BODY='${JSON.stringify(body)}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$YOURRANK_API_KEY" | sed 's/^.* //')
curl -X ${method} https://yourrank.site/api/scores \\
  -H 'Content-Type: application/json' \\
  -H "X-Postback-Key: $YOURRANK_API_KEY" \\
  -H "X-Postback-Signature: $SIG" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  --data-binary "$BODY"`;

const pySample = (method, body) => `import hmac, hashlib, json, os, uuid
import requests

api_key = os.environ["YOURRANK_API_KEY"]  # never hard-code it
body = json.dumps(${JSON.stringify(body, null, 2).replace(/\n/g, "\n")}, separators=(",", ":"))
signature = hmac.new(api_key.encode(), body.encode(), hashlib.sha256).hexdigest()

res = requests.request(
    "${method}",
    "https://yourrank.site/api/scores",
    headers={
        "Content-Type": "application/json",
        "X-Postback-Key": api_key,
        "X-Postback-Signature": signature,
        "Idempotency-Key": str(uuid.uuid4()),
    },
    data=body,  # send the exact string that was signed
)
print(res.status_code, res.json())`;

const jsSample = (method, body) => `import { createHmac, randomUUID } from "node:crypto";

const apiKey = process.env.YOURRANK_API_KEY; // never hard-code it
const body = JSON.stringify(${JSON.stringify(body, null, 2).replace(/\n/g, "\n")});
const signature = createHmac("sha256", apiKey).update(body).digest("hex");

const res = await fetch("https://yourrank.site/api/scores", {
  method: "${method}",
  headers: {
    "Content-Type": "application/json",
    "X-Postback-Key": apiKey,
    "X-Postback-Signature": signature,
    "Idempotency-Key": randomUUID(),
  },
  body, // send the exact string that was signed
});
console.log(res.status, await res.json());`;

const codeSamples = (method, body) => [
  { lang: "shell", label: "cURL", source: curlSample(method, body) },
  { lang: "javascript", label: "JavaScript", source: jsSample(method, body) },
  { lang: "python", label: "Python", source: pySample(method, body) },
];

const INFO_DESCRIPTION = `
Read-only leaderboard endpoints are public on every plan. The write endpoints under \`/api/scores\` require an active **Pro** or **Team** plan and a signed request.

## Getting started

1. Open **Dashboard → Leaderboard → Developer tools** on the board you want to update and create a **board-scoped API signing key**. Copy it once and store it as a secret (\`YOURRANK_API_KEY\` in the examples). Never commit it or put it in a URL.
2. Find your board's **slug** (\`yourrank.site/{slug}\`) or **board ID**; you will pass one of them with every write request.
3. Send a signed request to \`PATCH /api/scores\` to update players, or to \`POST /api/scores\` to replace the whole player list.
4. Read the result back from \`GET /api/public/{slug}/players\` — no authentication required.

The base URL is \`https://yourrank.site\`. All request and response bodies are JSON (\`application/json\`), except the plain-text \`/rank\` endpoint and the \`/stream\` event stream.

## Authentication

Write requests carry two headers:

| Header | Value |
| --- | --- |
| \`X-Postback-Key\` | Your API signing key. |
| \`X-Postback-Signature\` | Lowercase hex **HMAC-SHA256 of the exact raw JSON request body**, using the API signing key as the HMAC secret. |

The header names are kept for backwards compatibility with existing integrations; the key itself is called the *API signing key* in the dashboard.

### API signing

Serialise your body to a string **once**, sign that exact string, and send that exact string. Re-serialising the JSON (different whitespace, key order or number formatting) changes the bytes and the signature no longer matches, which returns \`401 Invalid postback signature.\`

\`\`\`text
signature = hex( HMAC_SHA256( key = API_SIGNING_KEY, message = RAW_REQUEST_BODY ) )
\`\`\`

Signatures are compared in constant time. Keys expire after one year and can be rotated or revoked at any time from the Developer tools card; a rotated or revoked key stops working immediately.

### Board-scoped keys

Keys come in two scopes:

- **Board-scoped** (recommended) — created from a board's Developer tools card. It can only write to that one board. Passing another board's \`slug\`, \`siteId\` or \`X-Postback-Site\` returns \`403 This API key is scoped to another board.\`
- **Account-level** — the legacy key from **Settings → Connections**, shared with deposit postbacks. It can write to every board the account owns and therefore always needs an explicit board reference.

Every write request must reference a board with exactly one of \`slug\` (body), \`siteId\` (body) or the \`X-Postback-Site\` header; a request without a board reference returns \`400\`.

## Leaderboards

The read endpoints under \`/api/public/{slug}\` return the published board. Password-protected boards return \`401 Password required.\`; unknown, unpublished or suspended boards return \`404\`. Responses are cacheable for 10–60 seconds and include \`X-RateLimit-*\` headers. \`slug\` \`demo\` always resolves to a static demo board you can test against.

## Bulk score replacement

> **Warning — \`POST /api/scores\` replaces the board's current player list.** Every player that is not in the submitted \`players\` array is removed from the board. Use it when your system is the single source of truth for the whole leaderboard (for example a nightly full export). To change a few players, use \`PATCH /api/scores\` instead.

## Incremental score updates

\`PATCH /api/scores\` upserts the submitted players and leaves everyone else untouched:

- a player whose name already exists on the board → only the fields you send are updated; omitted fields keep their stored values;
- a new name → the player is created; omitted numeric fields default to \`0\` (\`netProfit\` defaults to \`prize - wagered\`);
- players you do not mention are not modified or removed.

The merged board still has to respect your plan's player limit (Pro ${PLAN_LIMITS.pro.toLocaleString("en-US")}, Team ${PLAN_LIMITS.team.toLocaleString("en-US")}).

## Idempotency

Send an \`Idempotency-Key\` header (any string up to ${IDEMPOTENCY_KEY_MAX_LENGTH} characters, a UUID is ideal) with every write. It is scoped to your account, the target board and the endpoint (\`POST\` and \`PATCH\` keys do not collide), and kept for **24 hours**.

| Situation | Result |
| --- | --- |
| First request with a key | Executed normally; the successful response is stored. |
| Retry: same key, same body | The stored response is returned unchanged with \`Idempotency-Replayed: true\`. Nothing is executed again. |
| Same key, different body | \`422 Idempotency-Key was already used with a different request payload.\` |
| Same key while the first request is still running | \`409 A request with this Idempotency-Key is still being processed. Retry shortly.\` |
| The first request failed (4xx/5xx) | Nothing is stored; the same key can be retried. |

Requests **without** an \`Idempotency-Key\` fall back to replay protection: an identical body sent twice to the same board within 24 hours is rejected with \`409 Duplicate postback.\`. Prefer an \`Idempotency-Key\` so legitimate retries succeed.

## Errors

All JSON errors share one shape:

\`\`\`json
{ "ok": false, "error": "Human readable message" }
\`\`\`

| Status | Meaning |
| --- | --- |
| \`400\` | Validation failed or the board reference is missing. |
| \`401\` | Missing/invalid key or signature, or the key does not own the board. Password-protected public boards also return 401. |
| \`403\` | Plan does not include the signed API, or the key is scoped to another board. |
| \`404\` | Board (or, for \`/rank\`, the leaderboard) not found. |
| \`409\` | Leaderboard not started / ended, duplicate unkeyed request, or in-progress idempotent request. |
| \`422\` | Idempotency-Key reused with a different payload. |
| \`429\` | Rate limit exceeded — see \`Retry-After\`. |
| \`503\` | Stats temporarily unavailable. |

## Rate limits

Limits are per 60-second window. Every response carries \`X-RateLimit-Limit\` and \`X-RateLimit-Remaining\`; a \`429\` also carries \`Retry-After\` (seconds).

| Endpoint | Limit | Keyed by |
| --- | --- | --- |
| \`POST /api/scores\` | 10 / min | API signing key |
| \`PATCH /api/scores\` | 60 / min | API signing key |
| \`GET /api/public/{slug}\` | 120 / min | client IP |
| \`GET /api/public/{slug}/players\` | 120 / min (60 / min when \`search\` is used) | client IP |
| \`GET /api/public/{slug}/standings\` | 100 / min | client IP |
| \`GET /api/public/{slug}/rank\` | 60 / min | client IP |
| \`GET /api/public/{slug}/stats\` | 60 / min | client IP |
| \`GET /api/public/{slug}/stream\` | 60 connections / min | client IP |
`;

export const spec = {
  openapi: "3.1.0",
  info: {
    title: "YourRank Developer API",
    version: "1.1.0",
    summary: "Public leaderboard reads plus signed score writes.",
    description: INFO_DESCRIPTION.trim(),
    contact: { name: "YourRank", url: "https://yourrank.site/contact" },
    termsOfService: "https://yourrank.site/terms",
  },
  servers: [{ url: "https://yourrank.site", description: "Production" }],
  tags: [
    { name: "Leaderboards", description: "Public, unauthenticated reads of a published board." },
    { name: "Scores", description: "Signed writes. Pro or Team plan required." },
  ],
  "x-tagGroups": [
    { name: "Read", tags: ["Leaderboards"] },
    { name: "Write", tags: ["Scores"] },
  ],
  paths: {
    "/api/public/{slug}": {
      get: {
        tags: ["Leaderboards"],
        operationId: "getLeaderboard",
        summary: "Full leaderboard data",
        description: "Returns the complete public data object the leaderboard page renders: brand, prizes, branding, ranking metric, the full player list and timing. Cached for 30 seconds.",
        parameters: [{ $ref: "#/components/parameters/Slug" }],
        responses: publicBoardResponses({
          description: "Leaderboard data",
          headers: RATE_LIMIT_HEADERS,
          content: { "application/json": { schema: { $ref: "#/components/schemas/LeaderboardData" } } },
        }),
      },
    },
    "/api/public/{slug}/standings": {
      get: {
        tags: ["Leaderboards"],
        operationId: "getStandings",
        summary: "Sorted player standings",
        description: "Players sorted by the board's ranking metric (`rankBy`: `score` or `wagered`) with 1-based positions and, when the board has an end date, a countdown. Cached for 30 seconds.",
        parameters: [{ $ref: "#/components/parameters/Slug" }],
        responses: publicBoardResponses({
          description: "Standings",
          headers: RATE_LIMIT_HEADERS,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Standings" },
              example: {
                slug: "demo", name: "Demo Race", casino: "Example Casino", period: "Monthly", prizePool: "$5,000", rankBy: "score",
                players: [{ name: "Alex", score: 4820, wagered: 12500.5, prize: 1000, position: 1 }],
                countdown: { endsAt: "2026-10-31T23:59:59.000Z", remaining: 3372800000 },
              },
            },
          },
        }),
      },
    },
    "/api/public/{slug}/players": {
      get: {
        tags: ["Leaderboards"],
        operationId: "listPlayers",
        summary: "Paginated players",
        description: "A page of players sorted by the board's ranking metric, with every stored metric and the board-wide `rank`. Supports `limit`/`offset` pagination and a case-insensitive `search` on the name. Cached for 10 seconds and served with a weak `ETag`; send `If-None-Match` to receive `304 Not Modified`.",
        parameters: [
          { $ref: "#/components/parameters/Slug" },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 100 }, description: "Page size. Values outside 1–100 are clamped." },
          { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 }, description: "Number of players to skip." },
          { name: "search", in: "query", schema: { type: "string" }, description: "Case-insensitive substring match on the player name. Searching uses a separate 60/min limit." },
          { name: "If-None-Match", in: "header", schema: { type: "string" }, description: "Weak ETag from a previous response." },
        ],
        responses: {
          ...publicBoardResponses({
            description: "Players page",
            headers: { ...RATE_LIMIT_HEADERS, ETag: { schema: { type: "string" }, description: "Weak validator for `If-None-Match`." } },
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PlayersPage" },
                example: {
                  players: [{ name: "Alex", wagered: 12500.5, prize: 1000, score: 4820, hands: 312, netProfit: -11500.5, winRate: 48.2, change: 1, rank: 1 }],
                  total: 2, offset: 0, limit: 100, hasMore: false,
                },
              },
            },
          }),
          304: { description: "Not modified (ETag matched).", headers: RATE_LIMIT_HEADERS },
        },
      },
    },
    "/api/public/{slug}/rank": {
      get: {
        tags: ["Leaderboards"],
        operationId: "getRank",
        summary: "Rank lookup (plain text)",
        description: "One-line text answer for chat bots (Nightbot `$(urlfetch …)`, StreamElements `$(customapi …)`, Streamlabs `$(readapi …)`). The name is matched exactly after trimming, collapsing whitespace, lower-casing and dropping a leading `@`. A player who is not on the board still returns `200` with an explanatory sentence.",
        parameters: [
          { $ref: "#/components/parameters/Slug" },
          { name: "user", in: "query", required: true, schema: { type: "string" }, description: "Player name (exact, case-insensitive)." },
        ],
        responses: {
          200: {
            description: "Rank sentence, or `NAME is not on BOARD's leaderboard yet.`",
            headers: RATE_LIMIT_HEADERS,
            content: { "text/plain": { schema: { type: "string" }, example: "Alex is #2 of 40 on Demo Race's leaderboard. 4,820 points (280 points behind #1)" } },
          },
          400: { description: "Missing `user` query parameter.", content: { "text/plain": { schema: { type: "string" }, example: "Usage: /api/public/:slug/rank?user=NAME" } } },
          401: { description: "Password-protected board.", content: { "text/plain": { schema: { type: "string" }, example: "Password required." } } },
          404: { description: "Leaderboard not found.", content: { "text/plain": { schema: { type: "string" }, example: "Leaderboard not found." } } },
          429: { description: "Rate limit exceeded.", headers: { ...RATE_LIMIT_HEADERS, "Retry-After": { schema: { type: "integer" } } }, content: { "text/plain": { schema: { type: "string" }, example: "Rate limit exceeded." } } },
        },
      },
    },
    "/api/public/{slug}/stats": {
      get: {
        tags: ["Leaderboards"],
        operationId: "getStats",
        summary: "Public stats",
        description: "View / copy / click / conversion counters for today, the last 7 and the last 30 days, plus a dense 30-day daily series. Cached for 60 seconds.",
        parameters: [{ $ref: "#/components/parameters/Slug" }],
        responses: {
          ...publicBoardResponses({
            description: "Stats",
            headers: RATE_LIMIT_HEADERS,
            content: { "application/json": { schema: { $ref: "#/components/schemas/Stats" } } },
          }),
          503: { description: "Analytics temporarily unavailable (statement timeout).", content: errorContent("Analytics are temporarily unavailable. Try again shortly.") },
        },
      },
    },
    "/api/public/{slug}/stream": {
      get: {
        tags: ["Leaderboards"],
        operationId: "streamPlayers",
        summary: "Live player stream (SSE)",
        description: "Server-Sent Events stream. Each `data:` event is a JSON object `{ players, total, updatedAt }` with the first 100 players; a new event is sent whenever the board changes. Not covered by CORS — consume it from a browser on the same origin or from a server.",
        parameters: [{ $ref: "#/components/parameters/Slug" }],
        responses: {
          200: { description: "Event stream", headers: RATE_LIMIT_HEADERS, content: { "text/event-stream": { schema: { type: "string" }, example: "data: {\"players\":[…],\"total\":40,\"updatedAt\":\"2026-09-22T17:04:00.000Z\"}\n\n" } } },
          401: { $ref: "#/components/responses/PasswordRequired" },
          404: { $ref: "#/components/responses/NotFound" },
          429: { $ref: "#/components/responses/RateLimit" },
          503: { description: "Live streams temporarily unavailable; retry after `Retry-After` seconds.", headers: { "Retry-After": { schema: { type: "integer" } } }, content: { "text/plain": { schema: { type: "string" } } } },
        },
      },
    },
    "/api/scores": {
      post: {
        tags: ["Scores"],
        operationId: "replaceScores",
        summary: "Replace the board's player list",
        description: `**This endpoint replaces the board's current player list.** Players missing from \`players\` are deleted; players present are created or overwritten with the submitted values (omitted numeric fields become \`0\`, \`netProfit\` defaults to \`prize - wagered\`). Use \`PATCH /api/scores\` to update individual players instead.

Requires Pro or Team, a board reference, and a valid signature. Rejected with \`409\` while the leaderboard has not started or after it has ended. Rate limit: 10 requests / minute per key.`,
        security: [{ ApiSigningKey: [] }],
        parameters: signingParams,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["players"],
                properties: {
                  ...boardSelectionProps,
                  players: {
                    type: "array",
                    maxItems: 9999,
                    items: { $ref: "#/components/schemas/PlayerWrite" },
                    description: `The complete new player list. May be empty (clears the board). After validation the count must not exceed your plan limit: Pro ${PLAN_LIMITS.pro.toLocaleString("en-US")}, Team ${PLAN_LIMITS.team.toLocaleString("en-US")}.`,
                  },
                },
              },
              example: bulkBodyExample,
            },
          },
        },
        responses: {
          200: {
            description: "Player list replaced.",
            headers: { ...RATE_LIMIT_HEADERS, "Idempotency-Replayed": { schema: { type: "string", enum: ["true"] }, description: "Present when this is the stored result of an earlier request with the same `Idempotency-Key`." } },
            content: { "application/json": { schema: { $ref: "#/components/schemas/ReplaceResult" }, example: { ok: true, players: 2 } } },
          },
          ...writeErrorResponses,
        },
        "x-codeSamples": codeSamples("POST", bulkBodyExample),
      },
      patch: {
        tags: ["Scores"],
        operationId: "upsertScores",
        summary: "Update or create individual players",
        description: `Upserts the submitted players and leaves every other player untouched. For an existing name only the fields you include are changed; omitted fields keep their stored values. Unknown names are created (omitted numeric fields default to \`0\`, \`netProfit\` to \`prize - wagered\`). The merge is applied atomically under a board lock, so concurrent updates cannot overwrite each other.

Requires Pro or Team, a board reference, and a valid signature. Rejected with \`409\` while the leaderboard has not started or after it has ended. The merged board must stay within your plan's player limit. Rate limit: 60 requests / minute per key.`,
        security: [{ ApiSigningKey: [] }],
        parameters: signingParams,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["players"],
                properties: {
                  ...boardSelectionProps,
                  players: {
                    type: "array",
                    minItems: 1,
                    maxItems: 9999,
                    items: { $ref: "#/components/schemas/PlayerWrite" },
                    description: "One or more players to update or create.",
                  },
                },
              },
              examples: {
                updateOne: { summary: "Update one existing player", value: { slug: "your-board", players: [{ name: "Alex", score: 5100 }] } },
                createOne: { summary: "Create a new player", value: { slug: "your-board", players: [{ name: "Jordan", wagered: 300, prize: 0, score: 120 }] } },
                updateMany: { summary: "Update several players", value: patchBodyExample },
                partialFields: { summary: "Omitted fields stay unchanged", description: "Only `wagered` changes for Alex; score, prize, hands, netProfit, winRate and change keep their stored values.", value: { siteId: "3fa85f64-5717-4562-b3fc-2c963f66afa6", players: [{ name: "Alex", wagered: 13000 }] } },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Players merged.",
            headers: { ...RATE_LIMIT_HEADERS, "Idempotency-Replayed": { schema: { type: "string", enum: ["true"] }, description: "Present when this is the stored result of an earlier request with the same `Idempotency-Key`." } },
            content: { "application/json": { schema: { $ref: "#/components/schemas/UpsertResult" }, example: { ok: true, players: 41, updated: 1, created: 1 } } },
          },
          ...writeErrorResponses,
        },
        "x-codeSamples": codeSamples("PATCH", patchBodyExample),
      },
    },
  },
  components: {
    parameters: {
      Slug: { name: "slug", in: "path", required: true, schema: { type: "string" }, description: "Board slug — the path segment of `yourrank.site/{slug}`. `demo` always works." },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["ok", "error"],
        properties: { ok: { type: "boolean", const: false }, error: { type: "string" } },
      },
      PlayerWrite: playerWriteSchema,
      PlayerRead: {
        type: "object",
        properties: {
          name: { type: "string" },
          wagered: { type: "number" },
          prize: { type: "number" },
          score: { type: "number" },
          hands: { type: "integer" },
          netProfit: { type: "number" },
          winRate: { type: "number" },
          change: { type: "integer" },
          rank: { type: "integer", description: "1-based rank across the whole board (not just this page)." },
        },
      },
      StandingsPlayer: {
        type: "object",
        properties: {
          name: { type: "string" },
          score: { type: "number" },
          wagered: { type: "number" },
          prize: { type: "number" },
          position: { type: "integer", description: "1-based position." },
        },
      },
      PlayersPage: {
        type: "object",
        required: ["players", "total", "offset", "limit", "hasMore"],
        properties: {
          players: { type: "array", items: { $ref: "#/components/schemas/PlayerRead" } },
          total: { type: "integer", description: "Players on the whole board (ignores `search`)." },
          offset: { type: "integer" },
          limit: { type: "integer" },
          hasMore: { type: "boolean", description: "Whether another page exists after this one (respects `search`)." },
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
          rankBy: { type: "string", enum: ["score", "wagered"] },
          players: { type: "array", items: { $ref: "#/components/schemas/StandingsPlayer" } },
          countdown: {
            type: ["object", "null"],
            properties: { endsAt: { type: "string", format: "date-time" }, remaining: { type: "integer", description: "Milliseconds until `endsAt` (never negative)." } },
          },
        },
      },
      LeaderboardData: {
        type: "object",
        description: "The renderer's data object. Only the stable top-level keys are listed; additional presentation keys may appear.",
        additionalProperties: true,
        properties: {
          brand: { type: "object", properties: { name: { type: "string" }, casino: { type: "string" }, code: { type: "string" }, ctaUrl: { type: "string" }, prizePool: { type: "string" }, period: { type: "string" }, tagline: { type: "string" }, resetNote: { type: "string" }, blurb: { type: "string" } } },
          prizes: { type: "object" },
          branding: { type: "object" },
          rankBy: { type: "string", enum: ["score", "wagered"] },
          players: { type: "array", items: { $ref: "#/components/schemas/PlayerRead" } },
          playerCount: { type: "integer" },
          startsAt: { type: ["string", "null"], format: "date-time" },
          endsAt: { type: ["string", "null"], format: "date-time" },
        },
      },
      StatsWindow: {
        type: "object",
        properties: { views: { type: "integer" }, copies: { type: "integer" }, clicks: { type: "integer" }, conversions: { type: "integer" }, revenue: { type: "number" } },
      },
      Stats: {
        type: "object",
        properties: {
          slug: { type: "string" },
          name: { type: "string" },
          playerCount: { type: "integer" },
          summary: {
            type: "object",
            properties: { today: { $ref: "#/components/schemas/StatsWindow" }, last7: { $ref: "#/components/schemas/StatsWindow" }, last30: { $ref: "#/components/schemas/StatsWindow" } },
          },
          days: {
            type: "array",
            description: "Dense series for the last 30 days, oldest first.",
            items: { allOf: [{ $ref: "#/components/schemas/StatsWindow" }, { type: "object", properties: { day: { type: "string", format: "date" } } }] },
          },
        },
      },
      ReplaceResult: {
        type: "object",
        required: ["ok", "players"],
        properties: { ok: { type: "boolean", const: true }, players: { type: "integer", description: "Number of players now on the board." } },
      },
      UpsertResult: {
        type: "object",
        required: ["ok", "players", "updated", "created"],
        properties: {
          ok: { type: "boolean", const: true },
          players: { type: "integer", description: "Number of players on the board after the merge." },
          updated: { type: "integer", description: "Existing players that matched by name." },
          created: { type: "integer", description: "Players created by this request." },
        },
      },
    },
    securitySchemes: {
      ApiSigningKey: {
        type: "apiKey",
        in: "header",
        name: "X-Postback-Key",
        description: `API signing key (board-scoped or account-level). Every request must also carry \`X-Postback-Signature\`: the lowercase hex HMAC-SHA256 of the exact raw request body, keyed with this key. Example header pair (illustrative values only):

\`\`\`http
X-Postback-Key: ${EXAMPLE_KEY}
X-Postback-Signature: ${EXAMPLE_SIGNATURE}
\`\`\``,
      },
    },
    responses: {
      NotFound: { description: "Board not found, unpublished or suspended.", content: errorContent("not found") },
      PasswordRequired: { description: "The board is password-protected and cannot be read through the public API.", content: errorContent("Password required.") },
      RateLimit: {
        description: "Rate limit exceeded. Wait `Retry-After` seconds.",
        headers: { ...RATE_LIMIT_HEADERS, "Retry-After": { schema: { type: "integer" }, description: "Seconds until the window resets." } },
        content: errorContent("Rate limit exceeded. Try again shortly."),
      },
    },
  },
};



const DOCS_CSS = `
:root{--yr-bg:#0b0d10;--yr-panel:#11151a;--yr-line:#1f262e;--yr-ink:#e6e9ee;--yr-ink-soft:#9aa4b2;--yr-accent:#7cf0c4;--yr-code:#0a0c0f}
html,body{margin:0;background:var(--yr-bg);color:var(--yr-ink);font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Inter,Roboto,sans-serif}
.yr-docs-header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;padding:10px 20px;background:rgba(11,13,16,.92);border-bottom:1px solid var(--yr-line);backdrop-filter:blur(8px)}
.yr-docs-brand{display:flex;align-items:center;gap:12px;color:var(--yr-ink);text-decoration:none;font-weight:600;letter-spacing:-.01em}
.yr-docs-brand img{width:24px;height:24px;border-radius:6px}
.yr-docs-brand span{color:var(--yr-ink-soft);font-weight:500}
.yr-docs-brand span::before{content:"/";margin:0 8px;color:var(--yr-line)}
.yr-docs-links{display:flex;gap:6px;flex-wrap:wrap}
.yr-docs-links a{font:500 13px/1 inherit;color:var(--yr-ink-soft);text-decoration:none;padding:7px 10px;border:1px solid var(--yr-line);border-radius:6px}
.yr-docs-links a:hover{color:var(--yr-ink);border-color:#38424d}
.yr-docs-links a.yr-docs-primary{color:#07110d;background:var(--yr-accent);border-color:var(--yr-accent)}
.yr-docs-warning{margin:0;padding:10px 20px;font-size:13px;overflow-wrap:anywhere;color:#ffd9a3;background:#2a1d0a;border-bottom:1px solid #4a3410}
.yr-docs-warning code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#ffe7c2}
.scalar-app,.light-mode,.dark-mode{
  --scalar-background-1:var(--yr-bg);--scalar-background-2:var(--yr-panel);--scalar-background-3:#171c23;
  --scalar-border-color:var(--yr-line);--scalar-color-1:var(--yr-ink);--scalar-color-2:var(--yr-ink-soft);--scalar-color-3:#6f7a89;
  --scalar-color-accent:var(--yr-accent);--scalar-background-accent:rgba(124,240,196,.12);
  --scalar-sidebar-background-1:var(--yr-bg);--scalar-sidebar-color-1:var(--yr-ink);--scalar-sidebar-color-2:var(--yr-ink-soft);
  --scalar-sidebar-border-color:var(--yr-line);--scalar-sidebar-item-hover-background:#141920;--scalar-sidebar-item-active-background:#182029;
  --scalar-sidebar-search-background:var(--yr-panel);--scalar-sidebar-search-border-color:var(--yr-line);--scalar-sidebar-search-color:var(--yr-ink-soft);
  --scalar-button-1:var(--yr-accent);--scalar-button-1-color:#07110d;--scalar-button-1-hover:#96f5d1;
  --scalar-color-green:#7cf0c4;--scalar-color-red:#ff7b7b;--scalar-color-yellow:#ffd166;--scalar-color-blue:#7fb6ff;--scalar-color-orange:#ffb570;--scalar-color-purple:#c8a6ff;
  --scalar-font:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Inter,Roboto,sans-serif;--scalar-font-code:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --scalar-radius:6px;--scalar-radius-lg:8px;--scalar-radius-xl:10px;
  --scalar-header-height:49px;
}
.scalar-app .dark-mode,.scalar-app{--scalar-background-1:var(--yr-bg)}
.scalar-app blockquote{border-left:3px solid #ffb570;background:#2a1d0a;color:#ffd9a3;padding:10px 14px;border-radius:6px}
.scalar-app blockquote strong{color:#ffe7c2}
.markdown table{width:100%!important;table-layout:auto!important}
.markdown th{white-space:nowrap!important;word-break:normal!important}
.markdown td{word-break:normal!important;overflow-wrap:anywhere!important}
.narrow-references-container>header[aria-label="Developer Tools"],.darklight-reference{display:none!important}
`;

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Page-specific CSP: the pinned renderer bundle is the only third-party script.
function docsHeaders() {
  const csp = "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; upgrade-insecure-requests";
  return { ...SECURE_HTML, "Content-Security-Policy": csp, "cache-control": "public, max-age=300" };
}

export function renderDocsPage({ origin = "https://yourrank.site" } = {}) {
  const config = SCALAR_CONFIG_JSON.replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Developer API — YourRank</title>
<meta name="description" content="YourRank Developer API reference: public leaderboard endpoints, signed score writes, API signing keys, idempotency, errors and rate limits.">
<link rel="canonical" href="${escapeHtml(origin)}${DOCS_PATH}">
<link rel="icon" href="/favicon.ico">
<style>${DOCS_CSS}</style>
</head>
<body>
<header class="yr-docs-header">
  <a class="yr-docs-brand" href="/"><img src="/favicon.ico" alt="" width="24" height="24">YourRank<span>Developer API</span></a>
  <nav class="yr-docs-links" aria-label="Developer resources">
    <a href="/docs">Guides</a>
    <a href="${OPENAPI_PATH}">openapi.json</a>
    <a class="yr-docs-primary" href="/dashboard">Dashboard</a>
  </nav>
</header>
<p class="yr-docs-warning"><strong>Heads up:</strong> <code>POST /api/scores</code> replaces the board's current player list. Use <code>PATCH /api/scores</code> to update individual players.</p>
<div id="app"></div>
<script id="api-reference" type="application/json" data-configuration="${escapeHtml(config)}"></script>
<script src="${SCALAR_SCRIPT_URL}" integrity="${SCALAR_SCRIPT_INTEGRITY}" crossorigin="anonymous"></script>
</body>
</html>`;
}

export async function handleDocsPage(request) {
  return new Response(renderDocsPage({ origin: new URL(request.url).origin }), { status: 200, headers: docsHeaders() });
}

export async function handleApiDocs(request) {
  return Response.redirect(new URL(DOCS_PATH, request.url).toString(), 301);
}

export async function handleOpenApiJson() {
  return json(spec, 200, { "cache-control": "public, max-age=300" });
}

// Shared Zod schemas and validation helpers for the leaderboard and bot Workers.
// Schemas are keyed by handler function name so the leaderboard withHandler wrapper
// can validate request bodies without touching every handler.

import { z, type ZodSchema, type ZodError } from "zod";

const MAX_SHORT_TEXT = 200;
const MAX_MEDIUM_TEXT = 500;
const MAX_LONG_TEXT = 4000;
const MAX_LOGO_BASE64 = 300_000;

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

function optionalString(max?: number) {
  return z.string().max(max ?? MAX_SHORT_TEXT).optional();
}

function optionalTrimmedString(max?: number) {
  return z.string().trim().max(max ?? MAX_SHORT_TEXT).optional();
}

function optionalUuid() {
  return z.string().uuid().optional().or(z.literal("").optional());
}

// Accepts a string/number and coerces to a number, defaulting to undefined.
const optionalNumber = (max = Number.MAX_SAFE_INTEGER) =>
  z.union([z.number(), z.string()])
    .optional()
    .transform((v) => (v === "" || v === undefined || v === null ? undefined : Number(v)))
    .pipe(z.number().min(0).max(max).optional());
const optionalSignedNumber = (max = Number.MAX_SAFE_INTEGER) =>
  z.union([z.number(), z.string()])
    .optional()
    .transform((v) => (v === "" || v === undefined || v === null ? undefined : Number(v)))
    .pipe(z.number().max(max).optional());

// Accepts ISO date strings or numbers.
const optionalDateString = () => z.string().max(64).optional();

const positiveInt = (max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(1).max(max);

// ---------------------------------------------------------------------------
// Reusable object fragments
// ---------------------------------------------------------------------------

const playerItemSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    wagered: optionalNumber(1e15),
    prize: optionalNumber(1e15),
    score: optionalNumber(1e15),
    hands: optionalNumber(1e15),
    netProfit: optionalSignedNumber(1e15),
    winRate: optionalNumber(1e15),
    change: optionalSignedNumber(1e15),
  })
  .strict();

const socialItemSchema = z
  .object({
    platform: z.string().max(40).optional(),
    name: z.string().max(80).optional(),
    handle: z.string().max(200).optional(),
    action: z.string().max(80).optional(),
    brand: z.string().max(40).optional(),
    url: z.string().max(500).optional(),
    label: z.string().max(200).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

const whyStatItemSchema = z
  .object({
    big: z.string().max(100).optional(),
    label: z.string().max(200).optional(),
    sub: z.string().max(200).optional(),
  })
  .strict();

const jsonbLike = z
  .union([z.string().max(50_000), z.record(z.unknown()), z.array(z.unknown())])
  .optional();

const brandSchema = z
  .object({
    name: z.string().max(80).optional(),
    tagline: z.string().max(200).optional(),
    casino: z.string().max(100).optional(),
    code: z.string().max(100).optional(),
    ctaUrl: z.string().max(500).optional(),
    prizePool: z.string().max(100).optional(),
    period: z.string().max(50).optional(),
    resetNote: z.string().max(500).optional(),
  })
  .strict();

const partnerSchema = z
  .object({
    blurb: z.string().max(2000).optional(),
    chips: z.array(z.string().max(100)).max(20).optional(),
  })
  .strict();

const prizesSchema = z
  .object({
    prizePoolLabel: z.string().max(40).optional(),
    countdownLabel: z.string().max(40).optional(),
    currency: z.string().max(6).optional(),
    hidePrizeAmounts: z.boolean().optional(),
    payoutsLabel: z.string().max(40).optional(),
  })
  .strict()
  .optional();
const textSchema = z.record(z.string().max(MAX_MEDIUM_TEXT)).optional();
const brandingSchema = z
  .object({
    template: z.string().max(50).optional(),
    // The dashboard sends a responsive set (`{ 64: dataUri, 128: … }`), which
    // the save path already normalises; a single data URI stays accepted for
    // older clients. Per-entry and total limits belong to `validateLogoData`.
    logo: z
      .union([
        z.string().max(MAX_LOGO_BASE64),
        z.record(z.string().max(MAX_LOGO_BASE64)),
        z.null(),
      ])
      .optional(),
    accentA: z.string().max(8).optional(),
    accentB: z.string().max(8).optional(),
    font: z.string().max(50).optional(),
    text: textSchema,
    prizes: prizesSchema,
  })
  .strict();

const notifySchema = z
  .object({
    discord_webhook_url: z.union([z.string().max(500), z.null()]).optional(),
    telegram_chat_id: z.union([z.string().max(100), z.null()]).optional(),
    telegram_notify: z.boolean().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Per-handler request-body schemas
// ---------------------------------------------------------------------------

export const handlerSchemas: Record<string, ZodSchema<any>> = {
  handleSignup: z
    .object({
      email: z.string().email().max(254),
      password: z.string().min(8).max(128),
      name: z.string().trim().min(2).max(80).optional(),
      slug: z.string().trim().max(80).optional().or(z.literal("").optional()),
    })
    .strict(),

  handleLogin: z
    .object({
      email: z.string().email().max(254),
      password: z.string().min(1).max(128),
    })
    .strict(),

  handleForgot: z
    .object({
      email: z.string().email().max(254),
    })
    .strict(),

  handleReset: z
    .object({
      token: z.string().min(1).max(128),
      password: z.string().min(8).max(128),
    })
    .strict(),

  handleAccountDelete: z
    .object({
      password: z.string().min(1).max(128),
    })
    .strict(),

  handleTelegramLink: z
    .object({
      id: z.union([z.string(), z.number()]),
      hash: z.string().min(1).max(128),
      auth_date: z.union([z.string(), z.number()]),
      first_name: optionalString(100),
      last_name: optionalString(100),
      username: optionalString(100),
      photo_url: optionalString(500),
    })
    .strict(),

  handleTrackCopy: z
    .object({
      slug: z.string().max(80).optional().or(z.literal("").optional()),
    })
    .strict(),

  handleCreateBoard: z
    .object({
      slug: z.string().trim().max(80),
      name: z.string().trim().max(80).optional().or(z.literal("").optional()),
      casino: optionalTrimmedString(100),
      code: optionalTrimmedString(100),
    })
    .strict(),

  handleArchive: z
    .object({
      label: optionalTrimmedString(200),
      clear: z.enum(["wagers", "players", "none"]).optional().or(z.literal("").optional()),
      siteId: optionalUuid(),
    })
    .strict(),

  handleArchiveDelete: z
    .object({
      id: z.string().uuid(),
      siteId: optionalUuid(),
    })
    .strict(),

  handlePutSite: z
    .object({
      siteId: optionalUuid(),
      slug: z.string().trim().max(80).optional(),
      name: z.string().trim().max(80).optional(),
      published: z.boolean().optional(),
      isDraft: z.boolean().optional(),
      startsAt: optionalDateString(),
      endsAt: optionalDateString(),
      expectedUpdatedAt: optionalDateString(),
      rankBy: z.enum(["wagered", "score"]).optional(),
      customDomain: z.string().max(253).optional().or(z.literal("").optional()),
      removeLogo: z.boolean().optional(),
      brand: brandSchema.optional(),
      partner: partnerSchema.optional(),
      branding: brandingSchema.optional(),
      notify: notifySchema.optional(),
      players: z
        .array(playerItemSchema)
        .max(9999)
        .optional()
        .superRefine((items, ctx) => {
          if (!Array.isArray(items)) return;
          const seen = new Set<string>();
          for (const [i, p] of items.entries()) {
            const norm = String(p?.name || "").trim().toLowerCase().replace(/\s+/g, " ");
            if (!norm) continue;
            if (seen.has(norm)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Duplicate player name: ${p.name}`,
                path: [i, "name"],
              });
            }
            seen.add(norm);
          }
        }),
      socials: z.array(socialItemSchema).max(20).optional(),
      rules: z.array(z.union([z.string().max(500), socialItemSchema, whyStatItemSchema])).max(40).optional(),
      whyStats: z.array(whyStatItemSchema).max(20).optional(),
      chips: z.array(z.string().max(100)).max(20).optional(),
      sections: z.record(z.boolean()).optional(),
      playerFields: z.record(z.boolean()).optional(),
      legal: z.record(z.union([z.string().max(MAX_LONG_TEXT), z.boolean()])).optional(),
      passwordProtected: z.boolean().optional(),
      password: z.string().max(100).optional(),
      autoReset: z
        .object({
          enabled: z.boolean().optional(),
          clear: z.enum(["wagers", "players", "none"]).optional(),
        })
        .optional(),
      extraJson: jsonbLike,
      themeJson: jsonbLike,
    })
    .strict(),

  handlePutTheme: z
    .object({
      siteId: optionalUuid(),
      template: z.string().max(50),
      accentA: z.string().max(8).optional().or(z.literal("").optional()),
      accentB: z.string().max(8).optional().or(z.literal("").optional()),
    })
    .strict(),

  handleDeleteSite: z
    .object({
      siteId: z.string().uuid(),
    })
    .strict(),

  handleSetActive: z
    .object({
      siteId: z.string().uuid(),
    })
    .strict(),

  handleDuplicateBoard: z
    .object({
      siteId: z.string().uuid(),
    })
    .strict(),

  handleNotifyTest: z
    .object({
      channel: z.enum(["discord", "telegram"]),
      webhook_url: optionalString(500),
      chat_id: optionalString(100),
      siteId: optionalUuid(),
    })
    .strict(),

  handleDomainVerify: z
    .object({
      domain: z.string().trim().min(3).max(253),
      siteId: optionalUuid(),
    })
    .strict(),

  handleLead: z
    .object({
      handle: z.string().max(120).optional().or(z.literal("").optional()),
      casino: z.string().max(60).optional().or(z.literal("").optional()),
      contact: z.string().max(160).optional().or(z.literal("").optional()),
      note: z.string().max(MAX_MEDIUM_TEXT).optional().or(z.literal("").optional()),
    })
    .strict(),

  handleContact: z
    .object({
      name: z.string().trim().min(1).max(120),
      email: z.string().email().max(254),
      subject: z.string().max(120).optional().or(z.literal("").optional()),
      message: z.string().trim().min(10).max(MAX_LONG_TEXT),
      kind: z.enum(["support", "feedback"]).optional().or(z.literal("").optional()),
      context: z
        .enum(["dashboard", "leaderboard", "bot", "analytics", "attribution", "billing"])
        .optional()
        .or(z.literal("").optional()),
    })
    .strict(),

  handleCheckout: z
    .object({
      plan: z.string().max(20).optional().or(z.literal("").optional()),
    })
    .strict(),

  handleAction: z
    .object({
      userId: z.string().uuid(),
      action: z.enum(["pro", "team", "free", "suspend", "unsuspend", "reset-link"]),
      days: optionalNumber(3650),
      amountUsd: optionalNumber(1e9),
      plan: z.string().max(20).optional(),
    })
    .strict(),

  handleSupportReply: z
    .object({
      id: z.string().uuid(),
      reply: z.string().trim().min(1).max(MAX_LONG_TEXT),
    })
    .strict(),

  handle2faVerify: z
    .object({
      code: z.string().regex(/^\d{6}$/).max(6),
    })
    .strict(),

  handleLog: z
    .object({
      level: z.enum(["error", "warn", "info"]).optional(),
      context: z.string().max(80).optional(),
      message: z.string().min(1).max(MAX_LONG_TEXT),
      stack: z.string().max(10_000).optional().or(z.literal("").optional()),
      req_id: z.string().max(64).optional().or(z.literal("").optional()),
      extra: z.record(z.unknown()).optional(),
    })
    .strict(),

  // Credits / viewer dashboard schemas
  handleCreditsConnect: z
    .object({
      externalId: z.string().trim().min(1).max(64),
      name: z.string().trim().max(100).optional().or(z.literal("").optional()),
    })
    .strict(),

  handleCreditsSaveReward: z
    .object({
      id: z.string().max(64).optional().or(z.literal("").optional()),
      kickRewardId: z.string().trim().min(1).max(64),
      kickRewardTitle: z.string().trim().min(1).max(200),
      kickRewardCost: z.coerce.number().int().min(0).max(1e9),
      credits: positiveInt(1e9),
    })
    .strict(),

  handleCreditsCreateReward: z
    .object({
      title: z.string().trim().min(1).max(100),
      cost: positiveInt(1e9),
      credits: positiveInt(1e9),
      description: z.string().trim().max(500).optional().or(z.literal("").optional()),
      backgroundColor: z.string().trim().max(20).optional().or(z.literal("").optional()),
    })
    .strict(),

  handleCreditsSaveShopItem: z
    .object({
      id: z.string().uuid().optional().or(z.literal("").optional()),
      name: z.string().trim().min(1).max(100),
      description: z.string().trim().max(500).optional().or(z.literal("").optional()),
      cost: positiveInt(1e9),
      stock: z.preprocess(
        (val) => (val === "" || val === null || val === undefined ? null : Number(val)),
        z.union([z.number().int().min(0).max(1e9), z.literal(null)]).optional()
      ),
      active: z.boolean().optional(),
    })
    .strict(),

  handleCreditsUpdateRedemption: z
    .object({
      status: z.enum(["fulfilled", "cancelled"]),
    })
    .strict(),

  handleCreditsViewerAuth: z
    .object({
      kick: z.union([z.boolean(), z.literal("true"), z.literal("false")]).optional(),
      discord: z.union([z.boolean(), z.literal("true"), z.literal("false")]).optional(),
      public: z.union([z.boolean(), z.literal("true"), z.literal("false")]).optional(),
    })
    .strict(),

  handlePublicRedeem: z
    .object({
      slug: z.string().trim().min(1).max(80),
      kickUserId: z.string().trim().max(64).optional().or(z.literal("").optional()),
      kickUsername: z.string().trim().max(80).optional().or(z.literal("").optional()),
      shopItemId: z.string().trim().min(1).max(64),
      publicToken: z.string().trim().min(1).max(64),
    })
    .strict(),

  handleViewerRedeem: z
    .object({
      slug: z.string().trim().min(1).max(80),
      shopItemId: z.string().trim().min(1).max(64),
      idempotencyKey: z.string().trim().min(1).max(100).optional().or(z.literal("").optional()),
    })
    .strict(),

  // --- Originals games ------------------------------------------------------
  // The client only ever sends a bet, game params and (for Mines) a tile.
  // Outcomes, multipliers and payouts are server-computed and never accepted
  // from a request body — hence `.strict()` on every schema here.
  handleGamesBet: z
    .object({
      slug: z.string().trim().min(1).max(80),
      game: z.enum(["mines", "plinko", "dice", "limbo"]),
      bet: z.coerce.number().int().min(1).max(1_000_000),
      idempotencyKey: z.string().trim().min(8).max(100),
      params: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
    })
    .strict(),

  handleGamesMinesReveal: z
    .object({
      slug: z.string().trim().min(1).max(80),
      roundId: z.string().uuid(),
      tile: z.coerce.number().int().min(0).max(24),
    })
    .strict(),

  handleGamesMinesCashout: z
    .object({
      slug: z.string().trim().min(1).max(80),
      roundId: z.string().uuid(),
    })
    .strict(),

  handleGamesFairnessRotate: z
    .object({
      slug: z.string().trim().min(1).max(80),
      clientSeed: z.string().trim().min(1).max(64).optional(),
    })
    .strict(),
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function friendlyError(error: ZodError): string {
  const issues = error.issues.slice(0, 3).map((i) => {
    const path = i.path.length ? i.path.join(".") : "request";
    return `${path}: ${i.message}`;
  });
  return issues.length ? issues.join("; ") : "Invalid request";
}

export async function validateJson<T>(request: Request, schema: ZodSchema<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, error: "Invalid JSON body" };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: friendlyError(parsed.error) };
  }
  return { ok: true, data: parsed.data };
}

export function formatValidationError(error: ZodError): string {
  return friendlyError(error);
}

export { z };

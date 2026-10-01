export const DB_RANK_BY_AMOUNT = "wagered" as const;
const LEGACY_AMOUNT_FIELD = DB_RANK_BY_AMOUNT;
const LEGACY_SPONSOR_FIELD = "casino" as const;
const LEGACY_HANDS_FIELD = "hands" as const;
const LEGACY_NET_PROFIT_FIELD = "netProfit" as const;
const LEGACY_WIN_RATE_FIELD = "winRate" as const;
const LEGACY_NET_PROFIT_COLUMN = "net_profit" as const;
const LEGACY_WIN_RATE_COLUMN = "win_rate" as const;
const LEGACY_CONVERSION_EVENT = "deposit" as const;
const LEGACY_CLEAR_AMOUNT = "wagers" as const;
const LEGACY_ARCHIVE_FIELDS = [
  LEGACY_AMOUNT_FIELD,
  LEGACY_HANDS_FIELD,
  LEGACY_NET_PROFIT_FIELD,
  LEGACY_NET_PROFIT_COLUMN,
  LEGACY_WIN_RATE_FIELD,
  LEGACY_WIN_RATE_COLUMN,
] as const;

type RecordValue = Record<string, unknown>;

export function rankByFromDb(value: unknown): "amount" | "score" {
  return value === DB_RANK_BY_AMOUNT || value === "amount" ? "amount" : "score";
}

export function rankByToDb(value: unknown): typeof DB_RANK_BY_AMOUNT | "score" {
  return rankByFromDb(value) === "amount" ? DB_RANK_BY_AMOUNT : "score";
}

export function autoResetClearFromDb(value: unknown): "amount" | "players" | "none" {
  if (value === LEGACY_CLEAR_AMOUNT || value === "amount") return "amount";
  return value === "players" || value === "none" ? value : "amount";
}

export function autoResetClearToDb(value: unknown): typeof LEGACY_CLEAR_AMOUNT | "players" | "none" {
  const clear = autoResetClearFromDb(value);
  return clear === "amount" ? LEGACY_CLEAR_AMOUNT : clear;
}

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function withLegacyAmount<T extends RecordValue>(value: T): T & RecordValue {
  if (!Object.hasOwn(value, "amount")) return { ...value } as T & RecordValue;
  return { ...value, [LEGACY_AMOUNT_FIELD]: value.amount } as T & RecordValue;
}

export function writeArchiveSnapshot<T extends RecordValue>(players: T[]): Array<T & RecordValue> {
  return players.map((player) => {
    const amount = player.amount ?? player[LEGACY_AMOUNT_FIELD] ?? 0;
    return { ...player, amount, [LEGACY_AMOUNT_FIELD]: amount };
  });
}

export function readArchiveAmount(player: RecordValue): unknown {
  return player.amount ?? player[LEGACY_AMOUNT_FIELD] ?? 0;
}

export function readArchiveSnapshot(snapshot: unknown): RecordValue[] {
  if (!Array.isArray(snapshot)) return [];
  return snapshot.filter(isRecord).map((player) => {
    const canonical: RecordValue = { ...player, amount: readArchiveAmount(player) };
    for (const field of LEGACY_ARCHIVE_FIELDS) delete canonical[field];
    return canonical;
  });
}

function normalizePlayerInput(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const player = { ...value };
  if (!Object.hasOwn(player, "amount") && Object.hasOwn(player, LEGACY_AMOUNT_FIELD)) {
    player.amount = player[LEGACY_AMOUNT_FIELD];
  }
  delete player[LEGACY_AMOUNT_FIELD];
  delete player[LEGACY_HANDS_FIELD];
  delete player[LEGACY_NET_PROFIT_FIELD];
  delete player[LEGACY_WIN_RATE_FIELD];
  return player;
}

function normalizeLegacyInput(input: unknown, rootSponsorTarget: "sponsor" | "brand" | "partner"): unknown {
  if (!isRecord(input)) return input;
  const normalized = { ...input };
  if (!Object.hasOwn(normalized, "amount") && Object.hasOwn(normalized, LEGACY_AMOUNT_FIELD)) {
    normalized.amount = normalized[LEGACY_AMOUNT_FIELD];
  }
  delete normalized[LEGACY_AMOUNT_FIELD];
  delete normalized[LEGACY_HANDS_FIELD];
  delete normalized[LEGACY_NET_PROFIT_FIELD];
  delete normalized[LEGACY_WIN_RATE_FIELD];
  if (Object.hasOwn(normalized, "rankBy")) {
    normalized.rankBy = rankByFromDb(normalized.rankBy);
  }
  if (normalized.clear === LEGACY_CLEAR_AMOUNT) normalized.clear = "amount";
  if (isRecord(normalized.autoReset) && normalized.autoReset.clear === LEGACY_CLEAR_AMOUNT) {
    normalized.autoReset = { ...normalized.autoReset, clear: "amount" };
  }

  if (Object.hasOwn(normalized, LEGACY_SPONSOR_FIELD)) {
    if (!Object.hasOwn(normalized, rootSponsorTarget)) {
      normalized[rootSponsorTarget] = normalized[LEGACY_SPONSOR_FIELD];
    }
    delete normalized[LEGACY_SPONSOR_FIELD];
  }

  if (Array.isArray(normalized.players)) {
    normalized.players = normalized.players.map(normalizePlayerInput);
  }
  if (isRecord(normalized.brand)) {
    normalized.brand = normalizeLegacyInput(normalized.brand, "sponsor");
  }
  return normalized;
}

export function normalizeLegacyPublicInput(input: unknown): unknown {
  return normalizeLegacyInput(input, "sponsor");
}

export function normalizeLegacyLeadInput(input: unknown): unknown {
  return normalizeLegacyInput(input, "brand");
}

export function normalizeLegacyPartnerInput(input: unknown): unknown {
  return normalizeLegacyInput(input, "partner");
}

function addPlayerOutputAlias(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return withLegacyAmount(value);
}

export function addLegacyPublicOutputAliases<T extends RecordValue>(value: T): T {
  const output: RecordValue = { ...value };
  if (Array.isArray(output.players)) {
    output.players = output.players.map(addPlayerOutputAlias);
  }
  if (Array.isArray(output.pastWinners)) {
    output.pastWinners = output.pastWinners.map((archive) => {
      if (!isRecord(archive) || !Array.isArray(archive.top)) return archive;
      return { ...archive, top: archive.top.map(addPlayerOutputAlias) };
    });
  }
  if (Object.hasOwn(output, "sponsor")) {
    output[LEGACY_SPONSOR_FIELD] = output.sponsor;
  }
  if (isRecord(output.brand)) {
    const brand = { ...output.brand };
    if (Object.hasOwn(brand, "sponsor")) {
      brand[LEGACY_SPONSOR_FIELD] = brand.sponsor;
    }
    output.brand = brand;
  }
  return output as T;
}

function normalizeQueuePlayer(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const player = { ...value };
  if (!Object.hasOwn(player, "amount") && Object.hasOwn(player, LEGACY_AMOUNT_FIELD)) {
    player.amount = player[LEGACY_AMOUNT_FIELD];
  }
  delete player[LEGACY_AMOUNT_FIELD];
  if (Object.hasOwn(player, "rankBy")) {
    player.rankBy = rankByFromDb(player.rankBy);
  }
  return player;
}

export function normalizeLegacyQueueInput(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const normalized = { ...input };
  if (Object.hasOwn(normalized, "rankBy")) {
    normalized.rankBy = rankByFromDb(normalized.rankBy);
  }
  if (Array.isArray(normalized.changes)) {
    normalized.changes = normalized.changes.map(normalizeQueuePlayer);
  }
  if (Array.isArray(normalized.players)) {
    normalized.players = normalized.players.map(normalizeQueuePlayer);
  }
  return normalized;
}

function addQueuePlayerAlias(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const player = withLegacyAmount(value);
  delete player.amount;
  if (player.rankBy === "amount") player.rankBy = DB_RANK_BY_AMOUNT;
  return player;
}

export function addLegacyQueueAliases<T extends RecordValue>(input: T): T {
  const output: RecordValue = { ...input };
  if (output.rankBy === "amount") output.rankBy = DB_RANK_BY_AMOUNT;
  if (Array.isArray(output.changes)) {
    output.changes = output.changes.map(addQueuePlayerAlias);
  }
  if (Array.isArray(output.players)) {
    output.players = output.players.map(addQueuePlayerAlias);
  }
  return output as T;
}

export function normalizeConversionEvent(value: string | null | undefined): string {
  const event = String(value ?? "conversion").toLowerCase().slice(0, 32);
  return event === LEGACY_CONVERSION_EVENT ? "conversion" : event;
}

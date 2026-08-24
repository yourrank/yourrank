// postgres.js serialises a JS value bound to a jsonb column as JSON already.
// Pre-stringifying it first therefore encodes it TWICE and the column ends up
// holding a JSON *string* instead of an object/array: `jsonb_typeof()` says
// `string`, `params->>'mines'` reads nothing, and readers get a string back.
// That is how game_rounds.params/outcome, tournaments.participants_json,
// predictions.options, credit_ledger.metadata and friends were once written.
// The contract is: bind the value, never a pre-serialised copy of it.
//
// The scan is column-driven rather than text-driven: the jsonb column names come
// from the migrations, and only the argument list of a query whose SQL writes one
// of those columns is inspected, so ordinary HTTP/HTML serialisation elsewhere in
// the same file is not flagged.
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..", "..", "..", "..");
const MIGRATIONS = join(REPO, "supabase", "migrations");
// Every workspace that can reach the database. `apps/consumer` was missing here
// while it still bound a pre-serialised `queue_dlq_events.body`, so the gate has
// to enumerate the workspaces rather than the ones that happened to be fixed.
const ROOTS = [
  join(REPO, "packages", "shared", "src"),
  join(REPO, "apps", "leaderboard", "src"),
  join(REPO, "apps", "bot", "src"),
  join(REPO, "apps", "monitor", "src"),
  join(REPO, "apps", "consumer", "src"),
  join(REPO, "apps", "web", "src"),
];

const SOURCE = /\.(ts|tsx|js|jsx)$/;
const WRITES = /\b(insert\s+into|update|set_|place_bet|settle_round)\b/i;

// Browser-side code cannot reach Postgres, and `assets_bundled.js` is generated
// from it, so neither can hold a jsonb writer — but both are full of quoted SQL
// lookalikes ("update", "params", …) next to legitimate JSON.stringify calls.
const NOT_A_DB_CALLER = /(^|[\\/])(assets|assets_bundled\.js)$/;

function filesIn(dir: string, match: RegExp): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__snapshots__") continue;
    if (NOT_A_DB_CALLER.test(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(filesIn(full, match));
    else if (match.test(entry)) out.push(full);
  }
  return out;
}

/** Every jsonb column declared by a migration, e.g. `metadata jsonb`. */
function jsonbColumns(): Set<string> {
  const columns = new Set<string>();
  for (const file of filesIn(MIGRATIONS, /\.sql$/)) {
    const sql = readFileSync(file, "utf8");
    for (const match of sql.matchAll(/(?:^|[\s,(])"?([a-z_][a-z0-9_]*)"?\s+jsonb\b/gi)) {
      const name = match[1].toLowerCase();
      if (name === "add" || name === "column" || name === "as" || name === "returns") continue;
      columns.add(name);
    }
  }
  return columns;
}

/** End index (inclusive) of the string literal opened at `start`. */
function literalEnd(src: string, start: number): number {
  const quote = src[start];
  let i = start + 1;
  while (i < src.length && src[i] !== quote) {
    if (src[i] === "\\") i++;
    i++;
  }
  return i;
}

/**
 * Blanks out comments, keeping every other byte in place. Without this a lone
 * apostrophe in prose ("broadcasts can't be cancelled") reads as the start of a
 * string literal, so the scan pairs it with the next apostrophe further down the
 * file and skips whatever lies between — which is how the double-encoded
 * `broadcasts.audience_filter_snapshot` writer sat under a passing gate.
 */
function blankComments(src: string): string {
  const out = src.split("");
  const blank = (from: number, to: number) => {
    for (let i = from; i < to && i < out.length; i++) if (out[i] !== "\n") out[i] = " ";
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      i = literalEnd(src, i);
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i);
      blank(i, end === -1 ? src.length : end);
      i = end === -1 ? src.length : end;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      blank(i, stop);
      i = stop - 1;
    }
  }
  return out.join("");
}

/**
 * The argument list of every query call whose SQL writes a jsonb column: the
 * text between the end of the SQL string and the closing paren of the enclosing
 * call. Template literals, quoted strings, and `"…" + "…"` concatenations all
 * count — restricting the scan to backticks let a `'INSERT …'` writer through.
 */
function jsonbWriteArguments(source: string, columns: Set<string>): string[] {
  const regions: string[] = [];
  const src = blankComments(source);

  for (let i = 0; i < src.length; i++) {
    if (src[i] !== "`" && src[i] !== '"' && src[i] !== "'") continue;
    let end = literalEnd(src, i);
    let sql = src.slice(i + 1, end);
    // Fold `"…" + "…"` / adjacent-literal concatenation into one SQL string.
    for (;;) {
      const rest = src.slice(end + 1);
      const join = /^\s*\+\s*(?=[`"'])/.exec(rest);
      if (!join) break;
      const next = end + 1 + join[0].length;
      const nextEnd = literalEnd(src, next);
      sql += src.slice(next + 1, nextEnd);
      end = nextEnd;
    }
    i = end;

    const lower = sql.toLowerCase();
    // A `::jsonb` cast is a jsonb write on its own (the stored procedures take
    // their json arguments that way and never name the column).
    const touchesJsonb =
      lower.includes("::jsonb") ||
      (WRITES.test(lower) &&
        [...columns].some((column) => new RegExp(`\\b${column}\\b`).test(lower)));
    if (!touchesJsonb) continue;

    // Walk forward to the closing paren of the call this template belongs to.
    let depth = 0;
    let cursor = end + 1;
    for (; cursor < src.length; cursor++) {
      const ch = src[cursor];
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" && depth === 0) break;
      else if (ch === ")" || ch === "]" || ch === "}") depth--;
    }
    regions.push(src.slice(end + 1, cursor));
  }

  return regions;
}

describe("jsonb parameter binding", () => {
  const columns = jsonbColumns();

  it("knows the jsonb columns declared by the migrations", () => {
    // Sanity check: a column-driven scan is worthless if the column list is empty.
    expect(columns.size).toBeGreaterThan(10);
    expect(columns.has("params")).toBe(true);
    expect(columns.has("metadata")).toBe(true);
  });

  it("sees writers whose SQL is not a template literal", () => {
    // The scan used to look at backticked SQL only, so a quoted or concatenated
    // statement was invisible to it. Each fixture must be reported.
    const fixtures = [
      `await exec('INSERT INTO game_rounds (params) VALUES ($1::jsonb)', [JSON.stringify(params)]);`,
      `await exec("UPDATE predictions SET options=$1" + " WHERE id=$2", [JSON.stringify(options), id]);`,
      "await exec(`UPDATE seasons SET tiers_json=$1`, [JSON.stringify(tiers)]);",
    ];
    for (const fixture of fixtures) {
      const args = jsonbWriteArguments(fixture, columns);
      expect(args.some((region) => region.includes("JSON.stringify"))).toBe(true);
    }
  });

  it("sees writers that follow an apostrophe in a comment", () => {
    // A lone apostrophe in prose used to swallow the rest of the file: the
    // broadcasts writer below was invisible to the scan for exactly this reason.
    const fixture = [
      "// Already sent broadcasts can't be cancelled.",
      "const rows = await exec(",
      "  `INSERT INTO broadcasts (bot_id, audience_filter_snapshot) VALUES ($1, $2::jsonb)`,",
      "  [botId, JSON.stringify(segment)]",
      ");",
    ].join("\n");
    const args = jsonbWriteArguments(fixture, columns);
    expect(args.some((region) => region.includes("JSON.stringify"))).toBe(true);
  });

  it("never binds a pre-serialised value to a jsonb column", () => {
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of filesIn(root, SOURCE)) {
        // Tests are not writers, and some deliberately bind a pre-serialised
        // value to reproduce the defect (apps/consumer/src/jsonb-database.test.js).
        if (file.includes(`${join("src", "__tests__")}`) || /\.(test|spec)\.[jt]sx?$/.test(file)) continue;
        const src = readFileSync(file, "utf8");
        if (!src.includes("JSON.stringify")) continue;
        for (const args of jsonbWriteArguments(src, columns)) {
          if (args.includes("JSON.stringify")) {
            offenders.push(file.slice(REPO.length + 1));
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

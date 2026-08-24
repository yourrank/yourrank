// postgres.js serialises a JS value bound to a jsonb column as JSON already.
// Pre-stringifying it first therefore encodes it TWICE and the column ends up
// holding a JSON *string* instead of an object/array: `jsonb_typeof()` says
// `string`, `params->>'mines'` reads nothing, and readers get a string back.
// That is how game_rounds.params/outcome, tournaments.participants_json,
// predictions.options, credit_ledger.metadata and friends were written before
// 20260902000000_jsonb_unwrap_double_encoded.sql. The contract is: bind the
// value, never a pre-serialised copy of it.
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
const ROOTS = [
  join(REPO, "packages", "shared", "src"),
  join(REPO, "apps", "leaderboard", "src"),
  join(REPO, "apps", "bot", "src"),
  join(REPO, "apps", "monitor", "src"),
];

const SOURCE = /\.(ts|tsx|js|jsx)$/;
const WRITES = /\b(insert\s+into|update|set_|place_bet|settle_round)\b/i;

function filesIn(dir: string, match: RegExp): string[] {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__snapshots__") continue;
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

/**
 * The argument list of every query call whose SQL template writes a jsonb
 * column: the text between the end of the template literal and the closing
 * paren of the enclosing call.
 */
function jsonbWriteArguments(src: string, columns: Set<string>): string[] {
  const regions: string[] = [];

  for (let i = 0; i < src.length; i++) {
    if (src[i] !== "`") continue;
    let end = i + 1;
    while (end < src.length && src[end] !== "`") {
      if (src[end] === "\\") end++;
      end++;
    }
    const sql = src.slice(i + 1, end);
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

  it("never binds a pre-serialised value to a jsonb column", () => {
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of filesIn(root, SOURCE)) {
        if (file.includes(`${join("src", "__tests__")}`)) continue;
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

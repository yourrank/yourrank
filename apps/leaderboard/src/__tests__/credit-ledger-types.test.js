import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const handlersDir = fileURLToPath(new URL("../handlers", import.meta.url));
const allowedTypes = new Set(["earn", "spend", "redeem", "revoke", "refund"]);

describe("credit ledger insert types", () => {
  it("uses an allowed literal type in every handler insert", () => {
    const handlerFiles = readdirSync(handlersDir).filter((name) => name.endsWith(".js"));
    const insertPattern = /INSERT\s+INTO\s+credit_ledger\b/gi;

    for (const name of handlerFiles) {
      const source = readFileSync(join(handlersDir, name), "utf8");
      const inserts = [...source.matchAll(insertPattern)];
      if (inserts.length === 0) continue;

      expect(inserts.length, `${name} should have at least one ledger insert`).toBeGreaterThan(0);
      for (let index = 0; index < inserts.length; index++) {
        const start = inserts[index].index;
        const next = inserts[index + 1]?.index ?? source.length;
        const statement = source.slice(start, next);
        const type = statement.match(/VALUES\s*\(\$1,\s*'([^']+)'/i)?.[1];
        expect(type, `${name} should expose a literal type for every ledger insert`).toBeDefined();
        expect(allowedTypes.has(type), `${name} uses invalid ledger type "${type}"`).toBe(true);
      }
    }
  });
});

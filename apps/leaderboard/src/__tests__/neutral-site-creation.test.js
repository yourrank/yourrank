import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createBoard } from "../site.js";

describe("neutral site creation", () => {
  it("persists score ranking and an empty prize pool for a new normal site", async () => {
    const writes = [];
    const tx = {
      one: async (sql) => sql.includes("SELECT plan")
        ? { plan: "free", plan_expires_at: null, status: "active" }
        : null,
      query: async () => [],
      unsafe: async (sql, params) => {
        writes.push({ sql, params });
        return [];
      },
    };

    const result = await createBoard({}, "00000000-0000-4000-8000-000000000001", {
      slug: "neutral-streamer",
      name: "Neutral Streamer",
    }, null, tx);

    expect(result.ok).toBe(true);
    const siteInsert = writes.find(({ sql }) => sql.includes("INSERT INTO sites"));
    expect(siteInsert.sql).toContain("rank_by");
    expect(siteInsert.params).toContain("score");
    expect(siteInsert.params).not.toContain("$0");
    expect(writes.some(({ sql }) => sql.includes("INSERT INTO players"))).toBe(false);
  });

  it("changes only future database defaults and does not rewrite historical sites", () => {
    const migration = readFileSync(join(
      import.meta.dir,
      "../../../../supabase/migrations/20260902000000_neutral_leaderboard_defaults.sql",
    ), "utf8");
    expect(migration).toContain("ALTER COLUMN rank_by SET DEFAULT 'score'");
    expect(migration).not.toMatch(/UPDATE\s+public\.sites/i);
    expect(migration).toContain("WHEN NEW.rank_by = 'wagered'");
    expect(migration).toContain("ELSE (elements.elem->>'score')::numeric");
  });

  it("makes score the creator editor's normal path while retaining labeled legacy compatibility", () => {
    const dashboard = readFileSync(join(import.meta.dir, "../pages/dashboard.jsx"), "utf8");
    const state = readFileSync(join(import.meta.dir, "../assets/dashboard/state.js"), "utf8");
    const players = readFileSync(join(import.meta.dir, "../assets/dashboard/players.js"), "utf8");

    expect(state).toContain('RANK_BY: "score"');
    expect(dashboard.indexOf('<option value="score">Points / score</option>'))
      .toBeLessThan(dashboard.indexOf('<option value="wagered">Legacy amount</option>'));
    expect(dashboard).toContain('id="qa_score"');
    expect(dashboard).toContain("For a normal leaderboard, use <strong>Name</strong> and <strong>Score</strong>");
    expect(players).toContain('const scoreMode = state.RANK_BY !== "wagered"');
    expect(players).toContain('const csv = "name,score\\nAvery,120\\nBlair,80\\nCasey,45\\n"');
    expect(players).not.toContain("CryptoKing");
    expect(players).not.toContain('const csv = "name,wagered,prize');
    expect(players).toContain('table?.querySelectorAll(".col-legacy")');
  });
});

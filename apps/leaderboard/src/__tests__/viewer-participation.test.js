import { describe, expect, it } from "bun:test";
import { getViewerParticipationHistory } from "../site-data.js";

const row = (overrides = {}) => ({
  claim_id: "claim-1",
  participated_at: "2026-08-30T12:00:00.000Z",
  ...overrides,
});

describe("viewer membership participation history", () => {
  it("reads only successful free code-drop claims for the exact site, viewer, and membership", async () => {
    const calls = [];
    const result = await getViewerParticipationHistory("site-1", "viewer-1", "membership-1", {
      queryImpl: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        return [row()];
      },
    });

    expect(result).toEqual({
      participation: [{
        type: "code_drop_claim",
        title: "Claimed a code drop",
        status: "claimed",
        statusLabel: "Claimed",
        participatedAt: "2026-08-30T12:00:00.000Z",
      }],
      limit: 25,
      truncated: false,
    });
    expect(calls[0].params).toEqual(["site-1", "viewer-1", "membership-1", 26]);
    expect(calls[0].sql).toContain("FROM code_drop_claims cdc");
    expect(calls[0].sql).toContain("JOIN code_drops cd ON cd.id=cdc.code_drop_id AND cd.site_id=$1");
    expect(calls[0].sql).toContain("JOIN viewers v ON v.id=cdc.viewer_id AND v.is_system=false");
    expect(calls[0].sql).toContain("cdc.viewer_id=$2");
    expect(calls[0].sql).toContain("cdc.site_viewer_id=$3");
    expect(calls[0].sql).toContain("ORDER BY cdc.created_at DESC, cdc.id DESC");
    for (const restricted of ["raffle", "prediction", "tournament", "duel", "game", "wager", "quest"]) {
      expect(calls[0].sql.toLowerCase()).not.toContain(restricted);
    }
    expect(JSON.stringify(result)).not.toMatch(/claim-1|site-1|viewer-1|membership-1|code_drop_id/);
  });

  it("keeps distinct successful claims newest-first without inventing attempt records", async () => {
    const result = await getViewerParticipationHistory("site-1", "viewer-1", "membership-1", {
      queryImpl: async () => [
        row({ claim_id: "claim-2", participated_at: "2026-08-30T13:00:00.000Z" }),
        row({ claim_id: "claim-1", participated_at: "2026-08-30T12:00:00.000Z" }),
      ],
    });

    expect(result.participation.map((entry) => entry.participatedAt)).toEqual([
      "2026-08-30T13:00:00.000Z",
      "2026-08-30T12:00:00.000Z",
    ]);
    expect(result.participation).toHaveLength(2);
  });

  it("caps history at 25 and reports truncation", async () => {
    const rows = Array.from({ length: 26 }, (_, index) => row({ claim_id: `claim-${index}` }));
    const result = await getViewerParticipationHistory("site-1", "viewer-1", "membership-1", {
      queryImpl: async () => rows,
    });

    expect(result.participation).toHaveLength(25);
    expect(result.limit).toBe(25);
    expect(result.truncated).toBe(true);
  });
});

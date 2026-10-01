import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  handleExportDropClaimsCsv,
} from "../handlers/exports.js";

function mockEnv() {
  return { DB: {} };
}

const USER = { id: "user-123", email: "streamer@test.com", plan: "pro" };
const SITE = { id: "site-456", user_id: "user-123", slug: "streamer", name: "Streamer Hub" };

describe("Enterprise Exports & Streamer Reports", () => {
  let mockOne;
  let mockQuery;
  let deps;

  beforeEach(() => {
    mockOne = mock();
    mockQuery = mock();

    deps = {
      requireUser: mock().mockResolvedValue({ user: USER, res: null }),
      getByUser: mock().mockResolvedValue(SITE),
      getBoardById: mock().mockResolvedValue(SITE),
      one: mockOne,
      query: mockQuery,
    };
  });

  it("exports flash drop claims report as CSV", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        code: "SUMMER500",
        points_reward: 500,
        username: "lucky_viewer",
        claimed_at: "2026-08-16T15:30:00Z",
      },
    ]);

    const req = new Request("http://localhost/api/export/drop-claims.csv?siteId=site-456");
    const res = await handleExportDropClaimsCsv(req, mockEnv(), deps);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");

    const csvText = await res.text();
    expect(csvText).toContain('"Drop Code","Points Awarded","Viewer Username","Claimed Timestamp"');
    expect(csvText).toContain('"SUMMER500"');
    expect(csvText).toContain('"lucky_viewer"');
    expect(csvText).toContain('"2026-08-16T15:30:00.000Z"');
    const claimsSql = mockQuery.mock.calls[0][0];
    expect(claimsSql).toContain("v.kick_username AS username");
    expect(claimsSql).toContain("cdc.created_at AS claimed_at");
    expect(claimsSql).not.toContain("v.username");
    expect(claimsSql).not.toContain("v.display_name");
    expect(claimsSql).not.toContain("cdc.claimed_at");
  });

});

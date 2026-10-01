import { describe, it, expect, mock, beforeEach } from "bun:test";
import { handleExportData } from "../handlers/security.js";

const USER = {
  id: "user-1",
  email: "owner@example.com",
  display_name: "Owner",
  plan: "pro",
  status: "active",
};

const sites = [
  { id: "site-1", slug: "first", name: "First", published: true },
  { id: "site-2", slug: "second", name: "Second", published: false },
];
const players = [
  { id: "player-1", site_id: "site-1", name: "Alice", amount: "10.00" },
  { id: "player-2", site_id: "site-2", name: "Bob", amount: "20.00" },
];
const archives = [
  { id: "archive-1", site_id: "site-1", label: "First", snapshot_json: [{ name: "Alice", amount: "10.00" }], created_at: "2024-07-02T12:00:00.000Z" },
  { id: "archive-2", site_id: "site-2", label: "Second", snapshot_json: [], created_at: "2024-07-01T12:00:00.000Z" },
];
const archiveRows = [
  {
    id: "archive-1",
    site_id: "site-1",
    label: "First",
    snapshot_json: [{
      name: "Alice",
      amount: "10.00",
      wagered: "10.00",
      hands: 6,
      net_profit: "4.00",
      win_rate: "0.50",
    }],
    created_at: "2024-07-02T12:00:00.000Z",
  },
  { id: "archive-2", site_id: "site-2", label: "Second", snapshot_json: [], created_at: "2024-07-01T12:00:00.000Z" },
];

const mockOne = mock(() => Promise.resolve(USER));
const mockQuery = mock((sql) => {
  const text = String(sql);
  if (text.includes("FROM sites")) return Promise.resolve(sites);
  if (text.includes("FROM players")) return Promise.resolve(players);
  if (text.includes("FROM archives")) return Promise.resolve(archiveRows);
  return Promise.resolve([]);
});
const mockRateLimit = mock(() => Promise.resolve({
  ok: true,
  limit: 2,
  remaining: 1,
  retryAfter: 0,
}));

const request = () => new Request("https://yourrank.site/api/account/export", {
  method: "GET",
  headers: { cookie: "yr_session=token" },
});
const env = () => ({ HYPERDRIVE: { connectionString: "postgresql://mock" } });
const deps = () => ({
  currentUserImpl: async () => USER,
  rateLimitImpl: mockRateLimit,
  oneImpl: mockOne,
  queryImpl: mockQuery,
});

describe("handleExportData", () => {
  beforeEach(() => {
    mockOne.mockClear();
    mockQuery.mockClear();
    mockRateLimit.mockClear();
    mockRateLimit.mockResolvedValue({
      ok: true,
      limit: 2,
      remaining: 1,
      retryAfter: 0,
    });
  });

  it("streams the same compact JSON document shape with multiple boards and empty collections", async () => {
    const originalNow = Date.now;
    Date.now = () => 1720000000000;
    const originalIso = Date.prototype.toISOString;
    Date.prototype.toISOString = () => "2024-07-03T12:00:00.000Z";

    try {
      const res = await handleExportData(request(), env(), deps());
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(res.headers.get("content-disposition")).toBe(
        'attachment; filename="yourrank-export-1720000000000-user-1.json"',
      );

      const actual = await res.text();
      const userSql = mockOne.mock.calls[0][0];
      expect(userSql).toContain("telegram_user_id");
      expect(userSql).toContain("telegram_username");
      expect(userSql).not.toContain("telegram_id");
      const playerSql = mockQuery.mock.calls.find(([sql]) => String(sql).includes("FROM players"))?.[0] || "";
      const playerColumns = playerSql.match(/SELECT\s+([\s\S]+?)\s+FROM\s+players/i)?.[1]
        .split(",")
        .map((column) => column.trim());
      expect(playerColumns).toEqual([
        "id", "site_id", "name", "normalized_name", "amount", "prize",
        "score", "sort", "change", "updated_at", "version",
      ]);
      const expected = JSON.stringify({
        ok: true,
        exportId: "1720000000000-user-1",
        data: {
          exportedAt: "2024-07-03T12:00:00.000Z",
          user: USER,
          sites,
          players,
          archives,
          subscriptions: [],
          payments: [],
          sessions: [],
          offers: [],
          shortLinks: [],
          conversions: [],
          bots: [],
          botCommands: [],
          broadcasts: [],
          botSubscribers: [],
          postbackKeys: [],
          featureOverrides: [],
          onboardingEmails: [],
          referralRewards: [],
          auditLog: [],
          adminAudit: [],
          supportMessages: [],
          siteStatsHourly: [],
          siteReferrers: [],
        },
      });

      expect(actual).toBe(expected);
    } finally {
      Date.now = originalNow;
      Date.prototype.toISOString = originalIso;
    }
  });

  it("fails closed with standard headers when the account export limit is exhausted", async () => {
    mockRateLimit.mockResolvedValueOnce({
      ok: false,
      limit: 2,
      remaining: 0,
      retryAfter: 1800,
    });

    const res = await handleExportData(request(), env(), deps());
    expect(res.status).toBe(429);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("2");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(res.headers.get("Retry-After")).toBe("1800");
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

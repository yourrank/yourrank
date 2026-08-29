import { describe, expect, it } from "bun:test";
import { HISTORY_DAYS } from "@yourrank/shared/plans";
import { ARCHIVE_LIMITS, getArchives, getArchiveSnapshots } from "../site.js";

describe("plan history entitlements", () => {
  it("keeps archive-count safeguards separate from accessible time windows", () => {
    expect(ARCHIVE_LIMITS).toEqual({ free: 6, pro: 12, team: 24 });
    expect(HISTORY_DAYS).toEqual({ free: 30, pro: 365, team: 730 });
  });

  it("filters public archive summaries by the effective plan window", async () => {
    const calls = [];
    const query = async (sql, params) => {
      calls.push({ sql, params });
      return [];
    };

    await getArchives({}, "site-1", ARCHIVE_LIMITS.pro, HISTORY_DAYS.pro, query);

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("created_at >= now() - ($2::int * interval '1 day')");
    expect(calls[0].params).toEqual(["site-1", 365, 12]);
  });

  it("applies the same window to full snapshots without deleting old rows", async () => {
    const calls = [];
    const query = async (sql, params) => {
      calls.push({ sql, params });
      return [];
    };

    await getArchiveSnapshots({}, "site-1", ARCHIVE_LIMITS.team, HISTORY_DAYS.team, query);

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("created_at >= now() - ($2::int * interval '1 day')");
    expect(calls[0].sql).not.toContain("DELETE");
    expect(calls[0].params).toEqual(["site-1", 730, 24]);
  });
});

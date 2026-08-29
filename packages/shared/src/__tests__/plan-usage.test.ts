import { describe, expect, test } from "bun:test";
import {
  creatorExpansionRestriction,
  markSiteViewerActive,
  reconcileAccountActiveViewerUsage,
} from "../plan-usage.js";

const FUTURE = "2099-01-01T00:00:00.000Z";

function usageDependencies({
  plan = "free",
  activeViewers = 0,
  graceStartedAt = null as string | null,
  ownerId = "owner-1",
} = {}) {
  const calls: Array<{ kind: "one" | "exec"; sql: string; params: unknown[] }> = [];
  return {
    calls,
    one: async (sql: string, params: unknown[] = []) => {
      calls.push({ kind: "one", sql, params });
      if (sql.includes("FROM sites WHERE id")) return { user_id: ownerId };
      if (sql.includes("FROM users")) {
        return {
          id: ownerId,
          plan,
          status: "active",
          plan_expires_at: plan === "free" ? null : FUTURE,
          active_viewer_grace_started_at: graceStartedAt,
        };
      }
      if (sql.includes("COUNT(DISTINCT sv.viewer_id)")) return { active_viewers: activeViewers };
      return null;
    },
    exec: async (sql: string, params: unknown[] = []) => {
      calls.push({ kind: "exec", sql, params });
      if (sql.includes("RETURNING active_viewer_grace_started_at")) {
        return [{ active_viewer_grace_started_at: "2026-08-29T12:00:00.000Z" }];
      }
      return [];
    },
  };
}

describe("account-pooled active-viewer usage", () => {
  test("counts distinct authenticated viewer accounts across all owner sites in a rolling 30-day window", async () => {
    const deps = usageDependencies({ activeViewers: 173 });
    const usage = await reconcileAccountActiveViewerUsage("owner-1", deps);
    const countCall = deps.calls.find((call) => call.sql.includes("COUNT(DISTINCT sv.viewer_id)"));

    expect(usage?.activeViewers).toBe(173);
    expect(usage?.rollingDays).toBe(30);
    expect(countCall?.params).toEqual(["owner-1"]);
    expect(countCall?.sql).toContain("s.user_id=$1");
    expect(countCall?.sql).toContain("sv.last_active_at >= now() - interval '30 days'");
    expect(countCall?.sql).toContain("sv.last_active_at <= now()");
    expect(countCall?.sql).toContain("v.is_system=FALSE");
  });

  test("starts grace at 201 and clears it when rolling usage returns to 200", async () => {
    const over = usageDependencies({ activeViewers: 201 });
    const started = await reconcileAccountActiveViewerUsage("owner-1", over);
    expect(started?.level).toBe("grace");
    expect(over.calls.some((call) => call.kind === "exec" && call.sql.includes("COALESCE(active_viewer_grace_started_at, now())"))).toBe(true);

    const recovered = usageDependencies({
      activeViewers: 200,
      graceStartedAt: "2026-07-01T00:00:00.000Z",
    });
    const current = await reconcileAccountActiveViewerUsage("owner-1", recovered);
    expect(current?.expansionRestricted).toBe(false);
    expect(current?.graceStartedAt).toBeNull();
    expect(recovered.calls.some((call) => call.kind === "exec" && call.sql.includes("active_viewer_grace_started_at=NULL"))).toBe(true);
  });

  test("clears Free grace immediately after a confirmed paid entitlement", async () => {
    const deps = usageDependencies({
      plan: "pro",
      activeViewers: 400,
      graceStartedAt: "2026-08-01T00:00:00.000Z",
    });
    const usage = await reconcileAccountActiveViewerUsage("owner-1", deps);
    expect(usage?.plan).toBe("pro");
    expect(usage?.expansionRestricted).toBe(false);
    expect(usage?.graceStartedAt).toBeNull();
  });

  test("marks only an existing authenticated membership and then reconciles its owner account", async () => {
    const deps = usageDependencies({ activeViewers: 1 });
    const usage = await markSiteViewerActive("site-1", "viewer-1", deps);
    const markCall = deps.calls[0];
    expect(markCall.kind).toBe("exec");
    expect(markCall.sql).toContain("UPDATE site_viewers");
    expect(markCall.sql).toContain("WHERE site_id=$1 AND viewer_id=$2");
    expect(markCall.params).toEqual(["site-1", "viewer-1"]);
    expect(usage?.accountId).toBe("owner-1");
  });

  test("reports creator expansion restriction without blocking viewer-side membership activity", async () => {
    const deps = usageDependencies({
      activeViewers: 201,
      graceStartedAt: "2026-01-01T00:00:00.000Z",
    });
    const result = await creatorExpansionRestriction("owner-1", deps);
    expect(result.restricted).toBe(true);
    expect(result.usage?.activeViewers).toBe(201);
  });
});

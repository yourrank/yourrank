import { describe, expect, it } from "bun:test";
import { requireSiteCapability } from "../site-authorization.js";
import { getBoardById, getUserBoardsList } from "../site.js";

const capabilities = [
  ["canRoleManageBoard", ["owner", "moderator"]],
  ["canRoleViewMembers", ["owner", "moderator"]],
  ["canRoleManageMembers", ["owner", "moderator"]],
  ["canRoleManageActivities", ["owner", "moderator"]],
  ["canRoleManageReviews", ["owner", "moderator"]],
  ["canRoleManageClaims", ["owner", "moderator"]],
  ["canRoleViewRewards", ["owner", "moderator"]],
  ["canRoleManageRewards", ["owner", "moderator"]],
  ["canRoleViewInsights", ["owner", "moderator"]],
  ["canRoleManageCredits", ["owner"]],
  ["canRoleAdjustCredits", ["owner"]],
  ["canRoleManageSiteSettings", ["owner"]],
  ["canRoleManageConnections", ["owner"]],
  ["canRoleManageBot", ["owner"]],
  ["canRoleManageTeam", ["owner"]],
  ["canRoleManageBilling", ["owner"]],
  ["canRoleManageAccountSecurity", ["owner"]],
];

describe("site authorization", () => {
  it("allows a direct owner for every capability", async () => {
    for (const [capability] of capabilities) {
      const result = await requireSiteCapability(
        { id: "owner" },
        { id: "site", user_id: "owner" },
        capability,
        { getSiteRole: async () => "moderator" }
      );
      expect(result.res).toBeNull();
      expect(result.role).toBe("owner");
    }
  });

  it("applies the shared role matrix", async () => {
    for (const [capability, allowed] of capabilities) {
      for (const role of ["owner", "manager", "moderator"]) {
        const result = await requireSiteCapability(
          { id: role },
          { id: "site", user_id: "different-owner" },
          capability,
          { getSiteRole: async () => role }
        );
        expect(Boolean(result.res)).toBe(!allowed.includes(role));
        expect(result.role).toBe(role);
      }
    }
  });

  it("fails closed for a forged capability name", async () => {
    const result = await requireSiteCapability(
      { id: "owner" },
      { id: "site", user_id: "owner" },
      "canRoleBecomeOwner",
    );
    expect(result.res.status).toBe(403);
  });
});

describe("delegated site access", () => {
  it("rechecks effective Team access on every selected-site lookup", async () => {
    const calls = [];
    const result = await getBoardById({}, "moderator-1", "site-1", {
      one: async (sql, params) => {
        calls.push({ sql: String(sql), params });
        if (String(sql).includes("user_id=$2")) return null;
        if (String(sql).includes("FROM site_members")) return { role: "moderator" };
        return { id: "site-1", user_id: "owner-1" };
      },
      getSiteRole: async () => null,
    });
    expect(result).toBeNull();
    expect(calls.some(({ sql }) => sql.includes("SELECT role FROM site_members"))).toBe(false);
  });

  it("filters downgraded delegated sites while preserving their membership rows", async () => {
    const boards = await getUserBoardsList({}, "moderator-1", {
      query: async () => [{
        id: "site-1",
        slug: "creator",
        name: "Creator",
        user_role: "moderator",
        owner_plan: "pro",
        owner_plan_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        owner_status: "active",
      }],
    });
    expect(boards).toEqual([]);
  });
});

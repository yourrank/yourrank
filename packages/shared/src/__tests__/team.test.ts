import { describe, it, expect } from "bun:test";
import {
  canRoleManageBoard,
  canRoleManageCredits,
  canRoleManageBot,
  canRoleManageTeam,
  canRoleManageBilling,
  getSiteRole,
  listSiteMembers,
  listSiteInvites,
  createSiteInvite,
  revokeSiteInvite,
  removeSiteMember,
  updateSiteMemberRole,
  getInviteByToken,
  acceptSiteInvite,
} from "../team";

describe("Team & RBAC Capabilities", () => {
  it("enforces board management capabilities", () => {
    expect(canRoleManageBoard("owner")).toBe(true);
    expect(canRoleManageBoard("manager")).toBe(true);
    expect(canRoleManageBoard("moderator")).toBe(true);
    expect(canRoleManageBoard(null)).toBe(false);
    expect(canRoleManageBoard(undefined)).toBe(false);
  });

  it("enforces credits management capabilities", () => {
    expect(canRoleManageCredits("owner")).toBe(true);
    expect(canRoleManageCredits("manager")).toBe(true);
    expect(canRoleManageCredits("moderator")).toBe(true);
    expect(canRoleManageCredits(null)).toBe(false);
  });

  it("enforces bot management capabilities (owner & manager only)", () => {
    expect(canRoleManageBot("owner")).toBe(true);
    expect(canRoleManageBot("manager")).toBe(true);
    expect(canRoleManageBot("moderator")).toBe(false);
    expect(canRoleManageBot(null)).toBe(false);
  });

  it("enforces team and billing management capabilities (owner only)", () => {
    expect(canRoleManageTeam("owner")).toBe(true);
    expect(canRoleManageTeam("manager")).toBe(false);
    expect(canRoleManageTeam("moderator")).toBe(false);

    expect(canRoleManageBilling("owner")).toBe(true);
    expect(canRoleManageBilling("manager")).toBe(false);
    expect(canRoleManageBilling("moderator")).toBe(false);
  });
});

describe("getSiteRole", () => {
  it("returns 'owner' if userId matches site.user_id", async () => {
    const fakeOne = async (sql: string, params?: any[]) => {
      if (sql.includes("FROM sites WHERE id=$1")) {
        return { user_id: "user-123" };
      }
      return null;
    };

    const role = await getSiteRole("site-1", "user-123", { one: fakeOne as any });
    expect(role).toBe("owner");
  });

  it("returns 'moderator' if user is in site_members", async () => {
    const fakeOne = async (sql: string, params?: any[]) => {
      if (sql.includes("FROM sites WHERE id=$1")) {
        return { user_id: "owner-999" };
      }
      if (sql.includes("FROM site_members WHERE site_id=$1 AND user_id=$2")) {
        return { role: "moderator" };
      }
      if (sql.includes("SELECT plan, plan_expires_at, status FROM users")) {
        return { plan: "team", plan_expires_at: new Date(Date.now() + 86400000).toISOString(), status: "active" };
      }
      return null;
    };

    const role = await getSiteRole("site-1", "mod-456", { one: fakeOne as any });
    expect(role).toBe("moderator");
  });

  it("returns null if user has no relationship to the site", async () => {
    const fakeOne = async (sql: string) => {
      if (sql.includes("FROM sites WHERE id=$1")) {
        return { user_id: "owner-999" };
      }
      return null;
    };

    const role = await getSiteRole("site-1", "stranger-000", { one: fakeOne as any });
    expect(role).toBeNull();
  });
});

describe("createSiteInvite & lifecycle", () => {
  it("rejects invalid email or role", async () => {
    const res1 = await createSiteInvite("site-1", "owner-1", "notanemail", "moderator");
    expect(res1.ok).toBe(false);
    expect(res1.code).toBe("invalid_email");

    const res2 = await createSiteInvite("site-1", "owner-1", "mod@example.com", "superadmin" as any);
    expect(res2.ok).toBe(false);
    expect(res2.code).toBe("invalid_role");
  });

  it("rejects non-owner trying to create invite", async () => {
    const fakeOne = async (sql: string) => {
      if (sql.includes("FROM sites WHERE id=$1")) return { user_id: "owner-1" };
      if (sql.includes("FROM site_members")) return { role: "moderator" };
      return null;
    };

    const res = await createSiteInvite("site-1", "mod-2", "newmod@example.com", "moderator", { one: fakeOne as any });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("forbidden");
  });

  it("allows owner to create invite and returns a token", async () => {
    const fakeOne = async (sql: string, params?: any[]) => {
      if (sql.includes("FROM sites WHERE id=$1")) return { user_id: "owner-1" };
      if (sql.includes("FROM sites s JOIN users")) return { user_id: "owner-1", plan: "team", plan_expires_at: new Date(Date.now() + 86400000).toISOString(), status: "active" };
      if (sql.includes("FROM users WHERE lower(email)=$1")) return null;
      if (sql.includes("FROM site_invites WHERE site_id=$1")) return null;
      if (sql.includes("SELECT count(DISTINCT identity)")) return { count: 1 };
      return null;
    };
    const fakeExec = async (sql: string, params?: any[]) => {
      if (sql.includes("INSERT INTO site_invites")) {
        return [{ id: "inv-123", token: params?.[3] }];
      }
      return [];
    };

    const res = await createSiteInvite("site-1", "owner-1", "newmod@example.com", "moderator", {
      one: fakeOne as any,
      exec: fakeExec as any,
    });
    expect(res.ok).toBe(true);
    expect(res.token).toBeDefined();
    expect(res.inviteId).toBe("inv-123");
  });

  it("rotates an existing pending invite instead of creating a duplicate", async () => {
    let updateParams: any[] | undefined;
    const fakeOne = async (sql: string) => {
      if (sql.includes("FROM sites WHERE id=$1")) return { user_id: "owner-1" };
      if (sql.includes("FROM sites s JOIN users")) return { user_id: "owner-1", plan: "team", plan_expires_at: new Date(Date.now() + 86400000).toISOString(), status: "active" };
      if (sql.includes("FROM users WHERE lower(email)=$1")) return null;
      if (sql.includes("FROM site_invites WHERE site_id=$1")) return { id: "inv-existing" };
      return null;
    };
    const fakeExec = async (_sql: string, params?: any[]) => {
      updateParams = params;
      return { count: 1 };
    };

    const res = await createSiteInvite("site-1", "owner-1", "newmod@example.com", "manager", {
      one: fakeOne as any,
      exec: fakeExec as any,
    });
    expect(res.ok).toBe(true);
    expect(res.inviteId).toBe("inv-existing");
    expect(res.token).toBeDefined();
    expect(updateParams?.[0]).toBeDefined();
    expect(updateParams?.[1]).toBe("manager");
    expect(updateParams?.[2]).toBe("inv-existing");
  });

  it("accepts a valid invite token", async () => {
    let insertedMember: any = null;
    let updatedInvite: any = null;

    const fakeOne = async (sql: string) => {
      if (sql.includes("FROM site_invites si")) {
        return {
          id: "inv-123",
          site_id: "site-1",
          email: "newmod@example.com",
          role: "moderator",
          status: "pending",
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          invited_by: "owner-1",
          owner_id: "owner-1",
          plan: "team",
          plan_expires_at: new Date(Date.now() + 86400000).toISOString(),
          owner_status: "active",
        };
      }
      if (sql.includes("FROM users WHERE id=$1")) return { email: " NEWMOD@EXAMPLE.COM " };
      return null;
    };

    const fakeExec = async (sql: string, params?: any[]) => {
      if (sql.includes("INSERT INTO site_members")) {
        insertedMember = params;
      }
      if (sql.includes("UPDATE site_invites SET status='accepted'")) {
        updatedInvite = params;
      }
      if (sql.includes("COUNT(DISTINCT sm.user_id)")) return { count: 1 };
      return null;
    };

    const res = await acceptSiteInvite("tok-abc", "user-mod-1", { one: fakeOne as any, exec: fakeExec as any });
    expect(res.ok).toBe(true);
    expect(res.siteId).toBe("site-1");
    expect(res.role).toBe("moderator");
    expect(insertedMember).toBeDefined();
    expect(insertedMember[0]).toBe("site-1");
    expect(insertedMember[1]).toBe("user-mod-1");
    expect(updatedInvite).toBeDefined();
  });

  it("rejects an invite when the accepting account email does not match", async () => {
    const fakeOne = async (sql: string) => {
      if (sql.includes("FROM site_invites si")) {
        return {
          id: "inv-123",
          site_id: "site-1",
          email: "invited@example.com",
          role: "moderator",
          status: "pending",
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          invited_by: "owner-1",
          owner_id: "owner-1",
          plan: "team",
          plan_expires_at: new Date(Date.now() + 86400000).toISOString(),
          owner_status: "active",
        };
      }
      if (sql.includes("FROM users WHERE id=$1")) return { email: "different@example.com" };
      return null;
    };

    const res = await acceptSiteInvite("tok-abc", "user-mod-1", { one: fakeOne as any });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("email_mismatch");
  });

  it("rejects revoked or expired invites", async () => {
    const fakeOne = async (sql: string) => sql.includes("FROM site_invites si") ? ({
      id: "inv-expired",
      site_id: "site-1",
      email: "mod@example.com",
      role: "moderator",
      status: "pending",
      expires_at: new Date(Date.now() - 10000).toISOString(), // expired
      invited_by: "owner-1",
      owner_id: "owner-1",
      plan: "team",
      plan_expires_at: new Date(Date.now() + 86400000).toISOString(),
      owner_status: "active",
    }) : ({ email: "mod@example.com" });

    const res = await acceptSiteInvite("tok-expired", "user-mod-1", { one: fakeOne as any });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("expired");
  });
});

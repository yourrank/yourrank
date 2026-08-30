import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import {
  canRoleManageBoard,
  canRoleManageCredits,
  canRoleManageBot,
  canRoleViewMembers,
  canRoleManageMembers,
  canRoleManageActivities,
  canRoleManageReviews,
  canRoleManageClaims,
  canRoleViewRewards,
  canRoleManageRewards,
  canRoleAdjustCredits,
  canRoleViewInsights,
  canRoleManageSiteSettings,
  canRoleManageConnections,
  canRoleManageTeam,
  canRoleManageBilling,
  canRoleManageAccountSecurity,
  hasSiteCapability,
  getSiteRole,
  listSiteMembers,
  listSiteInvites,
  getOperatorSeatUsage,
  createSiteInvite,
  revokeSiteInvite,
  removeSiteMember,
  getInviteByToken,
  acceptSiteInvite,
} from "../team";

describe("Team & RBAC Capabilities", () => {
  const capabilities = {
    canRoleManageBoard,
    canRoleManageCredits,
    canRoleManageBot,
    canRoleViewMembers,
    canRoleManageMembers,
    canRoleManageActivities,
    canRoleManageReviews,
    canRoleManageClaims,
    canRoleViewRewards,
    canRoleManageRewards,
    canRoleAdjustCredits,
    canRoleViewInsights,
    canRoleManageSiteSettings,
    canRoleManageConnections,
    canRoleManageTeam,
    canRoleManageBilling,
    canRoleManageAccountSecurity,
  };

  const moderatorAllowed = new Set([
    "canRoleManageBoard",
    "canRoleViewMembers",
    "canRoleManageMembers",
    "canRoleManageActivities",
    "canRoleManageReviews",
    "canRoleManageClaims",
    "canRoleViewRewards",
    "canRoleManageRewards",
    "canRoleViewInsights",
  ]);

  it("defines every final capability explicitly for Owner and Moderator", () => {
    for (const [name, check] of Object.entries(capabilities)) {
      expect({ name, allowed: check("owner") }).toEqual({ name, allowed: true });
      expect({ name, allowed: check("moderator") }).toEqual({ name, allowed: moderatorAllowed.has(name) });
      expect({ name, allowed: check(null) }).toEqual({ name, allowed: false });
      expect({ name, allowed: check(undefined) }).toEqual({ name, allowed: false });
    }
  });

  it("denies dead, unknown, and forged roles and capabilities", () => {
    for (const [name, check] of Object.entries(capabilities)) {
      expect({ name, allowed: check("manager" as any) }).toEqual({ name, allowed: false });
      expect({ name, allowed: check("owner " as any) }).toEqual({ name, allowed: false });
    }
    expect(hasSiteCapability("owner", "notARealCapability" as any)).toBe(false);
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

  it("does not infer access from the same operator's membership on another account", async () => {
    const membershipReads: any[][] = [];
    const role = await getSiteRole("creator-a-site", "shared-operator", {
      one: (async (sql: string, params?: any[]) => {
        if (sql.includes("FROM sites WHERE id=$1")) return { user_id: "creator-a" };
        if (sql.includes("SELECT plan, plan_expires_at, status FROM users")) {
          return { plan: "team", plan_expires_at: new Date(Date.now() + 86_400_000).toISOString(), status: "active" };
        }
        if (sql.includes("FROM site_members")) {
          membershipReads.push(params || []);
          return null;
        }
        return null;
      }) as any,
    });
    expect(role).toBeNull();
    expect(membershipReads).toEqual([["creator-a-site", "shared-operator"]]);
  });

  it("denies dead persisted roles and suspends delegated access off Team without deleting rows", async () => {
    const roleFor = async (memberRole: string, plan: string) => getSiteRole("site-1", "operator-1", {
      one: (async (sql: string) => {
        if (sql.includes("FROM sites WHERE id=$1")) return { user_id: "owner-1" };
        if (sql.includes("SELECT plan, plan_expires_at, status FROM users")) {
          return {
            plan,
            plan_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
            status: "active",
          };
        }
        if (sql.includes("FROM site_members")) return { role: memberRole };
        return null;
      }) as any,
    });

    expect(await roleFor("manager", "team")).toBeNull();
    expect(await roleFor("moderator", "pro")).toBeNull();
    expect(await roleFor("moderator", "team")).toBe("moderator");
  });
});

describe("operator seat usage", () => {
  it("uses the canonical pooled account seat count and entitlement", async () => {
    const usage = await getOperatorSeatUsage("site-1", {
      one: (async (sql: string) => {
        if (sql.includes("FROM sites s JOIN users")) {
          return {
            user_id: "owner-1",
            plan: "team",
            plan_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
            status: "active",
          };
        }
        if (sql.includes("count(DISTINCT identity)")) return { count: 3 };
        return null;
      }) as any,
    });

    expect(usage).toEqual({ plan: "team", used: 3, limit: 5 });
  });
});

describe("Wave H role migration", () => {
  it("preflights, maps Manager deterministically, and constrains delegated roles to Moderator", () => {
    const migration = readFileSync(
      new URL("../../../../supabase/migrations/20260905000000_wave_h_owner_moderator_roles.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain("RAISE EXCEPTION 'Wave H aborted");
    expect(migration).toContain("UPDATE public.site_members SET role = 'moderator'");
    expect(migration).toContain("UPDATE public.site_invites SET role = 'moderator'");
    expect(migration).toContain("CHECK (role = 'moderator')");
    expect(migration).toContain("team_role_migrated");
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
    expect(Buffer.from(res.token!, "base64url")).toHaveLength(24);
    expect(res.inviteId).toBe("inv-123");
  });

  it("denies additional seats on Free and Pro without deleting saved relationships", async () => {
    for (const plan of ["free", "pro"]) {
      const writes: string[] = [];
      const result = await createSiteInvite("site-1", "owner-1", `${plan}@example.com`, "moderator", {
        one: (async (sql: string) => {
          if (sql.includes("FROM sites WHERE id=$1")) return { user_id: "owner-1" };
          if (sql.includes("FROM sites s JOIN users")) {
            return { user_id: "owner-1", plan, plan_expires_at: null, status: "active" };
          }
          return null;
        }) as any,
        exec: (async (sql: string) => { writes.push(sql); return []; }) as any,
      });
      expect(result).toMatchObject({ ok: false, code: "requires_team" });
      expect(writes).toHaveLength(0);
    }
  });

  it("allows the fifth total operator seat, rejects the sixth, and serializes the account seat check", async () => {
    const inviteAtUsage = async (used: number) => {
      const reads: string[] = [];
      const writes: string[] = [];
      const result = await createSiteInvite("site-1", "owner-1", `seat-${used}@example.com`, "moderator", {
        one: (async (sql: string) => {
          reads.push(sql);
          if (sql.includes("FROM sites WHERE id=$1")) return { user_id: "owner-1" };
          if (sql.includes("FROM sites s JOIN users")) {
            return { user_id: "owner-1", plan: "team", plan_expires_at: new Date(Date.now() + 86_400_000).toISOString(), status: "active" };
          }
          if (sql.includes("count(DISTINCT identity)")) return { count: used };
          return null;
        }) as any,
        exec: (async (sql: string) => {
          writes.push(sql);
          if (sql.includes("INSERT INTO site_invites")) return [{ id: `invite-${used}` }];
          return [];
        }) as any,
      });
      return { result, reads, writes };
    };

    const fifth = await inviteAtUsage(4);
    expect(fifth.result).toMatchObject({ ok: true, inviteId: "invite-4" });
    expect(fifth.reads.some((sql) => sql.includes("FOR UPDATE OF u"))).toBe(true);
    const sixth = await inviteAtUsage(5);
    expect(sixth.result).toMatchObject({ ok: false, code: "seat_limit" });
    expect(sixth.writes.some((sql) => sql.includes("INSERT INTO site_invites"))).toBe(false);
  });

  it("rotates an existing pending Moderator invite instead of creating a duplicate", async () => {
    let updateParams: any[] | undefined;
    const fakeOne = async (sql: string) => {
      if (sql.includes("FROM sites WHERE id=$1")) return { user_id: "owner-1" };
      if (sql.includes("FROM sites s JOIN users")) return { user_id: "owner-1", plan: "team", plan_expires_at: new Date(Date.now() + 86400000).toISOString(), status: "active" };
      if (sql.includes("FROM users WHERE lower(email)=$1")) return null;
      if (sql.includes("FROM site_invites WHERE site_id=$1")) return { id: "inv-existing" };
      return null;
    };
    const fakeExec = async (sql: string, params?: any[]) => {
      if (sql.includes("UPDATE site_invites SET token_hash")) updateParams = params;
      return { count: 1 };
    };

    const res = await createSiteInvite("site-1", "owner-1", "newmod@example.com", "moderator", {
      one: fakeOne as any,
      exec: fakeExec as any,
    });
    expect(res.ok).toBe(true);
    expect(res.inviteId).toBe("inv-existing");
    expect(res.token).toBeDefined();
    expect(updateParams?.[0]).toBeDefined();
    expect(updateParams?.[1]).toBe("moderator");
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

  it("records invite creation and acceptance without persisting the raw token", async () => {
    const writes: Array<{ sql: string; params?: any[] }> = [];
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const one = async (sql: string) => {
      if (sql.includes("FROM sites WHERE id=$1")) return { user_id: "owner-1" };
      if (sql.includes("FROM sites s JOIN users")) return { user_id: "owner-1", plan: "team", plan_expires_at: future, status: "active" };
      if (sql.includes("FROM users WHERE lower(email)=$1")) return null;
      if (sql.includes("FROM site_invites WHERE site_id=$1")) return null;
      if (sql.includes("count(DISTINCT identity)")) return { count: 1 };
      return null;
    };
    const exec = async (sql: string, params?: any[]) => {
      writes.push({ sql, params });
      if (sql.includes("INSERT INTO site_invites")) return [{ id: "invite-1" }];
      return [];
    };
    const created = await createSiteInvite("site-1", "owner-1", "mod@example.com", "moderator", { one: one as any, exec: exec as any });
    expect(created.ok).toBe(true);
    expect(writes.some(({ params }) => params?.includes("team_invitation_created"))).toBe(true);
    expect(JSON.stringify(writes)).not.toContain(created.token);

    writes.length = 0;
    const accepted = await acceptSiteInvite(created.token!, "moderator-1", {
      one: (async (sql: string) => {
        if (sql.includes("FROM site_invites si")) return {
          id: "invite-1", site_id: "site-1", email: "mod@example.com", role: "moderator", status: "pending",
          expires_at: future, invited_by: "owner-1", owner_id: "owner-1", plan: "team",
          plan_expires_at: future, owner_status: "active",
        };
        if (sql.includes("FROM users WHERE id=$1")) return { email: "mod@example.com" };
        if (sql.includes("COUNT(DISTINCT sm.user_id)")) return { count: 1 };
        return null;
      }) as any,
      exec: (async (sql: string, params?: any[]) => { writes.push({ sql, params }); return []; }) as any,
    });
    expect(accepted.ok).toBe(true);
    expect(writes.some(({ params }) => params?.includes("team_invitation_accepted"))).toBe(true);
    expect(JSON.stringify(writes)).not.toContain(created.token);
  });

  it("treats a second acceptance as an idempotent replay without another audit write", async () => {
    const writes: string[] = [];
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const result = await acceptSiteInvite("accepted-token", "moderator-1", {
      one: (async (sql: string) => sql.includes("FROM site_invites si") ? ({
        id: "invite-1", site_id: "site-1", email: "mod@example.com", role: "moderator", status: "accepted",
        expires_at: future, invited_by: "owner-1", owner_id: "owner-1", plan: "team",
        plan_expires_at: future, owner_status: "active",
      }) : ({ email: "mod@example.com" })) as any,
      exec: (async (sql: string) => { writes.push(sql); return []; }) as any,
    });
    expect(result).toMatchObject({ ok: true, siteId: "site-1", role: "moderator" });
    expect(writes).toHaveLength(0);
  });

  it("serializes concurrent acceptance on the invite and owner seat row before rejecting a sixth seat", async () => {
    const reads: string[] = [];
    const writes: string[] = [];
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const result = await acceptSiteInvite("seat-race-token", "moderator-6", {
      one: (async (sql: string) => {
        reads.push(sql);
        if (sql.includes("FROM site_invites si")) return {
          id: "invite-6", site_id: "site-1", email: "sixth@example.com", role: "moderator", status: "pending",
          expires_at: future, invited_by: "owner-1", owner_id: "owner-1", plan: "team",
          plan_expires_at: future, owner_status: "active",
        };
        if (sql.includes("SELECT email FROM users")) return { email: "sixth@example.com" };
        if (sql.includes("SELECT sm.id")) return null;
        if (sql.includes("COUNT(DISTINCT sm.user_id)")) return { count: 5 };
        return null;
      }) as any,
      exec: (async (sql: string) => { writes.push(sql); return []; }) as any,
    });
    expect(result).toMatchObject({ ok: false, code: "seat_limit" });
    expect(reads.some((sql) => sql.includes("FOR UPDATE OF si, u"))).toBe(true);
    expect(writes).toHaveLength(0);
  });

  it("revokes only a site-bound invite and records the authenticated owner actor", async () => {
    const writes: Array<{ sql: string; params?: any[] }> = [];
    const result = await revokeSiteInvite("site-a", "invite-b", "owner-a", {
      one: (async (sql: string) => sql.includes("FROM sites WHERE id=$1") ? { user_id: "owner-a" } : null) as any,
      exec: (async (sql: string, params?: any[]) => {
        writes.push({ sql, params });
        if (sql.includes("UPDATE site_invites")) return [];
        return [];
      }) as any,
    });
    expect(result).toMatchObject({ ok: false, code: "not_found" });
    expect(writes[0]?.params).toEqual(["invite-b", "site-a"]);
    expect(writes.some(({ params }) => params?.includes("team_invitation_revoked"))).toBe(false);

    writes.length = 0;
    const revoked = await revokeSiteInvite("site-a", "invite-a", "owner-a", {
      one: (async (sql: string) => sql.includes("FROM sites WHERE id=$1") ? { user_id: "owner-a" } : null) as any,
      exec: (async (sql: string, params?: any[]) => {
        writes.push({ sql, params });
        if (sql.includes("UPDATE site_invites")) return [{ id: "invite-a", role: "moderator" }];
        return [];
      }) as any,
    });
    expect(revoked.ok).toBe(true);
    expect(writes.some(({ params }) => params?.[0] === "owner-a" && params?.includes("team_invitation_revoked"))).toBe(true);
  });

  it("protects the owner, denies Moderator removal of others, and audits an owner removal", async () => {
    const ownerRemoval = await removeSiteMember("site-a", "owner-a", "owner-a", {
      one: (async (sql: string) => sql.includes("FROM sites") ? { user_id: "owner-a" } : null) as any,
      exec: (async () => []) as any,
    });
    expect(ownerRemoval).toMatchObject({ ok: false, code: "owner_protected" });

    const moderatorRemoval = await removeSiteMember("site-a", "operator-b", "moderator-a", {
      one: (async (sql: string) => {
        if (sql.includes("FROM sites WHERE id=$1")) return { user_id: "owner-a" };
        if (sql.includes("SELECT plan, plan_expires_at")) return { plan: "team", plan_expires_at: new Date(Date.now() + 86_400_000).toISOString(), status: "active" };
        if (sql.includes("FROM site_members")) return { role: "moderator" };
        return null;
      }) as any,
    });
    expect(moderatorRemoval).toMatchObject({ ok: false, code: "forbidden" });

    const writes: Array<{ sql: string; params?: any[] }> = [];
    const removed = await removeSiteMember("site-a", "moderator-a", "owner-a", {
      one: (async (sql: string) => sql.includes("FROM sites") ? { user_id: "owner-a" } : null) as any,
      exec: (async (sql: string, params?: any[]) => {
        writes.push({ sql, params });
        if (sql.includes("DELETE FROM site_members")) return [{ id: "member-a", role: "moderator" }];
        return [];
      }) as any,
    });
    expect(removed.ok).toBe(true);
    expect(writes.some(({ params }) => params?.[0] === "owner-a" && params?.includes("team_operator_removed") && JSON.stringify(params).includes("moderator-a"))).toBe(true);
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

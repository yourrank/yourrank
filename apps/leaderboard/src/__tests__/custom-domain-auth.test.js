import { describe, expect, it } from "bun:test";
import { resolveVerifiedCustomDomain, verifyDomainOwnership, verifiedProviderHostname } from "../middleware/custom-domain.js";

describe("verified custom-domain authentication authority", () => {
  it("requires the exact Site-bound TXT record rather than a shared CNAME", async () => {
    const dns = (data) => ({ fetchImpl: async () => Response.json({ Status: 0, Answer: data }) });
    expect(await verifyDomainOwnership("community.example", "proof", dns([
      { name: "community.example.", type: 5, data: "yourrank.site." },
    ]))).toBe(false);
    expect(await verifyDomainOwnership("community.example", "proof", dns([
      { name: "_yourrank.community.example.", type: 16, data: '"yourrank-verification=other"' },
    ]))).toBe(false);
    expect(await verifyDomainOwnership("community.example", "proof", dns([
      { name: "_yourrank.community.example.", type: 16, data: '"yourrank-verification=proof"' },
    ]))).toBe(true);
  });

  it("requires both active hostname and TLS for the exact provider record", () => {
    const record = { id: "record", hostname: "community.example", status: "active", ssl: { status: "active" } };
    expect(verifiedProviderHostname(record, "community.example", "record")).toBe(true);
    expect(verifiedProviderHostname({ ...record, status: "pending" }, "community.example")).toBe(false);
    expect(verifiedProviderHostname(record, "other.example")).toBe(false);
    expect(verifiedProviderHostname(record, "community.example", "other-record")).toBe(false);
  });

  it("requires current active provider and binding evidence", async () => {
    let sqlText = "";
    const binding = await resolveVerifiedCustomDomain({}, "Community.Example.", {
      oneImpl: async (sql, params) => {
        sqlText = sql;
        expect(params).toEqual(["community.example"]);
        return {
          site_id: "site-1",
          slug: "community",
          hostname: "community.example",
          binding_id: "binding-1",
        };
      },
    });

    expect(binding.binding_id).toBe("binding-1");
    expect(sqlText).toContain("s.domain_status='active'");
    expect(sqlText).toContain("s.custom_hostname_id IS NOT NULL");
    expect(sqlText).toContain("s.domain_auth_binding_id IS NOT NULL");
    expect(sqlText).toContain("s.domain_auth_verified_at IS NOT NULL");
  });

  it("fails closed when current verification evidence cannot be read", async () => {
    const binding = await resolveVerifiedCustomDomain({}, "community.example", {
      oneImpl: async () => { throw new Error("database unavailable"); },
    });
    expect(binding).toBeNull();
  });

  it("never treats a platform hostname as custom-domain authority", async () => {
    let queried = false;
    const binding = await resolveVerifiedCustomDomain({}, "yourrank.site", {
      oneImpl: async () => { queried = true; return {}; },
    });
    expect(binding).toBeNull();
    expect(queried).toBe(false);
  });
});

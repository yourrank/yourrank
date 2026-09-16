import { describe, expect, it } from "bun:test";
import {
  destroyViewerSession,
  resolveViewerSession,
  VIEWER_SESSION_ROTATE_AFTER_S,
  VIEWER_SESSION_ROTATE_GRACE_S,
} from "../viewer-session";

const request = (token: string, origin = "https://yourrank.site") => new Request(origin, {
  headers: { cookie: `yr_viewer=${token}` },
});

describe("viewer session rotation grace", () => {
  it("revokes the domain-separated token identity on custom-domain logout", async () => {
    const hashes: string[] = [];
    let params: unknown[] = [];
    await destroyViewerSession({}, "local-token", "community.example", {
      hashTokenImpl: async (value) => {
        hashes.push(value);
        return `hash:${value}`;
      },
      execImpl: async (_sql, values) => {
        params = values;
        return [];
      },
    });

    expect(hashes).toEqual(["local-token", "site:community.example:local-token"]);
    expect(params).toEqual(["hash:local-token", "hash:site:community.example:local-token"]);
  });

  it("resolves a previous token without rotating it again", async () => {
    let phase = "current";
    let rotations = 0;
    const result = await resolveViewerSession(request("old-token"), {}, {
      query: async () => phase === "expired" ? [] : [{
        viewer_id: "viewer-1",
        age: phase === "current" ? VIEWER_SESSION_ROTATE_AFTER_S + 1 : 0,
        is_current: phase === "current",
        authority: "global",
        site_id: null,
        hostname: null,
        domain_binding_id: null,
      }],
      exec: async (sql) => {
        if (sql.includes("SET token =")) {
          rotations += 1;
          phase = "previous";
          return [{ token: "rotated" }];
        }
        return [];
      },
    });

    expect(result.viewerId).toBe("viewer-1");
    expect(result.cookie).not.toBeNull();

    const graceHit = await resolveViewerSession(request("old-token"), {}, {
      query: async () => [{
        viewer_id: "viewer-1",
        age: 0,
        is_current: false,
        authority: "global",
        site_id: null,
        hostname: null,
        domain_binding_id: null,
      }],
      exec: async (sql) => {
        if (sql.includes("SET token =")) rotations += 1;
        return [];
      },
    });

    expect(graceHit.viewerId).toBe("viewer-1");
    expect(graceHit.cookie).toBeNull();
    expect(rotations).toBe(1);
  });

  it("requires global authority on the platform origin", async () => {
    let sqlText = "";
    let sqlParams: unknown[] = [];
    const result = await resolveViewerSession(request("token"), {}, {
      query: async (sql, params) => {
        sqlText = sql;
        sqlParams = params;
        return [];
      },
      exec: async () => [],
    });

    expect(sqlText).toContain("vs.authority = 'global'");
    expect(sqlText).toContain("vs.authority = 'site'");
    expect(sqlText).toContain("s.domain_auth_binding_id = vs.domain_binding_id");
    expect(sqlParams[2]).toBe(true);
    expect(sqlParams[3]).toBe("yourrank.site");
    expect(result.session).toBeNull();
  });

  it("does not grant global authority to a custom-domain bearer", async () => {
    let sqlParams: unknown[] = [];
    const result = await resolveViewerSession(request("local-token", "https://community.example/me"), {}, {
      query: async (_sql, params) => {
        sqlParams = params;
        return [];
      },
      exec: async () => [],
    });

    expect(sqlParams[2]).toBe(false);
    expect(sqlParams[3]).toBe("community.example");
    expect(result.viewerId).toBeNull();
    expect(result.session).toBeNull();
  });

  it("rejects a previous token after the grace window", async () => {
    const result = await resolveViewerSession(request("old-token"), {}, {
      query: async (_sql, params) => {
        expect(params[1]).toBe(VIEWER_SESSION_ROTATE_GRACE_S);
        return [];
      },
      exec: async () => [],
    });

    expect(result.viewerId).toBeNull();
    expect(result.cookie).toBeNull();
  });
});

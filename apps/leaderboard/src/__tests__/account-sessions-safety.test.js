import { describe, expect, it } from "bun:test";
import { handleListSessions, handleRevokeOtherSessions } from "../handlers/security.js";

const request = new Request("https://yourrank.site/api/auth/sessions");
const currentUserImpl = async () => ({ id: "owner-1" });

describe("account session safety", () => {
  it("keeps the current row when the cookie uses a recent rotated token", async () => {
    const actions = [];
    const response = await handleRevokeOtherSessions(request, {}, {
      currentUserImpl,
      currentSessionHashImpl: async () => "previous-hash",
      oneImpl: async (sql, params) => {
        expect(sql).toContain("previous_token=$2");
        expect(params[1]).toBe("previous-hash");
        return { token: "current-hash" };
      },
      execImpl: async (sql, params) => actions.push({ sql, params }),
    });
    expect(response.status).toBe(200);
    expect(actions).toHaveLength(1);
    expect(actions[0].params).toEqual(["owner-1", "current-hash"]);
  });

  it("does not revoke any session when the current one cannot be identified", async () => {
    const actions = [];
    const response = await handleRevokeOtherSessions(request, {}, {
      currentUserImpl,
      currentSessionHashImpl: async () => null,
      execImpl: async (...args) => actions.push(args),
    });
    expect(response.status).toBe(409);
    expect(actions).toHaveLength(0);
  });

  it("marks a recent previous token as the current device", async () => {
    const response = await handleListSessions(request, {}, {
      currentUserImpl,
      currentSessionHashImpl: async () => "previous-hash",
      queryImpl: async () => [{ token: "current-hash", previous_token: "previous-hash", rotated_at: new Date(), created_at: new Date(), expires_at: new Date(Date.now() + 10000) }],
    });
    const body = await response.json();
    expect(body.sessions[0].current).toBe(true);
  });
});

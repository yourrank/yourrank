import { describe, expect, it, mock } from "bun:test";
import { requireSiteOwner } from "../site-authorization.js";
import { handleGetRaffles, handleCreateRaffle } from "../handlers/events.js";
import { handleGetPredictions, handleCreatePrediction } from "../handlers/predictions.js";
import { handleGetTournaments, handleCreateTournament } from "../handlers/tournaments.js";

const OWNER = { id: "owner-1", email: "owner@example.test" };
const MODERATOR = { id: "moderator-1", email: "moderator@example.test" };
const OUTSIDER = { id: "outsider-1", email: "outsider@example.test" };
const SITE = { id: "site-1", user_id: OWNER.id, slug: "creator" };

function request(path, method = "GET", body = undefined) {
  return new Request(`https://example.test${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function authorizationDeps(user, role) {
  const query = mock(async () => []);
  const one = mock(async () => ({ id: "created-1" }));
  const exec = mock(async () => []);
  const withTransaction = mock(async () => {
    throw new Error("restricted mutation must not start");
  });
  const ownerGuard = (actor, site) => requireSiteOwner(actor, site, {
    getSiteRole: async () => role,
  });
  return {
    query,
    one,
    exec,
    withTransaction,
    requireUser: mock(async () => ({ user, res: null })),
    getByUser: mock(async () => SITE),
    getBoardById: mock(async () => SITE),
    requireSiteOwner: ownerGuard,
    requireSiteCapabilityImpl: ownerGuard,
    rateLimit: mock(async () => ({ ok: true })),
    clientIp: () => "203.0.113.1",
    logAudit: mock(async () => null),
  };
}

const restrictedFamilies = [
  {
    name: "raffles",
    get: (deps) => handleGetRaffles(request("/api/events/raffles?siteId=site-1"), {}, deps),
    post: (deps) => handleCreateRaffle(request("/api/events/raffles", "POST", { title: "Private draw" }), {}, deps),
  },
  {
    name: "predictions",
    get: (deps) => handleGetPredictions(request("/api/predictions?siteId=site-1"), {}, deps),
    post: (deps) => handleCreatePrediction(request("/api/predictions", "POST", {
      title: "Restricted prediction",
      options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
    }), {}, deps),
  },
  {
    name: "tournaments",
    get: (deps) => handleGetTournaments(request("/api/tournaments?siteId=site-1"), {}, deps),
    post: (deps) => handleCreateTournament(request("/api/tournaments", "POST", {
      title: "Restricted tournament",
      gameName: "Game",
      bracketSize: 4,
      participants: ["A", "B", "C", "D"],
    }), {}, deps),
  },
];

describe("restricted legacy owner boundary", () => {
  it("recognizes only the real site owner and fails closed for delegated, unrelated, and forged roles", async () => {
    expect((await requireSiteOwner(OWNER, SITE)).res).toBeNull();
    for (const [actor, role] of [
      [MODERATOR, "moderator"],
      [OUTSIDER, null],
      [{ ...OUTSIDER, role: "owner" }, "owner"],
    ]) {
      const result = await requireSiteOwner(actor, SITE, { getSiteRole: async () => role });
      expect(result.res?.status).toBe(403);
    }
  });

  for (const family of restrictedFamilies) {
    it(`${family.name}: owner retains GET access`, async () => {
      const deps = authorizationDeps(OWNER, "owner");
      const response = await family.get(deps);
      expect(response.status).toBe(200);
    });

    it(`${family.name}: Moderator direct GET and POST fail before restricted data access or mutation`, async () => {
      for (const invoke of [family.get, family.post]) {
        const deps = authorizationDeps(MODERATOR, "moderator");
        const response = await invoke(deps);
        expect(response.status).toBe(403);
        expect(deps.query).not.toHaveBeenCalled();
        expect(deps.one).not.toHaveBeenCalled();
        expect(deps.exec).not.toHaveBeenCalled();
        expect(deps.withTransaction).not.toHaveBeenCalled();
      }
    });

    it(`${family.name}: unrelated creator and forged client role fail closed`, async () => {
      for (const [actor, persistedRole] of [
        [OUTSIDER, null],
        [{ ...OUTSIDER, role: "owner" }, "owner"],
      ]) {
        const deps = authorizationDeps(actor, persistedRole);
        const response = await family.post(deps);
        expect(response.status).toBe(403);
        expect(deps.one).not.toHaveBeenCalled();
        expect(deps.withTransaction).not.toHaveBeenCalled();
      }
    });

    it(`${family.name}: viewer authentication cannot enter creator handlers`, async () => {
      const deps = authorizationDeps({ id: "viewer-1" }, null);
      deps.requireUser = mock(async () => ({
        user: null,
        res: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
      }));
      const response = await family.post(deps);
      expect(response.status).toBe(401);
      expect(deps.getByUser).not.toHaveBeenCalled();
      expect(deps.one).not.toHaveBeenCalled();
    });
  }
});

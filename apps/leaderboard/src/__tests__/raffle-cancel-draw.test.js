import { describe, expect, it } from "bun:test";
import { handleCancelRaffle, handleDrawRaffle } from "../handlers/events.js";

const USER = { id: "owner-1" };
const RAFFLE_ID = "raffle-1";

function makeCancelHarness(options = {}) {
  const state = {
    raffle: {
      id: RAFFLE_ID,
      site_id: "site-1",
      title: "Prize",
      status: options.status ?? "active",
    },
    memberships: new Map([
      ["viewer-a", { balance: 100, total_spent: 40 }],
      ["viewer-b", { balance: 25, total_spent: 100 }],
    ]),
    purchases: [
      { id: "purchase-a1", site_viewer_id: "viewer-a", cost: 30, refunded_at: null },
      { id: "purchase-a2", site_viewer_id: "viewer-a", cost: 20, refunded_at: null },
      { id: "purchase-b1", site_viewer_id: "viewer-b", cost: 50, refunded_at: null },
      { id: "purchase-free", site_viewer_id: "viewer-a", cost: 0, refunded_at: null },
    ],
    ledger: [],
    audit: [],
    queries: [],
  };
  const tx = {
    async one(statement, params = []) {
      state.queries.push(statement);
      const sql = statement.replace(/\s+/g, " ").toLowerCase();
      if (sql.startsWith("select r.id, r.site_id, r.title, r.status")) {
        return options.otherSite || params[1] !== USER.id ? null : state.raffle;
      }
      if (sql.startsWith("update site_viewers")) {
        const [cost, viewerId] = params;
        const membership = state.memberships.get(viewerId);
        if (!membership) return null;
        membership.balance += Number(cost);
        membership.total_spent = Math.max(membership.total_spent - Number(cost), 0);
        return { id: viewerId };
      }
      if (sql.startsWith("update raffles")) {
        if (state.raffle.status !== "active") return null;
        state.raffle.status = "cancelled";
        return { id: RAFFLE_ID };
      }
      throw new Error(`Unexpected tx.one SQL: ${statement}`);
    },
    async unsafe(statement, params = []) {
      state.queries.push(statement);
      const sql = statement.replace(/\s+/g, " ").toLowerCase();
      if (sql.startsWith("select id, site_viewer_id, cost from raffle_ticket_purchases")) {
        return state.purchases.filter((purchase) =>
          purchase.refunded_at === null && purchase.cost > 0);
      }
      if (sql.startsWith("insert into credit_ledger")) {
        state.ledger.push({
          site_viewer_id: params[0],
          type: "revoke",
          amount: params[1],
          description: params[2],
          metadata: params[3],
        });
        return [];
      }
      if (sql.startsWith("update raffle_ticket_purchases")) {
        for (const purchase of state.purchases) {
          if (purchase.refunded_at === null) purchase.refunded_at = "refunded";
        }
        return [];
      }
      throw new Error(`Unexpected tx.unsafe SQL: ${statement}`);
    },
  };
  const deps = {
    requireUser: async () => ({ user: USER, res: null }),
    withTransaction: async (callback) => callback(tx),
    logAudit: async (entry) => { state.audit.push(entry); },
  };
  return { state, deps };
}

function raffleRequest(path, raffleId = RAFFLE_ID) {
  return new Request(`https://yourrank.site${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ raffleId }),
  });
}

describe("handleCancelRaffle", () => {
  it("refunds paid purchases, records revokes and cancels the raffle", async () => {
    const harness = makeCancelHarness();
    const response = await handleCancelRaffle(raffleRequest("/api/events/raffles/cancel"), {}, harness.deps);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      refundedViewers: 2,
      refundedCredits: 100,
      message: "Raffle cancelled. Refunded 100 Credits to 2 viewers.",
    });
    expect(harness.state.memberships.get("viewer-a")).toEqual({ balance: 150, total_spent: 0 });
    expect(harness.state.memberships.get("viewer-b")).toEqual({ balance: 75, total_spent: 50 });
    expect(harness.state.ledger).toEqual([
      {
        site_viewer_id: "viewer-a",
        type: "revoke",
        amount: 30,
        description: "Raffle cancelled refund: Prize",
        metadata: { raffle_id: RAFFLE_ID, purchase_id: "purchase-a1" },
      },
      {
        site_viewer_id: "viewer-a",
        type: "revoke",
        amount: 20,
        description: "Raffle cancelled refund: Prize",
        metadata: { raffle_id: RAFFLE_ID, purchase_id: "purchase-a2" },
      },
      {
        site_viewer_id: "viewer-b",
        type: "revoke",
        amount: 50,
        description: "Raffle cancelled refund: Prize",
        metadata: { raffle_id: RAFFLE_ID, purchase_id: "purchase-b1" },
      },
    ]);
    expect(harness.state.purchases.every((purchase) => purchase.refunded_at === "refunded")).toBe(true);
    expect(harness.state.raffle.status).toBe("cancelled");
    expect(harness.state.queries[0]).toContain("FOR UPDATE OF r");
    expect(harness.state.audit[0]).toMatchObject({
      action: "raffle_cancel",
      entityType: "raffle",
      entityId: RAFFLE_ID,
      details: { refundedViewers: 2, refundedCredits: 100 },
    });
  });

  it("rejects raffles that are no longer active", async () => {
    const harness = makeCancelHarness({ status: "drawn" });
    const response = await handleCancelRaffle(raffleRequest("/api/events/raffles/cancel"), {}, harness.deps);
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toBe("This raffle has already been drawn or closed.");
    expect(harness.state.ledger).toHaveLength(0);
    expect(harness.state.audit).toHaveLength(0);
  });

  it("returns not found for a raffle outside the owner's site", async () => {
    const harness = makeCancelHarness({ otherSite: true });
    const response = await handleCancelRaffle(raffleRequest("/api/events/raffles/cancel"), {}, harness.deps);
    const body = await response.json();
    expect(response.status).toBe(404);
    expect(body.error).toBe("Raffle not found or you do not have permission.");
    expect(harness.state.ledger).toHaveLength(0);
  });
});

describe("handleDrawRaffle transaction guards", () => {
  it("locks the raffle and updates only while the status remains active", async () => {
    const calls = [];
    const ticket = {
      id: "ticket-1",
      ticket_number: 7,
      viewer_id: "viewer-1",
      site_viewer_id: "membership-1",
      viewer_name: "Winner",
    };
    const tx = {
      async one(statement) {
        calls.push(statement);
        if (statement.includes("SELECT r.id")) {
          return { id: RAFFLE_ID, site_id: "site-1", title: "Prize", status: "active", total_tickets: 1 };
        }
        if (statement.includes("UPDATE raffles")) return { id: RAFFLE_ID };
        throw new Error(`Unexpected tx.one SQL: ${statement}`);
      },
      async unsafe(statement) {
        calls.push(statement);
        return [ticket];
      },
    };
    const audit = [];
    const request = raffleRequest("/api/events/raffles/draw");
    const response = await handleDrawRaffle(request, {}, {
      requireUser: async () => ({ user: USER, res: null }),
      withTransaction: async (callback) => callback(tx),
      getCryptoRandomInt: () => 0,
      logAudit: async (entry) => audit.push(entry),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, winnerName: "Winner", winnerTicketNumber: 7 });
    expect(calls[0]).toContain("FOR UPDATE OF r");
    expect(calls[1]).toContain("FROM raffle_tickets");
    expect(calls[2]).toContain("WHERE id=$4 AND status='active'");
    expect(audit).toHaveLength(1);
  });
});

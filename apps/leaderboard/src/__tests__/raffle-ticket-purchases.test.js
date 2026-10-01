import { describe, expect, it } from "bun:test";
import { handlerSchemas } from "@yourrank/shared/validation";
import { handleViewerBuyRaffleTickets } from "../handlers/viewer-dashboard.js";

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const VIEWER_ID = "22222222-2222-4222-8222-222222222222";
const MEMBER_ID = "33333333-3333-4333-8333-333333333333";
const RAFFLE_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_RAFFLE_ID = "55555555-5555-4555-8555-555555555555";

function makeHarness(options = {}) {
  const state = {
    site: { id: SITE_ID, suspended: false },
    viewer: { id: VIEWER_ID },
    member: options.member === false
      ? null
      : { id: MEMBER_ID, balance: options.balance ?? 500, total_spent: options.totalSpent ?? 0, blocked: !!options.blocked },
    raffles: new Map([
      [RAFFLE_ID, {
        id: RAFFLE_ID,
        site_id: SITE_ID,
        title: "Prize",
        ticket_cost: options.ticketCost ?? 25,
        max_tickets_per_viewer: options.maxTickets ?? 10,
        total_tickets: options.totalTickets ?? 0,
        ended: !!options.ended,
        status: options.status ?? "active",
      }],
      [OTHER_RAFFLE_ID, {
        id: OTHER_RAFFLE_ID,
        site_id: SITE_ID,
        title: "Other prize",
        ticket_cost: 10,
        max_tickets_per_viewer: 10,
        total_tickets: 0,
        ended: false,
        status: "active",
      }],
    ]),
    tickets: Array.from({ length: Array.isArray(options.owned) ? options.owned.length : Number(options.owned) || 0 }, (_, i) => ({
      raffle_id: RAFFLE_ID,
      site_viewer_id: MEMBER_ID,
      viewer_id: VIEWER_ID,
      ticket_number: i + 1,
      purchase_id: "prior-purchase",
    })),
    purchases: [],
    ledger: [],
    activeMarks: [],
    lockOrder: [],
  };
  let nextPurchaseId = 1;

  function lookupPurchase(token) {
    const purchase = state.purchases.find((row) =>
      row.site_viewer_id === MEMBER_ID && row.client_token === token);
    if (!purchase) return null;
    const raffle = state.raffles.get(purchase.raffle_id);
    return {
      id: purchase.id,
      raffle_id: purchase.raffle_id,
      quantity: purchase.quantity,
      balance: state.member?.balance ?? 0,
      total_tickets: raffle?.total_tickets ?? 0,
      my_tickets: state.tickets.filter((ticket) =>
        ticket.raffle_id === purchase.raffle_id && ticket.site_viewer_id === MEMBER_ID).length,
    };
  }

  const tx = {
    async one(statement, params = []) {
      const sql = statement.replace(/\s+/g, " ").toLowerCase();
      if (sql.includes("from raffle_ticket_purchases p")) return lookupPurchase(params[2]);
      if (sql.startsWith("select id, title, ticket_cost")) {
        state.lockOrder.push("raffle");
        const raffle = state.raffles.get(params[0]);
        return raffle?.site_id === params[1] ? raffle : null;
      }
      if (sql.includes("from site_viewers") && sql.includes("for update")) {
        state.lockOrder.push("member");
        return state.member;
      }
      if (sql.startsWith("select count(*)::int as count from raffle_tickets")) {
        return {
          count: state.tickets.filter((ticket) =>
            ticket.raffle_id === params[0] && ticket.site_viewer_id === params[1]).length,
        };
      }
      if (sql.startsWith("update site_viewers")) {
        const [cost, memberId] = params;
        if (!state.member || state.member.id !== memberId || state.member.balance < cost) return null;
        state.member.balance -= cost;
        state.member.total_spent += cost;
        return { balance: state.member.balance };
      }
      if (sql.startsWith("insert into raffle_ticket_purchases")) {
        const [raffleId, siteViewerId, quantity, cost, clientToken] = params;
        if (state.purchases.some((row) =>
          row.site_viewer_id === siteViewerId && row.client_token === clientToken)) {
          throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
        }
        const purchase = {
          id: `purchase-${nextPurchaseId++}`,
          raffle_id: raffleId,
          site_viewer_id: siteViewerId,
          quantity,
          cost,
          client_token: clientToken,
        };
        state.purchases.push(purchase);
        return { id: purchase.id };
      }
      if (sql.startsWith("update raffles")) {
        const [quantity, raffleId, siteId] = params;
        const raffle = state.raffles.get(raffleId);
        if (!raffle || raffle.site_id !== siteId || raffle.status !== "active") return null;
        raffle.total_tickets += quantity;
        return { total_tickets: raffle.total_tickets };
      }
      throw new Error(`Unexpected tx.one SQL: ${statement}`);
    },
    async unsafe(statement, params = []) {
      const sql = statement.replace(/\s+/g, " ").toLowerCase();
      if (sql.startsWith("insert into raffle_tickets")) {
        const [raffleId, siteViewerId, viewerId, ticketOffset, purchaseId, quantity] = params;
        for (let i = 1; i <= quantity; i++) {
          state.tickets.push({
            raffle_id: raffleId,
            site_viewer_id: siteViewerId,
            viewer_id: viewerId,
            ticket_number: ticketOffset + i,
            purchase_id: purchaseId,
          });
        }
        return [];
      }
      if (sql.startsWith("insert into credit_ledger")) {
        state.ledger.push({
          site_viewer_id: params[0],
          type: "spend",
          amount: params[1],
          description: params[2],
          metadata: params[3],
        });
        return [];
      }
      throw new Error(`Unexpected tx.unsafe SQL: ${statement}`);
    },
  };

  const deps = {
    requireViewer: async () => ({ viewer: state.viewer, res: null }),
    getPublicSite: async () => state.site,
    rateLimit: async (_env, key, limit, window) => {
      state.rateLimit = { key, limit, window };
      return { ok: true };
    },
    withTransaction: async (callback) => callback(tx),
    one: async (statement, params = []) => {
      if (statement.includes("FROM raffle_ticket_purchases p")) return lookupPurchase(params[2]);
      throw new Error(`Unexpected one SQL: ${statement}`);
    },
    markActive: async (...args) => { state.activeMarks.push(args); },
  };

  return { state, deps };
}

async function buy(harness, raffleId = RAFFLE_ID, quantity = 2, idempotencyKey = "purchase-key") {
  const request = new Request("https://community.test/api/viewer/raffles/buy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug: "community", raffleId, quantity, idempotencyKey }),
  });
  const response = await handleViewerBuyRaffleTickets(request, {}, harness.deps);
  return { response, body: await response.json() };
}

describe("handleViewerBuyRaffleTickets", () => {
  it("validates a strict body with a bounded integer quantity", () => {
    const schema = handlerSchemas.handleViewerBuyRaffleTickets;
    const valid = { slug: "community", raffleId: RAFFLE_ID, quantity: 100, idempotencyKey: "client-key" };
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ ...valid, quantity: 1.5 }).success).toBe(false);
    expect(schema.safeParse({ ...valid, quantity: 101 }).success).toBe(false);
    expect(schema.safeParse({ ...valid, extra: true }).success).toBe(false);
  });

  it("charges the total, numbers tickets, links the purchase and writes spend ledger", async () => {
    const harness = makeHarness();
    const { response, body } = await buy(harness, RAFFLE_ID, 3);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      purchaseId: "purchase-1",
      quantity: 3,
      balance: 425,
      myTickets: 3,
      totalTickets: 3,
    });
    expect(harness.state.member).toMatchObject({ balance: 425, total_spent: 75 });
    expect(harness.state.tickets.map((ticket) => ticket.ticket_number)).toEqual([1, 2, 3]);
    expect(harness.state.tickets.every((ticket) => ticket.purchase_id === "purchase-1")).toBe(true);
    expect(harness.state.ledger).toEqual([{
      site_viewer_id: MEMBER_ID,
      type: "spend",
      amount: 75,
      description: "Raffle tickets: Prize",
      metadata: { raffle_id: RAFFLE_ID, purchase_id: "purchase-1", quantity: 3 },
    }]);
    expect(harness.state.raffles.get(RAFFLE_ID).total_tickets).toBe(3);
    expect(harness.state.lockOrder).toEqual(["raffle", "member"]);
    expect(harness.state.activeMarks).toEqual([[SITE_ID, VIEWER_ID]]);
    expect(harness.state.rateLimit).toEqual({ key: `viewer-raffle:${SITE_ID}:${VIEWER_ID}`, limit: 10, window: 60 });
  });

  it("enforces the per-viewer maximum with the remaining amount", async () => {
    const harness = makeHarness({ maxTickets: 3, owned: [true, true] });
    const { response, body } = await buy(harness, RAFFLE_ID, 2);
    expect(response.status).toBe(400);
    expect(body.error).toBe("You can buy 1 more tickets.");
    expect(harness.state.member.balance).toBe(500);
  });

  it("reports the exhausted ticket maximum", async () => {
    const harness = makeHarness({ maxTickets: 2, owned: [true, true] });
    const { response, body } = await buy(harness);
    expect(response.status).toBe(400);
    expect(body.error).toBe("You already have the maximum tickets.");
  });

  it("rejects a charge the viewer cannot afford", async () => {
    const harness = makeHarness({ balance: 40 });
    const { response, body } = await buy(harness, RAFFLE_ID, 2);
    expect(response.status).toBe(400);
    expect(body.error).toBe("insufficient balance");
    expect(harness.state.member).toMatchObject({ balance: 40, total_spent: 0 });
    expect(harness.state.tickets).toHaveLength(0);
    expect(harness.state.ledger).toHaveLength(0);
  });

  it("rejects closed and ended raffles", async () => {
    const closed = makeHarness({ status: "drawn" });
    const closedResult = await buy(closed);
    expect(closedResult.response.status).toBe(400);
    expect(closedResult.body.error).toBe("This raffle is closed.");

    const ended = makeHarness({ ended: true });
    const endedResult = await buy(ended);
    expect(endedResult.response.status).toBe(400);
    expect(endedResult.body.error).toBe("This raffle has ended.");
  });

  it("requires existing community membership and rejects blocked membership", async () => {
    const nonMember = makeHarness({ member: false });
    const nonMemberResult = await buy(nonMember);
    expect(nonMemberResult.response.status).toBe(400);
    expect(nonMemberResult.body.error).toBe("Join this community first.");

    const blocked = makeHarness({ blocked: true });
    const blockedResult = await buy(blocked);
    expect(blockedResult.response.status).toBe(400);
    expect(blockedResult.body.error).toBe("viewer blocked");
  });

  it("allows free tickets without debiting or writing a ledger row", async () => {
    const harness = makeHarness({ ticketCost: 0 });
    const { response, body } = await buy(harness, RAFFLE_ID, 2, "free-key");
    expect(response.status).toBe(200);
    expect(body.balance).toBe(500);
    expect(harness.state.member).toMatchObject({ balance: 500, total_spent: 0 });
    expect(harness.state.purchases[0].cost).toBe(0);
    expect(harness.state.ledger).toHaveLength(0);
  });

  it("returns the original purchase on an idempotent retry without charging again", async () => {
    const harness = makeHarness();
    const first = await buy(harness, RAFFLE_ID, 2, "same-key");
    const retry = await buy(harness, RAFFLE_ID, 2, "same-key");
    expect(first.response.status).toBe(200);
    expect(retry.response.status).toBe(200);
    expect(retry.body).toMatchObject({
      purchaseId: first.body.purchaseId,
      balance: 450,
      myTickets: 2,
      totalTickets: 2,
    });
    expect(harness.state.purchases).toHaveLength(1);
    expect(harness.state.member).toMatchObject({ balance: 450, total_spent: 50 });
    expect(harness.state.tickets).toHaveLength(2);
    expect(harness.state.activeMarks).toHaveLength(1);
  });

  it("rejects reusing a key on a different raffle", async () => {
    const harness = makeHarness();
    const first = await buy(harness, RAFFLE_ID, 1, "reused-key");
    expect(first.response.status).toBe(200);

    const second = await buy(harness, OTHER_RAFFLE_ID, 1, "reused-key");
    expect(second.response.status).toBe(409);
    expect(second.body.error).toBe("idempotency key already used for a different raffle");
    expect(harness.state.member).toMatchObject({ balance: 475, total_spent: 25 });
    expect(harness.state.purchases).toHaveLength(1);
  });
});

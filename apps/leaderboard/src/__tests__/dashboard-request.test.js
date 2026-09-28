import { describe, expect, it } from "bun:test";
import {
  fetchDashboardJson,
  isTransientDashboardError,
  loginRedirectPath,
  retryTransient,
} from "../assets/dashboard/request.js";

const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

describe("dashboard startup requests", () => {
  it("returns a successful JSON response", async () => {
    const result = await fetchDashboardJson("/api/auth/me", {}, {
      fetchFn: async () => response({ ok: true, user: { id: "user-1" } }),
    });
    expect(result.body.user.id).toBe("user-1");
  });

  it("classifies a forbidden response as FORBIDDEN, not AUTH", async () => {
    await expect(fetchDashboardJson("/api/site", {}, {
      fetchFn: async () => response({ ok: false, error: "Your account role is not permitted to perform this action." }, 403),
    })).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("classifies an unauthenticated response and preserves the destination", async () => {
    await expect(fetchDashboardJson("/api/auth/me", {}, {
      fetchFn: async () => response({ ok: false, error: "unauthorized" }, 401),
    })).rejects.toMatchObject({ code: "AUTH", status: 401 });
    await expect(fetchDashboardJson("/api/auth/me", {}, {
      fetchFn: async () => response({ ok: false, code: "UNAUTHORIZED" }),
    })).rejects.toMatchObject({ code: "AUTH", status: 200 });
    expect(loginRedirectPath({ pathname: "/dashboard/settings", search: "?tab=plan" }))
      .toBe("/login?next=%2Fdashboard%2Fsettings%3Ftab%3Dplan");
  });

  it("does not treat ordinary expired copy as an authentication error", async () => {
    await expect(fetchDashboardJson("/api/site", {}, {
      fetchFn: async () => response({
        ok: false,
        error: "This trial has expired; login to view upgrade options.",
      }),
    })).rejects.toMatchObject({ code: "REQUEST_FAILED", status: 200 });
  });

  it("keeps server failures retryable instead of treating them as auth", async () => {
    await expect(fetchDashboardJson("/api/site", {}, {
      fetchFn: async () => response({ ok: false, error: "Database unavailable" }, 500),
    })).rejects.toMatchObject({ code: "SERVER", status: 500 });
  });

  it("preserves a 404 status for admin routing decisions", async () => {
    await expect(fetchDashboardJson("/api/site", {}, {
      fetchFn: async () => response({ ok: false, error: "No board found." }, 404),
    })).rejects.toMatchObject({ code: "REQUEST_FAILED", status: 404 });
  });

  it("classifies a network failure without redirect semantics", async () => {
    await expect(fetchDashboardJson("/api/site", {}, {
      fetchFn: async () => { throw new Error("Network connection lost"); },
    })).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("bounds a hanging request and aborts its signal", async () => {
    let aborted = false;
    await expect(fetchDashboardJson("/api/site", {}, {
      timeoutMs: 5,
      fetchFn: (_input, { signal }) => new Promise((_, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
      }),
    })).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(aborted).toBe(true);
  });

  it("can be called again after a failed attempt", async () => {
    let attempts = 0;
    const fetchFn = async () => {
      attempts++;
      if (attempts === 1) throw new Error("Temporary network failure");
      return response({ ok: true, user: { id: "user-2" } });
    };

    await expect(fetchDashboardJson("/api/auth/me", {}, { fetchFn })).rejects.toMatchObject({ code: "NETWORK" });
    const retry = await fetchDashboardJson("/api/auth/me", {}, { fetchFn });
    expect(retry.body.user.id).toBe("user-2");
    expect(attempts).toBe(2);
  });

  it("retries transient failures and resolves when an attempt succeeds", async () => {
    let calls = 0;
    const waits = [];
    const result = await retryTransient(async () => {
      calls++;
      if (calls === 1) throw { code: "NETWORK" };
      return "ready";
    }, {
      delays: [15],
      sleep: async (ms) => waits.push(ms),
    });

    expect(result).toBe("ready");
    expect(calls).toBe(2);
    expect(waits).toEqual([15]);
  });

  it("rethrows the last error after three retries", async () => {
    let calls = 0;
    const waits = [];
    const lastError = { code: "SERVER" };
    await expect(retryTransient(async () => {
      calls++;
      throw calls === 4 ? lastError : { code: "SERVER" };
    }, {
      delays: [1, 2, 3],
      sleep: async (ms) => waits.push(ms),
    })).rejects.toBe(lastError);

    expect(calls).toBe(4);
    expect(waits).toEqual([1, 2, 3]);
  });

  it("does not retry forbidden or authentication errors", async () => {
    for (const error of [{ code: "FORBIDDEN", status: 403 }, { code: "AUTH", status: 401 }]) {
      let calls = 0;
      await expect(retryTransient(async () => {
        calls++;
        throw error;
      }, { sleep: async () => {} })).rejects.toBe(error);
      expect(calls).toBe(1);
    }
  });

  it("stops after the continuation guard turns false", async () => {
    let calls = 0;
    let checks = 0;
    const error = { code: "NETWORK" };
    await expect(retryTransient(async () => {
      calls++;
      throw error;
    }, {
      delays: [1, 2],
      shouldContinue: () => ++checks === 1,
      sleep: async () => {},
    })).rejects.toBe(error);

    expect(calls).toBe(1);
    expect(checks).toBe(2);
  });

  it("classifies transient statuses but excludes auth and entitlement denials", () => {
    expect(isTransientDashboardError({ code: "INVALID_RESPONSE" })).toBe(true);
    expect(isTransientDashboardError({ status: 404 })).toBe(true);
    expect(isTransientDashboardError({ status: 409 })).toBe(true);
    expect(isTransientDashboardError({ status: 429 })).toBe(true);
    expect(isTransientDashboardError({ code: "AUTH", status: 429 })).toBe(false);
    expect(isTransientDashboardError({ code: "entitlement_required", status: 403 })).toBe(false);
  });
});

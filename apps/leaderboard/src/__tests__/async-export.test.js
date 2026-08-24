import { describe, expect, it } from "bun:test";
import { handleCreateExportJob, handleExportJobDownload, handleExportJobStatus } from "../handlers/security.js";
import { attachRouteContext } from "../middleware/handler.js";

const USER = { id: "user-1" };
const request = (method = "POST") => new Request("https://yourrank.site/api/account/export", { method });
const env = { ACCOUNT_EXPORTS: { get: async () => ({ body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("artifact")); c.close(); } }) }) } };

function deps(overrides = {}) {
  const state = { jobs: [], execs: [], sent: [] };
  return {
    state,
    currentUserImpl: async () => USER,
    rateLimitImpl: async () => ({ ok: true, limit: 2, remaining: 1, reset: 123 }),
    oneImpl: async () => state.jobs.find((job) => job.status === "pending") || null,
    execImpl: async (_sql, params) => {
      state.execs.push(params);
      if (params?.length === 3 && params[1] === USER.id) state.jobs.push({ id: params[0], status: "pending" });
      return [];
    },
    sendImpl: async (event) => state.sent.push(event),
    logAuditImpl: async () => {},
    ...overrides,
  };
}

describe("async account export", () => {
  it("creates a cheap pending job and enqueues without reading tenant data", async () => {
    const d = deps();
    const res = await handleCreateExportJob(request(), env, d);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("pending");
    expect(d.state.sent[0].type).toBe("account-export");
    expect(d.state.execs).toHaveLength(1);
  });

  it("fails immediately when the R2 binding is unavailable without creating a job", async () => {
    const d = deps();
    const res = await handleCreateExportJob(request(), {}, d);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("temporarily unavailable");
    expect(d.state.execs).toHaveLength(0);
    expect(d.state.sent).toHaveLength(0);
  });

  it("reuses an existing pending request", async () => {
    const d = deps();
    d.oneImpl = async () => ({ id: "existing", status: "pending", created_at: "now", expires_at: "later" });
    const res = await handleCreateExportJob(request(), env, d);
    expect((await res.json()).exportId).toBe("existing");
    expect(d.state.sent).toHaveLength(0);
  });

  it("rate limits creation", async () => {
    const d = deps({ rateLimitImpl: async () => ({ ok: false, limit: 2, remaining: 0, reset: 123 }) });
    const res = await handleCreateExportJob(request(), env, d);
    expect(res.status).toBe(429);
  });

  it("only reports a completed artifact through an owner-scoped job", async () => {
    const d = deps({ oneImpl: async () => ({ id: "job-1", status: "completed", artifact_key: "key", expires_at: new Date(Date.now() + 10000).toISOString() }) });
    const res = await handleExportJobDownload(attachRouteContext(new Request("https://yourrank.site/api/account/export/job-1/download", { method: "GET" }), { slug: "job-1" }), env, d);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("artifact");
    const otherOwner = deps({
      currentUserImpl: async () => ({ id: "other-user" }),
      oneImpl: async () => null,
    });
    expect((await handleExportJobDownload(attachRouteContext(new Request("https://yourrank.site/api/account/export/job-1/download", { method: "GET" }), { slug: "job-1" }), env, otherOwner)).status).toBe(404);
  });

  it("refuses expired jobs and surfaces failed status", async () => {
    const expired = deps({ oneImpl: async () => ({ id: "job-1", status: "completed", expires_at: new Date(Date.now() - 1000).toISOString() }) });
    expect((await handleExportJobDownload(attachRouteContext(request("GET"), { slug: "job-1" }), env, expired)).status).toBe(404);
    const failed = deps({ oneImpl: async () => ({ id: "job-1", status: "failed", error: "database unavailable", expires_at: new Date(Date.now() + 10000).toISOString() }) });
    const status = await handleExportJobStatus(attachRouteContext(request("GET"), { slug: "job-1" }), env, failed);
    expect((await status.json()).status).toBe("failed");
  });

  it("returns a clear not-found response when the completed artifact is missing", async () => {
    const d = deps({
      oneImpl: async () => ({ id: "job-1", status: "completed", artifact_key: "missing-key", expires_at: new Date(Date.now() + 10000).toISOString() }),
    });
    const missingObjectEnv = { ACCOUNT_EXPORTS: { get: async () => null } };
    const res = await handleExportJobDownload(attachRouteContext(request("GET"), { slug: "job-1" }), missingObjectEnv, d);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("no longer available");
  });

  it("fails the job visibly when queue admission fails", async () => {
    const d = deps({
      sendImpl: async () => { throw new Error("queue unavailable"); },
    });
    const res = await handleCreateExportJob(request(), env, d);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("Could not start data export");
    expect(d.state.execs).toHaveLength(2);
    expect(d.state.execs[1]).toEqual(["queue unavailable", d.state.execs[0][0]]);
  });
});

import { describe, expect, it } from "bun:test";
import {
  handleCreateViewerExportJob,
  handleViewerExportStatus,
  handleViewerExportDownload,
} from "../handlers/viewer-export.js";
import { attachRouteContext } from "../middleware/handler.js";

const VIEWER = { id: "viewer-1" };
const env = { ACCOUNT_EXPORTS: { get: async () => ({ body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("artifact")); c.close(); } }) }) } };
const request = (method = "GET") => new Request("https://yourrank.site/api/viewer/export/job-1", { method });

function deps(overrides = {}) {
  const state = { execs: [], sent: [] };
  return {
    state,
    requireViewerImpl: async () => ({ viewer: VIEWER, res: null }),
    rateLimitImpl: async () => ({ ok: true, limit: 60, remaining: 59, reset: 123 }),
    oneImpl: async () => null,
    execImpl: async (sql, params) => { state.execs.push([sql, params]); return []; },
    sendImpl: async (event) => state.sent.push(event),
    logAuditImpl: async () => {},
    ...overrides,
  };
}

describe("viewer export ownership and lifecycle", () => {
  it("creates a viewer-owned job and uses the distinct queue event", async () => {
    const d = deps();
    const res = await handleCreateViewerExportJob(new Request("https://yourrank.site/api/viewer/export", { method: "POST" }), env, d);
    expect(res.status).toBe(200);
    expect(d.state.sent[0].type).toBe("viewer-export");
    expect(d.state.sent[0].viewerId).toBe("viewer-1");
  });

  it("fails immediately when the R2 binding is unavailable without creating a job", async () => {
    const d = deps();
    const res = await handleCreateViewerExportJob(new Request("https://yourrank.site/api/viewer/export", { method: "POST" }), {}, d);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("temporarily unavailable");
    expect(d.state.execs).toHaveLength(0);
    expect(d.state.sent).toHaveLength(0);
  });

  it("makes foreign and nonexistent status jobs indistinguishable", async () => {
    const d = deps({ oneImpl: async () => null });
    const foreign = await handleViewerExportStatus(attachRouteContext(request(), { slug: "foreign" }), env, d);
    const missing = await handleViewerExportStatus(attachRouteContext(request(), { slug: "missing" }), env, d);
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await foreign.text()).toBe(await missing.text());
  });

  it("makes foreign and nonexistent download jobs indistinguishable", async () => {
    const d = deps({ oneImpl: async () => null });
    const foreign = await handleViewerExportDownload(attachRouteContext(request(), { slug: "foreign" }), env, d);
    const missing = await handleViewerExportDownload(attachRouteContext(request(), { slug: "missing" }), env, d);
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await foreign.text()).toBe(await missing.text());
  });
});

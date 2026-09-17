// Tests for the public contact/support endpoint.
import { describe, it, expect, mock, beforeEach } from "bun:test";
import fs from "node:fs";

const mockExec = mock(() => Promise.resolve([{ id: "msg-stored", created: true }]));

const sendEmail = mock(() => Promise.resolve());
const rateLimit = mock(() => Promise.resolve({ ok: true, limit: 3, remaining: 2, retryAfter: 0 }));
import { handleContact as handleContactImpl } from "../handlers/contact.js";
const handleContact = (request, env) => handleContactImpl(request, env, { exec: mockExec, sendEmail, rateLimit });

function postReq(body) {
  return new Request("http://localhost/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const mockEnv = { RL_FAIL_OPEN: "true" }; // tests run without a KV backend

describe("handleContact", () => {
  beforeEach(() => {
    mockExec.mockClear();
  });

  it("stores a valid contact message and returns success", async () => {
    const res = await handleContact(postReq({ name: "Test", email: "test@example.com", message: "Hello, this is a message." }), mockEnv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockExec).toHaveBeenCalled();
  });

  it("acknowledges durable receipt even when the inbox email notification throws", async () => {
    const res = await handleContactImpl(postReq({ name: 'Test', email: 'test@example.com', message: 'Please help with my site.' }), mockEnv, {
      exec: mockExec, rateLimit, sendEmail: async () => { throw new Error('notification unavailable'); },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).message).toContain('YourRank received');
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it("labels contextual feedback for the admin support inbox", async () => {
    const res = await handleContact(postReq({
      name: "Test",
      email: "test@example.com",
      kind: "feedback",
      context: "bot",
      subject: "Broadcast flow",
      message: "The broadcast flow needs a clearer confirmation.",
    }), mockEnv);
    expect(res.status).toBe(200);
    expect(mockExec.mock.calls[0][1][2]).toBe("[Feedback · Bot] Broadcast flow");
  });

  it("rejects unknown message types and contexts", async () => {
    const badType = await handleContact(postReq({
      name: "Test", email: "test@example.com", kind: "sales", message: "Please contact me about this."
    }), mockEnv);
    expect(badType.status).toBe(400);
    const badContext = await handleContact(postReq({
      name: "Test", email: "test@example.com", context: "admin", message: "Please contact me about this."
    }), mockEnv);
    expect(badContext.status).toBe(400);
  });

  it("rejects missing name", async () => {
    const res = await handleContact(postReq({ name: "", email: "test@example.com", message: "Hello there." }), mockEnv);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Name");
  });

  it("rejects invalid email", async () => {
    const res = await handleContact(postReq({ name: "Test", email: "not-an-email", message: "Hello there." }), mockEnv);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("email");
  });

  it("stores a retried request id once and skips the second inbox email", async () => {
    const stored = new Map();
    // Mirrors the single insert-or-return-existing statement: same request id -> original row, created=false.
    const exec = mock((sql, params) => {
      const requestId = params[5];
      if (requestId && stored.has(requestId)) return Promise.resolve([{ id: stored.get(requestId), created: false }]);
      const id = `msg-${stored.size + 1}`;
      if (requestId) stored.set(requestId, id);
      return Promise.resolve([{ id, created: true }]);
    });
    const send = mock(() => Promise.resolve({ sent: true }));
    const payload = { name: "Test", email: "test@example.com", message: "Please help with my site.", requestId: "6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f" };
    const first = await handleContactImpl(postReq(payload), mockEnv, { exec, sendEmail: send, rateLimit });
    const firstBody = await first.json();
    expect(first.status).toBe(200);
    expect(firstBody).toMatchObject({ ok: true, receiptId: "msg-1" });
    expect(firstBody.duplicate).toBeUndefined();

    const retry = await handleContactImpl(postReq(payload), mockEnv, { exec, sendEmail: send, rateLimit });
    const retryBody = await retry.json();
    expect(retry.status).toBe(200);
    expect(retryBody).toMatchObject({ ok: true, duplicate: true, receiptId: "msg-1" });
    expect(retryBody.message).toBe(firstBody.message);
    expect(send).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[0][0]).toContain("WHERE NOT EXISTS (SELECT 1 FROM existing)");
    expect(exec.mock.calls[0][0]).toContain("INSERT INTO support_messages (name, email, subject, message, ip_hash, request_id)");
  });

  it("fails closed instead of faking a receipt when the store returns no row", async () => {
    const exec = mock(() => Promise.resolve([]));
    const send = mock(() => Promise.resolve({ sent: true }));
    const res = await handleContactImpl(
      postReq({ name: "Test", email: "test@example.com", message: "Please help with my site." }),
      mockEnv,
      { exec, sendEmail: send, rateLimit },
    );
    expect(res.status).toBe(500);
    expect(send).not.toHaveBeenCalled();
  });

  it("stores submissions without a request id every time and rejects malformed ids", async () => {
    const exec = mock(() => Promise.resolve([{ id: "msg-x", created: true }]));
    const payload = { name: "Test", email: "test@example.com", message: "Please help with my site." };
    await handleContactImpl(postReq(payload), mockEnv, { exec, sendEmail, rateLimit });
    await handleContactImpl(postReq(payload), mockEnv, { exec, sendEmail, rateLimit });
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[0][1][5]).toBeNull();

    const bad = await handleContactImpl(postReq({ ...payload, requestId: "<script>" }), mockEnv, { exec, sendEmail, rateLimit });
    expect(bad.status).toBe(400);
  });

  it("rejects messages that are too short", async () => {
    const res = await handleContact(postReq({ name: "Test", email: "test@example.com", message: "Hi" }), mockEnv);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Message");
  });
});

describe("support form client (assets/contact.js)", () => {
  const source = fs.readFileSync(new URL("../assets/contact.js", import.meta.url), "utf8");

  it("bounds the request with a 15 second abort and clears the timer", () => {
    expect(source).toContain("const REQUEST_TIMEOUT_MS = 15000;");
    expect(source).toContain("setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)");
    expect(source).toContain("signal: controller.signal");
    expect(source).toMatch(/finally \{\s*clearTimeout\(timer\);\s*setLoading\(false\);/);
  });

  it("keeps the draft and explains uncertain delivery without blind retry", () => {
    // form.reset() only runs on the success branch.
    expect(source.match(/form\.reset\(\)/g)).toHaveLength(1);
    expect(source).toMatch(/if \(res\.ok\) \{[\s\S]*?form\.reset\(\);[\s\S]*?\} else if/);
    expect(source).toContain("Sending again is safe");
    expect(source).toContain("nothing was sent");
    expect(source).not.toMatch(/retry\s*\(|attempts?\s*[<>]/i);
  });

  it("reuses one request id per draft and starts a new one only after a real receipt", () => {
    expect(source).toContain('const requestIdInput = document.getElementById("c_request_id");');
    expect(source).toMatch(/if \(!requestIdInput\.value\) \{[\s\S]*?crypto\.randomUUID\(\)/);
    expect(source).toMatch(/if \(res\.ok\) \{[\s\S]*?requestIdInput\.value = "";/);
    // The id is not cleared on timeout/network/server errors.
    expect(source.match(/requestIdInput\.value = ""/g)).toHaveLength(1);
  });

  it("shows durable inline field errors and a focused, polite confirmation", () => {
    expect(source).toContain('input.addEventListener("invalid", (e) => e.preventDefault())');
    expect(source).toContain('input.setAttribute("aria-invalid", "true")');
    expect(source).toContain("invalid[0].focus()");
    expect(source).toContain("success.focus()");
    expect(source).toContain("body.receiptId");
  });

  it("ignores duplicate submits while a request is pending", () => {
    expect(source).toContain("if (pending) return;");
    expect(source).toContain('submit.setAttribute("aria-busy", loading ? "true" : "false")');
  });
});

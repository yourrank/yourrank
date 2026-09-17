// Tests for the public contact/support endpoint.
import { describe, it, expect, mock, beforeEach } from "bun:test";
import fs from "node:fs";

const mockExec = mock(() => Promise.resolve());

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
    expect(source).toMatch(/if \(res\.ok\) \{[\s\S]*?form\.reset\(\);[\s\S]*?\} else \{/);
    expect(source).toContain("may or may not have been received");
    expect(source).toContain("nothing was sent");
    expect(source).not.toMatch(/retry\s*\(|attempts?\s*[<>]/i);
  });

  it("ignores duplicate submits while a request is pending", () => {
    expect(source).toContain("if (pending) return;");
    expect(source).toContain('submit.setAttribute("aria-busy", loading ? "true" : "false")');
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { sanitizeProviderMessage, sendEmail } from "../email";

const originalFetch = globalThis.fetch;
const originalConsoleError = console.error;
let requestCount: number;
let logs: unknown[][];
let responseBody: string;
let responseStatus: number;

beforeEach(() => {
  requestCount = 0;
  logs = [];
  responseBody = "";
  responseStatus = 400;
  globalThis.fetch = async () => {
    requestCount++;
    return new Response(responseBody, { status: responseStatus });
  };
  console.error = ((...args: unknown[]) => {
    logs.push(args);
  }) as typeof console.error;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalConsoleError;
});

function loggedPayload() {
  const encoded = logs[0]?.[1];
  return typeof encoded === "string" ? JSON.parse(encoded) : {};
}

describe("sendEmail Resend rejection diagnostics", () => {
  it("logs a sanitized provider message and preserves the HTTP failure contract", async () => {
    responseBody = JSON.stringify({
      statusCode: 400,
      name: "validation_error",
      message: "Could not send private@example.com; see https://resend.com/errors/400; key re_abc123def456ghijklmnopqrstuvwxyz; code 482913.",
    });

    const result = await sendEmail(
      { RESEND_API_KEY: "secret-api-key", MAIL_FROM: "YourRank <hey@yourrank.site>" },
      { to: "recipient@example.net", subject: "test", html: "<p>private body</p>", text: "private body" },
    );

    expect(result).toEqual({ sent: false, reason: "http_400" });
    expect(requestCount).toBe(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.[0]).toBe("[email]: resend rejected");
    const line = logs[0]?.map(String).join(" ") ?? "";
    expect(line).toContain('"status":400');
    expect(line).toContain('"name":"validation_error"');
    expect(line).toContain("[email]");
    expect(line).toContain("[url]");
    expect(line).toContain("[key]");
    expect(line).toContain("[code]");
    for (const secret of [
      "private@example.com",
      "https://resend.com/errors/400",
      "re_abc123def456ghijklmnopqrstuvwxyz",
      "482913",
      "recipient@example.net",
      "secret-api-key",
      "private body",
      "hey@yourrank.site",
    ]) {
      expect(line).not.toContain(secret);
    }
  });

  it("does not throw when the provider response body is not JSON", async () => {
    responseBody = "upstream refused request";

    const result = await sendEmail(
      { RESEND_API_KEY: "secret-api-key" },
      { to: "recipient@example.net", subject: "test", html: "", text: "" },
    );

    expect(result).toEqual({ sent: false, reason: "http_400" });
    expect(logs).toHaveLength(1);
    expect(loggedPayload().message).toBe("upstream refused request");
  });

  it("reports only the from domain and its format", async () => {
    const cases = [
      { from: "YourRank <hey@yourrank.site>", domain: "yourrank.site", format: "name_angle" },
      { from: "hey@yourrank.site", domain: "yourrank.site", format: "bare" },
      { from: '"YourRank" hey@yourrank.site', domain: "yourrank.site", format: "other" },
      { from: "malformed", domain: "invalid", format: "other" },
    ];

    for (const { from, domain, format } of cases) {
      await sendEmail(
        { RESEND_API_KEY: "secret-api-key" },
        { to: "recipient@example.net", subject: "test", html: "", text: "", from },
      );
      expect(loggedPayload()).toMatchObject({ from_domain: domain, from_format: format });
      expect(logs[logs.length - 1]?.map(String).join(" ")).not.toContain(from);
      logs = [];
    }

    expect(requestCount).toBe(cases.length);
  });

  it("limits sanitized provider messages to 300 characters", () => {
    expect(sanitizeProviderMessage("provider message. ".repeat(25))).toHaveLength(300);
  });
});

// The browser device-signal asset: a cached one-way SHA-256 hex hash, and a
// null-with-warning path when crypto.subtle is unavailable.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

const source = readFileSync(new URL("../assets/device-signal.js", import.meta.url), "utf8");

function makeWindow({ subtle = true } = {}) {
  const window = new Window({ url: "http://localhost/" });
  if (subtle) {
    // happy-dom lacks WebCrypto; bridge the Node implementation.
    window.crypto = { subtle: crypto.subtle };
  } else {
    window.crypto = {};
  }
  window.TextEncoder = TextEncoder;
  const run = new Function("window", "document", "navigator", "screen", "crypto", "Intl", "TextEncoder", "setTimeout", source);
  run(window, window.document, window.navigator, window.screen, window.crypto, Intl, TextEncoder, setTimeout);
  return window;
}

describe("device-signal asset", () => {
  test("returns a stable 64-hex hash and caches the computation", async () => {
    const window = makeWindow();
    expect(typeof window.YRDeviceSignal?.hash).toBe("function");
    const first = await window.YRDeviceSignal.hash();
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    // Same cached promise → identical hash, and a broken component still yields a hash.
    const second = await window.YRDeviceSignal.hash();
    expect(second).toBe(first);
  });

  test("resolves null with a warning when crypto.subtle is missing", async () => {
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => warns.push(a.join(" "));
    try {
      const window = makeWindow({ subtle: false });
      expect(await window.YRDeviceSignal.hash()).toBeNull();
    } finally { console.warn = orig; }
    expect(warns.join("\n")).toContain("[device-signal] crypto.subtle unavailable");
  });
});

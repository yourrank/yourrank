// The Kick channel card is server-rendered HTML (pages/credits-pages.js)
// driven by a separate script (assets/credits.js). They drift silently: the
// "Reconnect Kick" link shipped hidden in the template while nothing in the
// script ever unhid it, and no test failed. These assertions pin the contract
// between the two files so that class of dead UI cannot come back.
import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const pagesSource = fs.readFileSync(path.resolve(import.meta.dir, "../pages/credits-pages.js"), "utf8");
const scriptSource = fs.readFileSync(path.resolve(import.meta.dir, "../assets/credits.js"), "utf8");
const kickAuthSource = fs.readFileSync(path.resolve(import.meta.dir, "../handlers/kick-auth.js"), "utf8");

// Ids the script drives on the channel card.
const scriptedIds = [...scriptSource.matchAll(/\$\("([a-z0-9-]+)"\)/g)].map((m) => m[1]);
const channelIds = [...new Set(scriptedIds.filter((id) => id.startsWith("cr-channel")))];

describe("credits channel card DOM contract", () => {
  it("finds channel ids in the script", () => {
    expect(channelIds).toContain("cr-channel-reconnect");
    expect(channelIds).toContain("cr-channel-live");
    expect(channelIds).toContain("cr-channel-linked");
  });

  it("every channel id the script drives exists in the template", () => {
    for (const id of channelIds) {
      expect(pagesSource).toContain(`id="${id}"`);
    }
  });

  it("the reconnect link is unhidden when the token needs attention", () => {
    expect(scriptSource).toContain('const reconnect = $("cr-channel-reconnect")');
    expect(scriptSource).toMatch(/reconnect\.hidden = !/);
  });

  it("the reconnect link ships hidden in the template", () => {
    expect(pagesSource).toMatch(/id="cr-channel-reconnect"[^>]*hidden/);
  });

  it("channel status is not hardcoded: the script writes cr-channel-live", () => {
    expect(scriptSource).toMatch(/cr-channel-live"\)/);
    expect(scriptSource).toContain('chip.classList.toggle("v3-chip--cancelled", !connected)');
  });

  it("every OAuth error code the handler emits has a friendly message", () => {
    const emitted = [...kickAuthSource.matchAll(/channelRedirect\(\{ error: "([a-z_]+)"/g)].map((m) => m[1]);
    expect(emitted.length).toBeGreaterThan(0);
    const messagesBlock = scriptSource.slice(
      scriptSource.indexOf("OAUTH_MESSAGES"),
      scriptSource.indexOf("});", scriptSource.indexOf("OAUTH_MESSAGES"))
    );
    for (const code of new Set(emitted)) {
      expect(messagesBlock).toContain(`${code}:`);
    }
  });
});

import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const pageSource = fs.readFileSync(path.resolve(import.meta.dir, "../react/pages/rewards/page.tsx"), "utf8");
const entrySource = fs.readFileSync(path.resolve(import.meta.dir, "../react/pages/rewards/entry.tsx"), "utf8");
const dispatcherSource = fs.readFileSync(path.resolve(import.meta.dir, "../assets/credits.js"), "utf8");
const kickAuthSource = fs.readFileSync(path.resolve(import.meta.dir, "../handlers/kick-auth.js"), "utf8");

describe("React Kick channel card contract", () => {
  it("renders channel controls from current state and management capabilities", () => {
    expect(pageSource).toContain('id="cr-channel-reconnect"');
    expect(pageSource).toContain("Reconnect Kick");
    expect(pageSource).toContain("channel.canRepair || connectionStatus ===");
    expect(pageSource).toContain('capabilities.manageConnections !== false');
    expect(pageSource).toContain("The site owner manages the Kick connection.");
    expect(pageSource).toContain("channel.statusLabel");
    expect(pageSource).toContain("delivery.label");
  });

  it("routes Audience tabs to the legacy controller and Rewards tabs to the React island", () => {
    expect(dispatcherSource).toContain('tab === "viewers" || tab === "history"');
    expect(dispatcherSource).toContain('import("./audience-credits.js")');
    expect(dispatcherSource).toContain('import("./react/rewards.js")');
    expect(entrySource).toContain("defineIsland");
    expect(entrySource).toContain('getAttribute("data-cr-tab")');
  });

  it("writes OAuth errors into the channel status and removes one-time query parameters", () => {
    expect(pageSource).toContain("OAUTH_MESSAGES[oauth.error]");
    expect(pageSource).toContain('clean.searchParams.delete("error")');
    expect(pageSource).toContain('clean.searchParams.delete("kick_connected")');
    expect(pageSource).toContain('clean.searchParams.delete("kick_delivery")');
  });

  it("has a friendly message for every OAuth error code the handler emits", () => {
    const emitted = [...kickAuthSource.matchAll(/channelRedirect\(\{ error: "([a-z_]+)"/g)].map((match) => match[1]);
    expect(emitted.length).toBeGreaterThan(0);
    const messages = pageSource.match(/const OAUTH_MESSAGES:[^{]+\{[\s\S]*?\n\};/)?.[0] || "";
    for (const code of new Set(emitted)) expect(messages).toContain(`${code}:`);
  });
});

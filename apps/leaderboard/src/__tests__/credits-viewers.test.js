import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const creditsJs = readFileSync(new URL("../assets/credits.js", import.meta.url), "utf8");
const creditsPagesJs = readFileSync(new URL("../pages/credits-pages.js", import.meta.url), "utf8");
const creditsHandlerJs = readFileSync(new URL("../handlers/credits.js", import.meta.url), "utf8");

describe("viewer membership display", () => {
  it("shows join time and an explicit no-earnings state", () => {
    expect(creditsJs).toContain("const joined = fmtDate(v.created_at)");
    expect(creditsJs).toContain('const earned = v.last_earned_at ? fmtDate(v.last_earned_at) : "Not yet"');
    expect(creditsJs).toContain('const seen = v.last_seen_at ? fmtDate(v.last_seen_at) : "Not yet"');
    expect(creditsJs).toContain("v.discord_username");
    expect(creditsJs).toContain("v.avatar_url");
    expect(creditsJs).toContain("function viewerIdentity(");
    expect(creditsJs).toContain('v.kick_username || v.discord_username || v.kick_user_id || v.discord_user_id || "Member"');
    expect(creditsJs).not.toContain("v.viewer_id ||");
    expect(creditsJs).toContain('const history = identity !== "Member"');
    expect(creditsJs).toContain('/dashboard/rewards/activity?viewer=${encodeURIComponent(identity)}');
    expect(creditsJs).toContain('new URLSearchParams(location.search).get("viewer")');
    expect(creditsJs).toContain("has signed in but has not earned or spent credits yet");
    expect(creditsJs).toContain("Members who sign in will appear here");
    expect(creditsPagesJs).toContain("Joined / activity");
    expect(creditsHandlerJs).toContain("v.avatar_url");
    expect(creditsHandlerJs).toContain("v.discord_username");
    expect(creditsHandlerJs).toContain("v.discord_user_id");
    expect(creditsHandlerJs).toContain("sv.last_seen_at");
  });
});

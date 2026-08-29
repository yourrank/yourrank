import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const creditsJs = readFileSync(new URL("../assets/credits.js", import.meta.url), "utf8");
const creditsPagesJs = readFileSync(new URL("../pages/credits-pages.js", import.meta.url), "utf8");
const creditsHandlerJs = readFileSync(new URL("../handlers/credits.js", import.meta.url), "utf8");
const peopleHandlerJs = readFileSync(new URL("../handlers/people.js", import.meta.url), "utf8");
const routesJs = readFileSync(new URL("../routes.js", import.meta.url), "utf8");

describe("viewer membership display", () => {
  it("shows site membership and authenticated connection state without raw IDs", () => {
    expect(creditsJs).toContain("const joined = fmtDate(v.joinedAt)");
    expect(creditsJs).toContain("v.lastSeenAt || v.lastCreditAt");
    expect(creditsJs).toContain("v.linkedIdentities");
    expect(creditsJs).toContain("v.avatarUrl");
    expect(creditsJs).toContain("function viewerIdentity(");
    expect(creditsJs).toContain('v.displayName || "Unnamed member"');
    expect(creditsJs).toContain("No signed-in account");
    expect(creditsJs).toContain("No leaderboard player or subscriber record is assumed");
    expect(creditsPagesJs).toContain("Members in the selected site");
    expect(peopleHandlerJs).toContain("v.kick_linked_at, v.discord_linked_at");
    expect(peopleHandlerJs).not.toMatch(/v\.kick_user_id|v\.discord_user_id|fraud_score/);
  });

  it("cannot manufacture a member by entering a matching username", () => {
    expect(creditsPagesJs).not.toContain('id="cr-tip-open-btn"');
    expect(creditsPagesJs).toContain('id="cr-tip-username" name="username" type="text" readonly');
    expect(creditsJs).not.toContain('sitePath("/api/credits/tip")');
    expect(routesJs).not.toContain('{ path: "/api/credits/tip"');
    expect(creditsHandlerJs).not.toContain("INSERT INTO viewers (kick_username, kick_user_id)");
    expect(creditsHandlerJs).not.toContain("ON CONFLICT (site_id, viewer_id) DO UPDATE SET updated_at = now()");
  });
});

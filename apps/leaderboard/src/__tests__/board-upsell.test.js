import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { PAGES } from "../pages.jsx";

const boardsJs = readFileSync(new URL("../assets/dashboard/boards.js", import.meta.url), "utf8");

function dashboardHtml() {
  return PAGES.dashboard.Component({ activePath: "/dashboard/leaderboards" }).toString();
}

describe("board-limit upsell", () => {
  it("keeps a visible New board action with an accessible upsell target", () => {
    const html = dashboardHtml();
    expect(html).toContain('id="newBoard"');
    expect(html).toContain('id="boardLimitUpsell" role="status" hidden');
    expect(html).toContain('id="boardLimitCta"');
    expect(boardsJs).toContain("newBtn.hidden = false");
    expect(boardsJs).toContain('newBtn.setAttribute("aria-controls", atLimit ? "boardLimitUpsell" : "newBoardForm")');
  });

  it("supports keyboard and outside-click dismissal with focus restoration", () => {
    expect(boardsJs).toContain("wireBoardLimitUpsell()");
    expect(boardsJs).toContain('event.key === "Escape"');
    expect(boardsJs).toContain('event.preventDefault();');
    expect(boardsJs).toContain('document.addEventListener("pointerdown"');
    expect(boardsJs).toContain("!panel.contains(event.target)");
    expect(boardsJs).toContain('newBtn?.setAttribute("aria-expanded", "false")');
    expect(boardsJs).toContain("if (wasOpen && restoreFocus) newBtn?.focus()");
    expect(boardsJs).toContain('else newBtn.setAttribute("aria-expanded", $("boardLimitUpsell")?.hidden ? "false" : "true")');
  });

  it("offers Pro, Team, or support according to the current plan", () => {
    expect(boardsJs).toContain("Pro unlocks up to 3 independent sites.");
    expect(boardsJs).toContain("Team supports up to 10 independent sites and 5 operator seats.");
    expect(boardsJs).toContain('cta: "Contact support"');
  });
});

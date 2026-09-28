import { describe, expect, it } from "bun:test";
import { shopPage } from "../pages/credits-pages.js";

describe("shop drawer status placement", () => {
  it("renders the save status before the drawer actions", () => {
    const statusIndex = shopPage.indexOf('id="cr-shop-status"');
    const actionsIndex = shopPage.indexOf('<div class="cr-drawer-actions">', shopPage.indexOf('id="cr-shop-form"'));

    expect(statusIndex).toBeGreaterThan(-1);
    expect(actionsIndex).toBeGreaterThan(-1);
    expect(statusIndex).toBeLessThan(actionsIndex);
  });
});

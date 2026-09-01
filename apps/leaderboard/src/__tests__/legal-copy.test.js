import { describe, expect, it } from "bun:test";
import { applyLegalIdentity } from "../pages/legal-helper.js";
import { termsPage } from "../pages/terms.js";
import { responsiblePage } from "../pages/responsible.js";

describe("platform legal copy truth", () => {
  it("keeps default legal pages aligned with the free-credit launch boundary", () => {
    const terms = applyLegalIdentity(termsPage, {});
    const responsible = applyLegalIdentity(responsiblePage, {});
    const copy = `${terms}\n${responsible}`;

    expect(copy).toContain("Recurring card checkout for Pro and Team is not available yet.");
    expect(copy).toContain("Community credits have no cash value.");
    expect(copy).not.toMatch(/sign up or deposit|cryptocurrency|blockchain/i);
  });
});

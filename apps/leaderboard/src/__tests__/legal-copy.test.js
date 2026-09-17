import { describe, expect, it } from "bun:test";
import { applyLegalIdentity } from "../pages/legal-helper.js";
import { termsPage } from "../pages/terms.js";
import { responsiblePage } from "../pages/responsible.js";

describe("platform legal copy truth", () => {
  it("keeps default legal pages aligned with the free-credit launch boundary", () => {
    const terms = applyLegalIdentity(termsPage, {});
    const responsible = applyLegalIdentity(responsiblePage, {});
    const copy = `${terms}\n${responsible}`;

    expect(copy).toContain("When enabled in Billing, Pro and Team subscriptions are processed by Polar.");
    expect(copy).toContain("Community credits have no cash value.");
    expect(copy).not.toMatch(/sign up or deposit|cryptocurrency|blockchain/i);
  });

  it("keeps legal navigation pointed at the marketing workflow fragment", () => {
    const terms = applyLegalIdentity(termsPage, {});
    const howItWorksTargets = [...terms.matchAll(/<a href="([^"]+)">How it works<\/a>/g)]
      .map((match) => match[1]);

    expect(howItWorksTargets).toEqual(["/#loop", "/#loop"]);
  });
});

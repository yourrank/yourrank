// Exercise the compiled canonical pricing API; this is behavior coverage, not
// an assertion about dashboard source text.
import assert from "node:assert/strict";
import { PLAN_PRICING, priceUsd } from "../packages/shared/dist/plans.js";

assert.equal(PLAN_PRICING.pro.annualUsd, 240);
assert.equal(PLAN_PRICING.team.annualUsd, 690);
assert.equal(priceUsd({}, "pro", "annual"), 240);
assert.equal(priceUsd({}, "team", "annual"), 690);
console.log("PASSED: compiled canonical annual plan totals are Pro $240 and Team $690.");

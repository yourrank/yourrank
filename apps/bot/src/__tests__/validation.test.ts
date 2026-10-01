import { describe, expect, it } from "bun:test";
import { offerCreateSchema } from "../validation.js";

describe("bot API validation", () => {
  it("accepts the documented offer contract", () => {
    expect(offerCreateSchema.parse({
      casino: "Example Sponsor",
      label: "Welcome offer",
      referral_url: "https://example.com/ref",
      promo_code: "RANK",
    })).toEqual({
      casino: "Example Sponsor",
      label: "Welcome offer",
      referral_url: "https://example.com/ref",
      promo_code: "RANK",
    });
  });

  it("rejects unknown fields", () => {
    expect(() => offerCreateSchema.parse({
      casino: "Example Sponsor",
      label: "Welcome offer",
      referral_url: "https://example.com/ref",
      owner_id: "unexpected",
    })).toThrow("Unrecognized key");
  });
});

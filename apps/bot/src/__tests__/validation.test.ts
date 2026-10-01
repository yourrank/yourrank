import { describe, expect, it } from "bun:test";
import { adminOfferSchema, offerCreateSchema } from "../validation.js";

describe("bot API validation", () => {
  it("accepts the documented offer contract", () => {
    expect(offerCreateSchema.parse({
      partner: "Example Sponsor",
      label: "Welcome offer",
      referral_url: "https://example.com/ref",
      promo_code: "RANK",
    })).toEqual({
      partner: "Example Sponsor",
      label: "Welcome offer",
      referral_url: "https://example.com/ref",
      promo_code: "RANK",
    });
  });

  it("rejects unknown fields", () => {
    expect(() => offerCreateSchema.parse({
      partner: "Example Sponsor",
      label: "Welcome offer",
      referral_url: "https://example.com/ref",
      owner_id: "unexpected",
    })).toThrow("Unrecognized key");
  });

  it("normalizes the legacy partner field at the admin boundary", () => {
    expect(adminOfferSchema.parse({
      owner_id: "f95c4682-36ab-40e8-81fd-1013ce321cdc",
      casino: "Legacy Partner",
      label: "Welcome offer",
      referral_url: "https://example.com/ref",
    })).toEqual({
      owner_id: "f95c4682-36ab-40e8-81fd-1013ce321cdc",
      partner: "Legacy Partner",
      label: "Welcome offer",
      referral_url: "https://example.com/ref",
    });
  });
});

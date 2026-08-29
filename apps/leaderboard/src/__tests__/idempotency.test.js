// Billing provider retirement and retained payment-idempotency guards.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as billing from "../billing.js";

const MIGRATIONS_ROOT = path.resolve(import.meta.dir, "../../../../supabase/migrations");

describe("retired NOWPayments webhook surface", () => {
  it("does not export an IPN handler or provider-specific activation path", () => {
    expect("handleIpn" in billing).toBe(false);
    expect("createPayment" in billing).toBe(false);
    expect("verifyNowpaymentsSignature" in billing).toBe(false);
  });
});

describe("payment deduplication", () => {
  it("retains partial unique tx_ref indexes while historical rows remain", () => {
    const migration = readFileSync(
      path.join(MIGRATIONS_ROOT, "20260904000000_billing_free_pro_team.sql"),
      "utf8",
    );
    expect(migration).toContain("CREATE UNIQUE INDEX uq_payments_nowpayments_txref");
    expect(migration).toContain("WHERE provider = 'nowpayments'::public.pay_provider");
    expect(migration).toContain("CREATE UNIQUE INDEX uq_payments_stars_txref");
    expect(migration).toContain("WHERE provider = 'telegram_stars'::public.pay_provider");
  });
});

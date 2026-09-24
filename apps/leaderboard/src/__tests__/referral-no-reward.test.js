// The referral free-Pro reward is gone: signup ignores any referral parameter,
// grants nothing to either side, and no reward endpoint or copy remains.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { handleSignup } from "../handlers/auth.js";
import { ROUTES } from "../routes.js";
import { UnifiedSettingsPage } from "../pages/account.jsx";
import { handlerSchemas } from "@yourrank/shared/validation";

const SRC = join(import.meta.dir, "..");
const read = (rel) => readFileSync(join(SRC, rel), "utf8");

function fakeSignup() {
  const sql = [];
  const tx = { unsafe: async (text, params) => { sql.push({ text, params }); return []; } };
  let createdUser = null;
  const deps = {
    rateLimit: async () => ({ ok: true }),
    findUserByEmail: async () => null,
    findSiteBySlug: async () => null,
    generateUniqueReferralCode: async () => "newcode1",
    withTransaction: async (fn) => fn(tx),
    createUser: async (_tx, userId, email, _hash, _salt, referralCode, ...rest) => {
      createdUser = { userId, email, plan: "free", referralCode, extraArgs: rest };
      sql.push({ text: "INSERT INTO users", params: [userId, email, "free", referralCode] });
    },
    createBoard: async () => ({ ok: true }),
    createSession: async () => "session-token",
    issueVerificationEmail: async () => ({ sent: true }),
    sendOnboardingEmail: async () => {},
    trackActivation: () => {},
    waitUntil: () => {},
  };
  return { deps, sql, user: () => createdUser };
}

function signupRequest(body, query = "") {
  return new Request(`https://yourrank.site/api/auth/signup${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://yourrank.site" },
    body: JSON.stringify(body),
  });
}

const entitlementWrite = ({ text }) =>
  /referral_rewards/i.test(text) || /UPDATE\s+users\s+SET[^;]*\b(plan|plan_expires_at|has_trial)\b/i.test(text);

describe("referral signup grants no paid entitlement", () => {
  it("creates the account on Free and never touches plan columns, with or without a ref", async () => {
    for (const [body, query] of [[{ ref: "abc12345" }, "?ref=abc12345"], [{}, "?ref=abc12345"], [{}, ""]]) {
      const f = fakeSignup();
      const res = await handleSignup(signupRequest({ email: "new@yourrank.site", password: "CorrectHorse!42", ...body }, query), {}, f.deps);
      expect(res.status).toBe(200);
      expect(f.user().plan).toBe("free");
      expect(f.user().extraArgs).toEqual([]);
      expect(f.sql.filter(entitlementWrite)).toEqual([]);
      expect(f.sql.some(({ text }) => /UPDATE\s+users/i.test(text))).toBe(false);
    }
  });

  it("never looks up or writes a referrer", () => {
    const src = read("handlers/auth.js");
    expect(src).not.toMatch(/body\.ref\b|refCode|referrerId|findUserByReferralCode|referred_by/);
    expect(src).not.toMatch(/referral_rewards|applyReferralReward|REFERRAL_REWARD_DAYS|REFERRAL_FRIEND_DAYS/);
    expect(read("data/auth.js")).not.toMatch(/referred_by|findUserByReferralCode/);
  });

  it("the signup request schema does not accept a referral field", () => {
    const parsed = handlerSchemas.handleSignup.safeParse({ email: "new@yourrank.site", password: "CorrectHorse!42", ref: "abc12345" });
    expect(parsed.success).toBe(false);
    expect(read("assets/auth.js")).not.toMatch(/payload\.ref\b|get\("ref"\)/);
  });
});

describe("no referral reward endpoint or UI remains", () => {
  it("does not register /api/referrals, /ref/<code> or any reward claim route", () => {
    const paths = ROUTES.map((r) => r.path);
    expect(paths).not.toContain("/api/referrals");
    expect(paths.some((p) => /referral|reward\/claim/i.test(p))).toBe(false);
    expect(read("index.js")).not.toMatch(/path\.startsWith\("\/ref\/"\)/);
  });

  it("billing settings render no invite/earn-Pro card", async () => {
    const html = await UnifiedSettingsPage({ activePath: "/dashboard/settings/billing", tab: "plan", user: { email: "a@b.c" } }).toString();
    expect(html).not.toContain("Invite streamers, earn Pro");
    expect(html).not.toMatch(/free week of Pro|free month/i);
    expect(html).not.toMatch(/id="(refLink|refCopy|planReferral|refStats)"/);
  });

  it("dashboard assets no longer fetch a referral reward API", () => {
    expect(read("assets/account.js")).not.toMatch(/referrals\.js|renderReferrals/);
    expect(read("assets/dashboard/state.js")).not.toContain("REFERRALS_STATUS");
  });
});

// Referral signups record attribution only: no free-Pro reward for either side,
// no reward endpoint, no reward copy in the dashboard.
import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { handleSignup } from "../handlers/auth.js";
import { ROUTES } from "../routes.js";
import { UnifiedSettingsPage } from "../pages/account.jsx";

const SRC = join(import.meta.dir, "..");
const read = (rel) => readFileSync(join(SRC, rel), "utf8");

function fakeSignup({ referrer = null } = {}) {
  const sql = [];
  const tx = { unsafe: async (text, params) => { sql.push({ text, params }); return []; } };
  let createdUser = null;
  const deps = {
    rateLimit: async () => ({ ok: true }),
    findUserByEmail: async () => null,
    findSiteBySlug: async () => null,
    findUserByReferralCode: async (code) => (referrer && code === referrer.code ? { id: referrer.id } : null),
    generateUniqueReferralCode: async () => "newcode1",
    withTransaction: async (fn) => fn(tx),
    createUser: async (_tx, userId, email, _hash, _salt, referralCode, referredBy) => {
      createdUser = { userId, email, plan: "free", referralCode, referredBy };
      sql.push({ text: "INSERT INTO users", params: [userId, email, "free", referralCode, referredBy] });
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

function signupRequest(body) {
  return new Request("https://yourrank.site/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://yourrank.site" },
    body: JSON.stringify(body),
  });
}

const entitlementWrite = ({ text }) =>
  /referral_rewards/i.test(text) || /UPDATE\s+users\s+SET[^;]*\b(plan|plan_expires_at|has_trial)\b/i.test(text);

describe("referral signup grants no paid entitlement", () => {
  it("records attribution for a valid ref code but creates the account on Free and never touches plan columns", async () => {
    const f = fakeSignup({ referrer: { id: "referrer-1", code: "abc12345" } });
    const res = await handleSignup(signupRequest({ email: "new@yourrank.site", password: "CorrectHorse!42", ref: "ABC12345" }), {}, f.deps);
    expect(res.status).toBe(200);
    expect(f.user().plan).toBe("free");
    expect(f.user().referredBy).toBe("referrer-1");
    expect(f.sql.filter(entitlementWrite)).toEqual([]);
  });

  it("referrer receives nothing when a referred account is created", async () => {
    const f = fakeSignup({ referrer: { id: "referrer-1", code: "abc12345" } });
    await handleSignup(signupRequest({ email: "new@yourrank.site", password: "CorrectHorse!42", ref: "abc12345" }), {}, f.deps);
    // The only statement mentioning the referrer is the referred user's own INSERT (referred_by).
    const touchesReferrer = f.sql.filter(({ params }) => Array.isArray(params) && params.includes("referrer-1"));
    expect(touchesReferrer.length).toBe(1);
    expect(touchesReferrer[0].text).toMatch(/INSERT INTO users/);
    expect(f.sql.some(({ text }) => /UPDATE\s+users/i.test(text))).toBe(false);
  });

  it("signup works identically with an unknown ref and with no ref", async () => {
    for (const body of [{ ref: "nobody" }, {}]) {
      const f = fakeSignup();
      const res = await handleSignup(signupRequest({ email: "new@yourrank.site", password: "CorrectHorse!42", ...body }), {}, f.deps);
      expect(res.status).toBe(200);
      expect(f.user().plan).toBe("free");
      expect(f.user().referredBy).toBe(null);
      expect(f.sql.filter(entitlementWrite)).toEqual([]);
    }
  });

  it("the signup handler source contains no reward grant", () => {
    const src = read("handlers/auth.js");
    expect(src).not.toMatch(/referral_rewards/);
    expect(src).not.toMatch(/applyReferralReward|REFERRAL_REWARD_DAYS|REFERRAL_FRIEND_DAYS/);
  });
});

describe("no referral reward endpoint or UI remains", () => {
  it("does not register /api/referrals or any reward claim route", () => {
    const paths = ROUTES.map((r) => r.path);
    expect(paths).not.toContain("/api/referrals");
    expect(paths.some((p) => /referral|reward\/claim/i.test(p))).toBe(false);
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

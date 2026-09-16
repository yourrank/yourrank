import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { processKickRewardRedemption, setSiteKickChannel } from "@yourrank/shared/kick-credits";
import { handleKickAuthCallback } from "../handlers/kick-auth.js";

const url = process.env.AUDIT_TEST_DATABASE_URL || "";
const integrationIt = (name, fn) => (url ? it : it.skip)(name, fn, 60000);
const owner = crypto.randomUUID();
const otherOwner = crypto.randomUUID();
const site = crypto.randomUUID();
const otherSite = crypto.randomUUID();
const channel = `audit-${crypto.randomUUID()}`;
const events = [];
let sql;
let oldUrl;
const event = () => {
  const messageId = crypto.randomUUID(); events.push(messageId);
  return { messageId, eventType: "channel.reward.redemption.updated", payload: {
    id: messageId, broadcaster: { user_id: channel }, redeemer: { user_id: `${channel}-viewer`, username: "Audit Viewer" },
    reward: { id: "no-mapping", title: "Test", cost: 10 }, status: "fulfilled",
  } };
};
beforeAll(async () => {
  if (!url) return;
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1", "postgres"].includes(parsed.hostname) || !/test|e2e/.test(parsed.pathname)) throw new Error("Disposable local database required");
  sql = postgres(url, { max: 3, prepare: false });
  await sql`INSERT INTO users (id, email, status, email_verified, kick_user_id, kick_linked_at) VALUES
    (${owner}, ${`${owner}@test.example`}, 'active', true, ${channel}, now()),
    (${otherOwner}, ${`${otherOwner}@test.example`}, 'active', true, null, null)`;
  await sql`INSERT INTO sites (id, user_id, slug, name, published, is_draft, kick_channel_external_id) VALUES
    (${site}, ${owner}, ${`a-${site.slice(0, 30)}`}, 'Audit channel', true, false, ${channel}),
    (${otherSite}, ${otherOwner}, ${`b-${otherSite.slice(0, 30)}`}, 'Other audit', true, false, null)`;
  oldUrl = process.env.DATABASE_URL; parsed.username = "yourrank_worker"; process.env.DATABASE_URL = parsed.toString();
});
afterAll(async () => {
  if (!sql) return;
  await sql`DELETE FROM kick_reward_events WHERE event_id IN ${sql(events.length ? events : ["none"])}`;
  await sql`DELETE FROM sites WHERE id IN (${site}, ${otherSite})`;
  await sql`DELETE FROM viewers WHERE kick_user_id=${`${channel}-viewer`}`;
  await sql`DELETE FROM users WHERE id IN (${owner}, ${otherOwner})`;
  await sql.end({ timeout: 0 });
  if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
});

describe("C04 provider ownership database boundary", () => {
  integrationIt("quarantines historical unproven channel rows before viewer or ledger mutation", async () => {
    expect(await processKickRewardRedemption(event())).toEqual({ skipped: true });
    expect(await sql`SELECT id FROM viewers WHERE kick_user_id=${`${channel}-viewer`}`).toHaveLength(0);
    await expect(setSiteKickChannel(otherSite, channel, "spoof")).rejects.toThrow("identity changed");
  });
  integrationIt("accepts corroborated ownership but rejects stale proof and post-link identity changes", async () => {
    await setSiteKickChannel(site, channel, "owner");
    expect((await sql`SELECT kick_channel_verified_at FROM sites WHERE id=${site}`)[0].kick_channel_verified_at).toBeTruthy();
    await processKickRewardRedemption(event());
    expect(await sql`SELECT id FROM viewers WHERE kick_user_id=${`${channel}-viewer`}`).toHaveLength(1);
    await sql`DELETE FROM viewers WHERE kick_user_id=${`${channel}-viewer`}`;
    await sql`UPDATE users SET kick_user_id=${`${channel}-changed`} WHERE id=${owner}`;
    expect(await processKickRewardRedemption(event())).toEqual({ skipped: true });
    expect(await sql`SELECT id FROM viewers WHERE kick_user_id=${`${channel}-viewer`}`).toHaveLength(0);
    await expect(setSiteKickChannel(site, channel, "stale")).rejects.toThrow("identity changed");
  });
  integrationIt("a pre-existing squatted channel collision rolls back new account credentials", async () => {
    const response = await handleKickAuthCallback(new Request("https://yourrank.site/auth/kick/callback?code=x&state=x"), {}, {
      currentUser: async () => ({ id: otherOwner }),
      consumeOAuthState: async () => ({ userId: otherOwner, siteId: otherSite, codeVerifier: "verifier" }),
      one: async () => ({ id: otherSite, user_id: otherOwner }),
      requireSiteCapability: async () => ({ role: "owner", res: null }),
      exchangeKickCode: async () => ({ access_token: "test-token" }),
      fetchKickCurrentUser: async () => ({ user_id: channel, name: "owner" }),
      fetchKickCurrentChannel: async () => ({ broadcaster_user_id: channel, slug: "owner" }),
      encryptKickToken: async () => "test-encrypted",
      subscribeKickWebhookEvent: async () => {},
    });
    expect(response.headers.get("location")).toContain("kick_auth_failed");
    const [row] = await sql`SELECT kick_user_id, kick_access_token_enc FROM users WHERE id=${otherOwner}`;
    expect(row).toEqual({ kick_user_id: null, kick_access_token_enc: null });
  });
});

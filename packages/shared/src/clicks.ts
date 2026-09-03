// Shared click logging used by both the bot Worker and the queue consumer.
import { withTransaction } from "./db.js";
import { hashIp } from "./crypto.js";

export async function insertClick(
  shortLinkId: string,
  ipH: Buffer,
  userAgent: string | null,
  referer: string | null,
  country: string | null,
  tgUserId: number | null,
  clickRef: string | null = null,
  { withTransactionImpl = withTransaction }: { withTransactionImpl?: typeof withTransaction } = {}
): Promise<void> {
  try {
    await withTransactionImpl(async (tx) => {
      const lockResult = await tx.one<{ lock_acquired: boolean }>(
        `SELECT acquire_click_uniqueness_lock($1, encode($2, 'hex')) AS lock_acquired`,
        [shortLinkId, ipH]
      );

      if (!lockResult?.lock_acquired) {
        await tx.query(
          `INSERT INTO clicks (short_link_id, ip_hash, country, user_agent, referer, tg_user_id, is_unique, click_ref)
           VALUES ($1, $2, $3, $4, $5, $6, false, $7)`,
          [shortLinkId, ipH, country, userAgent, referer, tgUserId, clickRef]
        );
        return;
      }

      await tx.query(
        `INSERT INTO clicks (short_link_id, ip_hash, country, user_agent, referer, tg_user_id, is_unique, click_ref)
         SELECT $1, $2, $3, $4, $5, $6,
                NOT EXISTS (
                  SELECT 1 FROM clicks
                   WHERE short_link_id = $1
                     AND ip_hash = $2
                     AND ts > now() - interval '24 hours'
                ),
                $7`,
        [shortLinkId, ipH, country, userAgent, referer, tgUserId, clickRef]
      );
    });
  } catch (err) {
    console.error("[clicks] click log failed:", err);
    throw err;
  }
}

export async function logClick(
  shortLinkId: string,
  ip: string,
  userAgent: string | null,
  referer: string | null,
  country: string | null,
  tgUserId: number | null,
  clickRef: string | null = null
): Promise<void> {
  await insertClick(
    shortLinkId,
    await hashIp(ip),
    userAgent,
    referer,
    country,
    tgUserId,
    clickRef
  );
}

export async function logMinimizedClick(
  shortLinkId: string,
  ipHash: string,
  tgUserId: number | null,
  clickRef: string,
  { withTransactionImpl = withTransaction }: { withTransactionImpl?: typeof withTransaction } = {}
): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(ipHash)) {
    throw new Error("invalid click IP hash");
  }
  await insertClick(shortLinkId, Buffer.from(ipHash, "hex"), null, null, null, tgUserId, clickRef, { withTransactionImpl });
}

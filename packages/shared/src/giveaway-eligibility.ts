import { z } from "zod";
import type { SqlRunner } from "./viewer-identity.js";

// These capabilities describe real enforcement, not planned providers.
export const GIVEAWAY_CAPABILITIES = Object.freeze({ onePerIp: true, vpnDetection: false, duplicateDevice: false });
export const giveawayRulesSchema = z.object({
  entryMode: z.enum(["chat", "members", "verified"]).default("chat"),
  subscriberOnly: z.boolean().default(false),
  vipOnly: z.boolean().default(false),
  excludePreviousWinners: z.boolean().default(false),
  onePerIp: z.boolean().default(false),
  vpnDetection: z.literal(false).default(false),
  duplicateDevice: z.literal(false).default(false),
  winnerMustRespond: z.boolean().default(false),
  responseTimeout: z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(120)]).default(60),
  autoReroll: z.boolean().default(false),
}).strict().superRefine((rules, ctx) => {
  if (rules.onePerIp && rules.entryMode !== "verified") ctx.addIssue({ code: "custom", message: "One account per IP requires Verified Entry." });
  if (rules.autoReroll && !rules.winnerMustRespond) ctx.addIssue({ code: "custom", message: "Auto re-roll requires winner response verification." });
});
export type GiveawayRules = z.infer<typeof giveawayRulesSchema>;
export type EligibilityResult = { status: "eligible" | "pending_verification" | "rejected"; reason: string | null };
export interface GiveawayParticipant {
  badges?: unknown[];
  viewerId?: string | null;
  kickLinked?: boolean;
  previousWinner?: boolean;
  verified?: boolean;
  duplicateAccount?: boolean;
  duplicateIp?: boolean;
  ipAvailable?: boolean;
}
export function giveawayRules(raw: unknown): GiveawayRules { return giveawayRulesSchema.parse(raw ?? {}); }

export function evaluateGiveawayEligibility(p: GiveawayParticipant, rules: GiveawayRules): EligibilityResult {
  const reject = (reason: string): EligibilityResult => ({ status: "rejected", reason });
  const badges = new Set((p.badges ?? []).flatMap((b) => b && typeof b === "object" && "type" in b ? [String(b.type)] : []));
  if (p.duplicateAccount) return reject("duplicate_account");
  // Founder/gifter/moderator badges do not prove current subscriber or VIP status.
  if (rules.subscriberOnly && !badges.has("subscriber")) return reject("subscriber_required");
  if (rules.vipOnly && !badges.has("vip")) return reject("vip_required");
  if (rules.excludePreviousWinners && p.previousWinner) return reject("previous_winner");
  if (rules.entryMode === "members") {
    if (!p.viewerId) return reject("not_yourrank_member");
    if (!p.kickLinked) return reject("kick_not_linked");
  }
  if (rules.entryMode === "verified") {
    if (!p.verified) return { status: "pending_verification", reason: "verification_required" };
    if (!p.viewerId) return reject("not_yourrank_member");
    if (!p.kickLinked) return reject("kick_not_linked");
    if (rules.onePerIp && !p.ipAvailable) return reject("ip_unavailable");
    if (rules.onePerIp && p.duplicateIp) return reject("duplicate_ip");
  }
  return { status: "eligible", reason: null };
}

/** Trusted identity/history facts. A Viewer Account is not a site Membership. */
export async function giveawayParticipantFacts(run: SqlRunner, siteId: string, providerUserId: string) {
  const rows = await run(`SELECT
    (SELECT vi.viewer_id FROM viewer_identities vi JOIN viewers v ON v.id = vi.viewer_id
      WHERE vi.provider = 'kick' AND vi.external_user_id = $2
        AND vi.status = 'active' AND vi.linked_at IS NOT NULL AND v.is_system = false LIMIT 1) AS viewer_id,
    EXISTS (SELECT 1 FROM chat_giveaway_draws d JOIN chat_giveaway_sessions gs ON gs.id = d.giveaway_session_id
      WHERE gs.site_id = $1 AND d.provider_user_id = $2) AS previous_winner`, [siteId, providerUserId]) as Array<{ viewer_id: string | null; previous_winner: boolean }>;
  return { viewerId: rows[0]?.viewer_id ?? null, kickLinked: !!rows[0]?.viewer_id, previousWinner: !!rows[0]?.previous_winner };
}

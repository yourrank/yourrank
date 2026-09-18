// Provider-neutral view over `credit_reward_mappings`. The table still stores
// the Kick-named columns (`kick_reward_id/title/cost`, compatibility phase);
// application code reads the neutral shape below so a later contract migration
// only touches this module (docs/PROVIDER_PORTABILITY_PLAN.md §4).
import type { ProviderId } from "./providers/types.js";
import type { SqlRunner } from "./viewer-identity.js";

export interface RewardMapping {
  id: string;
  provider: ProviderId;
  externalRewardId: string;
  externalRewardTitle: string | null;
  externalRewardCost: number;
  credits: number;
  active: boolean;
}

export interface RewardMappingRow {
  id: string;
  provider: string | null;
  external_reward_id: string;
  external_reward_title: string | null;
  external_reward_cost: number | string | null;
  credits: number | string;
  active: boolean;
}

/** Column list exposing the neutral names; `alias` is the mappings table alias. */
export function rewardMappingColumnsSql(alias = "m"): string {
  return `${alias}.id, COALESCE(${alias}.provider, 'kick') AS provider,
          ${alias}.kick_reward_id AS external_reward_id,
          ${alias}.kick_reward_title AS external_reward_title,
          ${alias}.kick_reward_cost AS external_reward_cost,
          ${alias}.credits, ${alias}.active`;
}

export function toRewardMapping(row: RewardMappingRow): RewardMapping {
  return {
    id: row.id,
    provider: (row.provider || "kick") as ProviderId,
    externalRewardId: row.external_reward_id,
    externalRewardTitle: row.external_reward_title ?? null,
    externalRewardCost: Number(row.external_reward_cost || 0),
    credits: Number(row.credits || 0),
    active: row.active === true,
  };
}

/** Active mapping for a provider reward on a site, or null. */
export async function findActiveRewardMapping(
  run: SqlRunner,
  siteId: string,
  provider: ProviderId,
  externalRewardId: string,
): Promise<RewardMapping | null> {
  const rows = ((await run(
    `SELECT ${rewardMappingColumnsSql("m")}
       FROM credit_reward_mappings m
      WHERE m.site_id = $1
        AND COALESCE(m.provider, 'kick') = $2
        AND m.kick_reward_id = $3
        AND m.active = true
      LIMIT 1`,
    [siteId, provider, externalRewardId],
  )) ?? []) as RewardMappingRow[];
  return rows[0] ? toRewardMapping(rows[0]) : null;
}

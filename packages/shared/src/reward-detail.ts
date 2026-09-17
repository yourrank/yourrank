/**
 * Public reward detail contract (YR-011).
 *
 * The community Rewards catalog and the per-reward detail page render from the
 * same `shop_items` row. This module is the one place that decides which of
 * that row's fields a guest may see and how missing or older data is
 * described, so the page never fabricates a promise the creator did not make.
 *
 * Field map against `shop_items`:
 *  - `id`, `name`, `cost`            exist; required.
 *  - `description`                   exists; optional (older rows are null/empty).
 *  - `stock`                         exists; null means unlimited.
 *  - `cooldown_seconds`              exists; 0/null means no per-member wait.
 *  - `active`, `deleted_at`          exist; drive `availability`.
 *  - `image_key`                     exists but is private storage detail — only
 *                                    the derived `hasImage` boolean is exposed.
 *  - fulfillment                     no field exists. The product rule is that the
 *                                    creator completes every claim by hand, so the
 *                                    contract states that rather than inventing
 *                                    per-reward delivery data.
 *  - eligibility                     not a stored field: membership, balance and
 *                                    cooldown are evaluated per viewer on the
 *                                    server at claim time (`/api/viewer/redeem`).
 *  - creator contact                 not stored on the reward; the community's
 *                                    own Contact page is the support route.
 *
 * Claimant data (redemptions, viewer ids, balances) never enters this shape.
 */

export const REWARD_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type RewardAvailability = 'available' | 'out_of_stock' | 'inactive';

export interface PublicRewardDetail {
  id: string;
  name: string;
  /** Trimmed creator description, or null when the creator has not written one. */
  description: string | null;
  cost: number;
  /** Remaining units, or null when the creator set no limit. */
  stock: number | null;
  /** Per-member wait between claims, in seconds (0 when none). */
  cooldownSeconds: number;
  availability: RewardAvailability;
  hasImage: boolean;
  /** Fixed fulfillment statement — see the module note. */
  fulfillment: string;
}

export interface ShopItemLike {
  id: unknown;
  name?: unknown;
  description?: unknown;
  cost?: unknown;
  stock?: unknown;
  cooldown_seconds?: unknown;
  active?: unknown;
  deleted_at?: unknown;
  has_image?: unknown;
  image_url?: unknown;
  image?: unknown;
  imageUrl?: unknown;
}

export const REWARD_FULFILLMENT = 'The creator completes each claim by hand. Nothing is delivered automatically, and credits have no cash value.';

export function isRewardId(value: unknown): value is string {
  return typeof value === 'string' && REWARD_ID.test(value);
}

function integer(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Whitelist one stored row into the public shape; anything else is dropped. */
export function publicRewardDetail(item: ShopItemLike): PublicRewardDetail {
  const stock = integer(item.stock);
  const deleted = item.deleted_at !== null && item.deleted_at !== undefined;
  const inactive = deleted || item.active === false;
  const description = typeof item.description === 'string' ? item.description.trim() : '';
  return {
    id: String(item.id),
    name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'Reward',
    description: description || null,
    cost: Math.max(0, integer(item.cost) ?? 0),
    stock: stock === null ? null : Math.max(0, stock),
    cooldownSeconds: Math.max(0, integer(item.cooldown_seconds) ?? 0),
    availability: inactive ? 'inactive' : stock !== null && stock <= 0 ? 'out_of_stock' : 'available',
    hasImage: item.has_image === true || !!(item.image_url || item.image || item.imageUrl),
    fulfillment: REWARD_FULFILLMENT,
  };
}

/**
 * Resolve one reward for a community page. `items` must already be scoped to
 * the community (the storage query filters by site), so an id from another
 * community simply is not found — the caller renders the same recovery state
 * as for an unknown id and never reveals that the reward exists elsewhere.
 */
export function findPublicReward(items: readonly ShopItemLike[] | null | undefined, id: unknown): PublicRewardDetail | null {
  if (!isRewardId(id)) return null;
  const item = (items || []).find((entry) => String(entry.id) === id);
  return item ? publicRewardDetail(item) : null;
}

/** Sentence for the "Availability" row; never invents a number the creator did not set. */
export function rewardAvailabilityText(reward: PublicRewardDetail): string {
  if (reward.availability === 'inactive') return 'No longer offered by the creator.';
  if (reward.availability === 'out_of_stock') return 'Out of stock right now.';
  if (reward.stock === null) return 'No claim limit set by the creator.';
  return reward.stock === 1 ? '1 left.' : `${reward.stock.toLocaleString('en-US')} left.`;
}

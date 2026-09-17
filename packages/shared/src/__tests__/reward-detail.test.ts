import { describe, expect, it } from 'bun:test';
import { findPublicReward, isRewardId, publicRewardDetail, REWARD_FULFILLMENT, rewardAvailabilityText } from '../reward-detail.js';

const complete = {
  id: '3f2b9c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b',
  name: '  Discord role  ',
  description: ' Custom role for one month. ',
  cost: '500',
  stock: 3,
  cooldown_seconds: 86400,
  active: true,
  deleted_at: null,
  has_image: true,
  image_key: 'private/storage/key.png',
  site_id: 'site-1',
  created_by: 'creator-9',
};

describe('publicRewardDetail (YR-011)', () => {
  it('whitelists the public fields of a complete reward and drops private storage detail', () => {
    const detail = publicRewardDetail(complete);
    expect(detail).toEqual({
      id: complete.id,
      name: 'Discord role',
      description: 'Custom role for one month.',
      cost: 500,
      stock: 3,
      cooldownSeconds: 86400,
      availability: 'available',
      hasImage: true,
      fulfillment: REWARD_FULFILLMENT,
    });
    expect(JSON.stringify(detail)).not.toContain('private/storage');
    expect(JSON.stringify(detail)).not.toContain('site-1');
    expect(JSON.stringify(detail)).not.toContain('creator-9');
    expect(rewardAvailabilityText(detail)).toBe('3 left.');
  });

  it('describes older or incomplete rows honestly instead of inventing detail', () => {
    const legacy = publicRewardDetail({ id: 'legacy', name: 'Shoutout', cost: 100 });
    expect(legacy.description).toBeNull();
    expect(legacy.stock).toBeNull();
    expect(legacy.cooldownSeconds).toBe(0);
    expect(legacy.hasImage).toBe(false);
    expect(legacy.availability).toBe('available');
    expect(rewardAvailabilityText(legacy)).toBe('No claim limit set by the creator.');

    const blank = publicRewardDetail({ id: 'blank', name: '   ', description: '   ', cost: 'nan', stock: -4 });
    expect(blank.name).toBe('Reward');
    expect(blank.description).toBeNull();
    expect(blank.cost).toBe(0);
    expect(blank.stock).toBe(0);
    expect(blank.availability).toBe('out_of_stock');
  });

  it('flags unavailable rewards from stock, inactive and soft-deleted state', () => {
    expect(publicRewardDetail({ ...complete, stock: 0 }).availability).toBe('out_of_stock');
    expect(rewardAvailabilityText(publicRewardDetail({ ...complete, stock: 0 }))).toBe('Out of stock right now.');
    expect(publicRewardDetail({ ...complete, active: false }).availability).toBe('inactive');
    expect(publicRewardDetail({ ...complete, deleted_at: '2024-01-01T00:00:00Z' }).availability).toBe('inactive');
    expect(rewardAvailabilityText(publicRewardDetail({ ...complete, active: false }))).toBe('No longer offered by the creator.');
    expect(rewardAvailabilityText(publicRewardDetail({ ...complete, stock: 1 }))).toBe('1 left.');
  });

  it('only resolves ids within the given community catalog and rejects malformed ids', () => {
    const catalog = [complete, { id: 'other', name: 'Sticker', cost: 10 }];
    expect(findPublicReward(catalog, complete.id)?.name).toBe('Discord role');
    expect(findPublicReward(catalog, 'other')?.name).toBe('Sticker');
    // A reward that lives in another community is simply absent from this catalog.
    expect(findPublicReward(catalog, 'elsewhere')).toBeNull();
    expect(findPublicReward(catalog, '')).toBeNull();
    expect(findPublicReward(catalog, 'has space')).toBeNull();
    expect(findPublicReward(catalog, 'x'.repeat(65))).toBeNull();
    expect(findPublicReward(null, 'other')).toBeNull();
    expect(isRewardId('a-b_C9')).toBe(true);
    expect(isRewardId('../etc')).toBe(false);
    expect(isRewardId(42)).toBe(false);
  });
});

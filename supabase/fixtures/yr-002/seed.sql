-- YR-002 deterministic local fixtures.
--
-- These rows are deliberately isolated by fixed IDs in the disposable
-- yourrank_yr002_fixtures database. This file never creates provider accounts,
-- sends messages, or performs a redemption; it represents fixture state only.
-- It deliberately refuses any database other than the dedicated local fixture
-- database, even when invoked outside the supplied runner.

DO $$
BEGIN
  IF current_database() <> 'yourrank_yr002_fixtures' THEN
    RAISE EXCEPTION 'YR-002 fixtures refuse database "%"; expected yourrank_yr002_fixtures', current_database();
  END IF;
END
$$;

BEGIN;

-- Remove only this fixture namespace so `seed` is repeatable without touching
-- unrelated local rows. Deleting Viewer rows cascades their memberships,
-- redemptions, and ledger records.
DELETE FROM audit_log
 WHERE entity_type = 'claim'
   AND entity_id IN (
     'redemption:0f200000-0000-4000-8000-000000000001',
     'redemption:0f200000-0000-4000-8000-000000000002',
     'redemption:0f200000-0000-4000-8000-000000000003'
   );
DELETE FROM viewer_sessions
 WHERE viewer_id IN (
   '0c200000-0000-4000-8000-000000000001',
   '0c200000-0000-4000-8000-000000000002',
   '0c200000-0000-4000-8000-000000000003',
   '0c200000-0000-4000-8000-000000000004'
 );
DELETE FROM viewers
 WHERE id IN (
   '0c200000-0000-4000-8000-000000000001',
   '0c200000-0000-4000-8000-000000000002',
   '0c200000-0000-4000-8000-000000000003',
   '0c200000-0000-4000-8000-000000000004'
 );
DELETE FROM sites
 WHERE id IN (
   '0b200000-0000-4000-8000-000000000001',
   '0b200000-0000-4000-8000-000000000002'
 );
DELETE FROM users
 WHERE id = '0a200000-0000-4000-8000-000000000001';

-- One verified, local-only creator owns both fixture communities. No password,
-- provider token, webhook, or external account is present.
INSERT INTO users (id, email, display_name, plan, status, email_verified, created_at, updated_at)
VALUES (
  '0a200000-0000-4000-8000-000000000001',
  'yr002-creator@local.test',
  'YR-002 Fixture Creator',
  'pro',
  'active',
  true,
  '2026-01-01T00:00:00Z',
  '2026-01-01T00:00:00Z'
);

-- Community 1 is populated; community 2 is deliberately an empty catalog.
INSERT INTO sites (
  id, user_id, slug, name, tagline, casino, code, prize_pool, period,
  published, is_draft, shop_enabled, credits_enabled, extra_json, theme_json, updated_at
)
VALUES
  (
    '0b200000-0000-4000-8000-000000000001',
    '0a200000-0000-4000-8000-000000000001',
    'yr002-rewards',
    'YR-002 Community With An Intentionally Long Fixture Name For Layout Validation',
    'Populated deterministic rewards fixtures.',
    'Community', '', '$0', 'Monthly',
    true, false, true, true, '{}'::jsonb, '{}'::jsonb, '2026-01-01T00:00:00Z'
  ),
  (
    '0b200000-0000-4000-8000-000000000002',
    '0a200000-0000-4000-8000-000000000001',
    'yr002-empty',
    'YR-002 Empty Catalog Community',
    'Signed-in membership with no rewards.',
    'Community', '', '$0', 'Monthly',
    true, false, true, true, '{}'::jsonb, '{}'::jsonb, '2026-01-01T00:00:00Z'
  );

-- Three members exercise positive and zero balances across both communities.
-- The fourth Viewer has a global session but intentionally has no membership.
-- Usernames are display-only fixture labels: no provider ID, OAuth token, or
-- provider-linked timestamp is stored because no provider account is available.
INSERT INTO viewers (id, kick_username, is_system, created_at, updated_at)
VALUES
  ('0c200000-0000-4000-8000-000000000001', 'yr002-positive-member', true, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('0c200000-0000-4000-8000-000000000002', 'yr002-zero-member', true, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('0c200000-0000-4000-8000-000000000003', 'yr002-empty-catalog-member', true, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('0c200000-0000-4000-8000-000000000004', 'yr002-signed-in-nonmember', true, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

INSERT INTO site_viewers (id, site_id, viewer_id, balance, total_earned, total_spent, last_seen_at, created_at, updated_at)
VALUES
  ('0d200000-0000-4000-8000-000000000001', '0b200000-0000-4000-8000-000000000001', '0c200000-0000-4000-8000-000000000001', 375, 500, 125, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'),
  ('0d200000-0000-4000-8000-000000000002', '0b200000-0000-4000-8000-000000000001', '0c200000-0000-4000-8000-000000000002', 0, 0, 0, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'),
  ('0d200000-0000-4000-8000-000000000003', '0b200000-0000-4000-8000-000000000002', '0c200000-0000-4000-8000-000000000003', 50, 50, 0, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z');

-- Exactly four rewards. All have image_key NULL to exercise missing-media
-- rendering. The first three are available; the fourth is exhausted.
INSERT INTO shop_items (id, site_id, name, description, cost, stock, active, image_key, cooldown_seconds, created_at, updated_at)
VALUES
  ('0e200000-0000-4000-8000-000000000001', '0b200000-0000-4000-8000-000000000001', 'YR-002 Sticker Pack', 'Available finite-stock reward without media.', 25, 4, true, NULL, 0, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'),
  ('0e200000-0000-4000-8000-000000000002', '0b200000-0000-4000-8000-000000000001', 'YR-002 Reward With An Intentionally Long Name To Verify Wrapping, Unicode-Safe Rendering, And Claim Controls Without Truncation', 'Available finite-stock long-name reward without media.', 100, 1, true, NULL, 0, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'),
  ('0e200000-0000-4000-8000-000000000003', '0b200000-0000-4000-8000-000000000001', 'YR-002 High-Cost Community Spotlight', 'Available unlimited reward; the positive member balance is insufficient.', 500, NULL, true, NULL, 0, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z'),
  ('0e200000-0000-4000-8000-000000000004', '0b200000-0000-4000-8000-000000000001', 'YR-002 Exhausted Reward', 'Active but exhausted reward without media.', 75, 0, true, NULL, 0, '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z');

-- One pending, one fulfilled, and one cancelled claim are preserved as direct,
-- controlled state. Stock and member totals reflect the two non-cancelled
-- spends; the cancelled spend has its matching revoke ledger entry.
INSERT INTO redemptions (id, site_viewer_id, shop_item_id, cost, status, client_token, created_at, updated_at)
VALUES
  ('0f200000-0000-4000-8000-000000000001', '0d200000-0000-4000-8000-000000000001', '0e200000-0000-4000-8000-000000000001', 25, 'pending', 'yr002-pending-claim', '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z'),
  ('0f200000-0000-4000-8000-000000000002', '0d200000-0000-4000-8000-000000000001', '0e200000-0000-4000-8000-000000000002', 100, 'fulfilled', 'yr002-fulfilled-claim', '2026-01-04T00:00:00Z', '2026-01-05T00:00:00Z'),
  ('0f200000-0000-4000-8000-000000000003', '0d200000-0000-4000-8000-000000000001', '0e200000-0000-4000-8000-000000000001', 25, 'cancelled', 'yr002-cancelled-claim', '2026-01-06T00:00:00Z', '2026-01-07T00:00:00Z');

INSERT INTO credit_ledger (id, site_viewer_id, type, amount, description, metadata, created_at)
VALUES
  ('01200000-0000-4000-8000-000000000001', '0d200000-0000-4000-8000-000000000001', 'earn', 500, 'YR-002 fixture credit grant', '{}'::jsonb, '2026-01-02T00:00:00Z'),
  ('01200000-0000-4000-8000-000000000002', '0d200000-0000-4000-8000-000000000001', 'spend', 25, 'Claimed: YR-002 Sticker Pack', '{"redemption_id":"0f200000-0000-4000-8000-000000000001"}'::jsonb, '2026-01-03T00:00:00Z'),
  ('01200000-0000-4000-8000-000000000003', '0d200000-0000-4000-8000-000000000001', 'spend', 100, 'Claimed: YR-002 long-name reward', '{"redemption_id":"0f200000-0000-4000-8000-000000000002"}'::jsonb, '2026-01-04T00:00:00Z'),
  ('01200000-0000-4000-8000-000000000004', '0d200000-0000-4000-8000-000000000001', 'spend', 25, 'Claimed then cancelled: YR-002 Sticker Pack', '{"redemption_id":"0f200000-0000-4000-8000-000000000003"}'::jsonb, '2026-01-06T00:00:00Z'),
  ('01200000-0000-4000-8000-000000000005', '0d200000-0000-4000-8000-000000000001', 'revoke', 25, 'Cancelled redemption refund', '{"redemption_id":"0f200000-0000-4000-8000-000000000003"}'::jsonb, '2026-01-07T00:00:00Z'),
  ('01200000-0000-4000-8000-000000000006', '0d200000-0000-4000-8000-000000000003', 'earn', 50, 'YR-002 empty-catalog membership grant', '{}'::jsonb, '2026-01-02T00:00:00Z');

-- Terminal claim timestamps are owned by audit_log, not redemptions.updated_at.
INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, details, created_at)
VALUES
  (920000000001, '0a200000-0000-4000-8000-000000000001', 'claim_completed', 'claim', 'redemption:0f200000-0000-4000-8000-000000000002', '{"site_id":"0b200000-0000-4000-8000-000000000001","source":"redemptions","source_id":"0f200000-0000-4000-8000-000000000002","status":"fulfilled"}'::jsonb, '2026-01-05T00:00:00Z'),
  (920000000002, '0a200000-0000-4000-8000-000000000001', 'claim_cancelled', 'claim', 'redemption:0f200000-0000-4000-8000-000000000003', '{"site_id":"0b200000-0000-4000-8000-000000000001","source":"redemptions","source_id":"0f200000-0000-4000-8000-000000000003","status":"cancelled"}'::jsonb, '2026-01-07T00:00:00Z');

-- This is a known, local-only test credential, not an external provider token.
-- Raw cookie value: yr002-local-nonmember-session
INSERT INTO viewer_sessions (token, viewer_id, authority, site_id, hostname, domain_binding_id, created_at, expires_at)
VALUES (
  '9bc7c7d7045548e7a89af79b33f4729cb1052075a4bc06c3d6003c3934093668',
  '0c200000-0000-4000-8000-000000000004',
  'global', NULL, NULL, NULL, '2026-01-01T00:00:00Z', '2099-01-01T00:00:00Z'
);

COMMIT;

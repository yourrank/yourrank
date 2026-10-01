-- YourRank seed data — matches current schema (Jul 7 2026).
-- Idempotent: uses ON CONFLICT DO NOTHING everywhere.
-- Run: supabase db seed  (or psql $DATABASE_URL -f seed.sql)

BEGIN;

-- ── Users ────────────────────────────────────────────────────────────────
-- password_hash/salt are bcrypt placeholders (password = "test1234")
INSERT INTO users (id, email, password_hash, password_salt, plan, status, is_admin, display_name, postback_key, has_trial)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'admin@example.com',
   '$2b$10$rQEY5z5d5z5d5z5d5z5d5OKpKpKpKpKpKpKpKpKpKpKpKpKpKpK', 'salt1',
   'pro', 'active', true, 'Admin', 'pk-admin-001', false),
  ('a0000000-0000-0000-0000-000000000002', 'owner@example.com',
   '$2b$10$rQEY5z5d5z5d5z5d5z5d5OKpKpKpKpKpKpKpKpKpKpKpKpKpKpK', 'salt2',
   'pro', 'active', false, 'Owner User', 'pk-owner-002', false),
  ('a0000000-0000-0000-0000-000000000003', 'free@example.com',
   '$2b$10$rQEY5z5d5z5d5z5d5z5d5OKpKpKpKpKpKpKpKpKpKpKpKpKpKpK', 'salt3',
   'free', 'active', false, 'Free User', 'pk-free-003', false),
  ('a0000000-0000-0000-0000-000000000004', 'tguser@example.com',
   NULL, NULL,
   'starter', 'active', false, 'Telegram User', NULL, false)
ON CONFLICT (id) DO NOTHING;

-- ── Sites ────────────────────────────────────────────────────────────────
INSERT INTO sites (id, user_id, slug, name, tagline, casino, code, prize_pool, period, published, extra_json, theme_json)
VALUES
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002',
   'testboard', 'Test Leaderboard', 'Community standings for streamers', 'Acme', 'WELCOME',
   '$10,000', 'monthly', true,
   '{"chips":["Community Rewards","Built for Streamers"]}'::jsonb,
   '{"template":"classic","accentColor":"#c8ff00"}'::jsonb),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003',
   'freeboard', 'Free Board', 'Starter board', 'Northstar', 'COMMUNITY',
   '$1,000', 'weekly', true,
   '{}'::jsonb,
   '{"template":"midnight"}'::jsonb),
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004',
   'starterboard', 'Starter Board', 'Telegram-connected', 'Brightside', 'PARTNER',
   '$5,000', 'monthly', true,
   '{}'::jsonb,
   '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ── Players ──────────────────────────────────────────────────────────────
INSERT INTO players (id, site_id, name, wagered, prize, sort)
VALUES
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'StreamChampion', 152000, 1500, 1),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'CommunityBuilder', 98000, 700, 2),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'TeamPlayer', 61250, 500, 3),
  ('c0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000001', 'RegularViewer', 45000, 250, 4),
  ('c0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000001', 'NewMember', 32000, 0, 5),
  ('c0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000002', 'FreeGamer', 5000, 100, 1),
  ('c0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-000000000002', 'NewbiePlayer', 2000, 50, 2)
ON CONFLICT (id) DO NOTHING;

-- ── Bots ─────────────────────────────────────────────────────────────────
-- token_encrypted is AES-256-GCM encrypted; these are placeholders
INSERT INTO bots (id, owner_id, username, tg_bot_id, token_encrypted, token_hint, webhook_secret, status)
VALUES
  ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002',
   'testboard_bot', 8239038922, 'encrypted_placeholder', 'ABC...xyz', 'whsec_test123', 'active'),
  ('d0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000004',
   'starter_bot', 9999999999, 'encrypted_placeholder2', 'DEF...uvw', 'whsec_starter456', 'active')
ON CONFLICT (id) DO NOTHING;

-- ── Subscriptions ────────────────────────────────────────────────────────
INSERT INTO subscriptions (id, user_id, plan, status, provider, current_period_end)
VALUES
  ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002',
   'pro', 'active', 'nowpayments', '2026-08-07T00:00:00Z'),
  ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000004',
   'starter', 'active', 'nowpayments', '2026-08-07T00:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- ── Payments ─────────────────────────────────────────────────────────────
INSERT INTO payments (id, user_id, provider, amount, currency, status, tx_ref, plan_tier)
VALUES
  ('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002',
   'nowpayments', 29, 'USD', 'finished', 'tx_seed_001', 'pro'),
  ('f0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000004',
   'nowpayments', 12, 'USD', 'finished', 'tx_seed_002', 'starter')
ON CONFLICT (id) DO NOTHING;

-- ── Leads ────────────────────────────────────────────────────────────────
INSERT INTO leads (id, handle, casino, contact, note)
VALUES
  ('10000000-0000-0000-0000-000000000001', 'streamer_42', 'Acme', 'tg:@streamer_42', 'Creator interested in Pro'),
  ('10000000-0000-0000-0000-000000000002', 'community_creator', 'Northstar', 'email:fan@example.com', 'Community account')
ON CONFLICT (id) DO NOTHING;

-- ── Partners ──────────────────────────────────────────────────────────────
INSERT INTO casinos (id, name, slug, website_url, is_global, created_by)
VALUES
  ('11500000-0000-0000-0000-000000000001', 'Acme', 'acme', 'https://example.com/acme', true, 'a0000000-0000-0000-0000-000000000002'),
  ('11500000-0000-0000-0000-000000000002', 'Northstar', 'northstar', 'https://example.com/northstar', true, 'a0000000-0000-0000-0000-000000000002'),
  ('11500000-0000-0000-0000-000000000003', 'Brightside', 'brightside', 'https://example.com/brightside', true, 'a0000000-0000-0000-0000-000000000004')
ON CONFLICT (id) DO NOTHING;

-- ── Offers ───────────────────────────────────────────────────────────────
INSERT INTO offers (id, owner_id, casino_id, label, referral_url, bonus_text, promo_code, is_active)
VALUES
  ('11000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002',
   '11500000-0000-0000-0000-000000000001', 'Welcome offer', 'https://example.com/acme/welcome', 'A welcome offer for your community', 'WELCOME', true),
  ('11000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002',
   '11500000-0000-0000-0000-000000000002', 'Community offer', 'https://example.com/northstar/community', 'A thank-you for your community', 'COMMUNITY', true)
ON CONFLICT (id) DO NOTHING;

-- ── Short Links ──────────────────────────────────────────────────────────
INSERT INTO short_links (id, offer_id, slug, source)
VALUES
  ('12000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'welcome-offer', 'telegram'),
  ('12000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000002', 'community-offer', 'twitter')
ON CONFLICT (id) DO NOTHING;

-- ── Clicks ───────────────────────────────────────────────────────────────
INSERT INTO clicks (short_link_id, ip_hash, click_ref, is_unique, ts)
VALUES
  ('12000000-0000-0000-0000-000000000001', decode('aabbccdd', 'hex'), 'ref_001', true, now()),
  ('12000000-0000-0000-0000-000000000001', decode('eeff0011', 'hex'), 'ref_002', true, now()),
  ('12000000-0000-0000-0000-000000000002', decode('22334455', 'hex'), 'ref_003', true, now());

-- ── Conversions ──────────────────────────────────────────────────────────
INSERT INTO conversions (id, owner_id, offer_id, click_ref, event, amount, currency)
VALUES
  ('14000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002',
   '11000000-0000-0000-0000-000000000001', 'ref_001', 'conversion', 50, 'USD')
ON CONFLICT (id) DO NOTHING;

-- ── Bot Subscribers ──────────────────────────────────────────────────────
INSERT INTO bot_subscribers (id, bot_id, tg_user_id, tg_username, first_name, language, is_blocked)
VALUES
  ('15000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 6037437861, 'sm_dev', 'SM', 'en', false),
  ('15000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001', 1111111111, 'test_user', 'Test', 'en', false)
ON CONFLICT (id) DO NOTHING;

-- ── Player Subscriptions ─────────────────────────────────────────────────
INSERT INTO player_subscriptions (id, bot_id, site_id, tg_user_id, player_name)
VALUES
  ('16000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001', 6037437861, 'StreamChampion')
ON CONFLICT (id) DO NOTHING;

-- ── Archives ─────────────────────────────────────────────────────────────
INSERT INTO archives (id, site_id, label, snapshot_json)
VALUES
  ('17000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001',
   'June 2026', '{"players":[{"name":"OldKing","wagered":100000,"prize":1000}]}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ── Site Stats ───────────────────────────────────────────────────────────
INSERT INTO site_stats (site_id, day, views, clicks, copies)
VALUES
  ('b0000000-0000-0000-0000-000000000001', current_date, 42, 15, 3),
  ('b0000000-0000-0000-0000-000000000001', current_date - 1, 38, 12, 1),
  ('b0000000-0000-0000-0000-000000000002', current_date, 10, 4, 0)
ON CONFLICT (site_id, day) DO NOTHING;

-- ── Bot Commands ─────────────────────────────────────────────────────────
INSERT INTO bot_commands (id, bot_id, command, response, is_enabled)
VALUES
  ('18000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
   '/welcome', 'Use code WELCOME for a welcome offer from Acme.', true)
ON CONFLICT (id) DO NOTHING;

-- ── Admin Audit ──────────────────────────────────────────────────────────
INSERT INTO admin_audit (admin_id, action, details)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'seed', '{"message":"Seed data loaded"}'::jsonb);

COMMIT;

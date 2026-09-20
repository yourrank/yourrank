-- yourrank:migration-phase: expand
--
-- Truthful provider event-delivery health on the verified community channel.
-- `chat_events_subscribed_at` (chat giveaways) already records whether the
-- `chat.message.sent` webhook subscription exists; reward redemption events
-- and the time of the last subscription reconciliation were not recorded, so
-- an OAuth authorization with a failed reward subscription still looked
-- healthy. Additive only: two nullable columns.

ALTER TABLE public.community_channels
  ADD COLUMN IF NOT EXISTS reward_events_subscribed_at timestamptz,
  ADD COLUMN IF NOT EXISTS event_subscriptions_checked_at timestamptz;

COMMENT ON COLUMN public.community_channels.reward_events_subscribed_at IS
  'When the provider reward-redemption webhook subscription was last confirmed for this channel; NULL when the last check found it missing.';
COMMENT ON COLUMN public.community_channels.event_subscriptions_checked_at IS
  'When YourRank last reconciled webhook subscriptions for this channel (OAuth callback or delivery repair). NULL means never verified.';

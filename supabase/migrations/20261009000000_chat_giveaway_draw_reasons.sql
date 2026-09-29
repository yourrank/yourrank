-- Draw history for chat giveaways: record why each draw happened and which
-- entrant it replaced so the dashboard can show a re-roll trail.
ALTER TABLE public.chat_giveaway_draws
  ADD COLUMN reason text NOT NULL DEFAULT 'draw'
    CONSTRAINT chat_giveaway_draws_reason_check CHECK (reason IN ('draw', 'reroll', 'auto_reroll')),
  ADD COLUMN replaced_entry_id uuid REFERENCES public.chat_giveaway_entries(id) ON DELETE SET NULL;

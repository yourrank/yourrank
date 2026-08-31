-- Wave K: narrow, durable automation for the proven free code-drop Activity.
-- Templates are inert configuration. Schedules snapshot that configuration.

CREATE TABLE IF NOT EXISTS public.activity_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind = 'safe_code_drop'),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  config JSONB NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_templates_site_updated
  ON public.activity_templates(site_id, updated_at DESC, id);

CREATE TABLE IF NOT EXISTS public.activity_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.activity_templates(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind = 'safe_code_drop'),
  template_name_snapshot TEXT NOT NULL CHECK (char_length(template_name_snapshot) BETWEEN 1 AND 80),
  config_snapshot JSONB NOT NULL CHECK (jsonb_typeof(config_snapshot) = 'object'),
  recurrence TEXT NOT NULL DEFAULT 'once' CHECK (recurrence IN ('once', 'daily', 'weekly')),
  next_run_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'paused', 'completed', 'cancelled', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  last_run_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_schedules_due
  ON public.activity_schedules(next_run_at, id)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_activity_schedules_site_created
  ON public.activity_schedules(site_id, created_at DESC, id);

CREATE TABLE IF NOT EXISTS public.activity_schedule_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES public.activity_schedules(id) ON DELETE CASCADE,
  occurrence_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('retrying', 'succeeded', 'failed', 'stale')),
  failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  UNIQUE (schedule_id, occurrence_at)
);

CREATE INDEX IF NOT EXISTS idx_activity_schedule_occurrences_schedule
  ON public.activity_schedule_occurrences(schedule_id, occurrence_at DESC);

ALTER TABLE public.code_drops
  ADD COLUMN IF NOT EXISTS automation_occurrence_id UUID
  REFERENCES public.activity_schedule_occurrences(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_code_drops_automation_occurrence
  ON public.code_drops(automation_occurrence_id)
  WHERE automation_occurrence_id IS NOT NULL;

COMMENT ON TABLE public.activity_templates IS
  'Selected-site reusable configuration for explicitly allowlisted safe Activities; templates never execute.';
COMMENT ON TABLE public.activity_schedules IS
  'Durable UTC schedule rows whose validated template configuration is snapshotted at creation.';
COMMENT ON TABLE public.activity_schedule_occurrences IS
  'Durable idempotency boundary: one schedule and intended UTC occurrence can create at most one Activity.';

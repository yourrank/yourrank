-- yourrank:migration-phase: expand
--
-- Community banner/cover image, owned by Community → Appearance. Mirrors the
-- existing logo row strategy: one base64 data URI (PNG/JPEG/WebP) per site,
-- stored on the sites row, validated by decoded magic bytes before write and
-- again before it is served at /banner/:slug. Additive only; an empty banner
-- keeps the existing abstract hero treatment, so old code and new code both
-- read every row safely.

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS banner_data text DEFAULT ''::text NOT NULL;

COMMENT ON COLUMN public.sites.banner_data IS
  'Base64 data URI (PNG/JPEG/WebP) for the community cover banner. Empty string means no banner; served at /banner/:slug.';

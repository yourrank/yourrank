-- Phase 6 correction: shop item image persistence was implemented by storing
-- validated base64 data URIs in Postgres. This was not a production media
-- storage solution, so the column is being removed and image uploads are
-- disabled until a proper object/media store (e.g. R2/S3) is integrated.
ALTER TABLE public.shop_items DROP COLUMN IF EXISTS image_url;

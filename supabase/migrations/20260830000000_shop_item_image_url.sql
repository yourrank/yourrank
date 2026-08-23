-- Phase 6 A1: persist validated shop item images.
-- The dashboard uploads a base64 data URI; the handler validates it with
-- validateLogoData and stores it here until an object-store migration.
ALTER TABLE public.shop_items ADD COLUMN IF NOT EXISTS image_url text;

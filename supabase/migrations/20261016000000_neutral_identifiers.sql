-- yourrank:migration-phase: expand

ALTER TABLE public.players ADD COLUMN amount numeric(15,2);

CREATE FUNCTION public.sync_players_amount_legacy() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.amount IS NULL THEN
      NEW.amount := NEW.wagered;
    ELSE
      NEW.wagered := NEW.amount;
    END IF;
  ELSE
    IF NEW.amount IS DISTINCT FROM OLD.amount THEN
      NEW.wagered := NEW.amount;
    ELSIF NEW.wagered IS DISTINCT FROM OLD.wagered THEN
      NEW.amount := NEW.wagered;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER players_sync_amount_legacy
BEFORE INSERT OR UPDATE ON public.players
FOR EACH ROW EXECUTE FUNCTION public.sync_players_amount_legacy();

UPDATE public.players SET amount = wagered WHERE amount IS NULL;

CREATE INDEX IF NOT EXISTS idx_players_site_amount
  ON public.players (site_id, amount DESC);

ALTER TABLE public.sites ADD COLUMN sponsor text;

CREATE FUNCTION public.sync_sites_sponsor_legacy() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.sponsor IS NULL THEN
      NEW.sponsor := NEW.casino;
    ELSE
      NEW.casino := NEW.sponsor;
    END IF;
  ELSE
    IF NEW.sponsor IS DISTINCT FROM OLD.sponsor THEN
      NEW.casino := NEW.sponsor;
    ELSIF NEW.casino IS DISTINCT FROM OLD.casino THEN
      NEW.sponsor := NEW.casino;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sites_sync_sponsor_legacy
BEFORE INSERT OR UPDATE ON public.sites
FOR EACH ROW EXECUTE FUNCTION public.sync_sites_sponsor_legacy();

UPDATE public.sites SET sponsor = casino WHERE sponsor IS NULL;

ALTER TABLE public.leads ADD COLUMN brand text;

CREATE FUNCTION public.sync_leads_brand_legacy() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.brand IS NULL THEN
      NEW.brand := NEW.casino;
    ELSE
      NEW.casino := NEW.brand;
    END IF;
  ELSE
    IF NEW.brand IS DISTINCT FROM OLD.brand THEN
      NEW.casino := NEW.brand;
    ELSIF NEW.casino IS DISTINCT FROM OLD.casino THEN
      NEW.brand := NEW.casino;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER leads_sync_brand_legacy
BEFORE INSERT OR UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.sync_leads_brand_legacy();

UPDATE public.leads SET brand = casino WHERE brand IS NULL;

ALTER TABLE public.offers ADD COLUMN partner_id uuid;

CREATE FUNCTION public.sync_offers_partner_id_legacy() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.partner_id IS NULL THEN
      NEW.partner_id := NEW.casino_id;
    ELSE
      NEW.casino_id := NEW.partner_id;
    END IF;
  ELSE
    IF NEW.partner_id IS DISTINCT FROM OLD.partner_id THEN
      NEW.casino_id := NEW.partner_id;
    ELSIF NEW.casino_id IS DISTINCT FROM OLD.casino_id THEN
      NEW.partner_id := NEW.casino_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER offers_sync_partner_id_legacy
BEFORE INSERT OR UPDATE ON public.offers
FOR EACH ROW EXECUTE FUNCTION public.sync_offers_partner_id_legacy();

UPDATE public.offers SET partner_id = casino_id WHERE partner_id IS NULL;

CREATE VIEW public.partners WITH (security_invoker = true) AS
SELECT * FROM public.casinos;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT ALL ON TABLE public.partners TO service_role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'yourrank_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.partners TO yourrank_app';
  END IF;
END
$$;

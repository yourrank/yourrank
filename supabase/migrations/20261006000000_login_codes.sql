-- yourrank:migration-phase: expand

-- Passwordless creator sign-in: a short-lived 6-digit code emailed to the
-- account address. Mirrors password_resets: only the SHA-256 of
-- "<email>:<code>" is stored, never the code itself.
--
-- RLS + the yourrank_app policy must ship in a later contract-phase
-- migration; the expand-phase preflight rejects ENABLE ROW LEVEL SECURITY
-- here (same pattern as provider_webhook_receipts and api_idempotency_keys).
CREATE TABLE IF NOT EXISTS public.login_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      public.citext NOT NULL,
  code_hash  text NOT NULL,
  attempts   integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_codes_email ON public.login_codes(email);

-- yourrank:migration-phase: expand

-- Passwordless creator sign-in: a short-lived 6-digit code emailed to the
-- account address. Mirrors password_resets: only the SHA-256 of
-- "<email>:<code>" is stored, never the code itself.
CREATE TABLE IF NOT EXISTS public.login_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      public.citext NOT NULL,
  code_hash  text NOT NULL,
  attempts   integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_codes_email ON public.login_codes(email);

-- Server-only table: browser/public Supabase roles must never see a row.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'login_codes'
          AND policyname = 'service_role_all_login_codes'
    ) THEN
        CREATE POLICY "service_role_all_login_codes" ON public.login_codes
         FOR ALL
         TO service_role
         USING (true)
         WITH CHECK (true);
    END IF;
END $$;

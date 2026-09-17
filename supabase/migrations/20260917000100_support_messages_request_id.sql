-- yourrank:migration-phase: expand
-- Client-generated request id so a retried support submission (timeout after
-- the server already stored it) is delivered once. Older rows keep NULL.
-- Deduplication is enforced by the insert statement in handlers/contact.js;
-- a unique index is a contract-phase change and is deliberately not added here.
ALTER TABLE public.support_messages
  ADD COLUMN IF NOT EXISTS request_id text;

CREATE INDEX IF NOT EXISTS idx_support_messages_request_id
  ON public.support_messages(request_id)
  WHERE request_id IS NOT NULL;

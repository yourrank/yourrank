-- yourrank:migration-phase: expand
--
-- C01/F01 expand phase: establish every required backend EXECUTE grant before
-- a later contract release removes PostgreSQL's implicit PUBLIC path. This is
-- additive and N-1 compatible: it does not revoke any current caller.

GRANT EXECUTE ON FUNCTION public.place_bet(uuid, uuid, text, integer, jsonb, text)
  TO yourrank_app, service_role;
GRANT EXECUTE ON FUNCTION public.set_round_outcome(uuid, jsonb)
  TO yourrank_app, service_role;
GRANT EXECUTE ON FUNCTION public.settle_round(uuid, numeric, integer, jsonb)
  TO yourrank_app, service_role;
GRANT EXECUTE ON FUNCTION app_private.ensure_clicks_partition(date)
  TO yourrank_app;

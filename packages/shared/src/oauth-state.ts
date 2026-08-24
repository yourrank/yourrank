import { withTransaction as defaultWithTransaction, type Tx } from "./db.js";
import { fromJsonb } from "./jsonb.js";

export const OAUTH_STATE_TTL_SECONDS = 600;

export interface OAuthStateDependencies {
  withTransaction?: typeof defaultWithTransaction;
  ttlSeconds?: number;
}

function normalizedPayload(payload: unknown): unknown {
  return payload ?? {};
}

export async function storeOAuthState(
  provider: string,
  state: string,
  payload: unknown,
  { withTransaction = defaultWithTransaction, ttlSeconds = OAUTH_STATE_TTL_SECONDS }: OAuthStateDependencies = {},
): Promise<void> {
  const normalizedProvider = String(provider || "").trim();
  const normalizedState = String(state || "").trim();
  if (!normalizedProvider || !normalizedState) {
    throw new Error("OAuth state requires a provider and state.");
  }

  const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? Math.floor(ttlSeconds) : OAUTH_STATE_TTL_SECONDS;
  await withTransaction(async (tx: Tx) => {
    await tx.unsafe("DELETE FROM public.oauth_states WHERE expires_at <= now()");
    await tx.unsafe(
      `INSERT INTO public.oauth_states (state, provider, payload, created_at, expires_at)
       VALUES ($1, $2, $3::jsonb, now(), now() + ($4 * interval '1 second'))
       ON CONFLICT (state) DO UPDATE
         SET provider = EXCLUDED.provider,
             payload = EXCLUDED.payload,
             created_at = EXCLUDED.created_at,
             expires_at = EXCLUDED.expires_at`,
      [normalizedState, normalizedProvider, normalizedPayload(payload), ttl],
    );
  });
}

export async function consumeOAuthState(
  provider: string,
  state: string,
  { withTransaction = defaultWithTransaction }: OAuthStateDependencies = {},
): Promise<Record<string, unknown> | null> {
  const normalizedProvider = String(provider || "").trim();
  const normalizedState = String(state || "").trim();
  if (!normalizedProvider || !normalizedState) return null;

  const rows = await withTransaction((tx: Tx) => tx.unsafe(
    `DELETE FROM public.oauth_states
      WHERE state=$1
        AND provider=$2
        AND expires_at > now()
      RETURNING payload`,
    [normalizedState, normalizedProvider],
  ));
  const row = rows?.[0] as { payload?: unknown } | undefined;
  if (!row) return null;
  try {
    const payload = fromJsonb<Record<string, unknown>>(row.payload);
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

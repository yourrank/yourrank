// ------------------------------------------------------------------
// Immutable provider event ledger.
//
// Every provider callback (NOWPayments IPN, Telegram Stars successful_payment,
// etc.) is recorded once. The unique key prevents duplicate/reordered
// callbacks from being reprocessed, and the row is never updated or deleted.
// ------------------------------------------------------------------

export interface ProviderEventTx {
  query: (text: string, params?: unknown[]) => Promise<unknown[]>;
}

export interface ProviderEventInput {
  provider: string;
  provider_reference: string;
  event_kind: string;
  status?: string | null;
  tx_ref?: string | null;
  payload_json?: unknown;
}

/**
 * Append a provider event to the ledger.
 * @returns true when a new row was inserted, false when the same callback
 *          has already been recorded (unique conflict).
 */
export async function logProviderEvent(
  tx: ProviderEventTx,
  input: ProviderEventInput
): Promise<boolean> {
  const rows = await tx.query(
    `INSERT INTO provider_events (provider, provider_reference, event_kind, status, tx_ref, payload_json)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (provider, provider_reference, event_kind, status) DO NOTHING
     RETURNING id`,
    [
      input.provider,
      input.provider_reference,
      input.event_kind,
      input.status ?? null,
      input.tx_ref ?? null,
      input.payload_json ?? {},
    ]
  );
  return Array.isArray(rows) && rows.length > 0;
}

// Provider-neutral view over a viewer row's linked identities. Reads the legacy
// `kick_*` / `discord_*` columns today; switching to `viewer_identities` later
// only changes this module (docs/PROVIDER_PORTABILITY_PLAN.md).
import type { ProviderId } from "./providers/types.js";

export interface ViewerIdentityRow {
  kick_user_id?: string | null;
  kick_username?: string | null;
  kick_linked_at?: string | Date | null;
  discord_user_id?: string | null;
  discord_username?: string | null;
  discord_linked_at?: string | Date | null;
}

export interface LinkedViewerIdentity {
  provider: ProviderId;
  label: string;
  externalUserId: string | null;
  username: string | null;
  linkedAt: string | Date | null;
}

/** Display priority: Kick first, then Discord (matches current product behavior). */
const IDENTITY_ORDER: readonly { provider: ProviderId; label: string; prefix: "kick" | "discord" }[] = [
  { provider: "kick", label: "Kick", prefix: "kick" },
  { provider: "discord", label: "Discord", prefix: "discord" },
];

export function linkedViewerIdentities(row: ViewerIdentityRow | null | undefined): LinkedViewerIdentity[] {
  if (!row) return [];
  const out: LinkedViewerIdentity[] = [];
  for (const { provider, label, prefix } of IDENTITY_ORDER) {
    const linkedAt = row[`${prefix}_linked_at`] ?? null;
    if (!linkedAt) continue;
    out.push({
      provider,
      label,
      externalUserId: row[`${prefix}_user_id`] ?? null,
      username: row[`${prefix}_username`] || null,
      linkedAt,
    });
  }
  return out;
}

/** First non-empty provider username, else `fallback`. */
export function viewerDisplayName(row: ViewerIdentityRow | null | undefined, fallback = "Member"): string {
  return row?.kick_username || row?.discord_username || fallback;
}

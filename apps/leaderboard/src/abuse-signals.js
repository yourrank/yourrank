// Phase 1 of the anti-abuse "smart account linking" system: silent signal
// collection only. Raw IPs and raw fingerprint components are never persisted
// or logged — only keyed HMACs land in the database. Recording runs after the
// action's main work commits and must never make the viewer's action fail.
import { isIP } from "node:net";
import { query } from "@yourrank/shared/db";

// WHATWG URL canonicalizes equivalent IPv6 spellings; shared with
// giveaway-verification's giveawayIpHash so both hash the same value.
export function normalizeClientIp(raw) {
  if (!raw || !isIP(raw)) return null;
  return isIP(raw) === 6 ? new URL(`http://[${raw}]/`).hostname : raw;
}

const hex = (buffer) => Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");

export async function abuseSignalHash(value, env) {
  const secret = env?.ABUSE_SIGNAL_HMAC_KEY;
  if (!value || !secret) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

export async function recordAbuseSignals({ run = query, env, request, viewerId, siteId, action }) {
  if (!env?.ABUSE_SIGNAL_HMAC_KEY) {
    console.error("[abuse-signals] ABUSE_SIGNAL_HMAC_KEY not configured; signals not recorded");
    return;
  }
  const writes = [];
  const ip = normalizeClientIp(request.headers.get("cf-connecting-ip"));
  if (ip) writes.push({ kind: "ip", value: ip });
  else console.warn("[abuse-signals] missing or invalid client IP for", action);
  const device = request.headers.get("x-yr-device");
  if (device && /^[a-f0-9]{64}$/.test(device)) writes.push({ kind: "device", value: device });
  else if (device) console.warn("[abuse-signals] invalid device hash", action);
  // A missing device header is normal (old client or no JS) — skip silently.
  try {
    for (const { kind, value } of writes) {
      const hash = await abuseSignalHash(value, env);
      if (!hash) continue;
      if (kind === "ip") {
        await run("INSERT INTO ip_observations (ip_hash, viewer_id, site_id, action) VALUES ($1,$2,$3,$4)", [hash, viewerId, siteId, action]);
      } else {
        await run(`INSERT INTO device_links (device_hash, viewer_id, site_id) VALUES ($1,$2,$3)
          ON CONFLICT (site_id, device_hash, viewer_id) DO UPDATE SET last_seen = now(), seen_count = device_links.seen_count + 1`, [hash, viewerId, siteId]);
      }
    }
  } catch (err) {
    // Deliberate: signal collection is best-effort and must never fail the
    // viewer's action. The failure is logged, never swallowed.
    console.error("[abuse-signals] record failed:", action, String(err?.message || err));
  }
}

export async function cleanupIpObservations({ run = query } = {}) {
  const rows = await run(`DELETE FROM ip_observations WHERE id IN
    (SELECT id FROM ip_observations WHERE observed_at < now() - interval '30 days' LIMIT 5000)`, []);
  return rows;
}

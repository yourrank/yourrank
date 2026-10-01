// Platform identity (legal company details + public disclosures).
// Cached per-isolate; reloads when the admin updates it.
import { one, exec } from "@yourrank/shared/db";

const CACHE_TTL_MS = 60_000;
let cache = null;
let cachedAt = 0;

export function getPlatformIdentity() {
  return cache;
}

export async function loadPlatformIdentity(_env) {
  const now = Date.now();
  if (cache && now - cachedAt < CACHE_TTL_MS) return cache;
  try {
    const row = await one("SELECT company_name, company_country, company_number, support_email, affiliate_disclosure, updated_at FROM platform_identity WHERE id=1");
    cache = row || {
      company_name: "",
      company_country: "",
      company_number: "",
      support_email: "contact@yourrank.site",
      affiliate_disclosure: "Some links and offers on this site are affiliate links. We may earn a commission if you sign up or make a purchase through them, at no extra cost to you.",
      updated_at: new Date().toISOString(),
    };
    cachedAt = now;
    return cache;
  } catch (e) {
    console.error("[platform-identity] load failed:", String(e?.message || e));
    cache = cache || {
      company_name: "",
      company_country: "",
      company_number: "",
      support_email: "contact@yourrank.site",
      affiliate_disclosure: "Some links and offers on this site are affiliate links. We may earn a commission if you sign up or make a purchase through them, at no extra cost to you.",
      updated_at: new Date().toISOString(),
    };
    cachedAt = now;
    return cache;
  }
}

export function setPlatformIdentity(identity) {
  cache = { ...cache, ...identity, updated_at: new Date().toISOString() };
  cachedAt = Date.now();
}

export function invalidatePlatformIdentity() {
  cachedAt = 0;
  cache = null;
}

export async function updatePlatformIdentity(_env, values, _adminId, _request) {
  const {
    company_name = "",
    company_country = "",
    company_number = "",
    support_email = "",
    affiliate_disclosure = "",
  } = values || {};

  const cleanedEmail = String(support_email || "").trim().toLowerCase() || "contact@yourrank.site";

  await exec(
    `INSERT INTO platform_identity (id, company_name, company_country, company_number, support_email, affiliate_disclosure, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, now())
     ON CONFLICT (id) DO UPDATE
     SET company_name = EXCLUDED.company_name,
         company_country = EXCLUDED.company_country,
         company_number = EXCLUDED.company_number,
         support_email = EXCLUDED.support_email,
         affiliate_disclosure = EXCLUDED.affiliate_disclosure,
         updated_at = now()`,
    [
      String(company_name || "").trim(),
      String(company_country || "").trim(),
      String(company_number || "").trim(),
      cleanedEmail,
      String(affiliate_disclosure || "").trim(),
    ]
  );

  const row = await one("SELECT company_name, company_country, company_number, support_email, affiliate_disclosure, updated_at FROM platform_identity WHERE id=1");
  setPlatformIdentity(row);
  return row;
}

export function isIdentityComplete(identity) {
  if (!identity) return false;
  return !!(identity.company_name?.trim() && identity.company_country?.trim());
}

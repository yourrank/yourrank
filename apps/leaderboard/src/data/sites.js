// Data access layer for site operations
import { one } from "@yourrank/shared/db";

export async function findSiteLogoData(slug) {
  return await one("SELECT logo_data FROM sites WHERE slug=$1", [slug]);
}

export async function findSiteBannerData(slug) {
  return await one("SELECT banner_data FROM sites WHERE slug=$1", [slug]);
}

export async function findSiteStatus(slug) {
  return await one("SELECT s.slug, s.published, (u.status = 'suspended') AS suspended FROM sites s LEFT JOIN users u ON u.id = s.user_id WHERE s.slug=$1", [slug]);
}

export async function findUserTotpSecret(userId) {
  return await one("SELECT totp_secret, totp_pending_secret, totp_pending_at, totp_enabled_at, totp_locked_until FROM users WHERE id=$1", [userId]);
}
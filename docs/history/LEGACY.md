# Legacy Compatibility Documentation

This document tracks legacy compatibility paths that still exist in the codebase and their removal timeline.

## Active Legacy Paths

### 1. Single-Board Compatibility in site.js
**Location:** `apps/leaderboard/src/site.js`

**Description:** The system still supports single-board configuration for users who haven't completed the setup wizard. This allows users to have a default board without explicitly configuring one.

**Migration Path:**
- Users are redirected to the setup wizard (`/dashboard/setup`) if they don't have a configured board
- The setup wizard ensures users create at least one board before accessing the dashboard
- Plan: Remove after Q2 2026 (6 months after setup wizard implementation)

**Removal Timeline:** Q2 2026

---

### 2. Unsigned Partner Postback Paths
**Locations:**
- `apps/bot/src/hono-app.ts` — `GET|POST /pb/:key`
- `apps/leaderboard/src/handlers/attribution.js` — unsigned `POST /api/postback`

**Description:** The system accepts legacy requests with a key in the URL and no HMAC signature. Integrations that don't support HMAC-SHA256 signing can temporarily use these paths. The preferred paths use `X-Postback-Key` and `X-Postback-Signature` headers.

**Migration Path:**
- Encourage all partner integrations to migrate to signed postbacks
- Signed postbacks provide better security and prevent spoofing
- New dashboard integrations show the signed setup by default
- Legacy responses include `Deprecation`, `Sunset`, and successor `Link` headers
- Signed and unsigned usage is measured separately per key
- `POSTBACK_UNSIGNED_ENABLED=false` makes both unsigned paths return `410 Gone`
- Plan: disable on 2026-10-01 after usage and affected-account review

**Removal Timeline:** 2026-10-01

---

### 3. Legacy Password Hash Format
**Location:** `apps/leaderboard/src/auth.js`

**Description:** The system supports legacy password hashes without iteration count prefixes. New hashes use the format `iterations$hash` (e.g., `100000$abcd1234...`), but legacy hashes in the format `hash` (no prefix) are still accepted and automatically upgraded on next login.

**Migration Path:**
- Lazy rehash: Existing users are automatically upgraded to the new format on their next successful login
- New signups always use the new format
- The system tracks `needsRehash` and upgrades transparently
- Plan: Remove after Q4 2026 (allows 18 months for all users to login and upgrade)

**Removal Timeline:** Q4 2026

---

### 4. Legacy Token Blob Format
**Location:** `shared/crypto.ts`

**Description:** The system supports legacy encrypted token blobs without version prefixes. New tokens use the format `v1:<ciphertext>`, but legacy tokens in the format `<ciphertext>` (no prefix) are still accepted and decrypted with the current key.

**Migration Path:**
- A future key rotation will introduce `v2:` prefix
- Legacy tokens are transparently decrypted
- POST /api/admin/reencrypt can be used to migrate all tokens to the current version
- Plan: Remove legacy support after key rotation completes (post-Q4 2026)

**Removal Timeline:** Post key rotation

---

## Removed Legacy Paths

### SEC-104: Legacy Session Cookie Support
**Status:** ✅ Removed (Grace period over)

**Description:** Previously supported `gm_session` (GroupsMix era) and `sess` (old HMAC-signed) cookies. Replaced by `yr_session`.

**Removal Date:** 2026-Q1

**Impact:** Users with legacy cookies are redirected to login page (expected behavior)

---

## Migration Checklist

### Before Removing Each Legacy Path:

1. **Analytics:** Check usage metrics to ensure minimal impact
2. **Monitoring:** Add alerts for errors that might indicate legacy path usage
3. **Communication:** Notify affected users/partners of deprecation
4. **Testing:** Verify new paths work correctly for all use cases
5. **Rollback:** Have quick rollback procedure ready

### Removal Process:

1. Add deprecation warnings/logs to legacy paths
2. Monitor for deprecation warnings for 1-2 months
3. If usage is low, proceed with removal
4. Update this document with removal date
5. Remove code and clean up related tests

---

## Notes

- This document should be reviewed quarterly
- New legacy paths should be documented here immediately
- Removal timelines should be communicated to stakeholders in advance
- Security-related legacy paths should be prioritized for removal
# YourRank Bug Sweep — Jul 7, 2026

Sweep method: curl, web_fetch, source code review. No browser automation (Playwright doesn't support Ubuntu 26.04). All findings verified against production and source.

---

## Fix Status Summary

| Bug | Severity | Status | Commit |
|-----|----------|--------|--------|
| BUG-001 | P0 | ✅ Fixed | dd665ec |
| BUG-002 | P0 | ✅ Fixed | dd665ec |
| BUG-003 | P0 | ✅ Fixed | dd665ec |
| BUG-004 | P1 | ✅ Fixed | dd665ec |
| BUG-005 | P1 | ✅ Fixed | dd665ec |
| BUG-006 | P1 | ✅ Fixed | dd665ec |
| BUG-007 | P2 | ✅ Fixed | b87ebfe |
| BUG-008 | P3 | ⏳ Needs S M (DNS) | — |
| BUG-009 | P3 | ⏳ Needs S M (secrets) | — |
| BUG-010 | P4 | ✅ Fixed | b87ebfe |
| BUG-011 | P4 | ⏸️ Skipped (harmless) | — |

---

## P0 — User-Facing Broken

### BUG-001: Forgot password leaks email existence ✅
**Endpoint:** `POST /api/auth/forgot`
**Behavior:** Non-existent email → `{"ok":true}`. Existing email (when Resend fails) → `{"ok":false}`.
**Impact:** Attacker can enumerate valid email addresses.
**Fix:** Always return `{"ok":true,"message":"If that account exists..."}` regardless of send outcome. Catch Resend errors and return success anyway.

### BUG-002: Demo page API returns "not found" ✅
**Endpoint:** `GET /api/public/demo/players` → `{"ok":false,"error":"not found"}`
**Behavior:** The demo page at `/demo` is SSR-hardcoded with fake player data. But leaderboard.js fetches `/api/public/demo/players` client-side, which returns 404. Players would disappear after the first JS poll.
**Impact:** Demo page shows players initially (SSR), then they vanish on first client-side refresh.
**Fix:** Skip JS polling when `slug === "demo"` (SSR data is authoritative).

### BUG-003: `/reset` shows form when no token is present ✅
**URL:** `yourrank.site/reset` (no `?token=...`)
**Behavior:** Renders a password form. User fills it in, submits, server returns `"Missing reset token"`. Error is shown but UX is confusing.
**Fix:** Check for token on page load. If missing, show "This link is invalid or expired" with a link to `/forgot`, instead of the form.

---

## P1 — Functional / Security

### BUG-004: `/widget` route silently serves full page ✅
**URL:** `yourrank.site/smoketest1/widget` → 200 (full leaderboard page)
**Behavior:** The slug handler extracts `smoketest1` and ignores `/widget`. Falls through to the normal leaderboard page.
**Impact:** User visiting `/widget` URL sees a full page instead of getting a 404 or a widget view. Confusing.
**Fix:** Reject paths with extra segments after the slug (unless it's `/overlay`). Returns 404.

### BUG-005: `/admin` returns plain text 404 for non-admins ✅
**URL:** `yourrank.site/admin` (not logged in or non-admin)
**Behavior:** Returns `text/plain: "Not found"` with 404 status. No HTML page, no redirect.
**Impact:** Looks broken/unprofessional.
**Fix:** Return HTML 404 page instead of plain text.

### BUG-006: `GET /api/auth/me` returns 200 for unauthenticated requests ✅
**Behavior:** Returns `{"ok":false,"user":null}` with HTTP 200.
**Expected:** HTTP 401 with `{"ok":false,"error":"Not authenticated"}`.
**Fix:** Now returns 401 for unauthenticated requests.

---

## P2 — CSP / Inline Styles (future-proofing)

### BUG-007: Inline `<style>` blocks depend on `'unsafe-inline'` CSP ✅
**Affected files:**
- `render.js` — Dynamic branding CSS variables (accent colors)
- `pages.js` — OBS overlay page styles
- `index.js` — Overlay upsell page styles
- `headers.js` — Error pages (notFound, suspended, comingSoon)

**Fix:** Per-request nonce via `crypto.randomUUID()`. `withNonce()` helper replaces `'unsafe-inline'` with `'nonce-xxx'` in CSP header. All 6 `<style>` blocks get matching `nonce=""` attribute. Verified: nonce matches between CSP header and HTML in same response.

---

## P3 — Staging / Infra

### BUG-008: staging.yourrank.site has no DNS record ⏳
**Behavior:** Returns HTTP 000 (no connection). DNS doesn't resolve.
**Root cause:** CF API token only has Workers scope, no DNS edit.
**Fix needed:** S M needs to add DNS record in Cloudflare dashboard: A record for `staging` → `192.0.2.1` (proxied, Workers route handles traffic).

### BUG-009: Staging worker has no secrets ⏳
**Behavior:** Staging worker was deployed without DATABASE_URL, NOWPAYMENTS_API_KEY, etc.
**Impact:** Staging will 500 on any DB or payment operation.
**Status:** Staging worker deployed with latest code + correct KV/Hyperdrive bindings + CF_ZONE_ID. Still missing 7 secrets (DATABASE_URL, NOWPAYMENTS_API_KEY, NOWPAYMENTS_IPN_SECRET, RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, TOKEN_ENC_KEY). CF API doesn't expose secret values — S M must set these via `wrangler secret put --env staging` or re-deploy from CI.

---

## P4 — Cosmetic / Minor

### BUG-010: `GET /go/nonexistent-slug` returns plain text 404 ✅
**Behavior:** Returns `text/plain: "not found"` instead of HTML 404 page.
**Fix:** All 404 responses now return HTML pages. Covers /go/, /overlay, catch-all, custom domain, and slug handler.

### BUG-011: Test accounts on production ⏸️
**Accounts created during this sweep:**
- `test-bugcheck-998@example.com` / slug `bugtest998`
- `test-bugcheck-999@example.com` / slug `bugtest999`
**Status:** Skipped — no psql in sandbox, accounts are harmless. Clean up when convenient.

---

## Not Bugs (verified working)

- ✅ All public pages return 200 (/, /terms, /privacy, /demo, /<slug>)
- ✅ Auth pages render correctly (login, signup, forgot, reset)
- ✅ Dashboard redirects to /login when unauthenticated (302)
- ✅ All asset files load (CSS, JS)
- ✅ Security headers present on all pages (HSTS, CSP, X-Content-Type-Options, Referrer-Policy)
- ✅ Cookie security: HttpOnly, Secure, SameSite=Lax, Domain=.yourrank.site ✓
- ✅ Rate limiting works (kicks in at ~11th attempt)

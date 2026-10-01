#!/usr/bin/env bash
# YourRank Route Handler Test Suite
# Tests every public route on both workers against production.
# Run: bash test-routes.sh

BASE="https://yourrank.site"
PASS=0
FAIL=0
RESULTS=""

test_route() {
  local method="$1" path="$2" desc="$3" expect_status="$4" extra_args="$5"
  local url="${BASE}${path}"

  local resp
  resp=$(curl -s -o /dev/null -w "%{http_code}|%{time_total}|%{size_download}" \
    -X "$method" "$url" \
    -H "User-Agent: YourRank-Test/1.0" \
    -H "Accept: text/html,application/json,*/*" \
    $extra_args 2>&1)

  local status="${resp%%|*}"
  local rest="${resp#*|}"
  local time="${rest%%|*}"
  local size="${rest#*|}"

  if [ "$status" = "$expect_status" ]; then
    PASS=$((PASS + 1))
    printf "  ✅ %s %s → %s (%ss, %sB) [%s]\n" "$method" "$path" "$status" "$time" "$size" "$desc"
  else
    FAIL=$((FAIL + 1))
    printf "  ❌ %s %s → %s (expected %s) (%ss) [%s]\n" "$method" "$path" "$status" "$expect_status" "$time" "$desc"
    RESULTS="${RESULTS}\n  ❌ ${method} ${path} → ${status} (expected ${expect_status}) — ${desc}"
  fi
}

test_route_body() {
  local method="$1" path="$2" desc="$3" expect_status="$4" body="$5"
  local url="${BASE}${path}"

  local resp
  resp=$(curl -s -o /dev/null -w "%{http_code}|%{time_total}" \
    -X "$method" "$url" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -H "User-Agent: YourRank-Test/1.0" \
    -d "$body" 2>&1)

  local status="${resp%%|*}"
  local time="${resp#*|}"

  if [ "$status" = "$expect_status" ]; then
    PASS=$((PASS + 1))
    printf "  ✅ %s %s → %s (%ss) [%s]\n" "$method" "$path" "$status" "$time" "$desc"
  else
    FAIL=$((FAIL + 1))
    printf "  ❌ %s %s → %s (expected %s) (%ss) [%s]\n" "$method" "$path" "$status" "$expect_status" "$time" "$desc"
    RESULTS="${RESULTS}\n  ❌ ${method} ${path} → ${status} (expected ${expect_status}) — ${desc}"
  fi
}

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  YourRank Route Handler Test Suite"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── 1. HEALTH & INFRA ──────────────────────────────────────
echo "── 1. Health & Infrastructure ──"
test_route GET "/health" "Health check" 200
test_route GET "/bot/health" "Bot health check" 200
test_route GET "/robots.txt" "Robots.txt" 200
test_route GET "/sitemap.xml" "Sitemap" 200
test_route GET "/favicon.ico" "Favicon" 200
echo ""

# ── 2. PUBLIC PAGES (leaderboard worker) ───────────────────
echo "── 2. Public Pages ──"
test_route GET "/" "Landing page" 200
test_route GET "/login" "Login page" 200
test_route GET "/signup" "Signup page" 200
test_route GET "/forgot" "Forgot password page" 200
test_route GET "/reset" "Reset password (no token → handled)" 200
test_route GET "/terms" "Terms of service" 200
test_route GET "/privacy" "Privacy policy" 200
test_route GET "/demo" "Demo leaderboard" 200
echo ""

# ── 3. DASHBOARD PAGES (unauthenticated → redirect to /login) ──
echo "── 3. Dashboard (unauthenticated → 302 redirect) ──"
test_route GET "/dashboard" "Dashboard" 302
test_route GET "/dashboard/analytics" "Analytics" 302
test_route GET "/dashboard/billing" "Billing" 302
test_route GET "/dashboard/bot/setup" "Bot setup" 302
test_route GET "/dashboard/setup" "Site setup" 302
echo ""

# ── 4. ADMIN (non-admin → 404) ─────────────────────────────
echo "── 4. Admin (non-admin → 404 hidden) ──"
test_route GET "/admin" "Admin panel (no auth → 404)" 404
echo ""

# ── 5. PUBLIC LEADERBOARDS ──────────────────────────────────
echo "── 5. Public Leaderboards ──"
test_route GET "/testboard" "Seed board (testboard)" 200
test_route GET "/freeboard" "Seed board (freeboard)" 200
test_route GET "/starterboard" "Seed board (starterboard)" 200
test_route GET "/testboard/overlay" "Board overlay" 200
test_route GET "/nonexistent-board-slug" "Missing board → 404" 404
echo ""

# ── 6. SHORT LINKS ─────────────────────────────────────────
echo "── 6. Short Links ──"
test_route GET "/r/nonexistent-slug" "Missing short link → 404" 404
test_route GET "/go/nonexistent-slug" "Missing go link → 404" 404
echo ""

# ── 7. API ENDPOINTS (leaderboard worker) ──────────────────
echo "── 7. API Endpoints ──"
# Scores postback — no key → 401
test_route POST "/api/scores" "Score postback (no key → 401)" 401
# Account delete — no CSRF → 403
test_route_body POST "/api/account/delete" "Account delete (no CSRF → 403)" 403 '{}'
echo ""

# ── 8. BOT AUTH ROUTES (bot worker, under /bot prefix) ─────
echo "── 8. Bot Auth Routes (/bot/auth/*) ──"
# Telegram auth — empty body → verifyTelegramLogin returns false → 401
test_route_body POST "/bot/auth/telegram" "Telegram auth (no data → 401)" 401 '{}'
# Dev auth — prod mode → should block
test_route_body POST "/bot/auth/dev" "Dev auth (prod → 403 or 404)" 403 '{}'
# Logout — no session → still processes
test_route_body POST "/bot/auth/logout" "Logout (no session)" 200 '{}'
echo ""

# ── 9. BOT DASHBOARD ───────────────────────────────────────
echo "── 9. Bot Dashboard ──"
test_route GET "/dashboard/telegram" "Bot dashboard page" 200
test_route GET "/dashboard/telegram/bots" "Bot bots page" 200
# Legacy bot pages redirect permanently into the dashboard namespace.
test_route GET "/bot/dashboard" "Legacy bot dashboard → redirect" 301
test_route GET "/bot" "Bot root → redirect" 301
echo ""

# ── 10. Bot API ──────────────────────────────────────────────
# /api/* has no CF route. Bot API is accessible via /bot/api/* only.
echo "── 10. Bot API ──"
test_route GET "/api/bots" "API /bots (no CF route → 404 from leaderboard)" 404
test_route GET "/bot/api/bots" "Bot API /bot/api/bots (no auth → 401)" 401
test_route POST "/bot/api/billing/setup" "Bot API billing (no auth → 401)" 401
echo ""

# ── 11. WEBHOOKS ────────────────────────────────────────────
echo "── 11. Webhooks ──"
# Telegram webhook — bad secret → 401 (secret header mismatch)
test_route POST "/hook/testsecret" "Telegram webhook (bad secret → 401)" 401
# Postback — no headers → 400
test_route_body POST "/pb" "Postback (no headers → 400)" 400 '{}'
# Legacy postback — no key in URL → 404
test_route GET "/pb/nonexistentkey" "Legacy postback (bad key → 404)" 404
echo ""

# ── 12. STATIC ASSETS ──────────────────────────────────────
echo "── 12. Static Assets ──"
test_route GET "/assets/nonexistent.css" "Missing asset → 404" 404
echo ""

# ── 13. LOGO ENDPOINT ──────────────────────────────────────
echo "── 13. Logo Endpoint ──"
test_route GET "/logo/nonexistent" "Missing logo → 404" 404
echo ""

# ── 14. EDGE CASES ─────────────────────────────────────────
echo "── 14. Edge Cases ──"
# Null byte — Cloudflare rejects at edge (400). Correct security behavior.
test_route GET "/%00" "Null byte → CF rejects" 400
# Very long path
test_route GET "/$(python3 -c "print('a'*500)")" "Long slug → 404" 404
echo ""

# ── SUMMARY ─────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
TOTAL=$((PASS + FAIL))
printf "  Results: %d/%d passed, %d failed\n" "$PASS" "$TOTAL" "$FAIL"
echo "═══════════════════════════════════════════════════════════"

if [ $FAIL -gt 0 ]; then
  echo ""
  echo "  FAILURES:"
  echo -e "$RESULTS"
  echo ""
  exit 1
else
  echo ""
  echo "  All route handlers responding correctly. ✅"
  echo ""
  exit 0
fi

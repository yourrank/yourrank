// ============================================================
// RLS Cross-Tenant Isolation Test (Phase 4.2)
//
// Verifies that the anon key CANNOT read or write any data
// from any table. Only service_role should have access.
//
// This test catches RLS policy regressions: if any policy is
// loosened, this test fails.
//
// Run: SUPABASE_URL=... SUPABASE_ANON_KEY=... bun test packages/shared/src/__tests__/rls-isolation.test.ts
// ============================================================

import { describe, it, expect } from "bun:test";

const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Skip if credentials not available
const hasCredentials = SUPABASE_URL && ANON_KEY;

const TABLES = [
  "users",
  "sites",
  "players",
  "leads",
  "archives",
  "site_stats",
  "bots",
  "bot_subscribers",
  "bot_commands",
  "offers",
  "partners",
  "short_links",
  "clicks",
  "click_daily",
  "conversions",
  "stream_channels",
  "broadcasts",
  "subscriptions",
  "payments",
];

async function supabaseQuery(
  table: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>
): Promise<{ status: number; data: unknown; error: unknown }> {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`;
  const headers: Record<string, string> = {
    apikey: ANON_KEY!,
    Authorization: `Bearer ${ANON_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  const res = await fetch(url, {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(body || {}) : undefined,
  });

  const data = await res.json().catch(() => null);
  return { status: res.status, data, error: data?.message || data };
}

describe.skipIf(!hasCredentials)("RLS cross-tenant isolation", () => {
  for (const table of TABLES) {
    it(`anon key cannot SELECT from ${table}`, async () => {
      const result = await supabaseQuery(table, "GET");

      // Anon key should either:
      // - Get 401/403 (unauthorized)
      // - Get empty array (RLS filters all rows)
      // - Never get actual data
      if (result.status === 200) {
        // If 200, must be empty array (no rows visible via RLS)
        expect(Array.isArray(result.data)).toBe(true);
        expect((result.data as unknown[]).length).toBe(0);
      } else {
        // 401 or 403 is expected
        expect([401, 403]).toContain(result.status);
      }
    });

    it(`anon key cannot INSERT into ${table}`, async () => {
      const result = await supabaseQuery(table, "POST", {
        id: "00000000-0000-0000-0000-000000000000",
      });

      // Should get 401/403 or 404
      expect([401, 403, 404]).toContain(result.status);
    });
  }
});

describe.skipIf(!hasCredentials)(
  "RLS isolation — no cross-tenant data leak",
  () => {
    it("anon key gets zero rows from sites table", async () => {
      const result = await supabaseQuery("sites", "GET");
      if (result.status === 200) {
        expect(result.data).toEqual([]);
      }
    });

    it("anon key gets zero rows from users table", async () => {
      const result = await supabaseQuery("users", "GET");
      if (result.status === 200) {
        expect(result.data).toEqual([]);
      }
    });

    it("anon key gets zero rows from payments table", async () => {
      const result = await supabaseQuery("payments", "GET");
      if (result.status === 200) {
        expect(result.data).toEqual([]);
      }
    });

    it("anon key gets zero rows from conversions table", async () => {
      const result = await supabaseQuery("conversions", "GET");
      if (result.status === 200) {
        expect(result.data).toEqual([]);
      }
    });
  }
);

// ============================================================================
//  Nightly click rollup and partition maintenance against a real Postgres.
//
//  These tests need the migrated schema, so they self-skip when
//  ROLLUP_TEST_DATABASE_URL is not set.
//
//  Locally:
//    ROLLUP_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:5432/yourrank_test \
//      bun test apps/bot/src/__tests__/rollup-postgres.test.ts
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import postgres from "postgres";

const DB_URL = process.env.ROLLUP_TEST_DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;
const sql = DB_URL ? postgres(DB_URL, { max: 5, onnotice: () => {} }) : (null as never);

let rollupClicks: () => Promise<void>;
let ensureNextMonthPartition: () => Promise<void>;
let ensureCurrentMonthPartition: () => Promise<void>;

if (DB_URL) {
  process.env.DATABASE_URL = DB_URL;
  ({ rollupClicks, ensureNextMonthPartition, ensureCurrentMonthPartition } = await import("../rollup.js"));
}

type Fixture = {
  userId: string;
  partnerId: string;
  offerId: string;
  linkIds: string[];
};

let sequence = 0;

async function createFixture(linkCount = 2): Promise<Fixture> {
  const suffix = `${Date.now()}-${sequence++}`;
  const [user] = await sql`
    INSERT INTO users (email, status, email_verified)
    VALUES (${`rollup-${suffix}@test.local`}, 'active', true)
    RETURNING id`;
  const [partner] = await sql`
    INSERT INTO partners (slug, name, created_by)
    VALUES (${`rollup-${suffix}`}, 'Rollup Test Sponsor', ${user.id})
    RETURNING id`;
  const [offer] = await sql`
    INSERT INTO offers (owner_id, partner_id, label, referral_url)
    VALUES (${user.id}, ${partner.id}, 'Rollup Test Offer', 'https://example.test')
    RETURNING id`;
  const links = await Promise.all(
    Array.from({ length: linkCount }, (_, index) => sql`
      INSERT INTO short_links (offer_id, slug, source)
      VALUES (${offer.id}, ${`rollup-${suffix}-${index}`}, 'test')
      RETURNING id
    `)
  );
  return {
    userId: user.id,
    partnerId: partner.id,
    offerId: offer.id,
    linkIds: links.map(([link]) => link.id),
  };
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  await sql`DELETE FROM users WHERE id = ${fixture.userId}`;
}

async function withFixture<T>(
  callback: (fixture: Fixture) => Promise<T>,
  linkCount = 2,
): Promise<T> {
  const fixture = await createFixture(linkCount);
  try {
    return await callback(fixture);
  } finally {
    await cleanupFixture(fixture);
  }
}

function nextMonthUtc(): { year: number; month: number; from: string; to: string; name: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  return {
    year: from.getUTCFullYear(),
    month: from.getUTCMonth() + 1,
    from: iso(from),
    to: iso(to),
    name: `clicks_${from.getUTCFullYear()}_${String(from.getUTCMonth() + 1).padStart(2, "0")}`,
  };
}

describeDb("rollupClicks against Postgres", () => {
  beforeAll(async () => {
    await sql`SELECT 1`;
  });

  afterAll(async () => {
    await sql.end({ timeout: 0 });
  });

  it("aggregates the last seven complete days by link and day", async () => {
    await withFixture(async ({ linkIds: [first, second] }) => {
      const [days] = await sql`
        SELECT
          (CURRENT_DATE - 7)::text AS d7,
          (CURRENT_DATE - 4)::text AS d4,
          (CURRENT_DATE - 1)::text AS d1`;
      await sql`
        INSERT INTO clicks (short_link_id, ts, is_unique)
        VALUES
          (${first}, CURRENT_DATE - 1 + interval '2 hours', true),
          (${first}, CURRENT_DATE - 1 + interval '3 hours', true),
          (${first}, CURRENT_DATE - 1 + interval '4 hours', false),
          (${first}, CURRENT_DATE - 7 + interval '2 hours', false),
          (${second}, CURRENT_DATE - 1 + interval '5 hours', true),
          (${second}, CURRENT_DATE - 1 + interval '6 hours', false),
          (${second}, CURRENT_DATE - 4 + interval '2 hours', true)`;

      await rollupClicks();

      const rows = await sql`
        SELECT day::text, short_link_id::text, clicks, unique_clicks
         FROM click_daily
         WHERE short_link_id IN (${first}, ${second})
         ORDER BY day, short_link_id`;
      const expected = [
        { day: days.d7, short_link_id: first, clicks: 1, unique_clicks: 0 },
        { day: days.d4, short_link_id: second, clicks: 1, unique_clicks: 1 },
        { day: days.d1, short_link_id: first, clicks: 3, unique_clicks: 2 },
        { day: days.d1, short_link_id: second, clicks: 2, unique_clicks: 1 },
      ].sort((a, b) =>
        a.day.localeCompare(b.day) || a.short_link_id.localeCompare(b.short_link_id)
      );
      expect(rows.map(({ day, short_link_id, clicks, unique_clicks }) => ({
        day,
        short_link_id,
        clicks,
        unique_clicks,
      }))).toEqual(expected);
    });
  });

  it("excludes today's raw clicks from click_daily", async () => {
    await withFixture(async ({ linkIds: [link] }) => {
      await sql`
        INSERT INTO clicks (short_link_id, ts, is_unique)
        VALUES (${link}, CURRENT_DATE + interval '2 hours', true)`;

      await rollupClicks();

      const rows = await sql`
        SELECT * FROM click_daily
         WHERE short_link_id = ${link} AND day = CURRENT_DATE`;
      expect(rows).toHaveLength(0);
    });
  });

  it("is idempotent when run twice", async () => {
    await withFixture(async ({ linkIds: [link] }) => {
      await sql`
        INSERT INTO clicks (short_link_id, ts, is_unique)
        VALUES
          (${link}, CURRENT_DATE - 2 + interval '2 hours', true),
          (${link}, CURRENT_DATE - 2 + interval '3 hours', false)`;

      await rollupClicks();
      const first = await sql`
        SELECT day::text, short_link_id::text, clicks, unique_clicks
          FROM click_daily WHERE short_link_id = ${link}`;
      await rollupClicks();
      const second = await sql`
        SELECT day::text, short_link_id::text, clicks, unique_clicks
          FROM click_daily WHERE short_link_id = ${link}`;
      expect(second).toEqual(first);
    });
  });

  it("overwrites a deliberately wrong aggregate with recomputed values", async () => {
    await withFixture(async ({ linkIds: [link] }) => {
      await sql`
        INSERT INTO click_daily (day, short_link_id, clicks, unique_clicks)
        VALUES (CURRENT_DATE - 3, ${link}, 99, 88)`;
      await sql`
        INSERT INTO clicks (short_link_id, ts, is_unique)
        VALUES
          (${link}, CURRENT_DATE - 3 + interval '2 hours', true),
          (${link}, CURRENT_DATE - 3 + interval '3 hours', false)`;

      await rollupClicks();

      const [row] = await sql`
        SELECT clicks, unique_clicks
          FROM click_daily
         WHERE day = CURRENT_DATE - 3 AND short_link_id = ${link}`;
      expect(row).toEqual({ clicks: 2, unique_clicks: 1 });
    });
  });

  it("keeps the 90-day daily boundary and removes older rows and raw clicks", async () => {
    await withFixture(async ({ linkIds: [link] }) => {
      const [boundary] = await sql`
        SELECT (CURRENT_DATE - 90)::text AS day`;
      await sql`
        INSERT INTO click_daily (day, short_link_id, clicks, unique_clicks)
        VALUES
          (CURRENT_DATE - 90, ${link}, 7, 6),
          (CURRENT_DATE - 91, ${link}, 8, 7)`;
      await sql`
        INSERT INTO clicks (short_link_id, ts, is_unique)
        VALUES
          (${link}, now() - interval '90 days' + interval '1 minute', true),
          (${link}, now() - interval '90 days' - interval '1 minute', true)`;

      await rollupClicks();

      const daily = await sql`
        SELECT day::text FROM click_daily
         WHERE short_link_id = ${link}
         ORDER BY day`;
      expect(daily.map(({ day }) => day)).toEqual([boundary.day]);
      const raw = await sql`
        SELECT count(*)::int AS count,
               bool_and(ts >= now() - interval '90 days') AS inside_window
          FROM clicks
         WHERE short_link_id = ${link}`;
      expect(raw[0].count).toBe(1);
      expect(raw[0].inside_window).toBe(true);
    });
  });

  it("ensures next month's partition has correct bounds and receives inserts", async () => {
    await withFixture(async ({ linkIds: [link] }) => {
      const next = nextMonthUtc();
      await ensureNextMonthPartition();

      const [partition] = await sql`
        SELECT pg_get_expr(c.relpartbound, c.oid) AS bound
          FROM pg_class c
         WHERE c.oid = ${next.name}::regclass`;
      expect(partition.bound).toContain(`FROM ('${next.from} 00:00:00+00')`);
      expect(partition.bound).toContain(`TO ('${next.to} 00:00:00+00')`);

      await sql.unsafe(
        `INSERT INTO clicks (short_link_id, ts, is_unique)
         VALUES ('${link}', '${next.from} 12:00:00+00', true)`
      );
      const [row] = await sql`
        SELECT tableoid::regclass::text AS partition
          FROM clicks
         WHERE short_link_id = ${link}`;
      expect(row.partition).toBe(next.name);
    });
  });

  it("does not duplicate the next month's partition on a second call", async () => {
    const next = nextMonthUtc();
    await ensureNextMonthPartition();
    await ensureNextMonthPartition();
    const rows = await sql`
      SELECT count(*)::int AS count
        FROM pg_inherits
       WHERE inhparent = 'clicks'::regclass
         AND inhrelid::regclass::text = ${next.name}`;
    expect(rows[0].count).toBe(1);
  });

  it("drops old click partitions while retaining current and next month", async () => {
    await withFixture(async ({ linkIds: [link] }) => {
      const now = new Date();
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
      const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 4, 1));
      const iso = (date: Date) => date.toISOString().slice(0, 10);
      const oldName = `clicks_${from.getUTCFullYear()}_${String(from.getUTCMonth() + 1).padStart(2, "0")}`;
      await sql.unsafe(
        `CREATE TABLE IF NOT EXISTS ${oldName} PARTITION OF clicks
         FOR VALUES FROM ('${iso(from)}') TO ('${iso(to)}')`
      );
      await sql.unsafe(
        `INSERT INTO clicks (short_link_id, ts, is_unique)
         VALUES ('${link}', '${iso(from)} 12:00:00+00', true)`
      );

      await ensureCurrentMonthPartition();
      await rollupClicks();

      const [oldPartition] = await sql`
        SELECT to_regclass(${oldName}) AS name`;
      const [currentPartition] = await sql`
        SELECT to_regclass(${"clicks_" + now.getUTCFullYear() + "_" + String(now.getUTCMonth() + 1).padStart(2, "0")}) AS name`;
      const [nextPartition] = await sql`
        SELECT to_regclass(${nextMonthUtc().name}) AS name`;
      expect(oldPartition.name).toBeNull();
      expect(currentPartition.name).not.toBeNull();
      expect(nextPartition.name).not.toBeNull();
    });
  });
});

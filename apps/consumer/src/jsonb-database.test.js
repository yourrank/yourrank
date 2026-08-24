// Database-backed proof that the consumer's jsonb writers store objects rather
// than JSON strings. The static contract test in packages/shared can only see
// the source text; this one runs the real writer against a migrated Postgres and
// asks the database what it actually stored.
//
// Requires a migrated database:
//   JSONB_TEST_DATABASE_URL=postgres://... bun test src/jsonb-database.test.js
// Without it the suite reports itself as skipped — it never reports as passed.
import { describe, expect, it } from "bun:test";
import { handleDlq } from "./worker.js";

const JSONB_TEST_DATABASE_URL = process.env.JSONB_TEST_DATABASE_URL;
const describeDb = JSONB_TEST_DATABASE_URL ? describe : describe.skip;

describeDb("consumer jsonb writers (database-backed)", () => {
  process.env.DATABASE_URL = JSONB_TEST_DATABASE_URL;

  async function withDb(fn) {
    const { query, exec } = await import("@yourrank/shared/db");
    return fn({ query, exec });
  }

  it("stores queue_dlq_events.body as a jsonb object, not a JSON string", async () => {
    await withDb(async ({ query, exec }) => {
      const messageId = `jsonb-contract-${crypto.randomUUID()}`;
      const body = { type: "bump", siteId: "site-1", field: "views", timestamp: 1 };
      const msg = { id: messageId, body, ack() {}, retry() { throw new Error("dlq persistence failed"); } };

      try {
        await handleDlq({ queue: "events-dlq", messages: [msg] }, {}, undefined, { alertImpl: async () => {} });

        const [row] = await query(
          `SELECT jsonb_typeof(body) AS kind, body->>'siteId' AS site_id
             FROM queue_dlq_events WHERE message_id = $1`,
          [messageId],
        );
        expect(row?.kind).toBe("object");
        // A double-encoded row cannot be indexed, so this read is the regression
        // the encoding bug actually caused.
        expect(row?.site_id).toBe("site-1");
      } finally {
        await exec("DELETE FROM queue_dlq_events WHERE message_id = $1", [messageId]);
      }
    });
  });

  it("shows the failure mode a pre-serialised binding produces", async () => {
    await withDb(async ({ query, exec }) => {
      const messageId = `jsonb-contract-pre-${crypto.randomUUID()}`;
      const body = { type: "bump", siteId: "site-1" };
      try {
        await exec(
          `INSERT INTO queue_dlq_events (message_id, queue_name, event_type, body)
           VALUES ($1, $2, $3, $4::jsonb)`,
          [messageId, "events-dlq", "bump", JSON.stringify(body)],
        );
        const [row] = await query(
          `SELECT jsonb_typeof(body) AS kind, body->>'siteId' AS site_id
             FROM queue_dlq_events WHERE message_id = $1`,
          [messageId],
        );
        expect(row?.kind).toBe("string");
        expect(row?.site_id).toBeNull();
      } finally {
        await exec("DELETE FROM queue_dlq_events WHERE message_id = $1", [messageId]);
      }
    });
  });
});

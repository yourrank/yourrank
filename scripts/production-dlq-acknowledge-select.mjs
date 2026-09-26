// One-time guard for the Production DLQ Acknowledge workflow. Selects the
// actionable ids to acknowledge ONLY when every actionable row matches the
// inspected backlog profile exactly: pending + unresolved, event_type
// 'notify', Top-3 notify shape, and valid under the current parseQueueMessage.
// Any deviation refuses with a sanitized counts-only error — ids are only
// ever written to stdout JSON, never to stderr or thrown messages.

import { readFileSync } from "node:fs";
import { parseQueueMessage } from "../packages/shared/dist/queue-producer.js";
import { isTop3Notify } from "./lib/dlq-inspect-shared.mjs";

const schemaValid = (row) => {
  try {
    parseQueueMessage(row.body);
    return true;
  } catch {
    return false;
  }
};

export function selectAcknowledgeIds(page, expectedActionable) {
  const rows = Array.isArray(page?.rows) ? page.rows : [];
  const expected = Number(expectedActionable);
  if (!Number.isInteger(expected) || expected < 1) {
    throw new Error("refused: expected_actionable must be a positive integer");
  }
  if (rows.length === 0) {
    throw new Error("refused: actionable page is empty");
  }
  if (rows.length !== expected) {
    throw new Error(`refused: actionable total ${rows.length} != expected ${expected}`);
  }
  const actionable = rows.filter(
    (row) => (row.replay_state ?? "pending") === "pending" && row.resolved_at == null,
  );
  const eligible = actionable.filter(
    (row) => row.event_type === "notify" && isTop3Notify(row) && schemaValid(row),
  );
  if (eligible.length !== rows.length) {
    throw new Error(
      `refused: ${rows.length - eligible.length} of ${rows.length} actionable rows are not pending current-schema-valid Top-3 notify rows`,
    );
  }
  return { messageIds: eligible.map((row) => row.message_id) };
}

function main() {
  const file = process.argv[2];
  const expected = process.argv[3];
  try {
    const page = JSON.parse(readFileSync(file, "utf8"));
    const { messageIds } = selectAcknowledgeIds(page, expected);
    process.stdout.write(`${JSON.stringify({
      messageIds,
      reason: process.env.ACK_REASON,
    })}\n`);
  } catch (err) {
    const message = err instanceof Error && err.message.startsWith("refused:")
      ? err.message
      : "refused: acknowledge selection failed";
    console.error(message);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();

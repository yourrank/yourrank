// Rerun-mode verifier for the Production DLQ Acknowledge workflow. Called
// after a prior acknowledge pass: the actionable page is empty, so the
// terminal page (include_terminal=true, no bodies) is fetched instead and
// must show exactly `expected` rows with resolution 'acknowledged' carrying
// the given bounded reason — and zero unresolved rows. Counts only: never
// emits ids, reason values, or bodies.

import { readFileSync } from "node:fs";

export function verifyAcknowledgedCleanup(terminalPage, expectedAcknowledged, reason, pageLimit = 200) {
  const rows = terminalPage?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("refused: terminal page is empty or malformed");
  }
  const expected = Number(expectedAcknowledged);
  if (!Number.isInteger(expected) || expected < 1) {
    throw new Error("refused: expected_acknowledged must be a positive integer");
  }
  if (rows.length >= pageLimit) {
    throw new Error(`refused: terminal page returned ${rows.length} rows (>= limit ${pageLimit}); cannot prove completeness`);
  }
  const actionable = rows.filter((row) => row.resolved_at == null).length;
  if (actionable > 0) {
    throw new Error(`refused: ${actionable} of ${rows.length} terminal-page rows are still unresolved/actionable`);
  }
  const acknowledgedRows = rows.filter((row) => row.resolution === "acknowledged");
  if (acknowledgedRows.length !== expected) {
    throw new Error(`refused: acknowledged ${acknowledgedRows.length} != expected ${expected}`);
  }
  const wrongReason = acknowledgedRows.filter((row) => row.ack_reason !== reason).length;
  if (wrongReason > 0) {
    throw new Error(`refused: ${wrongReason} acknowledged rows carry a different ack_reason`);
  }
  return {
    acknowledged: acknowledgedRows.length,
    acknowledged_with_reason: acknowledgedRows.length - wrongReason,
    actionable,
    invalid: rows.filter((row) => row.resolution === "invalid").length,
    exhausted: rows.filter((row) => row.resolution === "exhausted").length,
  };
}

function main() {
  const file = process.argv[2];
  const expected = process.argv[3];
  try {
    const page = JSON.parse(readFileSync(file, "utf8"));
    const counts = verifyAcknowledgedCleanup(page, expected, process.env.ACK_REASON);
    process.stdout.write(`${JSON.stringify(counts, null, 1)}\n`);
  } catch (err) {
    const message = err instanceof Error && err.message.startsWith("refused:")
      ? err.message
      : "refused: acknowledge verification failed";
    console.error(message);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();

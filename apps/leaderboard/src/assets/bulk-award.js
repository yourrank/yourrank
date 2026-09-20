// DOM-free bulk credit award runner so the mid-batch failure contract can be
// unit-tested. Awards run sequentially; a rate limit stops the batch and every
// recipient not yet attempted is reported as unattempted rather than dropped.

export function isRateLimitError(error) {
  return error?.code === "RATE_LIMITED" || error?.status === 429;
}

export async function runBulkAward(ids, award) {
  const succeeded = [];
  const failed = [];
  const errors = new Map();
  let index = 0;
  for (; index < ids.length; index++) {
    const id = ids[index];
    try {
      await award(id);
      succeeded.push(id);
    } catch (error) {
      failed.push(id);
      errors.set(id, error);
      if (isRateLimitError(error)) {
        index++;
        break;
      }
    }
  }
  const unattempted = ids.slice(index);
  return {
    total: ids.length,
    attempted: succeeded.length + failed.length,
    succeeded,
    failed,
    unattempted,
    errors,
    rateLimited: [...errors.values()].some(isRateLimitError),
  };
}

// Recipients that still need an award after a partial run: failed first (so a
// retry re-attempts them), then everything that was never attempted.
export function remainingSelection(outcome) {
  return [...outcome.failed, ...outcome.unattempted];
}

export function bulkAwardSummary(outcome, amount) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (!outcome.failed.length && !outcome.unattempted.length) {
    return `Awarded ${amount} credits to ${plural(outcome.succeeded.length, "member")}.`;
  }
  const parts = [
    `Attempted ${outcome.attempted} of ${outcome.total}`,
    `succeeded ${outcome.succeeded.length}`,
    `failed ${outcome.failed.length}`,
    `not attempted ${outcome.unattempted.length}`,
  ];
  const cause = outcome.rateLimited ? "Rate limit reached" : "An error occurred";
  return `${parts.join(" · ")}. ${cause} — the ${plural(remainingSelection(outcome).length, "member")} still needing credits stay selected; apply again to retry.`;
}

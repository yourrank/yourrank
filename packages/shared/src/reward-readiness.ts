/**
 * Publish-readiness review for creator shop rewards.
 *
 * Pure and advisory: it never rewrites or rejects a reward. The creator UI
 * shows the findings before an item goes live and links each one to the
 * control that fixes it; the owner decides whether to publish anyway.
 * Creator/reward names are deliberately not judged (no gibberish heuristic).
 */

export type RewardReviewField = "description" | "contact";

export interface RewardReviewFinding {
  code: "description_missing" | "description_duplicate" | "contact_missing";
  field: RewardReviewField;
  message: string;
}

export interface RewardReviewInput {
  id?: string | null;
  name?: string | null;
  description?: string | null;
}

export interface RewardReviewSibling {
  id: string;
  name?: string | null;
  description?: string | null;
}

export interface RewardReviewContext {
  /** Other rewards on the same site; the reward under review is skipped by id. */
  siblings?: readonly RewardReviewSibling[];
  /** Whether the creator has at least one public way to be reached. */
  contactReady: boolean;
}

export interface RewardReview {
  ready: boolean;
  findings: RewardReviewFinding[];
}

export function normalizeRewardCopy(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function reviewRewardReadiness(
  reward: RewardReviewInput,
  context: RewardReviewContext,
): RewardReview {
  const findings: RewardReviewFinding[] = [];
  const description = normalizeRewardCopy(reward.description);

  if (!description) {
    findings.push({
      code: "description_missing",
      field: "description",
      message:
        "No description. Members will not see what they receive or how and when you deliver it; the public page only shows the generic note that you complete claims by hand.",
    });
  } else {
    const twin = (context.siblings ?? []).find(
      (s) => s.id !== reward.id && normalizeRewardCopy(s.description) === description,
    );
    if (twin) {
      findings.push({
        code: "description_duplicate",
        field: "description",
        message: `Same description as “${String(twin.name ?? "another reward").trim() || "another reward"}”. Say what makes this reward different and how it is delivered.`,
      });
    }
  }

  if (!context.contactReady) {
    findings.push({
      code: "contact_missing",
      field: "contact",
      message:
        "No public contact channel. Members who claim this reward have no way to reach you about it.",
    });
  }

  return { ready: findings.length === 0, findings };
}

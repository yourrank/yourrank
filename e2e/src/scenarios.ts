/**
 * The release-gate scenario registry.
 *
 * Every scenario the recovery wave must demonstrate at runtime is declared here
 * exactly once. Test names carry `[scenario:<key>]` so `scripts/gate.mjs` can map
 * bun's per-test verdicts back to these entries and report each scenario as
 * PASSED / FAILED / SKIPPED / NOT VERIFIABLE. A scenario with no executed test is
 * reported SKIPPED, never PASSED.
 */

export type Tier =
  /** Must pass for the gate to succeed. */
  | "required"
  /** Must pass once its `requires` environment is provided; SKIPPED otherwise. */
  | "conditional"
  /** Cannot be executed against a Worker deployment; the reason is part of the report. */
  | "not-verifiable";

export interface Scenario {
  key: string;
  title: string;
  tier: Tier;
  /** Environment variables the scenario needs before it can run. */
  requires?: string[];
  /** Why a conditional/not-verifiable scenario cannot simply be run. */
  reason?: string;
}

export const SCENARIOS: Scenario[] = [
  {
    key: "auth-login-logout-relogin",
    title: "Login, logout and re-login report truthful outcomes",
    tier: "required",
  },
  {
    key: "auth-password-reset",
    title: "Password reset: request accepted, invalid token refused, change-password rotates the credential",
    tier: "required",
  },
  {
    key: "publish-draft-navigation",
    title: "Publish makes the board public; returning it to draft removes public access",
    tier: "required",
  },
  {
    key: "player-validation",
    title: "Server refuses invalid and duplicate players instead of persisting them",
    tier: "required",
  },
  {
    key: "games-config",
    title: "Games settings saved by the owner are the settings the public config serves",
    tier: "required",
  },
  {
    key: "raffle-zero-ticket-refusal",
    title: "Drawing a raffle with zero tickets is refused and the raffle stays undrawn",
    tier: "required",
  },
  {
    key: "tournament-kick-channel",
    title: "Tournament Kick channel persists and signup preconditions are enforced",
    tier: "required",
  },
  {
    key: "account-export-state",
    title: "Account export reports a real job or an explicit unavailable state, never a fabricated success",
    tier: "required",
  },
  {
    key: "analytics-empty-vs-error",
    title: "Analytics distinguishes an empty dataset from a failure",
    tier: "required",
  },
  {
    key: "wave-i-owner-insights-connections",
    title: "Wave I owner sees selected-site Insights and a credential-minimized connection inventory",
    tier: "required",
  },
  {
    key: "wave-i-moderator-insights-readonly",
    title: "Wave I Moderator can view selected-site Insights but cannot manage provider authorization",
    tier: "conditional",
    requires: ["E2E_DB_URL"],
    reason: "Creating an isolated Team membership requires the E2E database fixture connection.",
  },
  {
    key: "wave-k-safe-activity-automation",
    title: "A scheduled safe Activity executes once and records normal viewer participation",
    tier: "required",
    requires: ["E2E_DB_URL", "E2E_VIEWER_SESSION"],
    reason: "The isolated gate provisions both the scheduler database and a viewer session.",
  },
  {
    key: "games-bet-placement",
    title: "A viewer bet debits balance and returns a settled round",
    tier: "conditional",
    requires: ["E2E_VIEWER_SESSION"],
    reason:
      "Placing a bet needs a viewer session, which is created by Kick/Telegram OAuth. Provide a captured yr_viewer token in E2E_VIEWER_SESSION to execute it.",
  },
  {
    key: "games-round-readback",
    title: "Round params and outcome read back from the server match what was played",
    tier: "conditional",
    requires: ["E2E_VIEWER_SESSION"],
    reason: "Depends on a placed round, so it needs the same viewer session.",
  },
  {
    key: "games-mines-reveal-cashout",
    title: "Mines reveal and cashout settle server-side",
    tier: "conditional",
    requires: ["E2E_VIEWER_SESSION"],
    reason: "Depends on a placed round, so it needs the same viewer session.",
  },
  {
    key: "password-reset-email-token",
    title: "Consuming a real reset token delivered by email",
    tier: "not-verifiable",
    reason:
      "The token is only delivered by email; the suite has no mailbox. The API-visible half of the flow is covered by auth-password-reset.",
  },
];

export const SCENARIO_KEYS = new Set(SCENARIOS.map((s) => s.key));

/** Test-name tag that binds a test to a registry entry. */
export function tag(key: string): string {
  if (!SCENARIO_KEYS.has(key)) throw new Error(`unknown scenario: ${key}`);
  return `[scenario:${key}]`;
}

export function scenarioReady(scenario: Scenario, env: Record<string, string | undefined>): boolean {
  return (scenario.requires ?? []).every((name) => Boolean(env[name]));
}

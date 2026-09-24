// Release target guard: the fail-closed identity check every mutation path runs
// before touching Cloudflare or Supabase. evaluate() is pure — the workflow only
// sees ::error:: lines naming variables.
import { describe, it, expect } from "bun:test";
import { evaluate, PROD_REF, PROD_HYPERDRIVE } from "../../../../scripts/release-target-guard.mjs";

const STAGING_REF = "abcdefghijklmnopqrst";
const STAGING_DB_URL = `postgresql://postgres.${STAGING_REF}:x@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`;

const prodEnv = (overrides = {}) => ({
  RELEASE_ENVIRONMENT: "production",
  GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_NAME: "push",
  SUPABASE_PROJECT_REF: PROD_REF,
  ...overrides,
});

const stagingEnv = (overrides = {}) => ({
  RELEASE_ENVIRONMENT: "staging",
  STAGING_SUPABASE_PROJECT_REF: STAGING_REF,
  STAGING_DATABASE_URL: STAGING_DB_URL,
  ...overrides,
});

describe("release-target-guard", () => {
  it("accepts a coherent production release from main", () => {
    expect(evaluate("production", prodEnv())).toEqual([]);
    expect(
      evaluate(
        "production",
        prodEnv({
          GITHUB_EVENT_NAME: "workflow_dispatch",
          SUPABASE_DB_URL: `postgresql://postgres.${PROD_REF}:x@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
        }),
      ),
    ).toEqual([]);
  });

  it("rejects a production release that did not run from main", () => {
    for (const ref of ["refs/pull/1/merge", "refs/heads/devin/123-x", "refs/tags/v1"]) {
      expect(evaluate("production", prodEnv({ GITHUB_REF: ref })).join("\n")).toContain("GITHUB_REF");
    }
    expect(evaluate("production", prodEnv({ GITHUB_EVENT_NAME: "pull_request" })).join("\n")).toContain("GITHUB_EVENT_NAME");
    expect(evaluate("production", prodEnv({ SUPABASE_PROJECT_REF: STAGING_REF })).join("\n")).toContain("SUPABASE_PROJECT_REF");
  });

  it("rejects production when a STAGING_ variable is present or the DB URL points off-project", () => {
    expect(evaluate("production", prodEnv({ STAGING_SUPABASE_PROJECT_REF: STAGING_REF })).join("\n")).toContain("STAGING_SUPABASE_PROJECT_REF");
    expect(
      evaluate("production", prodEnv({ SUPABASE_DB_URL: `postgresql://postgres.${STAGING_REF}:x@aws-0-eu-west-1.pooler.supabase.com:5432/postgres` })).join("\n"),
    ).toContain("SUPABASE_DB_URL");
    expect(
      evaluate("production", prodEnv({ SUPABASE_DB_URL: `postgresql://postgres.${PROD_REF}:x@staging.example.com:5432/postgres` })).join("\n"),
    ).toContain("SUPABASE_DB_URL");
    expect(evaluate("production", prodEnv({ SUPABASE_DB_URL: "not-a-url" })).join("\n")).toContain("SUPABASE_DB_URL");
  });

  it("requires RELEASE_ENVIRONMENT to match the mode", () => {
    expect(evaluate("production", prodEnv({ RELEASE_ENVIRONMENT: "staging" })).join("\n")).toContain("RELEASE_ENVIRONMENT");
    expect(evaluate("staging", stagingEnv({ RELEASE_ENVIRONMENT: "production" })).join("\n")).toContain("RELEASE_ENVIRONMENT");
  });

  it("accepts a coherent staging release", () => {
    expect(evaluate("staging", stagingEnv())).toEqual([]);
    expect(
      evaluate(
        "staging",
        stagingEnv({
          STAGING_HYPERDRIVE_ID: "a".repeat(32),
          STAGING_WEB_URL: "https://yourrank-web-staging.example.workers.dev",
          STAGING_MONITOR_URL: "https://yourrank-monitor-staging.example.workers.dev",
          STAGING_WORKER_DATABASE_URL: STAGING_DB_URL,
        }),
      ),
    ).toEqual([]);
  });

  it("rejects staging when the project ref is the production project or malformed", () => {
    expect(evaluate("staging", stagingEnv({ STAGING_SUPABASE_PROJECT_REF: PROD_REF })).join("\n")).toContain("STAGING_SUPABASE_PROJECT_REF");
    expect(evaluate("staging", stagingEnv({ STAGING_SUPABASE_PROJECT_REF: "short" })).join("\n")).toContain("STAGING_SUPABASE_PROJECT_REF");
    expect(evaluate("staging", stagingEnv({ STAGING_SUPABASE_PROJECT_REF: undefined })).join("\n")).toContain("STAGING_SUPABASE_PROJECT_REF");
  });

  it("rejects a staging DB URL that is missing, malformed, or reaches production", () => {
    expect(evaluate("staging", stagingEnv({ STAGING_DATABASE_URL: undefined })).join("\n")).toContain("STAGING_DATABASE_URL is required");
    expect(evaluate("staging", stagingEnv({ STAGING_DATABASE_URL: "https://example.com" })).join("\n")).toContain("STAGING_DATABASE_URL");
    expect(
      evaluate("staging", stagingEnv({ STAGING_DATABASE_URL: `postgresql://postgres.${PROD_REF}:x@aws-0-eu-west-1.pooler.supabase.com:5432/postgres` })).join("\n"),
    ).toContain("STAGING_DATABASE_URL");
    expect(evaluate("staging", stagingEnv({ STAGING_DATABASE_URL: "postgresql://postgres:x@db.otherref.supabase.co:5432/postgres" })).join("\n")).toContain(
      "STAGING_DATABASE_URL",
    );
    // A production-looking URL under another name is still refused.
    expect(evaluate("staging", stagingEnv({ DATABASE_URL: STAGING_DB_URL })).join("\n")).toContain("DATABASE_URL must not be present");
    expect(evaluate("staging", stagingEnv({ SUPABASE_DB_URL: STAGING_DB_URL })).join("\n")).toContain("SUPABASE_DB_URL must not be present");
    // The bootstrap URL gets the same contract when provided.
    expect(evaluate("staging", stagingEnv({ STAGING_WORKER_DATABASE_URL: `postgresql://postgres.${PROD_REF}:x@h:5432/postgres` })).join("\n")).toContain(
      "STAGING_WORKER_DATABASE_URL",
    );
  });

  it("rejects a staging Hyperdrive id that is the production config or malformed", () => {
    expect(evaluate("staging", stagingEnv({ STAGING_HYPERDRIVE_ID: PROD_HYPERDRIVE })).join("\n")).toContain("STAGING_HYPERDRIVE_ID");
    expect(evaluate("staging", stagingEnv({ STAGING_HYPERDRIVE_ID: "not-hex" })).join("\n")).toContain("STAGING_HYPERDRIVE_ID");
    // Unset is allowed: staging-bootstrap runs before the config exists.
    expect(evaluate("staging", stagingEnv({ STAGING_HYPERDRIVE_ID: undefined }))).toEqual([]);
  });

  it("rejects staging URLs that point at production hosts", () => {
    for (const name of ["STAGING_WEB_URL", "STAGING_MONITOR_URL"]) {
      expect(evaluate("staging", stagingEnv({ [name]: "https://yourrank.site" })).join("\n")).toContain(name);
      expect(evaluate("staging", stagingEnv({ [name]: "not a url" })).join("\n")).toContain(name);
    }
  });

  it("collects every failure instead of stopping at the first", () => {
    const problems = evaluate("staging", { RELEASE_ENVIRONMENT: "production" });
    expect(problems.length).toBeGreaterThan(2);
  });
});

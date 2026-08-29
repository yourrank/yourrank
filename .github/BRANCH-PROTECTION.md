# Branch Protection & Environment Setup

## Merge Gate Policy

### Current private GitHub Free repository

GitHub does not provide branch protection or repository rulesets for this private
organization repository on GitHub Free. Until the repository becomes public or
the organization upgrades to a plan that provides those controls, every merge
must be held until these checks report **success**:

- `Build`
- `Dependency Audit`
- `E2E`
- `Lint`
- `Migration Dry-Run`
- `Test`
- `Typecheck`
- `sbom`
- `trufflehog`

CodeQL `analyze` is not a merge gate while the repository is private on GitHub
Free. The job is explicitly **skipped**, not treated as passed, because GitHub
rejects code-scanning SARIF uploads without GitHub Code Security.

### Re-enable CodeQL

CodeQL must be restored as a required merge gate when either condition becomes
true:

1. The repository becomes public. The workflow detects public visibility and
   runs `analyze` automatically.
2. GitHub Code Security is purchased and enabled for this private repository.
   Set the repository or organization Actions variable `CODEQL_ENABLED=true` so
   `analyze` runs.

After the repository plan supports branch protection or rulesets, configure
`main` to require the checks above plus `analyze`, require branches to be up to
date, require one approval, and disallow administrator bypass.

Do not set `CODEQL_ENABLED=true` before private-repository Code Security is
enabled: the analysis completes locally in Actions but its SARIF upload fails.

## Environment Protection (Settings → Environments)

#### `production` Environment

| Setting | Value |
|---------|-------|
| Deployment branches | `main` only |
| Required reviewers | Add at least 1 team member |
| Wait timer | 0 minutes (or 5 min for extra safety) |

Used by: `deploy.yml` — both `deploy-leaderboard` and `deploy-bot` jobs.

#### `staging` Environment

| Setting | Value |
|---------|-------|
| Deployment branches | All branches |
| Required reviewers | None (on-demand) |

Used by: `staging.yml` — both `deploy-leaderboard-staging` and `deploy-bot-staging` jobs.

## Workflow Environment References

All deploy jobs have the `environment:` field set:

- **deploy.yml** `deploy-leaderboard` → `environment: production`
- **deploy.yml** `deploy-bot` → `environment: production`
- **staging.yml** `deploy-leaderboard-staging` → `environment: staging`
- **staging.yml** `deploy-bot-staging` → `environment: staging`

## How It Works

1. **Push to main** → `deploy.yml` runs. GitHub waits for production environment approval before deploying.
2. **Manual trigger** → `staging.yml` runs. Deploys immediately to staging environment (any branch).
3. **Rollback** → Use `rollback.yml` workflow_dispatch with a specific git ref.

## Secrets per Environment

Both environments need these secrets (can be scoped per environment for isolation):

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | CF API token |
| `CLOUDFLARE_ACCOUNT_ID` | CF account ID (48ae72b0370b5aa9feca1a45ea37f577) |
| `SUPABASE_ACCESS_TOKEN` | For DB migrations (production only) |
| `SUPABASE_DB_PASSWORD` | For DB migrations (production only) |

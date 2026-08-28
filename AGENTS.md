# AGENTS.md

Guidance for automated agents and new contributors working in this repo.

## Layout

- `apps/leaderboard` — public leaderboard + dashboard Worker (JavaScript, `src/`).
- `apps/bot` — Telegram bot + streamer dashboard Worker (TypeScript, `src/`).
- `apps/monitor` — uptime/monitor Worker.
- `apps/web` — OpenNext marketing homepage only; the apex Leaderboard Worker
  proxies `/` and `/_next/*` assets to it. `app.yourrank.site` and
  `next.yourrank.site` redirect to the apex for unmarked requests.
- `packages/shared/` — TypeScript modules shared across Workers and the Next.js app,
  built to `packages/shared/dist`. Edit the `.ts` and run `bun run --cwd packages/shared build`.
- `e2e/` — end-to-end tests.
- `supabase/migrations/` — SQL migrations (`YYYYMMDDHHMMSS_description.sql`).

## Runtime

- Bun `>= 1.3.0` (CI pins `1.3.0`), Node `>= 20`.
- Cloudflare Workers (Wrangler), Supabase/Postgres, Cloudflare Queues.

## Product and architecture authority

- **TARGET product architecture:** `docs/YOURRANK_PRODUCT_ARCHITECTURE.md`.
  It defines owner-approved product direction, information architecture, domain
  boundaries, migration rules, deferred gates, and restricted legacy scope.
- **CURRENT dashboard route semantics:** `packages/shared/src/dashboard-routes.ts`.
  Stable IDs, canonical paths, Worker owners, delivery modes, account/site scope,
  navigation-state parameters, and aliases remain implementation truth until a
  deliberate migration changes them.
- **CURRENT navigation presentation:** `packages/shared/src/dashboard-nav.ts`,
  derived from the route model rather than competing with it.
- **CURRENT runtime/deployment truth:** `ARCHITECTURE.md` plus Worker configuration,
  code, tests, and runtime evidence.
- **CURRENT implementation/convergence state:** `.ai/PROJECT_STATE.md`.
- `PRODUCT.md` summarizes the target architecture; `DESIGN.md` defines the visual
  language. Neither file may silently rewrite current route, schema, API, billing,
  or deployment facts.
- Product labels do not automatically require URL changes. `Community` is a
  product/navigation grouping, not automatically a new database entity, and
  account-scoped versus site-scoped state must remain explicit.
- Do not silently merge Viewer Account, Membership, Leaderboard Player, or
  Telegram Subscriber identities. Shared Activity, Review, or Claims persistence
  remains deferred until implementation evidence proves the abstraction.

Architecture/product migration work must not redesign, optimize, debug, extend,
or consolidate Games, wagering/stakes, race/wager mechanics, predictions,
paid-chance mechanics, credit-ticket/random-value raffle mechanics,
odds/payout/settlement behavior, or gambling-specific Telegram behavior.
Generic shell/documentation work may acknowledge that legacy routes exist, but
those systems are not target product strategy.

## Product and frontend design

- For UI/UX, frontend, redesign, navigation, layout, user-flow, or information-
  architecture work, load and actively apply both project skills:
  `.ai/skills/impeccable/SKILL.md` and
  `.ai/skills/frontend-design/SKILL.md`.
- Use Impeccable for product shaping, journey analysis, interaction quality,
  responsive behavior, accessibility, and implementation rigor. Use Frontend
  Design in the same task to establish a distinctive, subject-specific visual
  direction rather than a templated dashboard aesthetic.
- Treat the existing interface as evidence, not as the design source of truth.
  Inspect the connected journey and shared patterns, then fix underlying UX,
  navigation, hierarchy, or product-architecture problems when they affect the
  requested work.

## Engineering skill pack

This file is the canonical router. `.ai/` is the single instruction hierarchy below it —
there is no second pack, and nothing that used to live under `.agents/` remains.
`.ai/skills/` holds **95 skills**: the 90 lifecycle skills of the v7 pro-max
[coding-agent-prompt-and-skills](https://github.com/rabavadev/coding-agent-prompt-and-skills)
pack plus the 5 project skills `impeccable`, `frontend-design`, `ui-ux-pro-max`,
`testing-dashboard`, `testing-rewards-engagement`.

Entry points: always-on rules `AI_RULES.md` (= `.ai/AI_CODING_RULES.md`), task protocol
`TASK_PROTOCOL.md` (= `.ai/AI_WORKFLOW.md`), verification standard `VERIFICATION.md`
(= `.ai/AI_VERIFICATION.md`), product/architecture truth `PROJECT_TRUTH.md`
(= `.ai/PROJECT_TRUTH.md`), repo-specific rules `.ai/PROJECT_RULES.md`, current architecture
state `.ai/PROJECT_STATE.md`, plus `.ai/AI_FORBIDDEN.md`, `.ai/INVARIANTS.md` and
`.ai/STOPPING_CRITERIA.md`. Validate the graph and skill set with
`python3 .ai/scripts/self_check.py --repo .` (expects 95 skills).

- Start non-trivial work by routing through `.ai/skills/using-skills/SKILL.md`,
  which maps a task type (bug, feature, UI redesign, migration, high-risk
  backend) to the minimum skill sequence. Load only the skills that sequence
  selects.
- The always-on policy (`AI_RULES.md`, `.ai/AI_FORBIDDEN.md`): inspect the repo
  before asking, one canonical implementation (no `*-v2`/`*-new`/`*-final` files,
  no compatibility re-exports left behind), root-cause over patch stacking, and
  runtime evidence before claiming completion.
- Runtime verification of dashboard and rewards flows follows
  `.ai/skills/testing-dashboard/SKILL.md` and
  `.ai/skills/testing-rewards-engagement/SKILL.md`. A skipped check is never a
  pass: report `PASSED` / `FAILED` / `SKIPPED` / `NOT RUN` / `NOT VERIFIABLE`.
- UI/UX work keeps using `impeccable` and `frontend-design` (above) and adds the
  pack's `frontend-ui-ux`, `design-system`, `component-system`, `accessibility`,
  `browser-runtime-testing`, `behavior-validation`, and `final-review`.
- Report completion as `Changed` / `Verified` / `Not verified` /
  `Risks`; `Verified` means actually executed, not inspected.

## Checks (run from repo root before committing)

```bash
bun run lint        # eslint: bot + leaderboard
bun run typecheck   # tsc: bot + leaderboard + monitor
bun run test        # shared + bot + leaderboard (per-file) + monitor
```

These mirror the `PR Check` workflow. A `.githooks/pre-commit` hook (enabled by
`bun install`) runs `lint` + `typecheck` automatically.

## Gotchas

### Dashboard chrome ownership

The sidebar owns section roots, page subnavigation owns tabs, and the topbar
owns context, search, and actions rather than duplicate destinations.
Breadcrumbs may show ancestry but never link the active page. The rendered
invariant and Worker route-coverage gate live in
`apps/leaderboard/src/__tests__/dashboard-chrome-ownership.test.js`.

- Global module mocks are disallowed in shared and Worker tests. Bun's
  `mock.module` is process-global, so one test can replace a shared dependency
  for every later test in an aggregate run and produce misleading failures.
  Inject collaborators into the function under test instead; production
  defaults must remain unchanged. When a test genuinely needs a module fake,
  spread the real module exports and override only the collaborators it uses.
  A temporary, documented allowlist is enforced by
  `bun run check:test-mocks`; it must only shrink.
- Coverage gate is >= 60% lines on the leaderboard suite, excluding
  `audit-validation.test.js`, `credits-loop.test.js`, `public-stream-version.test.js`,
  and `sites-handlers.test.js` (which are run only in isolation).
- After editing anything under `packages/shared/`, run `bun run --cwd packages/shared build` so the
  Workers and `apps/web` pick up the recompiled `.js`.
- Caches in the Workers are per-isolate L1 only (no KV/L2); invalidation clears
  the current isolate, and other isolates go stale until their TTL expires.

## Conventions

- Keep changes minimal and focused; follow the style of surrounding code.
- Never weaken CI gates or security controls to make a check pass.
- Never commit secrets; see `SECRETS.md`.

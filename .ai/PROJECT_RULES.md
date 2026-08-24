# Project Rules

Repository-specific rules that override the generic pack where they conflict.
Root `AGENTS.md` remains the canonical policy; this file adds only what the pack cannot know.

## Toolchain

- Bun `>= 1.3.0` (CI pins `1.3.0`), Node `>= 20`. Never introduce npm/yarn/pnpm lockfiles.
- After editing anything in `packages/shared/`, run `bun run --cwd packages/shared build`.
- Root gates before any commit: `bun run lint`, `bun run typecheck`, `bun run test`.

## Generated files

- `apps/leaderboard/src/assets_bundled.js` is generated and tracked. Never hand-edit it.
  Regenerate with `node build.js` in `apps/leaderboard` (also runs as part of `bun run test`).
- `packages/shared/dist` is generated and git-ignored.

## Dashboard invariants enforced by tests

- Chrome ownership: sidebar owns section roots, subnav owns tabs, topbar owns context/search/
  actions, breadcrumbs never link the active page
  (`apps/leaderboard/src/__tests__/dashboard-chrome-ownership.test.js`).
- Client routing table (`assets/dashboard/routes.js`) must agree with the Worker's
  `resolveFragment()`; a parity test enforces it.
- Coverage gate: >= 60% lines on the leaderboard suite.
- Global module mocks are disallowed; `bun run check:test-mocks` allowlist may only shrink.

## Security controls that must not be weakened

- Public leaderboard/overlay HTML intentionally has a permissive CSP (`frame-ancestors *`) so
  streamers can embed it. Authenticated pages use the hardened `SECURE_HTML` set. Do not merge
  the two.
- Money paths are only verified by the Postgres-backed CI job (`migration-dry-run`). A green
  local `bun run test` does not cover them (69 shared tests self-skip without a database URL).

## Design rules (audit-derived, pending owner sign-off)

- One file declares workspace design tokens. Adding a second token layer is forbidden.
- No raw px spacing or font sizes in new workspace CSS once a scale exists.
- No `*-v2` / `*-new` / `*-final` files or class names. Existing `v3-*`/`v4-*` names are debt to
  be renamed, never a pattern to extend.

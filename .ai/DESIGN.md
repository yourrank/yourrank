# Design language pointer

Canonical design language is the root [DESIGN.md](../DESIGN.md).

The previously recorded gap is closed for the authenticated workspace: DESIGN.md's
"Authenticated Workspace Contract" section names the tokens, the spacing scale, the type roles and the
interaction states, every `--ws-*` token is defined once in the `ws-token-contract` block of
`apps/leaderboard/src/assets/dashboard-v4.css`, and `apps/leaderboard/src/__tests__/tokens.test.js`
enforces single ownership plus the drift ratchets. Marketing and public surfaces are still prose-only.

# Public Leaderboard UX Audit Status

The previous theme-variant audit is retired; its screenshots and source
references no longer describe the current product.

Use `packages/shared/src/site-render.ts` for public site rendering and
`apps/leaderboard/src/assets/site-shell.css` for its shared presentation. Check
the current dashboard route manifest and renderer tests before proposing
surface changes.

Any future review should inspect the active public experience at desktop and
mobile sizes, including empty, populated, and blocked states.

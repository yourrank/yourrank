# React islands

Add a page at `src/react/pages/<name>/entry.tsx`; export `enter` and `leave` from
`defineIsland("<mount-id>", Page)`. The matching vanilla asset is a tiny shim
that re-exports those methods and keeps the direct-load boot guard. The React
builder discovers entries automatically, so a page does not need shared build
configuration changes.

Use `lib/api.ts` for same-origin JSON requests and pass the active `siteId`.
Keep markup and styles inside `.yr-react`: `styles.css` intentionally omits
Tailwind preflight, maps shadcn tokens to workspace tokens, and uses the
`components/ui` source primitives. Give Radix portal content the `.yr-react`
class so scoped styles and theme tokens continue to apply outside the island.

Keep server-owned business state and human-facing copy server-owned: render
returned lifecycle, eligibility, available actions, labels, errors, and messages
verbatim instead of reconstructing them from raw values. Add each page's
behavioral tests in `.test.js` files using happy-dom, `react-dom/client`, and
React `act`; inject collaborators through page dependencies instead of global
module mocks, and port every behavioral test from the previous implementation.

One file, one truth: edit the canonical file in place; never create `v2`, `v3`,
`final`, or similar copies. Keep one API helper (`lib/api.ts`), one island
helper (`lib/island.tsx`), and one stylesheet entry (`styles.css`). Commit
before making a risky change.

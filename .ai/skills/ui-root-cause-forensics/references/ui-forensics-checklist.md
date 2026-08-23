# UI Forensics Checklist

Use only relevant rows.

| Layer | Evidence to inspect | Typical stale/duplicate failure |
|---|---|---|
| Router | route table, redirects, nested layouts | old page still reachable |
| Layout | shell providers, nested layouts | old chrome around new page |
| Component | import/caller graph | V2 component used in one state |
| State | stores, query cache, flags | old branch selected for some users |
| Persistence | cookies/local/session/server prefs | old mode restored on return |
| Styling | global CSS, modules, utilities, CSS-in-JS | override fight / old theme leakage |
| Tokens | theme providers/config | two design systems active |
| Responsive | conditional markup/CSS | mobile still uses old component |
| Permission | role/plan/auth states | alternate path untouched |
| Runtime cache | service worker/CDN/build hashes | stale assets after deploy |
| Tests | snapshots/visual baselines | tests preserve accidental legacy |

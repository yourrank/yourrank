# YourRank Originals — games UI framework

A self-contained Preact island. The Worker keeps server-rendering every page as
it does today; the games section of a site drops in one mount point and the
island boots itself. Nothing here computes an outcome: **the server decides, the
client renders.**

```
src/games/
  types.ts          API contract (the only place a response shape is declared)
  api/client.ts     HttpGamesApi — CSRF, timeout, retry, idempotency
  api/errors.ts     GamesApiError + status/code mapping
  api/wire.ts       server response shapes -> UI types (the one mapping boundary)
  state/store.ts    per-island signal store
  state/context.ts  store injection for game modules
  bet.ts            bet arithmetic + validation (pure)
  motion.ts         easing, tween, count-up, prefers-reduced-motion
  sound.ts          muted-by-default, persisted
  haptics.ts        navigator.vibrate, guarded
  registry.ts       GameId -> dynamic import()
  ui/               shell + shared primitives
  games/<id>/       one folder per game, one chunk per game
entry.tsx           boots from data-gx-boot, mounts <GamesShell>
../games-embed.js   server-side mount helper for the host page
../../build-games.mjs  esbuild bundle -> src/assets/games/
```

## Embedding it in a page

The host page owns the site chrome; this is the entire integration surface:

```jsx
import { gamesIslandHead, gamesIslandMount } from "../games-embed.js";

<head>{raw(gamesIslandHead())}</head>
<section id="games">
  {raw(gamesIslandMount({ slug, nonce, siteName, logoUrl, header: false }))}
</section>
```

`gamesIslandMount()` emits a `.gx` root carrying a `data-gx-boot` JSON payload, a
server-rendered skeleton (fixed dimensions, so hydration shifts nothing), a
`<noscript>` fallback and the module script. It carries **no** game state and no
balance — the island asks `GET /api/games/config` and the server answers. All
CSS is scoped under `.gx`, so the host page's tokens are untouched; set
`--gx-accent` on the root element to inherit the streamer's colour.

Pass `header: false` when the host page already shows branding: the island keeps
a compact bar (the live balance must stay visible mid-round) and drops the logo.

## Running it locally

```bash
cd apps/leaderboard
node build-games.mjs        # bundle -> src/assets/games/
bun run dev                 # play at http://localhost:8787/<slug>/games
```

There is one API and it is the real one. The island has no mock, no demo mode
and no offline fallback: a failed call surfaces an error state, never a
fabricated round. Play locally against the Worker with a seeded viewer.

## Adding a game

1. `src/games/<id>/index.tsx` exporting a `default` board and, if it needs extra
   controls, a `Panel`:

```tsx
import type { GameProps } from "../../registry.js";
import { BetPanel } from "../../ui/BetPanel.js";

export default function DiceBoard({ store, config }: GameProps) { /* board */ }

export function Panel({ store, config }: GameProps) {
  return <BetPanel bounds={...} amount={...} onSubmit={...}>{/* target slider */}</BetPanel>;
}
```

2. Add the id to `GameId` in `types.ts` and a loader in `registry.ts`. That is
   the only shared file a game touches — esbuild code-splits on the `import()`,
   so a viewer downloads one game's chunk.
3. Place a bet through `store.api`, then hand the response to
   `store.applyResult(result)`. Never write `store.balance` yourself.
4. Animate **from** `result.outcome` (Plinko's bucket, Mines' board). If your
   animation could produce a different result than the server's, it is wrong.

The shell already renders the picker, the frame states, the balance, the history
strip and the result toast around your board.

## Components

| Component | Purpose | Key props |
| --- | --- | --- |
| `GamesShell` | Everything around a game: header, picker, board slot, panel slot, history, toast | `store`, `branding`, `showHeader` |
| `GameFrame` | The five non-playing states, identical in every game | `state`, `gameName`, `errorMessage`, `onRetry`, `signInHref`, `earnHref` |
| `BetPanel` | Amount field, `−/+`, `½ 2× max`, validation, primary action | `bounds`, `amount`, `onAmountChange`, `onSubmit`, `loading`, `disabled`, `error`, `children`, `secondary` |
| `BalanceDisplay` | Live balance with count-up and a `+N` flash | `balance`, `currency`, `lastDelta` |
| `ResultToast` | Tiered win/loss celebration, auto-dismissing | `result`, `currency`, `onDismiss`, `autoDismissMs` |
| `MultiplierDisplay` | Multiplier in win tiers | `value`, `size`, `tier`, `label` |
| `HistoryStrip` | Recent rounds | `entries`, `limit`, `loading` |
| `Button` | Primary/win/ghost/neutral, loading spinner | `variant`, `size`, `block`, `loading` |

`GameFrame` states: `loading`, `error`, `disabled`, `signed_out`, `no_credits`,
`ready`. `GamesShell.resolveFrameState()` picks between them — the shell's own
problems outrank the viewer's, so nobody is told to top up a game that is off.

## Store

`createGamesStore({ api, slug, viewer, initialGame })` returns signals
(`config`, `viewer`, `balance`, `history`, `activeGame`, `pendingResult`,
`loading`, `betting`, `error`, …) plus `load()`, `selectGame()`,
`applyResult()`, `setError()`, `clearError()`, `dismissResult()`.

`applyResult()` is the only writer of `balance`, and it assigns
`result.balance` — the number the server sent, not a locally derived one.

## API client

`createGamesApi({ slug })` → `getConfig`, `placeBet`, `minesReveal`,
`minesCashout`, `getHistory`, `getFairness`, `rotateFairness`. It attaches the
CSRF header and credentials, times requests out, retries only idempotent or
5xx/network failures, and **reuses the same `Idempotency-Key` across retries** so
a retried bet can never charge twice. Failures throw `GamesApiError` with a
`GamesErrorCode` the UI has a dedicated state for.

## Accessibility and motion

Everything is keyboard operable with visible focus rings; the balance, error
line, history and result toast are live regions; the skeleton reserves the
board's size. `prefers-reduced-motion` collapses tweens to their final value —
games stay fully playable with animation off. Sound is muted by default and the
preference persists; haptics only fire on a real `navigator.vibrate`.

## Assets and licences

No third-party or commercial-casino assets. Every icon is original inline SVG,
every surface is CSS. Runtime dependencies: `preact` and `@preact/signals`
(MIT); `esbuild` (MIT) is build-time only.

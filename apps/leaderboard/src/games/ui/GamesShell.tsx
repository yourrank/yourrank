/** @jsxImportSource preact */
// ============================================================================
//  The games shell: header (branding + live balance + sound), game picker,
//  board slot, bet panel slot and the history strip. It owns everything around
//  a game so a game module only has to supply a board and (optionally) the
//  extra controls that belong in the bet panel.
//
//  Layout is mobile-first: one column, board first and bet panel under it
//  (thumb reach), promoted to "panel left, board right" at 900px. Both layouts
//  are declared in games.css — nothing here measures the viewport, so there is
//  no layout shift when the island hydrates.
// ============================================================================
import { useEffect, useState } from "preact/hooks";
import { GAME_LOADERS } from "../registry.js";
import type { GameModule } from "../registry.js";
import { GamesStoreContext } from "../state/context.js";
import type { GamesStore } from "../state/store.js";
import { setHapticsEnabled } from "../haptics.js";
import { sound } from "../sound.js";
import { safeImageUrl, safePath } from "../url.js";
import { BalanceDisplay } from "./BalanceDisplay.js";
import { GameFrame } from "./GameFrame.js";
import type { GameFrameState } from "./GameFrame.js";
import { HistoryStrip } from "./HistoryStrip.js";
import { ResultToast } from "./ResultToast.js";
import { SoundOffIcon, SoundOnIcon } from "./icons.js";

export interface ShellBranding {
  siteName: string;
  logoUrl: string | null;
  homeUrl: string;
}

export interface GamesShellProps {
  store: GamesStore;
  branding: ShellBranding;
  /**
   * Whether to show the streamer's branding in the island header. Off when the
   * host page already has a branded topbar — the header stays (the live balance
   * has to be visible while playing) but drops to a compact balance bar.
   */
  showHeader?: boolean;
}

export function GamesShell({ store, branding, showHeader = true }: GamesShellProps) {
  const games = store.enabledGames.value;
  const activeId = store.activeGame.value;
  const active = games.find((g) => g.id === activeId) ?? null;
  const currency = store.currency.value;
  const gameModule = useGameModule(store);
  const frameState = resolveFrameState(store);
  const playable = frameState === "ready" && active !== null;
  const logoUrl = safeImageUrl(branding.logoUrl);

  useEffect(() => {
    void store.load();
  }, [store]);

  // Deep link and back button: /<slug>/games?game=plinko.
  useEffect(() => {
    if (!activeId || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("game") === activeId) return;
    url.searchParams.set("game", activeId);
    window.history.replaceState(null, "", url.toString());
  }, [activeId]);

  const Board = gameModule?.default ?? null;
  // A board owns its own controls (mine count, risk, dice target), so the panel
  // slot renders only when a game ships a separate one.
  const Panel = gameModule?.Panel ?? null;

  return (
    <GamesStoreContext.Provider value={store}>
      <div class="gx-app">
        <header class={showHeader ? "gx-header" : "gx-header gx-header--compact"}>
          {showHeader ? (
            <a class="gx-header__brand" href={safePath(branding.homeUrl, "/")}>
              {logoUrl ? (
                <img class="gx-header__logo" src={logoUrl} alt="" width={28} height={28} />
              ) : (
                <span class="gx-header__mark" aria-hidden="true">
                  {branding.siteName.slice(0, 2).toUpperCase()}
                </span>
              )}
              <span class="gx-header__title">{branding.siteName}</span>
            </a>
          ) : null}
          <span class="gx-header__spacer" />
          <div class="gx-header__actions">
            <BalanceDisplay balance={store.balance.value} currency={currency} lastDelta={store.lastPayout.value} />
            <SoundToggle />
          </div>
        </header>

        <main class="gx-main" id="main-content">
          <div class="gx-board-slot">
            {games.length > 1 ? (
              <nav class="gx-picker" aria-label="Games">
                {games.map((game) => (
                  <button
                    key={game.id}
                    type="button"
                    class="gx-picker__item"
                    aria-current={game.id === activeId ? "true" : "false"}
                    onClick={() => store.selectGame(game.id)}
                  >
                    {game.name}
                  </button>
                ))}
              </nav>
            ) : null}

            <GameFrame
              state={Board === null && frameState === "ready" ? "loading" : frameState}
              gameName={active?.name ?? "This game"}
              currency={currency}
              balance={store.balance.value}
              minBet={active?.minBet ?? 1}
              errorMessage={store.error.value}
              onRetry={() => void store.load()}
              signInHref={safePath(store.signInHref, "/")}
              earnHref={safePath(store.earnHref, "/")}
            >
              {Board && active ? <Board store={store} config={active} /> : null}
            </GameFrame>
          </div>

          <div class="gx-panel-slot">{Panel && playable && active ? <Panel store={store} config={active} /> : null}</div>

          <div class="gx-history-slot gx-surface">
            <HistoryStrip entries={store.history.value} loading={store.loading.value} />
          </div>
        </main>

        <ResultToast result={store.pendingResult.value} currency={currency} onDismiss={() => store.dismissResult()} />
      </div>
    </GamesStoreContext.Provider>
  );
}

/**
 * Frame state precedence: the shell's own problems (loading, failed config,
 * everything switched off) win over the viewer's (signed out, no credits) —
 * telling someone to top up a game that is turned off is nonsense.
 */
export function resolveFrameState(store: GamesStore): GameFrameState {
  if (store.loading.value) return "loading";
  if (store.error.value) return "error";
  const config = store.config.value;
  if (!config || !config.enabled) return "disabled";
  const active = config.games.find((g) => g.id === store.activeGame.value);
  if (!active || !active.enabled) return "disabled";
  if (!store.viewer.value.authenticated) return "signed_out";
  if (store.balance.value < active.minBet) return "no_credits";
  return "ready";
}

/**
 * Loads the active game's chunk. Board and panel come from the same module so a
 * game's controls can never render against a different game's board.
 */
function useGameModule(store: GamesStore): GameModule | null {
  const id = store.activeGame.value;
  const [state, setState] = useState<{ id: string; mod: GameModule } | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    GAME_LOADERS[id]()
      .then((mod) => {
        if (!cancelled) setState({ id, mod });
      })
      .catch(() => {
        if (!cancelled) store.setError(new Error("chunk_failed"));
      });
    return () => {
      cancelled = true;
    };
  }, [id, store]);

  return state && state.id === id ? state.mod : null;
}

function SoundToggle() {
  const [muted, setMuted] = useState(sound.isMuted);
  return (
    <button
      type="button"
      class="gx-icon-btn"
      aria-pressed={muted ? "false" : "true"}
      aria-label={muted ? "Turn sound on" : "Turn sound off"}
      onClick={() => {
        const next = sound.toggle();
        setHapticsEnabled(!next);
        setMuted(next);
        if (!next) sound.play("click");
      }}
    >
      {muted ? <SoundOffIcon /> : <SoundOnIcon />}
    </button>
  );
}

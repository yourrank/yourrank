// ============================================================================
//  Games session store.
//
//  One signal graph per mounted shell, created in entry.tsx and handed to games
//  through context. Signals rather than a reducer because the hot path here is
//  "one number changed mid-animation" — a balance tick must not re-render the
//  board component tree.
//
//  Every field that describes money or a result is written ONLY from a server
//  response. There is no local mutation of `balance` anywhere: it is assigned
//  from `BetResult.balance`.
// ============================================================================
import { computed, signal } from "@preact/signals";
import type { Signal } from "@preact/signals";
import { GamesApiError } from "../api/errors.js";
import type { GamesApi } from "../api/client.js";
import type { BetResult, GameConfig, GameId, GamesConfig, HistoryEntry, ViewerState } from "../types.js";

export interface GamesStore {
  api: GamesApi;
  slug: string;
  signInHref: string;
  earnHref: string;

  config: Signal<GamesConfig | null>;
  viewer: Signal<ViewerState>;
  balance: Signal<number>;
  history: Signal<HistoryEntry[]>;
  activeGame: Signal<GameId | null>;
  /** Result awaiting its celebration, cleared by ResultToast. */
  pendingResult: Signal<BetResult | null>;
  lastPayout: Signal<number | null>;
  loading: Signal<boolean>;
  betting: Signal<boolean>;
  error: Signal<string | null>;
  errorCode: Signal<string | null>;

  enabledGames: Signal<GameConfig[]>;
  currency: Signal<string>;

  load(): Promise<void>;
  selectGame(id: GameId): void;
  /** Applies a settled server result: balance, history and celebration. */
  applyResult(result: BetResult): void;
  setError(err: unknown): void;
  clearError(): void;
  dismissResult(): void;
}

export interface CreateStoreOptions {
  api: GamesApi;
  slug: string;
  viewer: ViewerState;
  signInHref?: string;
  earnHref?: string;
  initialGame?: GameId | null;
}

export function createGamesStore(opts: CreateStoreOptions): GamesStore {
  const config = signal<GamesConfig | null>(null);
  const viewer = signal<ViewerState>(opts.viewer);
  const balance = signal<number>(opts.viewer.balance);
  const history = signal<HistoryEntry[]>([]);
  const activeGame = signal<GameId | null>(opts.initialGame ?? null);
  const pendingResult = signal<BetResult | null>(null);
  const lastPayout = signal<number | null>(null);
  const loading = signal<boolean>(true);
  const betting = signal<boolean>(false);
  const error = signal<string | null>(null);
  const errorCode = signal<string | null>(null);

  const enabledGames = computed(() => (config.value?.games ?? []).filter((g) => g.enabled));
  const currency = computed(() => config.value?.currency ?? "credits");

  const store: GamesStore = {
    api: opts.api,
    slug: opts.slug,
    signInHref: opts.signInHref ?? `/api/viewer/auth/kick?returnTo=${encodeURIComponent(`/${opts.slug}/games`)}`,
    earnHref: opts.earnHref ?? `/${opts.slug}/credits`,
    config,
    viewer,
    balance,
    history,
    activeGame,
    pendingResult,
    lastPayout,
    loading,
    betting,
    error,
    errorCode,
    enabledGames,
    currency,

    async load() {
      loading.value = true;
      error.value = null;
      errorCode.value = null;
      try {
        const cfg = await opts.api.getConfig();
        config.value = cfg;
        const available = cfg.games.filter((g) => g.enabled);
        if (!activeGame.value || !available.some((g) => g.id === activeGame.value)) {
          activeGame.value = available[0]?.id ?? null;
        }
        // History is best-effort: a signed-out viewer has none, and a failure
        // here must not take the whole shell into its error state.
        if (viewer.value.authenticated) {
          try {
            const res = await opts.api.getHistory({ limit: 20 });
            history.value = res.entries;
          } catch {
            history.value = [];
          }
        }
      } catch (err) {
        store.setError(err);
      } finally {
        loading.value = false;
      }
    },

    selectGame(id: GameId) {
      if (activeGame.value === id) return;
      activeGame.value = id;
      error.value = null;
      errorCode.value = null;
    },

    applyResult(result: BetResult) {
      balance.value = result.balance;
      viewer.value = { ...viewer.value, balance: result.balance };
      if (result.status !== "open") {
        lastPayout.value = result.payout;
        pendingResult.value = result;
        history.value = [
          {
            roundId: result.roundId,
            game: result.game,
            amount: result.amount,
            multiplier: result.multiplier,
            payout: result.payout,
            status: result.status,
            createdAt: result.createdAt,
          },
          ...history.value,
        ].slice(0, 30);
      }
    },

    setError(err: unknown) {
      const apiErr = err instanceof GamesApiError ? err : null;
      error.value = apiErr ? apiErr.message : "Something went wrong. Please try again.";
      errorCode.value = apiErr ? apiErr.code : "server_error";
    },

    clearError() {
      error.value = null;
      errorCode.value = null;
    },

    dismissResult() {
      pendingResult.value = null;
    },
  };

  return store;
}

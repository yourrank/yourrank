// Shared mutable state for the dashboard modules, plus the one change
// notification path. Modules must not reach into each other to refresh a
// surface — and cannot, in the case of players.js, which site.js imports —
// so every mutation goes through setState()/markDirty() and every surface
// that has to react subscribes here.
export function createDashboardState({ requestId, onSubscriberError = (err) => console.error("dashboard subscriber failed", err) } = {}) {
  const state = {
    SLUG: null,
    EXTRA: {},
    ME: null,
    ACTIVE_SITE_ID: null,
    SITE_UPDATED_AT: null,
    PUBLISHED_AT: null,
    BOARDS: [],
    PLAYERS: [],
    SAVED_PLAYERS: [],
    SAMPLE_PLAYERS: false,
    CURRENT_BRANDING: { accentA: null, accentB: null, font: "Inter" },
    PUBLISHED: false,
    IS_DRAFT: false,
    RANK_BY: "wagered",
    STATS_STATUS: "loading",
    GIVEAWAYS_STATUS: "loading",
    CREDITS_STATUS: "loading",
    CREDITS_PRODUCT_ENABLED: false,
    HEATMAP_STATUS: "loading",
    REFERRALS_STATUS: "loading",
    USAGE_STATUS: "loading",
    SESSIONS_STATUS: "loading",
    GAMES_STATUS: "loading",
    THEME_SAVING: false,
    LOGO: undefined, // undefined = unchanged, null = remove, string = new data URI
    _dirty: false,
    pageReqId: requestId ?? (document.querySelector('meta[name="request-id"]')?.content || ""),
  };
  const listeners = new Set();

  /** Subscribe to change notifications. Returns an unsubscribe function. */
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function notify(keys) {
    for (const fn of [...listeners]) {
      try {
        fn(keys, state);
      } catch (err) {
        // One broken subscriber must not stop the rest of the UI updating.
        onSubscriberError(err);
      }
    }
  }

  /** Assign `patch` onto the state and notify subscribers of the keys that changed. */
  function setState(patch) {
    const changed = [];
    for (const key of Object.keys(patch)) {
      if (state[key] !== patch[key]) changed.push(key);
      state[key] = patch[key];
    }
    if (changed.length) notify(changed);
    return changed;
  }

  /**
   * The editor draft changed: flag unsaved work and tell every surface that
   * derives from the draft (live preview, overview summary) to re-render. Fires
   * on every edit, not just the first, so it is separate from the `_dirty` flip.
   */
  function markDirty() {
    setState({ _dirty: true });
    notify(["draft"]);
  }

  /** The draft was saved (or discarded): drop the unsaved-changes state. */
  function clearDirty() {
    setState({ _dirty: false });
  }

  // Single source of truth for "is this board actually reachable by visitors".
  // A published board is still not live while the owner's email is unconfirmed,
  // so every surface (badge, banner, share step, toasts) must derive from this.
  function boardStatus() {
    const emailVerified = state.ME ? state.ME.emailVerified !== false : true;
    const published = !!state.PUBLISHED;
    const live = published && emailVerified;
    const pending = published && !emailVerified;
    let key = "draft";
    if (published) key = live ? "published" : "pending";
    else if (!state.IS_DRAFT) key = "unpublished";
    return { live, published, emailVerified, pending, key };
  }

  return { state, setState, subscribe, markDirty, clearDirty, boardStatus };
}

const defaultStore = createDashboardState();
export const { state, setState, subscribe, markDirty, clearDirty, boardStatus } = defaultStore;

// P4-1: pure tour data + persistence, split from tour.js so tests can import
// it without pulling in the DOM-owning shell modules (mirrors overview-state.js).
export const NO_TARGET = null;

export const MAX_TOUR_STEPS = 7;

const TOUR_KEY_PREFIX = "yr-tour:";

export const TOUR_STEPS = [
  {
    id: "welcome",
    target: NO_TARGET,
    title: "Welcome to YourRank",
    body: "This quick tour takes about two minutes: name your site, add players, put the board on stream, and connect your community. You can skip at any point.",
    primaryLabel: "Show me around",
  },
  {
    id: "setup",
    target: "#ovSetup",
    title: "Start with the launch checklist",
    body: "Name your site, add the players you want to rank, then publish. The checklist tracks what is left — the site stays editable the whole time.",
  },
  {
    id: "scoring",
    target: "#ovTopPlayers",
    title: "Players are ranked by score",
    body: "Every player you add appears here, highest score first. Ranking rules, imports and score edits live in the Leaderboard editor in the sidebar.",
  },
  {
    id: "overlays",
    target: "#overlayDesignerCard",
    title: "Put the board on your stream",
    body: "The Leaderboard overlay in My board → Share is a transparent browser source for OBS or Streamlabs. Pick a widget, copy the OBS link, and your leaderboard renders live on stream.",
  },
  {
    id: "kick",
    target: NO_TARGET,
    title: "Connect your Kick channel",
    body: "Link your Kick channel in Site settings → Connections so viewers can sign in, earn credits and claim rewards on your site. That is the whole tour — you are ready to build your board.",
    ctaLabel: "Open connections",
    ctaRoute: ["siteConnections", "channel"],
  },
];

/** Storage key per account so a shared browser does not suppress new tours forever. */
export function tourSeenKey(userId) {
  return TOUR_KEY_PREFIX + (userId || "anon");
}

export function hasSeenTour(userId, storage = safeStorage()) {
  try {
    return storage.getItem(tourSeenKey(userId)) === "done";
  } catch {
    return false;
  }
}

export function markTourSeen(userId, storage = safeStorage()) {
  try {
    storage.setItem(tourSeenKey(userId), "done");
  } catch {
    /* private mode — the tour simply runs again next visit */
  }
}

function safeStorage() {
  // Keep module import side-effect free; window is only touched at runtime.
  return typeof window !== "undefined" ? window.localStorage : undefined;
}

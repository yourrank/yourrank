import { routeById } from "@yourrank/shared/dashboard-routes";

export const GIVEAWAY_TABS = [
  ["chat", "Chat Giveaway"],
  ["raffles", "Raffle"],
  ["preds", "Prediction"],
];

const SUBNAV_ROUTES = {
  chat: "giveaways.chat",
  raffles: "giveaways.raffles",
  preds: "giveaways.preds",
};

export const ENGAGE_FEATURES = [
  {
    feature: "activities",
    title: "Activities",
    href: "/dashboard/activities",
    desc: "Code drops that hand out free credits.",
    idle: { meta: "Launch a code drop to hand out free credits." },
  },
  {
    feature: "giveaways",
    title: "Giveaways",
    href: routeById(SUBNAV_ROUTES.chat).canonicalPath,
    desc: "Chat giveaways, raffles, and predictions.",
    idle: { meta: "Start a chat giveaway, raffle, or prediction." },
  },
  {
    feature: "tournaments",
    title: "Tournaments",
    href: "/dashboard/giveaways/tournaments",
    desc: "Brackets and community competitions.",
    idle: { meta: "Set up a bracket for your community." },
  },
];

export function renderEngageHubHtml() {
  return '<div id="giveaway-root" class="yr-react" data-tab="hub"></div>';
}

export function renderGiveawayDrawersHtml() {
  return "";
}

export function renderGiveawaysContentHtml(activeTab = "chat") {
  if (activeTab === "hub") return renderEngageHubHtml();
  if (activeTab === "tournaments") {
    return `<div class="gw-tab-pane is-active" id="pane-tournaments">
<section id="tournament-app" aria-label="Tournament workspace">
  <div id="tournament-root" class="yr-react">
    <div class="tn-loading" role="status" aria-busy="true">
      <h1 class="tn-loading-title">Tournaments</h1>
      <span class="tn-loading-bar"></span>
      <span class="tn-loading-bar tn-loading-bar--short"></span>
    </div>
  </div>
  <div id="tournament-dialogs"></div>
</section></div>`;
  }
  const tab = GIVEAWAY_TABS.some(([key]) => key === activeTab) ? activeTab : "chat";
  return `<div id="giveaway-root" class="yr-react" data-tab="${tab}"></div>`;
}

export function renderGiveawaysHtml(activeTab = "chat") {
  return renderGiveawaysContentHtml(activeTab);
}

export const giveawaysHtml = renderGiveawaysHtml();

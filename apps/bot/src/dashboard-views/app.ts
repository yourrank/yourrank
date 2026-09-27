import { botPageHtml } from "@yourrank/shared/page-shell";
import { dashboardChromeHtml, workspaceSearchHtml } from "@yourrank/shared/dashboard-chrome";
import { botNavItems, pageLinks, pageMeta, telegramChrome } from "./shell.js";
import { overviewPanel } from "./pages/overview.js";
import { botsPanel } from "./pages/bots.js";
import { commandsPanel } from "./pages/commands.js";
import { offersPanel } from "./pages/offers.js";
import { broadcastsPanel } from "./pages/broadcasts.js";
import { dashClientScript } from "./client-script.js";

type DashboardContext = {
  botUsername?: string | null;
  botStatus?: string | null;
  siteName?: string | null;
};

function panelHtml(page: string, publicBaseUrl: string, context: DashboardContext): string {
  switch (page) {
    case "bots": return botsPanel();
    case "commands": return commandsPanel();
    case "offers": return offersPanel(publicBaseUrl);
    case "broadcasts": return broadcastsPanel();
    case "overview":
    default: return overviewPanel({ hasBot: Boolean(context.botUsername) });
  }
}

function telegramTabsHtml(page: string): string {
  return `<nav class="v3-tabs telegram-tabs" aria-label="Telegram pages">${
    pageLinks.map(({ key, label, href }) =>
      `<a class="v3-tab${key === page ? " is-on" : ""}" href="${href}"${key === page ? ' aria-current="page"' : ""}>${label}</a>`
    ).join("")
  }</nav>`;
}

function telegramContextHtml(page: string): string {
  if (page === "overview") return ""; // The current-bot card is Overview's context.
  return `<div class="tg-page-context" id="tgPageContext" aria-live="polite">
    <div class="tg-page-context-copy"><span class="tg-page-context-name" id="tgContextName">Checking bots…</span><span class="tg-page-context-status" id="tgContextStatus"></span></div>
    <label class="tg-page-context-picker" id="tgContextPicker" hidden><span class="sr-only">Selected Telegram bot</span><select id="tgContextSelect" class="v3-input" aria-label="Selected Telegram bot"></select></label>
  </div>`;
}

export function appHtml(
  user: { display_name: string; email: string; plan: string },
  publicBaseUrl: string,
  nonce?: string,
  page = "overview",
  nav?: string,
  context: DashboardContext = {},
): string {
  const meta = pageMeta(page);
  const chromeState = telegramChrome(page);
  // The Telegram pages render in the leaderboard dashboard's shell (same rail,
  // topbar and account menu) instead of a second, older-looking one.
  const chrome = dashboardChromeHtml({
    nav: botNavItems(),
    active: chromeState.navKey,
    navLabel: "Telegram",
    title: chromeState.h1 ?? "",
    subtitle: meta.sub,
    crumbs: [...chromeState.crumbs],
    user,
    // This setup CTA is contextual bot state, not a second navigation tree.
    topbarContextHtml: "",
    topbarHtml: workspaceSearchHtml(),
    activePath: chromeState.canonicalPath,
    railProfile: true,
    collapsible: true,
    logoutAction: "/bot/auth/logout",
    // Each Telegram page is its own document (nav links are full loads), so
    // render only the active panel. This keeps one panel's slow or failed data
    // from bloating or breaking the others, and matches the SPA section model
    // the leaderboard dashboard already uses.
    content: `${telegramContextHtml(page)}${telegramTabsHtml(page)}${panelHtml(page, publicBaseUrl, context)}`,
  });
  return botPageHtml({
    user,
    page,
    nonce,
    nav,
    documentTitle: chromeState.documentTitle,
    dashboardChrome: true,
    content: `${chrome}
${dashClientScript()}
<script src="/assets/dashboard/command-palette.js" type="module"></script>`,
  });
}

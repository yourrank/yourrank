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

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>
  )[ch]);
}

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
    topbarContextHtml: `<div class="lb-topbar-hud"><div class="lb-account-hud"><div class="lb-hud-details"><span class="lb-board-select-lbl">Account · Telegram</span>${context.botUsername ? `<span class="lb-account-title">@${esc(context.botUsername)} <span class="lb-status">${esc(context.botStatus || "active")}</span></span>` : `<a class="lb-account-title" href="${telegramChrome("bots").canonicalPath}" data-chrome-contextual-action="true">No bot connected · Connect one</a>`}</div></div></div>`,
    topbarHtml: workspaceSearchHtml(),
    activePath: chromeState.canonicalPath,
    railProfile: true,
    collapsible: true,
    logoutAction: "/bot/auth/logout",
    // Each Telegram page is its own document (nav links are full loads), so
    // render only the active panel. This keeps one panel's slow or failed data
    // from bloating or breaking the others, and matches the SPA section model
    // the leaderboard dashboard already uses.
    content: `${telegramTabsHtml(page)}${panelHtml(page, publicBaseUrl, context)}`,
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

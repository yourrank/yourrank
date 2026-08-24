import { botPageHtml } from "@yourrank/shared/page-shell";
import { dashboardChromeHtml } from "@yourrank/shared/dashboard-chrome";
import { dashboardChromeState } from "@yourrank/shared/dashboard-chrome-state";
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
    railHeadHtml: `<div class="lb-ws-switcher"><a class="lb-ws-card" href="${dashboardChromeState("boards").canonicalPath}"><div class="lb-ws-avatar">${esc((context.siteName || "S").slice(0, 1).toUpperCase())}</div><div class="lb-ws-meta"><span class="lb-ws-name">${esc(context.siteName || "No site connected")}</span><span class="lb-ws-plan">Active site</span></div></a></div>`,
    title: chromeState.h1 ?? "",
    subtitle: meta.sub,
    crumbs: [...chromeState.crumbs],
    user,
    // This setup CTA is contextual bot state, not a second navigation tree.
    topbarHtml: `<div class="lb-topbar-hud"><div class="lb-account-hud"><span class="lb-hud-icon" aria-hidden="true">◎</span><div class="lb-hud-details"><span class="lb-board-select-lbl">CURRENT BOT</span>${context.botUsername ? `<span class="lb-account-title">@${esc(context.botUsername)} <span class="lb-status">${esc(context.botStatus || "active")}</span></span>` : `<a class="lb-account-title" href="${telegramChrome("bots").canonicalPath}" data-chrome-contextual-action="true">No bot connected · Connect one</a>`}</div></div></div>`,
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
${dashClientScript()}`,
  });
}

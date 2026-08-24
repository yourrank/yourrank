import type { NavItem } from "@yourrank/shared/dashboard-chrome";
import { dashboardNavItems } from "@yourrank/shared/dashboard-nav";
import { dashboardChromeState, type DashboardChromeState } from "@yourrank/shared/dashboard-chrome-state";
import type { DashboardRouteId } from "@yourrank/shared/dashboard-routes";

// Telegram page vocabulary → canonical route identity. Values are manifest
// route ids (a typo fails compile); no path literals live here.
const PAGE_ROUTES = {
  overview: "telegram",
  bots: "telegram.bots",
  commands: "telegram.commands",
  offers: "telegram.offers",
  broadcasts: "telegram.broadcasts",
} as const satisfies Readonly<Record<string, DashboardRouteId>>;

type PageKey = keyof typeof PAGE_ROUTES;

// Page subtitles are Telegram presentation (H1 support copy), not chrome state.
const PAGE_SUBS: Readonly<Record<PageKey, string>> = {
  overview: "Your bot at a glance — last 14 days",
  bots: "Connect and manage your Telegram bots",
  commands: "Commands your bot sends when subscribers type a command",
  offers: "Your tracked offers — clicks are tracked automatically",
  broadcasts: "Send a broadcast to your subscribers",
};

/** Canonical chrome state of a Telegram page (unknown pages → Overview). */
export function telegramChrome(page: string): DashboardChromeState {
  const key: PageKey = page in PAGE_ROUTES ? (page as PageKey) : "overview";
  return dashboardChromeState(PAGE_ROUTES[key]);
}

/** Telegram page subnavigation, addressed through the canonical route model. */
export const pageLinks = (Object.keys(PAGE_ROUTES) as PageKey[]).map((key) => {
  const chrome = dashboardChromeState(PAGE_ROUTES[key]);
  return { key, label: chrome.h1 ?? "", href: chrome.canonicalPath, sub: PAGE_SUBS[key] };
});

/** Shared dashboard navigation with Telegram's pages nested under its product entry. */
export function botNavItems(): NavItem[] {
  return dashboardNavItems();
}

export function pageMeta(active: string): { label: string; sub: string } {
  const p = pageLinks.find((l) => l.key === active) || pageLinks[0];
  return { label: p.label, sub: p.sub };
}

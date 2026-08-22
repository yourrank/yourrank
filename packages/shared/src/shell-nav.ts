// ============================================================================
//  YourRank — SHARED DASHBOARD SHELL / TOP NAV  (bot Worker, TypeScript)
//
//  Renders the same sticky header (Sites | Telegram | Credits & Shop |
//  Account | Help) so the Telegram dashboard feels like the same app.
//
//  The stylesheet and behaviour live in the leaderboard Worker's static
//  assets (/assets/shell-nav.css, /assets/shell-nav.js) and are linked by
//  packages/shared/src/page-shell.ts, so every page renders the same header from one source.
//
//  Usage (bot Worker dashboard.ts):
//    import { shellNavHtml } from "@yourrank/shared/shell-nav";
//    botPageHtml({ nav: shellNavHtml({ activePath: "/dashboard/telegram", user }), ... })
// ============================================================================

export interface ShellUser {
  display_name?: string | null;
  email?: string | null;
  plan?: string | null;
}
export interface NavLink {
  key: string;
  label: string;
  href: string;
  match: string[];
  top?: boolean;
}

export const NAV_LINKS: NavLink[] = [
  { key: "sites",    label: "Sites",          href: "/dashboard",                       match: ["/dashboard"],                    top: true },
  { key: "telegram", label: "Telegram",       href: "/dashboard/telegram",              match: ["/dashboard/telegram", "/bot"],  top: true },
  { key: "credits",  label: "Credits & Shop", href: "/dashboard/rewards/redemptions",   match: ["/dashboard/rewards", "/dashboard/credits"], top: true },
  { key: "account",  label: "Account",        href: "/dashboard/settings",              match: ["/dashboard/settings", "/account"], top: true },
  { key: "help",     label: "Help",           href: "/help",                            match: ["/help", "/contact"],             top: true },
];

export function activeKey(activePath: string): string | null {
  const raw = (activePath || "/").replace(/\/+$/, "") || "/";
  const qIndex = raw.indexOf("?");
  const pathname = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
  const search = qIndex >= 0 ? raw.slice(qIndex + 1) : "";
  const nav = new URLSearchParams(search).get("nav");

  if (pathname.startsWith("/bot") || pathname.startsWith("/dashboard/telegram")) return "telegram";
  if (pathname.startsWith("/account")) return "account";
  if (pathname.startsWith("/help")) return "help";
  if (pathname.startsWith("/contact")) return "help";

  // Account settings are a `/dashboard/` URL but belong to the account tab.
  if (pathname === "/dashboard/settings" || pathname.startsWith("/dashboard/settings/")) {
    return "account";
  }
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    if (pathname.startsWith("/dashboard/telegram")) return "telegram";
    if (pathname.startsWith("/dashboard/credits") || pathname.startsWith("/dashboard/rewards") || pathname.startsWith("/dashboard/audience")) return "credits";
    return "sites";
  }

  // Fallback to longest literal prefix match for public / marketing pages.
  let best: string | null = null;
  let bestLen = -1;
  for (const link of NAV_LINKS) {
    for (const m of link.match) {
      if ((raw === m || raw.startsWith(m + "/")) && m.length > bestLen) {
        best = link.key;
        bestLen = m.length;
      }
    }
  }
  return best;
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string)
  );
}

function planBadge(plan?: string | null): string {
  const p = String(plan || "free").toLowerCase();
  const label = p === "agency" ? "Agency" : p === "pro" ? "Pro" : p === "starter" ? "Starter" : "Free";
  const mod = p === "free" ? "gm-badge--free" : "gm-badge--paid";
  return `<span class="gm-badge ${mod}">${label}</span>`;
}

export interface ShellNavOpts {
  activePath?: string;
  active?: string;
  user?: ShellUser;
  logoutAction?: string;
  /** @deprecated use accountHref */
  settingsHref?: string;
  accountHref?: string;
  theme?: "light" | "dark";
}

export function profileMenuHtml(opts: ShellNavOpts & { mobileTabs?: string; standalone?: boolean; dynamicIdentity?: boolean } = {}): string {
  const active = opts.active || activeKey(opts.activePath || "/") || "";
  const rawName = opts.user?.display_name?.trim()
    || opts.user?.email?.split("@")[0]
    || "—";
  const name = esc(rawName);
  const initial = rawName === "—" ? "…" : rawName[0].toUpperCase();
  const badge = planBadge(opts.user?.plan);
  const area = encodeURIComponent(active || "dashboard");
  const returnTo = encodeURIComponent(opts.activePath || "/dashboard");
  const helpQuery = `area=${area}&amp;return=${returnTo}`;
  const accountHref = esc(opts.accountHref || opts.settingsHref || "/dashboard/settings");
  const accountLabel = "Account settings";
  const profileClass = opts.standalone ? "gm-profile gm-profile--standalone" : "gm-profile";
  const identityAttr = opts.dynamicIdentity ? " data-profile-name" : "";
  const profileNav = opts.mobileTabs ? `<div class="gm-profile-nav">${opts.mobileTabs}</div>` : "";
  const profileHtml = `<details class="${profileClass}">
        <summary class="gm-profile-trigger">
          <span class="gm-who-avatar" aria-hidden="true">${esc(initial)}</span>
          <span class="gm-who-id"><span class="gm-who-name"${identityAttr}>${name}</span>${badge}</span>
          <span class="gm-profile-chevron" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></span>
        </summary>
        <div class="gm-profile-menu">
          ${profileNav}
          <div class="gm-profile-id"><span class="gm-profile-id-name"${identityAttr}>${name}</span>${badge}</div>
          <button class="gm-profile-link" id="yrThemeToggle" type="button"><span class="gm-profile-ic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg></span>Appearance</button>
          ${opts.standalone ? "" : `
          <a class="gm-profile-link" href="${accountHref}"><span class="gm-profile-ic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9c-.18-.7-.43-1.36-.79-1.95a2 2 0 0 1 .63-2.75l.06-.06a2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33h.09A1.65 1.65 0 0 0 9 4.6V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09c0 .66.25 1.28.67 1.75h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V15z"/></svg></span>${accountLabel}</a>
          `}
          <a class="gm-profile-link" href="/help/support?${helpQuery}" data-open-support><span class="gm-profile-ic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>Help &amp; feedback</a>
          <form method="POST" action="${esc(opts.logoutAction || "/logout")}?next=${esc(returnTo)}" class="gm-logout-form"><button class="gm-logout" type="submit"><span class="gm-profile-ic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></span>Sign out</button></form>
        </div>
      </details>`;
  return profileHtml;
}

import { brandMarkSvg } from "./brand-assets.js";

/**
 * Signed-out variant of the same header. Pages that can be reached by both
 * visitors and signed-in streamers (Help) render this when there is no
 * session, so the chrome stays identical instead of switching to a different
 * marketing top bar.
 */
export function publicNavHtml(opts: { activePath?: string; theme?: "light" | "dark" } = {}): string {
  const theme = opts.theme || "dark";
  const next = encodeURIComponent(opts.activePath || "/");
  return `<header class="gm-shell-nav gm-shell-nav--${theme}" data-theme="${theme}">
  <div class="gm-shell-inner">
    <a class="gm-brand" href="/">
      <span class="gm-brand-mark">${brandMarkSvg()}</span>
      <span class="gm-brand-word">YourRank</span>
    </a>
    <div class="gm-tabs-wrap">
      <nav class="gm-tabs" aria-label="Site">
        <a class="gm-tab" href="/pricing">Pricing</a>
        <a class="gm-tab" href="/docs">Docs</a>
      </nav>
    </div>
    <div class="gm-who gm-who--anon">
      <a class="gm-anon-link" href="/login?next=${next}">Sign in</a>
      <a class="gm-anon-cta" href="/signup">Get started</a>
    </div>
  </div>
</header>`;
}

export function shellNavHtml(opts: ShellNavOpts = {}): string {
  const active = opts.active || activeKey(opts.activePath || "/") || "";
  const theme = opts.theme || "dark";
  const headerClass = `gm-shell-nav gm-shell-nav--${theme}`;
  const topLinks = NAV_LINKS.filter((l) => l.top);
  const tabs = topLinks.map((l) => {
    const isActive = l.key === active;
    return `<a class="gm-tab${isActive ? " gm-tab--active" : ""}"` +
      `${isActive ? ' aria-current="page"' : ""} href="${l.href}">${l.label}</a>`;
  }).join("");

  // The tab bar is hidden on narrow viewports (it cannot fit next to the
  // account chip), so the same destinations are repeated inside the account
  // menu and revealed by CSS at the same breakpoint.
  const mobileTabs = topLinks.map((l) => {
    const isActive = l.key === active;
    return `<a class="gm-profile-link gm-profile-link--nav${isActive ? " is-active" : ""}"` +
      `${isActive ? ' aria-current="page"' : ""} href="${l.href}">${l.label}</a>`;
  }).join("");

  return `<header class="${headerClass}" data-theme="${theme}">
  <div class="gm-shell-inner">
    <a class="gm-brand" href="/dashboard">
      <span class="gm-brand-mark">${brandMarkSvg()}</span>
      <span class="gm-brand-word">YourRank</span>
    </a>
    <div class="gm-tabs-wrap">
      <nav class="gm-tabs" aria-label="Dashboard">${tabs}</nav>
    </div>
    <div class="gm-who">
      ${profileMenuHtml({
        activePath: opts.activePath,
        active,
        user: opts.user,
        logoutAction: opts.logoutAction,
        accountHref: String(opts.accountHref || opts.settingsHref || "") || undefined,
        theme: opts.theme,
        mobileTabs,
        standalone: false
      })}
    </div>
  </div>
</header>`;
}

/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

import {
  channelPage,
  overviewPage,
  rulesPage,
  shopPage,
  redemptionsPage,
} from "./credits-pages.js";
import { DashboardShell } from "./dashboard-shell.jsx";
import { chromeStateFor } from "../assets/dashboard/routes.js";

const PAGES = { channel: channelPage, overview: overviewPage, rules: rulesPage, shop: shopPage, redemptions: redemptionsPage };

export const REWARDS_TABS = [
  { key: "overview", label: "Overview", href: "/dashboard/rewards" },
  { key: "rules", label: "Ways to earn", href: "/dashboard/rewards/rules" },
  { key: "shop", label: "Shop", href: "/dashboard/rewards/shop" },
  { key: "redemptions", label: "Claims", href: "/dashboard/rewards/redemptions" },
];

function RewardsTabs({ active }) {
  return (
    <nav class="v3-tabs rewards-tabs" aria-label="Rewards sections">
      {REWARDS_TABS.map((t) => (
        <a
          class={"v3-tab" + (t.key === active ? " is-on" : "")}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
        >
          {t.label}
        </a>
      ))}
    </nav>
  );
}

function RewardsContent({ tab, subnav = true }) {
  const body = PAGES[tab] || overviewPage;
  return <div class="cr-workspace-content">
    {subnav ? <RewardsTabs active={tab} /> : null}
    <div id="cr-loading" class="ui-loading" role="status" aria-live="polite" aria-busy="true" hidden><div class="ui-loading__spinner"></div><span class="sr-only">Loading rewards…</span></div>
    <div id="cr-app" data-cr-tab={tab} hidden dangerouslySetInnerHTML={{ __html: body }}></div>
    <div id="cr-empty" class="empty cr-loading-state" hidden><div class="ui-loading__spinner" aria-hidden="true"></div><p>Loading your rewards dashboard…</p></div>
  </div>;
}

function RewardsPage({ tab, activePath, boardContext = "selector", footer = "rewards", user, fragment }) {
  const chrome = chromeStateFor("rewards", tab);
  if (fragment) return <RewardsContent tab={tab} />;
  return <DashboardShell activeNav={chrome.navKey} activePath={activePath || chrome.canonicalPath} boardContext={boardContext} crumbs={chrome.crumbs} footer={footer} rootId="cr-dash" user={user}>
    <RewardsContent tab={tab} />
  </DashboardShell>;
}

// Site settings → Connections: the Kick connection owns its own page because
// the connection is stored on the selected site. It reuses the rewards
// fragment content and boot module; only the chrome (rail owner, crumbs,
// title) differs.
function SiteConnectionsPage({ activePath, user, fragment } = {}) {
  const chrome = chromeStateFor("siteConnections", "channel");
  if (fragment) return <RewardsContent tab="channel" subnav={false} />;
  return <DashboardShell activeNav={chrome.navKey} activePath={activePath || chrome.canonicalPath} boardContext="selector" crumbs={chrome.crumbs} footer="rewards" rootId="cr-dash" user={user}>
    <RewardsContent tab="channel" subnav={false} />
  </DashboardShell>;
}

export function RewardsChannelPage({ user, fragment } = {}) { return <SiteConnectionsPage user={user} fragment={fragment} />; }
export function RewardsOverviewPage({ user, fragment } = {}) { return <RewardsPage tab="overview" user={user} fragment={fragment} />; }
export function RewardsRulesPage({ user, fragment } = {}) { return <RewardsPage tab="rules" user={user} fragment={fragment} />; }
export function RewardsShopPage({ user, fragment } = {}) { return <RewardsPage tab="shop" user={user} fragment={fragment} />; }
export function RewardsRedemptionsPage({ user, fragment } = {}) { return <RewardsPage tab="redemptions" user={user} fragment={fragment} />; }

const rewardsConfigBase = { styles: ["/assets/app.css", "/assets/shell-nav.css", "/assets/ui.css", "/assets/dashboard-v4.css"], scripts: ['<script src="/assets/credits.js?v=4" type="module"></script>', '<script src="/assets/shell-nav.js?v=4" defer></script>'], nav: false, footer: false, wide: true, bootWatchdog: true };
export const rewardsChannelConfig = { ...rewardsConfigBase, title: chromeStateFor("siteConnections", "channel").documentTitle, canonical: "https://yourrank.site/dashboard/site/connections" };
export const rewardsOverviewConfig = { ...rewardsConfigBase, title: chromeStateFor("rewards", "overview").documentTitle, canonical: "https://yourrank.site/dashboard/rewards" };
export const rewardsRulesConfig = { ...rewardsConfigBase, title: chromeStateFor("rewards", "rules").documentTitle, canonical: "https://yourrank.site/dashboard/rewards/rules" };
export const rewardsShopConfig = { ...rewardsConfigBase, title: chromeStateFor("rewards", "shop").documentTitle, canonical: "https://yourrank.site/dashboard/rewards/shop" };
export const rewardsRedemptionsConfig = { ...rewardsConfigBase, title: chromeStateFor("rewards", "redemptions").documentTitle, canonical: "https://yourrank.site/dashboard/rewards/redemptions" };

export const rewardsChannelPage = { config: rewardsChannelConfig, Component: RewardsChannelPage };
export const rewardsOverviewPage = { config: rewardsOverviewConfig, Component: RewardsOverviewPage };
export const rewardsRulesPage = { config: rewardsRulesConfig, Component: RewardsRulesPage };
export const rewardsShopPage = { config: rewardsShopConfig, Component: RewardsShopPage };
export const rewardsRedemptionsPage = { config: rewardsRedemptionsConfig, Component: RewardsRedemptionsPage };

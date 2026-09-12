/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

// The Engage workspace merges code drops, rewards, and giveaways behind one
// rail item, so every surface shares this single tab strip. `Giveaways` links
// the section root; it redirects to the default Chat tab.
export const ENGAGE_TABS = [
  { key: "activities", label: "Activities", href: "/dashboard/activities" },
  { key: "rewards", label: "Rewards", href: "/dashboard/rewards" },
  { key: "shop", label: "Shop", href: "/dashboard/rewards/shop" },
  { key: "rules", label: "Ways to earn", href: "/dashboard/rewards/rules" },
  { key: "redemptions", label: "Claims", href: "/dashboard/rewards/redemptions" },
  { key: "giveaways", label: "Giveaways", href: "/dashboard/giveaways" },
];

export function EngageTabs({ active }) {
  return (
    <nav class="v3-tabs engage-tabs" aria-label="Engage sections">
      {ENGAGE_TABS.map((t) => (
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

export function engageTabsHtml(active) {
  const items = ENGAGE_TABS.map(
    (t) => `<a class="v3-tab${t.key === active ? " is-on" : ""}" href="${t.href}"${t.key === active ? ' aria-current="page"' : ""}>${t.label}</a>`,
  ).join("");
  return `<nav class="v3-tabs engage-tabs" aria-label="Engage sections">${items}</nav>`;
}

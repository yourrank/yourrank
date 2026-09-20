/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

// Engage is creator-run engagement: Activities + Giveaways. Rewards is its
// own workspace. `Giveaways` links the section root; it redirects to Chat.
export const ENGAGE_TABS = [
  { key: "activities", label: "Activities", href: "/dashboard/activities" },
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

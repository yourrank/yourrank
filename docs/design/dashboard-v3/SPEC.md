# Dashboard v3 — design spec

Source of truth: the twelve reference renders in this folder, exported from the
streamer's design PDF (`Sans titre-1-1.pdf`, 2026-08-11). Every dashboard screen
must match its reference render: same structure, same order, same copy pattern,
same spacing. When code and reference disagree, the reference wins.

| Reference | Screen | Route |
| --- | --- | --- |
| `01-leaderboard.png` | Leaderboard table, three rows selected, bulk bar | `/dashboard/editor/players` |
| `02-leaderboard-empty.png` | Leaderboard empty state + Import menu | `/dashboard/editor/players` |
| `03-rewards-redemptions.png` | Redemptions queue + fulfil confirm popover | `/dashboard/rewards/redemptions` |
| `04-overview-setup.png` | Overview, setup checklist (board not live) | `/dashboard` |
| `05-overview-live.png` | Overview, KPIs + activity + top players + status bar | `/dashboard` |
| `06-page-setup.png` | Page editor, Setup tab + live preview rail | `/dashboard/editor/design` |
| `07-rewards-shop-items.png` | Shop items grid + create-item drawer | `/dashboard/rewards/shop` |
| `08-rewards-channel.png` | Kick channel integration | `/dashboard/settings/integrations` |
| `10-analytics.png` | Analytics KPIs, views chart, activity table | `/dashboard/analytics/activity` |
| `11-settings-plan.png` | Settings → Plan & Usage | `/dashboard/settings` |
| `12-settings-security.png` | Settings → Security + danger zone | `/dashboard/settings` |

## Tokens

Measured off the renders; they are already declared in
`apps/leaderboard/src/assets/dashboard-v3.css` and must not be re-invented per
page.

- Operator surfaces (dashboard, bot dashboard, account, marketing, and emails) use the dark theme `#0F0F23` with `#7C3AED` as the primary accent. Public streamer-facing surfaces (the `.yr-site` shell: home, leaderboard, shop, and `/me`, plus the OBS overlay) deliberately default to Kick lime `#53FC18`; streamers override it per site through `theme_json.accentA`.
- Chrome (topbar, sidebar) `#0A0A0A`; sidebar card `#131313`; hairlines `rgba(255,255,255,0.08)`.
- Content background `#0F0F23`; cards `rgba(255,255,255,0.03)`; hairline `rgba(255,255,255,0.08)`.
- Danger `#F43F5E`, warning `#F59E0B`.
- Radius 12px cards, 8px controls, 6px chips.
- Type: Fira Sans for prose and headings, Fira Code for numbers, counters, table
  headers, meta labels (`50 / 9999 PLAYERS TRACKED`, money, timestamps, ids).

## Layout

- Topbar: fixed, 72px tall, black. Left: `Y` accent mark + `YourRank`. Center:
  board switcher pill (`BOARD:` mono label + board name + chevron). Right:
  `LIVE`/`NOT LIVE` dot chip (mono, uppercase), `Publish site` accent button,
  avatar.
- Sidebar: fixed, 260px, black, full height under the topbar. Top: `ACTIVE BOARD`
  mono label card with the board name, a stepper chevron and a full-width
  `+ New board` outline button. Then the nav: Overview, Leaderboard, Page,
  Credits (Redemptions, Shop, Credit rules, Viewers, Credit activity), Analytics, Past periods, Settings — 24px icons, active item
  has a 3px accent left bar, `#1A1A1A` fill and accent icon. Bottom: accent
  `View live page ↗` link and the `VIP PRO / Active` usage card with the API
  usage meter.
- Content: 32px padding. Page title 34px/700 with a mono or prose sub-line under
  it. Cards are white, 1px hairline, 12px radius, no shadow at rest.
- Tab bars (`Site`, `Credits`, `Analytics`, `Settings`) are text tabs with
  a 2px underline on the active tab, sitting on a full-width hairline.
- Tables: mono uppercase headers on `#FAFAFA`, 1px row hairlines, 41px rows,
  right-aligned numeric columns in mono, row hover `#FAFAFA`, selected row
  `#EDFEE7` with an accent checkbox.
- Bulk actions appear in a floating black bar centred over the content.
- Toggles: 40x22 pill, accent when on with a black knob, `#3F3F46` when off.
- Status chips: pending amber, fulfilled green, refunded blue, cancelled grey —
  all with a leading icon, mono label.

## Rules

- Server-rendered markup and progressive enhancement as today; no new framework.
- Reuse the v3 tokens and shared components; a page-specific colour or radius is
  a bug.
- Keep every existing behaviour, endpoint and permission check intact — this is a
  visual rebuild, not a rewrite of the data layer.
- Mobile: sidebar collapses behind the topbar menu button, cards go full width,
  tables scroll horizontally inside their card.

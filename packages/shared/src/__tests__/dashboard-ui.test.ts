import { describe, expect, it } from "bun:test";
import {
  SCOPE_LABELS,
  actionHtml,
  actionsHtml,
  drawerShellHtml,
  emptyStateHtml,
  errorStateHtml,
  listShellHtml,
  loadingStateHtml,
  pageHeaderHtml,
  scopeIndicatorHtml,
  statusBadgeHtml,
  subnavHtml,
} from "../dashboard-ui.js";

// dashboard-ui.ts is the single owner of shared dashboard presentation
// primitives. These tests pin the rendered contract every Worker relies on.
describe("dashboard ui primitives", () => {
  it("renders primary, secondary and destructive actions on the workspace button classes", () => {
    expect(actionHtml({ label: "Save", variant: "primary", type: "submit" }))
      .toBe('<button class="v3-btn v3-btn--accent" type="submit">Save</button>');
    expect(actionHtml({ label: "Cancel" })).toBe('<button class="v3-btn" type="button">Cancel</button>');
    expect(actionHtml({ label: "Delete", variant: "destructive", size: "sm" }))
      .toBe('<button class="v3-btn v3-btn--danger v3-btn--sm" type="button">Delete</button>');
    expect(actionHtml({ label: "Open", href: "/dashboard/rewards", variant: "primary" }))
      .toBe('<a class="v3-btn v3-btn--accent" href="/dashboard/rewards">Open</a>');
    // Disabled links fall back to a disabled button so the action cannot be followed.
    expect(actionHtml({ label: "Open", href: "/x", disabled: true })).toContain("<button");
    expect(actionHtml({ label: "Open", href: "/x", disabled: true })).toContain(" disabled");
    expect(actionsHtml([])).toBe("");
    expect(actionsHtml([{ label: "A" }, { label: "B" }])).toMatch(/^<div class="v3-actions">.*<\/div>$/);
  });

  it("escapes every text and attribute value", () => {
    const html = actionHtml({ label: "<b>x</b>", href: '/a"b', attrs: { "data-x": "1<2" } });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain('href="/a&quot;b"');
    expect(html).toContain('data-x="1&lt;2"');
    expect(statusBadgeHtml({ label: "<live>" })).toContain("&lt;live&gt;");
    expect(pageHeaderHtml({ title: "A & B" })).toContain("<h1>A &amp; B</h1>");
  });

  it("names the three scopes and exposes the kind for styling", () => {
    expect(SCOPE_LABELS).toEqual({ account: "Account-wide", site: "Current site", bot: "Current bot" });
    for (const kind of ["account", "site", "bot"] as const) {
      const html = scopeIndicatorHtml({ kind, name: kind === "account" ? null : "Nightly" });
      expect(html).toContain(`data-scope="${kind}"`);
      expect(html).toContain(`<span class="v3-scope-label">${SCOPE_LABELS[kind]}</span>`);
      if (kind === "account") expect(html).not.toContain("v3-scope-name");
      else expect(html).toContain('<span class="v3-scope-name">Nightly</span>');
    }
  });

  it("renders status badges from data rather than fixed status names", () => {
    const html = statusBadgeHtml({ label: "Live", tone: "success", status: "live", live: true });
    expect(html).toContain('data-tone="success"');
    expect(html).toContain('data-status="live"');
    expect(html).toContain('role="status" aria-live="polite"');
    expect(statusBadgeHtml({ label: "Draft" })).toContain('data-tone="neutral"');
    expect(statusBadgeHtml({ label: "Draft" })).not.toContain("data-status");
  });

  it("renders the page header with optional kicker, scope, badge, description and actions", () => {
    const plain = pageHeaderHtml({ title: "Rewards", titleAttrs: { "data-chrome-h1": true } });
    expect(plain).toBe('<header class="v3-head"><div class="v3-head-col"><h1 data-chrome-h1>Rewards</h1></div></header>');
    const full = pageHeaderHtml({
      title: "Giveaways",
      kicker: "Engage",
      description: "Run chat giveaways.",
      scope: { kind: "site", name: "Nightly" },
      badge: { label: "Live", tone: "success" },
      actions: [{ label: "New", variant: "primary" }],
    });
    expect(full).toContain('class="v3-head v3-head--row"');
    expect(full).toContain('<p class="v3-head-kicker">Engage</p>');
    expect(full).toContain('<div class="v3-head-meta"><span class="v3-scope" data-scope="site">');
    expect(full).toContain('<p class="v3-head-sub">Run chat giveaways.</p>');
    expect(full).toContain('<div class="v3-head-actions"><button class="v3-btn v3-btn--accent" type="button">New</button></div>');
  });

  it("marks exactly one subnav item current and keeps route links plain anchors", () => {
    const items = [
      { key: "chat", label: "Chat Giveaway", href: "/dashboard/giveaways/chat" },
      { key: "raffles", label: "Raffle", href: "/dashboard/giveaways/raffles" },
      { key: "preds", label: "Prediction", href: "/dashboard/giveaways/predictions" },
    ];
    const html = subnavHtml({ items, active: "raffles", label: "Giveaways", className: "gw-subnav" });
    expect(html.startsWith('<nav class="v3-tabs gw-subnav" aria-label="Giveaways" data-subnav-strip>')).toBe(true);
    expect(html).not.toContain('role="tablist"');
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    expect(html).toContain('<a class="v3-tab is-on" href="/dashboard/giveaways/raffles" aria-current="page" data-subnav="raffles">Raffle</a>');
    expect(html).toContain('<a class="v3-tab" href="/dashboard/giveaways/chat" data-subnav="chat">Chat Giveaway</a>');
    expect(subnavHtml({ items, active: "nope", label: "Giveaways" })).not.toContain("is-on");
  });

  it("renders in-page tab strips as a tablist with roving focus", () => {
    const html = subnavHtml({
      items: [
        { key: "a", label: "A", href: "/x/a", attrs: { "data-settings-tab": "a" } },
        { key: "b", label: "B", href: "/x/b" },
      ],
      active: "a",
      label: "Settings sections",
      tablist: true,
    });
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab" aria-selected="true" tabindex="0" data-settings-tab="a"');
    expect(html).toContain('role="tab" aria-selected="false" tabindex="-1"');
  });

  it("renders empty, error and loading states with machine-readable data-state", () => {
    const empty = emptyStateHtml({ title: "Nothing yet", body: "Create one.", actions: [{ label: "Create", variant: "primary" }] });
    expect(empty).toContain('class="v3-empty" data-state="empty"');
    expect(empty).toContain("<h2>Nothing yet</h2><p>Create one.</p>");
    expect(empty).toContain('<div class="v3-empty-actions">');

    const error = errorStateHtml({ title: "Couldn't load", actions: [{ label: "Retry" }] });
    expect(error).toContain('class="v3-empty v3-empty--error" data-state="error" role="alert"');

    const loading = loadingStateHtml({ label: "Loading rewards", lines: 2, id: "rw-loading" });
    expect(loading).toContain('data-state="loading" role="status" aria-live="polite" aria-busy="true" id="rw-loading"');
    expect(loading.match(/v3-skeleton-line/g)?.length).toBe(2);
    expect(loading).toContain('<span class="sr-only">Loading rewards</span>');
    expect(loadingStateHtml({ label: "Loading", lines: 0 })).toContain("ui-loading__spinner");
    expect(loadingStateHtml({ label: "Loading", hidden: true })).toContain(" hidden");
  });

  it("wraps list bodies in a labelled table shell with optional head and foot", () => {
    const bare = listShellHtml({ label: "Members", body: "<table></table>" });
    expect(bare).toBe('<section class="v3-table-card v3-list-shell" aria-label="Members"><div class="v3-list-shell-body"><table></table></div></section>');
    const full = listShellHtml({ label: "Members", title: "Members", description: "Who joined", actions: [{ label: "Export" }], body: "<ul></ul>", footer: "<p>10 of 40</p>", id: "members" });
    expect(full).toContain('<div class="v3-list-shell-head"><div class="v3-list-shell-copy"><h2>Members</h2><p>Who joined</p></div><div class="v3-list-shell-actions">');
    expect(full).toContain('<div class="v3-list-shell-foot"><p>10 of 40</p></div>');
    expect(full).toContain(' id="members"');
  });

  it("renders an accessible drawer shell that can host a form", () => {
    const html = drawerShellHtml({
      id: "rw-drawer",
      title: "Edit reward",
      description: "Changes save on submit.",
      body: '<input name="title">',
      actions: [{ label: "Cancel", attrs: { "data-drawer-close": true } }, { label: "Save", variant: "primary", type: "submit" }],
      form: { method: "post", "data-drawer-form": true },
      hidden: true,
    });
    expect(html).toContain('<div class="v3-drawer" id="rw-drawer" data-drawer hidden>');
    expect(html).toContain('<div class="v3-drawer-backdrop" data-drawer-close></div>');
    expect(html).toContain('role="dialog" aria-modal="true" aria-labelledby="rw-drawer-title" aria-describedby="rw-drawer-desc"');
    expect(html).toContain('<h2 id="rw-drawer-title">Edit reward</h2><p id="rw-drawer-desc">Changes save on submit.</p>');
    expect(html).toContain('<form class="v3-drawer-form" method="post" data-drawer-form><div class="v3-drawer-body"><input name="title"></div>');
    expect(html).toContain('<footer class="v3-drawer-foot"><div class="v3-drawer-actions">');
    expect(html).toContain('aria-label="Close"');
    expect(drawerShellHtml({ id: "d", title: "T", body: "", footer: "<b>custom</b>" })).toContain('<footer class="v3-drawer-foot"><b>custom</b></footer>');
  });
});

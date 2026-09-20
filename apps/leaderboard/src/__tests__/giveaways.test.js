import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { handleGiveawayChatroom } from "../handlers/giveaway.js";
import { GiveawaysPage } from "../pages/giveaways.jsx";
import { giveawaysHtml, renderGiveawayDrawersHtml, renderGiveawaysContentHtml, renderGiveawaysHtml } from "../pages/giveaway-pages.js";

const gamesSource = readFileSync(new URL("../assets/dashboard/games.js", import.meta.url), "utf8");
const siteSource = readFileSync(new URL("../assets/dashboard/site.js", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../assets/dashboard.js", import.meta.url), "utf8");
const previewTabsSource = readFileSync(new URL("../assets/dashboard/preview-tabs.js", import.meta.url), "utf8");
const giveawaysSource = readFileSync(new URL("../assets/giveaways.js", import.meta.url), "utf8");
const giveawaysCssSource = readFileSync(new URL("../assets/giveaways.css", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../assets/dashboard/shell.js", import.meta.url), "utf8");

function collectGiveawayClasses(source) {
  const classes = new Set();
  for (const match of source.matchAll(/class(?:Name)?\s*=\s*["'`]([^"'`]+)["'`]/g)) {
    for (const className of match[1].matchAll(/["']?(gw-[A-Za-z0-9_-]+)/g)) {
      if (!className[1].endsWith("-")) classes.add(className[1]);
    }
  }
  for (const match of source.matchAll(/classList\.(?:add|remove|toggle)\(([^)]*)\)/g)) {
    for (const className of match[1].matchAll(/["'](gw-[A-Za-z0-9_-]+)["']/g)) {
      classes.add(className[1]);
    }
  }
  return classes;
}

describe("Giveaway Chatroom Handler", () => {
  const allowRateLimit = async () => ({ ok: true, remaining: 59, limit: 60, retryAfter: 0 });

  it("returns numeric chatroom ID when provided directly", async () => {
    const req = new Request("http://localhost/api/giveaways/chatroom?channel=12345678");
    const res = await handleGiveawayChatroom(req, {}, { rateLimitImpl: allowRateLimit });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.chatroomId).toBe(12345678);
    expect(data.channel).toBe("12345678");
  });

  it("returns 400 when channel parameter is missing and user has no site", async () => {
    const req = new Request("http://localhost/api/giveaways/chatroom");
    const res = await handleGiveawayChatroom(req, {}, { rateLimitImpl: allowRateLimit });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Missing channel parameter");
  });

  it("rejects over-limit callers before contacting Kick", async () => {
    let fetchCalled = false;
    const req = new Request("http://localhost/api/giveaways/chatroom?channel=streamer");
    const res = await handleGiveawayChatroom(req, {}, {
      rateLimitImpl: async () => ({ ok: false, remaining: 0, limit: 60, retryAfter: 60 }),
      fetchImpl: async () => {
        fetchCalled = true;
        return new Response("{}");
      },
    });
    expect(res.status).toBe(429);
    expect(fetchCalled).toBe(false);
  });

  it("builds entrant markup without interpolating API values into HTML", () => {
    const source = readFileSync(new URL("../assets/giveaways.js", import.meta.url), "utf8");
    expect(source).not.toContain("tr.innerHTML");
    expect(source).toContain("message.textContent = entrant.message");
    expect(source).toContain("userLink.textContent = entrant.username");
    expect(source).toContain("safeAvatarUrl(entrant.avatar_url, DEFAULT_AVATAR)");
  });

  it("runs Chat Giveaways through the connected Kick channel and server API, not the legacy listener", () => {
    const source = readFileSync(new URL("../assets/giveaways.js", import.meta.url), "utf8");
    for (const legacy of ["connectKickChat", "chat-entry.js", "/api/giveaways/chatroom", "chatroomId", "Resolving Kick chatroom", "Start Listening", "Refreshing will clear"]) {
      expect(source).not.toContain(legacy);
    }
    expect(source).toContain('sitePath(`/api/giveaways/chat${path}`)');
    expect(source).toContain('chatApi("/start"');
    expect(source).toContain('chatApi("/stop"');
    expect(source).toContain('chatApi("/draw"');
    expect(source).toContain("const POLL_MS = 4000");
    expect(source).toContain('label.textContent = "Stop entries"');
    expect(source).toContain('label.textContent = "Start giveaway"');
    // No editable channel: the connected channel is displayed, arbitrary entry is gone.
    expect(giveawaysHtml).not.toContain('id="gw-channel-input"');
    expect(giveawaysHtml).toContain('id="gw-channel-name"');
    expect(giveawaysHtml).toContain("Chat giveaways require a connected Kick channel.");
    expect(giveawaysHtml).toContain('id="gw-btn-connect-kick" href="/dashboard/settings/connections"');
    for (const legacy of ["Connect &amp; Start Listening", "chatroom", 'id="gw-chat-feed"', 'id="gw-opt-case"', 'id="gw-opt-exact"', 'id="gw-trust-min"']) {
      expect(giveawaysHtml).not.toContain(legacy);
    }
  });

  it("loads the server-rendered giveaway tab on initialization", () => {
    const source = readFileSync(new URL("../assets/giveaways.js", import.meta.url), "utf8");
    expect(source).toContain('document.querySelector(".gw-tab-btn.is-active")?.dataset.tab');
    expect(source).toContain('if (activeTab === "raffles") loadRaffles();');
    expect(source).toContain('if (activeTab === "drops") loadCodeDrops();');
    expect(source).toContain('if (activeTab === "preds") loadPredictions();');
    expect(source).not.toContain('querySelectorAll(".gw-tab-btn").forEach((btn) => {');
  });

  it("renders GiveawaysPage properly", () => {
    const vnode = GiveawaysPage({ user: { id: "u-1", email: "streamer@test.com" } });
    expect(vnode).toBeTruthy();
    const html = vnode.toString();
    expect(html).toContain("Giveaways");
    expect(html).toContain("gw-setup-form");
    expect(html).toContain("gw-channel-name");
    expect(html).toContain("gw-roller");
  });

  it("renders each giveaway tab as a deep-linkable active server view", () => {
    const html = renderGiveawaysHtml("raffles");
    expect(html).toContain('href="/dashboard/giveaways/raffles"');
    expect(html).toContain("<h1>Raffles</h1>");
    expect(html).toContain('id="tab-btn-raffles"');
    expect(html).toContain('id="pane-raffles"');
    expect(html).toContain('class="gw-tab-pane is-active" id="pane-raffles"');
    expect(html).toContain('class="gw-tab-pane" id="pane-chat" hidden');
  });

  it("paints Engage refusals in a page-level alert outside the tab panes", () => {
    const html = renderGiveawaysContentHtml("raffles");
    const alertIndex = html.indexOf('id="gw-page-alert"');
    expect(alertIndex).toBeGreaterThan(-1);
    // Ahead of every pane, so a refusal on any tab is visible rather than being
    // written into a hidden pane.
    expect(alertIndex).toBeLessThan(html.indexOf('class="gw-tab-pane'));
    expect(html).toContain('<p class="gw-page-alert" id="gw-page-alert" role="alert"');
    // Styled as an error by the stylesheet the page actually loads, so the
    // refusal does not render as ordinary body copy.
    expect(giveawaysCssSource).toContain(".gw-page-alert {");

    expect(giveawaysSource).toContain('function showEngageError(message)');
    expect(giveawaysSource).toContain('const alert = $("gw-page-alert")');
    // The Kick connection badge (gw-status-text, inside the chat pane) stays a
    // connection indicator and is never used as the Engage error surface.
    expect(giveawaysSource).not.toContain('fallbackId');
  });

  it("keeps the single OBS copy action in the overlay designer, not the shell", () => {
    const designerSource = readFileSync(new URL("../assets/dashboard/overlay-designer.js", import.meta.url), "utf8");
    expect(designerSource).toContain('$("odCopy")');
    for (const id of ["odCopy", "ov-btn-copy-pred-hud", "ov-btn-copy-alerts", "ov-btn-copy-ticker"]) {
      expect(shellSource).not.toContain(id);
    }
    // The standalone HUD/alerts/ticker copy cards left the Share page.
    for (const id of ["ov-btn-copy-pred-hud", "ov-btn-copy-alerts", "ov-btn-copy-ticker"]) {
      expect(siteSource).not.toContain(id);
    }
  });

  it("keeps giveaway history tables on the canonical table markup", () => {
    expect(giveawaysHtml).not.toContain('class="gw-table"');
    expect(giveawaysHtml).not.toContain('class="gw-table-wrap"');
    expect(giveawaysHtml.match(/<table\b/g)).toHaveLength(4);
    expect(giveawaysHtml.match(/<div class="v3-table-scroll">\s*<table class="v3-table">/g)).toHaveLength(4);
  });

  it("keeps draw options behind the disclosure", () => {
    expect(giveawaysHtml).toContain('<details class="cr-advanced gw-setup-advanced" data-ui-advanced>');
    expect(giveawaysHtml).toContain('id="gw-opt-subs-perk"');
    expect(giveawaysHtml).toContain('id="gw-opt-skip-past"');
    expect(giveawaysHtml).toContain('id="gw-opt-claim-req"');
    expect(giveawaysHtml).toContain('id="gw-opt-claim-duration"');
    expect(giveawaysHtml).toContain('<option value="60" selected>60 seconds</option>');
    expect(giveawaysHtml).not.toContain('id="gw-opt-claim-req" checked');
    expect(giveawaysHtml).toContain('id="gw-custom-rule-text"');
    expect(giveawaysHtml).toContain('id="gw-roller-track"');
    expect(giveawaysHtml).toContain('id="gw-winner-stage" role="status" aria-live="polite"');
    expect(giveawaysHtml).toContain('id="gw-roller-track" aria-hidden="true"');
    expect(giveawaysCssSource).toContain(".gw-roller-track--spinning");
    expect(giveawaysCssSource).toContain("color: var(--ws-success)");
    expect(giveawaysCssSource).toContain("@media (prefers-reduced-motion: reduce)");
    expect(giveawaysCssSource).toContain(".gw-winner-stage");
    expect(giveawaysCssSource).toContain(".gw-winner-crown");
    expect(giveawaysSource).toContain('track?.classList.add("gw-roller-track--spinning")');
    expect(giveawaysSource).toContain('track?.classList.remove("gw-roller-track--spinning")');
    expect(giveawaysHtml).not.toContain('id="gw-roller-track" aria-live="polite"');
    expect(giveawaysHtml).toContain('id="gw-stat-time"');
    expect(giveawaysHtml).not.toContain("نعم");
    expect(giveawaysHtml).not.toContain("لا");
    expect(giveawaysHtml).not.toContain('style="');
    expect(giveawaysSource).toContain('|| "Yes"');
    expect(giveawaysSource).toContain('|| "No"');
    expect(giveawaysHtml).not.toContain("🎉");
    expect(giveawaysHtml).not.toContain("💬");
    expect(giveawaysSource).not.toContain("🎉");
    expect(giveawaysSource).not.toContain("⚡");
  });

  it("keeps Giveaway client lookups aligned with the rendered controls", () => {
    const renderedIds = new Set([...giveawaysHtml.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
    const lookupIds = new Set([...giveawaysSource.matchAll(/\$\("([^"]+)"\)/g)].map((match) => match[1]));
    const missingIds = [...lookupIds].filter((id) => !renderedIds.has(id)).sort();

    expect(missingIds).toEqual([]);
    expect(giveawaysSource).toContain('$("gw-btn-roll")?.addEventListener("click"');
    expect(giveawaysSource).toContain('$("gw-btn-reroll")?.addEventListener("click"');
    expect(giveawaysSource).toContain('$("gw-btn-copy-winner")?.addEventListener("click"');
    expect(giveawaysSource).toContain('$("gw-search-entrants")?.addEventListener("input"');
    expect(giveawaysSource).not.toContain('$("gw-roll-btn")');
    expect(giveawaysSource).not.toContain('$("gw-reroll-btn")');
    expect(giveawaysSource).not.toContain('$("gw-copy-winner")');
    expect(giveawaysSource).not.toContain('$("gw-search-input")');
    expect(giveawaysSource).not.toContain('$("gw-clear-btn")');
    expect(giveawaysSource).not.toContain("clearChatFeed");
    expect(giveawaysSource).not.toContain("lastChild.textContent");
    expect(giveawaysSource).not.toContain('"gw-claim-bar-fill"');
    expect(giveawaysSource).toContain('$("gw-winner-stage")');
    expect(giveawaysSource).toContain('$("gw-stage-idle")');
    expect(giveawaysSource).toContain('$("gw-listen-btn-label")');
    expect(giveawaysHtml).toContain('id="gw-roller-track"');
    expect(giveawaysHtml).toContain('id="gw-stat-time"');
    expect(giveawaysHtml).toContain('id="gw-opt-claim-duration"');
    expect(giveawaysHtml).toContain('id="gw-opt-claim-req"');
    expect(giveawaysHtml).toContain('id="gw-custom-rule-text"');
  });

  it("keeps Giveaway classes aligned with the canonical stylesheet", () => {
    const renderedClasses = collectGiveawayClasses(
      giveawaysHtml + GiveawaysPage({ user: { id: "u-1" } }).toString(),
    );
    const controllerClasses = collectGiveawayClasses(giveawaysSource);
    const stylesheetClasses = new Set(
      [...giveawaysCssSource.matchAll(/(?<![\w-])\.(gw-[A-Za-z0-9_-]+)/g)].map(
        (match) => match[1],
      ),
    );
    const missingClasses = [
      ...new Set([...renderedClasses, ...controllerClasses]),
    ].filter((className) => !stylesheetClasses.has(className)).sort();

    expect(missingClasses).toEqual([]);
  });

  it("keeps dynamic Giveaway states on stylesheet classes", () => {
    expect(giveawaysSource).not.toContain("style.color");
    expect(giveawaysSource).not.toContain("style.fontStyle");
    expect(giveawaysSource).toContain("gw-claim-status--confirmed");
    expect(giveawaysSource).toContain("gw-claim-status--expired");
    expect(giveawaysCssSource).toContain(".gw-claim-status--confirmed");
    expect(giveawaysCssSource).toContain(".gw-claim-status--expired");
    expect(giveawaysSource).toContain("flashButtonLabel(button, \"Copied!\")");
    expect(giveawaysSource).not.toContain("Copied! ✓");
    expect(giveawaysSource).not.toContain("✓ Copied");
    expect(giveawaysHtml).not.toMatch(/<h2 id="pred-drawer-title"><svg/);
    expect(giveawaysHtml).toContain("Draw Random Winner");
  });

  it("keeps preview frame navigations out of browser history", () => {
    expect(gamesSource).toContain("loadSimulatorFrame(iframe, embedUrl);");
    expect(gamesSource).toContain('loadSimulatorFrame(iframe, iframe.dataset.currentSrc + "&_t=" + Date.now());');

    const resetIndex = siteSource.indexOf("if (!resetPreviewFrame(mount)) return;");
    const submitIndex = siteSource.indexOf("local.form.submit()");
    expect(resetIndex).toBeGreaterThanOrEqual(0);
    expect(submitIndex).toBeGreaterThan(resetIndex);
  });

  it("keeps preview device tabs under a single controller", () => {
    expect(dashboardSource).not.toContain('querySelectorAll(".preview-tab")');
    expect(previewTabsSource).not.toContain("stopImmediatePropagation");
  });

  it("adds CSRF only to Engage mutations and keeps drawers accessible", () => {
    expect(giveawaysSource).toContain('headers.set("x-csrf-token", csrf)');
    expect(giveawaysSource).toContain('if (!["GET", "HEAD", "OPTIONS"].includes(method))');
    expect(giveawaysSource).toContain('responseData(res)');
    expect(giveawaysSource).toContain("showConfirmModal");
    expect(giveawaysSource).toContain("trapEventDrawerFocus");
    expect(giveawaysSource).toContain("sessionStorage.setItem");
    expect(giveawaysSource).not.toMatch(/\b(?:alert|confirm)\s*\(/);
    for (const id of ["rf-drawer", "cd-drawer", "pred-drawer", "settle-drawer"]) {
      expect(giveawaysHtml).toContain(`id="${id}"`);
      expect(giveawaysHtml).toContain('role="dialog" aria-modal="true" aria-labelledby=');
    }
    expect(giveawaysHtml).toContain('id="rf-status"');
    expect(giveawaysHtml).toContain('id="cd-status"');
    expect(giveawaysHtml).toContain('id="pred-status"');
    expect(giveawaysHtml).toContain('id="settle-status"');
  });

  it("keeps every event drawer's fields scrollable while actions stay pinned above the app", () => {
    for (const id of ["rf-drawer", "cd-drawer", "pred-drawer", "settle-drawer"]) {
      const drawer = giveawaysHtml.match(
        new RegExp(`<div class="gw-drawer-backdrop" id="${id}"[\\s\\S]*?</div>\\n</div>`, "m"),
      )?.[0];
      expect(drawer).toBeTruthy();
      const fieldsStart = drawer.indexOf('<div class="gw-drawer-fields">');
      const footerStart = drawer.indexOf('<div class="gw-drawer-footer">');
      expect(fieldsStart).toBeGreaterThan(0);
      expect(footerStart).toBeGreaterThan(fieldsStart);
      expect(drawer.slice(fieldsStart, footerStart)).toContain("gw-drawer-fields");
      expect(drawer.slice(footerStart)).toContain("gw-drawer-footer");
    }

    const cssRules = new Map();
    for (const [, selector, declarations] of giveawaysCssSource.matchAll(
      /(\.gw-drawer-(?:backdrop|body|fields|footer))\s*\{([^}]*)\}/g,
    )) {
      if (cssRules.has(selector)) continue;
      cssRules.set(
        selector,
        new Map([...declarations.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()])),
      );
    }
    expect(cssRules.get(".gw-drawer-body")?.get("overflow")).toBe("hidden");
    expect(cssRules.get(".gw-drawer-fields")?.get("overflow-y")).toBe("auto");
    expect(cssRules.get(".gw-drawer-footer")?.get("flex")).toBe("0 0 auto");
  });

  it("mounts event drawers outside the content stacking context", () => {
    const content = renderGiveawaysContentHtml("raffles");
    const drawers = renderGiveawayDrawersHtml("raffles");
    expect(content).not.toContain('id="rf-drawer"');
    expect(drawers).toContain('id="rf-drawer"');

    const page = GiveawaysPage({ user: { id: "u-1", email: "streamer@test.com" }, tab: "raffles" }).toString();
    const bentoStart = page.indexOf('<div class="lb-bento"');
    const firstDrawer = page.indexOf('class="gw-drawer-backdrop" id="pred-drawer"');
    const bentoEnd = page.lastIndexOf("</div>", firstDrawer);
    expect(bentoStart).toBeGreaterThanOrEqual(0);
    expect(bentoEnd).toBeGreaterThan(bentoStart);
    for (const id of ["pred-drawer", "settle-drawer", "rf-drawer", "cd-drawer"]) {
      expect(page.indexOf(`id="${id}"`)).toBeGreaterThan(bentoEnd);
    }
  });

  it("renders truthful unverified and resend controls", () => {
    const dashboardPage = readFileSync(new URL("../pages/dashboard.jsx", import.meta.url), "utf8");
    expect(dashboardPage).toContain('id="verifyBannerEmail"');
    expect(dashboardPage).toContain('id="verifyResend"');
    expect(dashboardPage).toContain('id="verifyDismiss"');
    expect(siteSource).toContain("/api/auth/resend-verification");
    expect(dashboardPage).toContain("Visitors cannot open your published leaderboard");
    expect(siteSource).toContain("/api/auth/resend-verification");
  });
});

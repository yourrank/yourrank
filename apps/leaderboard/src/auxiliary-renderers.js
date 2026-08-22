import { formatMoney, prizeCurrency, renderSite } from "@yourrank/shared/site-render";
import { safeUrl } from "@yourrank/shared/public-render-helpers";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function shell({ r, slug, homeUrl, nonce, contentHtml, title, description, logoUrl = null, isCustomDomain = false }) {
  return renderSite({
    r,
    section: null,
    viewer: null,
    viewerData: null,
    opts: {
      homeUrl,
      slug,
      nonce,
      logoUrl,
      isCustomDomain,
      contentHtml,
      pageTitle: title,
      pageDescription: description,
    },
  });
}

function record(data, opts) {
  return data?.data ? data : {
    data,
    slug: opts.slug,
    plan: opts.plan || "free",
    boards: opts.boards || [],
    botUsername: opts.botUsername || null,
  };
}

function legalBody(data, page) {
  const b = data.brand || {};
  const custom = String(data.legal?.[page] || "").trim();
  if (custom) {
    return custom.split(/\n\n+/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  }
  const name = esc(b.name || "This leaderboard");
  // A-06: External links in legal content use rel="noopener noreferrer" and
  // include a screen-reader new-tab disclosure.
  const copy = {
    terms: `<p>Welcome to the ${name} leaderboard page. By viewing or participating you agree to these terms.</p><p>${name} is responsible for the rules, prizes, and player standings shown here. YourRank provides the hosting platform only and does not operate any gambling or wagering services.</p><p>You must be 18 or older to participate. ${name} may update these terms at any time. For questions, use the Contact page.</p>`,
    privacy: `<p>${name} values your privacy. This page collects only the information needed to display the leaderboard, such as player names and scores.</p><p>Public pages are visible to anyone with the link. Do not share personal information you do not want made public.</p><p>We use essential cookies and basic analytics to keep the service running. You can contact ${name} through the Contact page for data questions.</p>`,
    responsible: `<p>${name} is provided for entertainment purposes only. Gambling can be addictive and should be enjoyed in moderation, never as a source of income.</p><p>If you or someone you know needs help, reach out to a local responsible-gaming organisation:</p><ul><li><a href="https://www.begambleaware.org" target="_blank" rel="noopener noreferrer">BeGambleAware<span class="sr-only"> (opens in a new tab)</span></a> — UK advice and support</li><li><a href="https://www.loketkansspel.nl" target="_blank" rel="noopener noreferrer">Loket Kansspel<span class="sr-only"> (opens in a new tab)</span></a> — Netherlands (in Dutch)</li><li><a href="https://www.connexontario.ca" target="_blank" rel="noopener noreferrer">ConnexOntario<span class="sr-only"> (opens in a new tab)</span></a> — Canada</li><li><a href="https://www.gamblingtherapy.org" target="_blank" rel="noopener noreferrer">Gambling Therapy<span class="sr-only"> (opens in a new tab)</span></a> — international, multilingual</li></ul><p>This page is intended for adults 18 and older only.</p>`,
    cookies: `<p>${name} uses cookies and similar technologies to provide the leaderboard service and to understand how visitors use the page.</p><p>Essential cookies are required for the page to function. Analytics cookies help us improve the experience. You can adjust your browser settings to manage cookies.</p>`,
    refund: `<p>${name} sets its own refund policy for any prizes, subscriptions, or promotions offered through this page.</p><p>If you have questions about a specific prize or payment, please contact ${name} through the Contact page. YourRank subscription payments made in cryptocurrency are final once confirmed on the blockchain.</p>`,
    contact: `<p>For questions about this leaderboard, its rules, or prizes, please reach out to ${name} directly through the social channels shown on the leaderboard.</p><p>For platform issues with YourRank, email contact@yourrank.site.</p>`,
  };
  return copy[page] || "<p>Nothing here yet.</p>";
}

export function renderNewLegalPage(data, page, opts) {
  const r = record(data, opts);
  const title = ({
    terms: "Terms of Service", privacy: "Privacy Policy", responsible: "Responsible Play",
    cookies: "Cookie Policy", refund: "Refund & Cancellation", contact: "Contact",
  })[page] || page;
  // A-01: <i> is decorative; aria-hidden prevents screen readers announcing the empty element.
  // A-05: <aside> now has aria-label; <p class="yr-label"> promoted to <h3> for heading semantics.
  const content = `<div class="yr-hero"><p class="yr-eyebrow"><i aria-hidden="true"></i>LEADERBOARD INFORMATION</p><h1 class="yr-h1">${esc(title)}</h1><p class="yr-lede">${esc(r.data.brand?.name || r.slug)} · Public information and policies.</p></div><div class="yr-g12"><article class="yr-c8 yr-card yr-lb"><div class="yr-prose">${legalBody(r.data, page)}</div></article><aside class="yr-c4 yr-card yr-lb" aria-label="Leaderboard help"><h3 class="yr-label">Need help?</h3><p class="yr-note">Return to the leaderboard or use the streamer's configured channel links.</p></aside></div>`;
  return shell({ r, ...opts, contentHtml: content, title: `${title} · ${r.data.brand?.name || r.slug}`, description: `${title} for ${r.data.brand?.name || r.slug}.` });
}

export function renderNewPlayerProfile(data, player, history, opts) {
  const r = record(data, opts);
  const p = player || {};
  const currency = prizeCurrency(r.data);
  const hidePrizes = r.data.prizes?.hidePrizeAmounts === true;
  // A-01: aria-hidden on eyebrow <i> icon.
  // A-02: scope="col" on all <th> cells for correct AT header association.
  // A-03: Stat cards use <dl><dt><dd> instead of <p> pairs for key-value semantics.
  // U-07: Empty state uses the .empty component instead of unstyled plain text.
  const rows = (history || []).length
    ? history.map((h) => `<tr><td>${esc(h.label || "Archived")}</td><td>#${Number(h.rank) || "\u2014"}</td><td>${esc(formatMoney(currency, h.wagered))}</td><td>${hidePrizes ? "\u2014" : esc(formatMoney(currency, h.prize))}</td></tr>`).join("")
    : `<tr><td colspan="4"><div class="empty">No archived results yet.</div></td></tr>`;
  const content = `<div class="yr-hero"><p class="yr-eyebrow"><i aria-hidden="true"></i>PLAYER PROFILE</p><h1 class="yr-h1">${esc(p.name || "Player")}</h1><p class="yr-lede">Current standing and archived results for this board.</p></div><div class="yr-g3"><dl class="yr-card yr-lb yr-stat"><dt class="yr-label">Current rank</dt><dd class="yr-num">#${Number(p.rank) || "\u2014"}</dd></dl><dl class="yr-card yr-lb yr-stat"><dt class="yr-label">Wagered</dt><dd class="yr-num">${esc(formatMoney(currency, p.wagered))}</dd></dl><dl class="yr-card yr-lb yr-stat"><dt class="yr-label">Prize</dt><dd class="yr-num">${hidePrizes ? "\u2014" : esc(formatMoney(currency, p.prize))}</dd></dl></div><div class="yr-card yr-lb"><h2 class="yr-panel-title">Archived results</h2><div class="yr-table-wrap"><table class="yr-table"><thead><tr><th scope="col">Period</th><th scope="col">Rank</th><th scope="col">Wagered</th><th scope="col">Prize</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  return shell({ r, ...opts, contentHtml: content, title: `${p.name || "Player"} · ${r.data.brand?.name || r.slug}`, description: `Player profile for ${p.name || "this player"}.` });
}

export function renderNewHallOfFame(data, opts) {
  const r = record(data, opts);
  const winners = (r.data.pastWinners || []).slice(0, 20);
  // A-01: aria-hidden on eyebrow <i> icon.
  // A-04: Winner list uses <ul><li> for proper list semantics instead of <div> containers.
  const content = `<div class="yr-hero"><p class="yr-eyebrow"><i aria-hidden="true"></i>ARCHIVE</p><h1 class="yr-h1">Hall of Fame</h1><p class="yr-lede">Past boards and winners for ${esc(r.data.brand?.name || r.slug)}.</p></div>${winners.length ? `<div class="yr-card yr-lb"><ul class="yr-list" role="list">${winners.map((w) => `<li class="yr-list-item"><div><p class="yr-list-h">${esc(w.label || "Past board")}</p><p class="yr-list-p">${Number(w.players) || 0} players</p></div><span class="yr-tag">${esc(w.winner || "Winner not recorded")}</span></li>`).join("")}</ul></div>` : '<div class="yr-empty">No past winners yet.</div>'}`;
  return shell({ r, ...opts, contentHtml: content, title: `Hall of Fame · ${r.data.brand?.name || r.slug}`, description: `Past winners for ${r.data.brand?.name || r.slug}.` });
}

export function renderNewStreamerProfile(data, opts) {
  const r = record(data, opts);
  const profileData = r.data || {};
  const socials = (profileData.socials || [])
    .filter((s) => s.enabled !== false && s.url)
    .map((s) => ({ ...s, safeHref: safeUrl(s.url) }))
    .filter((s) => s.safeHref !== "#");
  const boards = (r.boards || []).filter((b) => b.slug && b.name);
  // A-01: aria-hidden on eyebrow <i> icon.
  // A-04: Channel links use <ul><li><a> instead of bare <a> divs for list semantics.
  // A-06: target="_blank" links now include noreferrer and a sr-only new-tab warning.
  const content = `<div class="yr-hero"><p class="yr-eyebrow"><i aria-hidden="true"></i>STREAMER PROFILE</p><h1 class="yr-h1">${esc(profileData.brand?.name || r.slug)}</h1><p class="yr-lede">${esc(profileData.brand?.tagline || "No profile description yet.")}</p></div><div class="yr-g12"><section class="yr-c8 yr-card yr-lb"><h2 class="yr-panel-title">Channel links</h2>${socials.length ? `<ul class="yr-g3" role="list">${socials.map((s) => `<li><a class="yr-btn" href="${s.safeHref}" target="_blank" rel="noopener noreferrer">${esc(s.name || s.brand || "Channel")}<span class="sr-only"> (opens in a new tab)</span></a></li>`).join("")}</ul>` : '<p class="yr-empty">No channel links yet.</p>'}</section><section class="yr-c4 yr-card yr-lb"><h2 class="yr-panel-title">Leaderboards</h2>${boards.length ? `<ul class="yr-list" role="list">${boards.map((b) => `<li><a class="yr-list-item" href="/${esc(b.slug)}"><span class="yr-list-h">${esc(b.name)}</span><span class="yr-tag">Open</span></a></li>`).join("")}</ul>` : '<p class="yr-empty">No public leaderboards yet.</p>'}</section></div>`;
  return shell({ r, ...opts, contentHtml: content, title: `${profileData.brand?.name || r.slug} · Streamer profile`, description: `Streamer profile for ${profileData.brand?.name || r.slug}.` });
}

export function renderNewEmbed(data, opts) {
  const b = data.brand || {};
  const hidePrizes = data.prizes?.hidePrizeAmounts === true;
  const players = Array.isArray(data.players) ? data.players.slice().sort((a, z) => (Number(z.wagered) || 0) - (Number(a.wagered) || 0)) : [];
  // A-01: aria-hidden on eyebrow <i> icon in the embed shell.
  // A-02: scope="col" on <th> cells.
  // U-07: Empty state uses .empty component.
  const currency = prizeCurrency(data);
  const rows = players.length ? players.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.name)}</td><td>${esc(formatMoney(currency, p.wagered))}</td><td>${hidePrizes ? "\u2014" : esc(formatMoney(currency, p.prize))}</td></tr>`).join("") : '<tr><td colspan="4"><div class="empty">No players yet.</div></td></tr>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(b.name || opts.slug)}</title><link rel="stylesheet" href="/assets/site-shell.css"><link rel="stylesheet" href="/assets/devin-system.css"><style nonce="${esc(opts.nonce)}">body{margin:0;background:transparent}.yr-embed{max-width:680px;margin:0 auto;padding:12px}.yr-embed .yr-card{padding:18px}.yr-embed table{width:100%}</style></head><body class="yr-site"><main class="yr-embed"><section class="yr-card yr-lb"><p class="yr-eyebrow"><i aria-hidden="true"></i>${esc(b.period || "CURRENT BOARD")}</p><h1 class="yr-h1">${esc(b.name || opts.slug)}</h1><p class="yr-lede">${esc(b.prizePool || "")}</p><div class="yr-table-wrap"><table class="yr-table"><thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col">Wagered</th><th scope="col">Prize</th></tr></thead><tbody>${rows}</tbody></table></div></section></main></body></html>`;
}

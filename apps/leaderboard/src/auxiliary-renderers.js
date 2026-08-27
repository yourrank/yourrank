import { formatMoney, prizeCurrency, renderSite } from "@yourrank/shared/site-render";
import { safeUrl } from "@yourrank/shared/public-render-helpers";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// These pages live outside the section shell, so they own their canonical URL:
// `/<page>` on a custom domain and `/<slug>/<page>` on the platform host.
function canonicalPathFor(page, slug, isCustomDomain) {
  return isCustomDomain ? `/${page}` : `/${encodeURIComponent(slug || "")}/${page}`;
}

function shell({ r, slug, homeUrl, nonce, contentHtml, title, description, logoUrl = null, isCustomDomain = false, canonicalPath = null }) {
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
      canonicalPath,
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
  // External links in legal content use rel="noopener noreferrer" and carry a
  // screen-reader new-tab disclosure in the public shell's own utility class:
  // .sr-only is a ui.css component, which no public viewer page loads, so that
  // disclosure used to render as visible text mid-sentence.
  const copy = {
    terms: `<p>Welcome to the ${name} leaderboard page. By viewing or participating you agree to these terms.</p><p>${name} is responsible for the rules, prizes, and player standings shown here. YourRank provides the hosting platform only and does not operate any gambling or wagering services.</p><p>You must be 18 or older to participate. ${name} may update these terms at any time. For questions, use the Contact page.</p>`,
    privacy: `<p>${name} values your privacy. This page collects only the information needed to display the leaderboard, such as player names and scores.</p><p>Public pages are visible to anyone with the link. Do not share personal information you do not want made public.</p><p>We use essential cookies and basic analytics to keep the service running. You can contact ${name} through the Contact page for data questions.</p>`,
    responsible: `<p>${name} is provided for entertainment purposes only. Gambling can be addictive and should be enjoyed in moderation, never as a source of income.</p><p>If you or someone you know needs help, reach out to a local responsible-gaming organisation:</p><ul><li><a href="https://www.begambleaware.org" target="_blank" rel="noopener noreferrer">BeGambleAware<span class="yr-sr"> (opens in a new tab)</span></a> — UK advice and support</li><li><a href="https://www.loketkansspel.nl" target="_blank" rel="noopener noreferrer">Loket Kansspel<span class="yr-sr"> (opens in a new tab)</span></a> — Netherlands (in Dutch)</li><li><a href="https://www.connexontario.ca" target="_blank" rel="noopener noreferrer">ConnexOntario<span class="yr-sr"> (opens in a new tab)</span></a> — Canada</li><li><a href="https://www.gamblingtherapy.org" target="_blank" rel="noopener noreferrer">Gambling Therapy<span class="yr-sr"> (opens in a new tab)</span></a> — international, multilingual</li></ul><p>This page is intended for adults 18 and older only.</p>`,
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
  // The same page head as every other viewer surface, then one column of
  // prose: a policy is something a viewer reads on a phone, not a mosaic of
  // cards. `.yr-prose` is what gives the copy its paragraph rhythm and reading
  // measure — the public shell resets paragraph margins, so this body was one
  // undifferentiated block of text on every legal page.
  const name = esc(r.data.brand?.name || r.slug);
  const content = `<header class="yr-vhead"><span class="yr-cue">Information</span><h1 class="yr-h1">${esc(title)}</h1><p class="yr-vhead-lede">${name} · public information and policies.</p></header><section class="yr-vsec" aria-labelledby="yr-legal-body"><h2 class="yr-sr" id="yr-legal-body">${esc(title)}</h2><div class="yr-prose">${legalBody(r.data, page)}</div></section><section class="yr-vsec" aria-labelledby="yr-legal-help"><div class="yr-sec-head"><h2 class="yr-sec-title" id="yr-legal-help">Need help?</h2></div><p class="yr-note">Go back to the leaderboard, or reach ${name} through the channel links on their profile.</p></section>`;
  return shell({ r, ...opts, contentHtml: content, canonicalPath: canonicalPathFor(page, r.slug, opts.isCustomDomain), title: `${title} · ${r.data.brand?.name || r.slug}`, description: `${title} for ${r.data.brand?.name || r.slug}.` });
}

export function renderNewPlayerProfile(data, player, history, opts) {
  const r = record(data, opts);
  const p = player || {};
  const currency = prizeCurrency(r.data);
  const hidePrizes = r.data.prizes?.hidePrizeAmounts === true;
  // A player asks two things on a phone: where they stand now, and what they
  // did before. Both answers are flat rows in the viewer's own row shape; the
  // three-KPI card wall and the four-column table behind a 620px horizontal
  // scroller answered neither at 390px. Wagered and Prize keep their existing
  // labels, values and secondary position — nothing here is recalculated,
  // renamed or promoted, and a hidden prize is simply absent rather than an
  // em dash the viewer has to interpret.
  const name = p.name || "Player";
  const rank = Number(p.rank) > 0 ? `#${Number(p.rank)}` : "Unranked";
  const standing = [
    { label: "Current rank", value: rank },
    { label: "Wagered", value: formatMoney(currency, p.wagered) },
    ...(hidePrizes ? [] : [{ label: "Prize", value: formatMoney(currency, p.prize) }]),
  ]
    .map((s) => `<li class="yr-hist"><div class="yr-hist-main"><p class="yr-hist-n">${esc(s.label)}</p></div><div class="yr-hist-side"><p class="yr-hist-amt">${esc(s.value)}</p></div></li>`)
    .join("");
  const rows = (history || []).length
    ? `<ul class="yr-hists" role="list">${history.map((h) => {
      const place = Number(h.rank) > 0 ? `Rank #${Number(h.rank)}` : "Unranked";
      const prize = hidePrizes ? "" : `<p class="yr-hist-d">Prize ${esc(formatMoney(currency, h.prize))}</p>`;
      return `<li class="yr-hist"><div class="yr-hist-main"><p class="yr-hist-n">${esc(h.label || "Archived")}</p><p class="yr-hist-p">${place}</p></div><div class="yr-hist-side"><p class="yr-hist-amt">${esc(formatMoney(currency, h.wagered))}</p>${prize}</div></li>`;
    }).join("")}</ul>`
    : '<p class="yr-empty">No archived results yet.</p>';
  const content = `<header class="yr-vhead"><span class="yr-cue">Player</span><h1 class="yr-h1">${esc(name)}</h1><p class="yr-vhead-lede">Where this player stands on ${esc(r.data.brand?.name || r.slug)} right now, and their archived results.</p></header><section class="yr-vsec" aria-labelledby="yr-player-standing"><div class="yr-sec-head"><h2 class="yr-sec-title" id="yr-player-standing">Current standing</h2></div><ul class="yr-hists" role="list">${standing}</ul></section><section class="yr-vsec" aria-labelledby="yr-player-history"><div class="yr-sec-head"><h2 class="yr-sec-title" id="yr-player-history">Archived results</h2></div>${rows}</section>`;
  return shell({ r, ...opts, contentHtml: content, canonicalPath: canonicalPathFor(`player/${encodeURIComponent(name)}`, r.slug, opts.isCustomDomain), title: `${name} · ${r.data.brand?.name || r.slug}`, description: `Player profile for ${name}.` });
}

export function renderNewHallOfFame(data, opts) {
  const r = record(data, opts);
  const winners = (r.data.pastWinners || []).slice(0, 20);
  const rows = winners.length
    ? `<ul class="yr-rwds" role="list">${winners.map((w) => `<li class="yr-rwd"><div class="yr-rwd-main"><p class="yr-rwd-n">${esc(w.label || "Past board")}</p><p class="yr-rwd-p">${Number(w.players) || 0} players</p></div><div class="yr-rwd-side"><span class="yr-rwd-p">Winner: ${esc(w.winner || "Not recorded")}</span></div></li>`).join("")}</ul>`
    : '<p class="yr-empty">No past winners yet.</p>';
  const content = `<header class="yr-vhead"><span class="yr-cue">Archive</span><h1 class="yr-h1">Hall of Fame</h1><p class="yr-vhead-lede">Past boards and winners for ${esc(r.data.brand?.name || r.slug)}.</p></header><section class="yr-vsec" aria-labelledby="yr-hof-title"><div class="yr-sec-head"><h2 class="yr-sec-title" id="yr-hof-title">Past winners</h2></div>${rows}</section>`;
  return shell({ r, ...opts, contentHtml: content, canonicalPath: canonicalPathFor("hall-of-fame", r.slug, opts.isCustomDomain), title: `Hall of Fame · ${r.data.brand?.name || r.slug}`, description: `Past winners for ${r.data.brand?.name || r.slug}.` });
}

export function renderNewStreamerProfile(data, opts) {
  const r = record(data, opts);
  const profileData = r.data || {};
  const socials = (profileData.socials || [])
    .filter((s) => s.enabled !== false && s.url)
    .map((s) => ({ ...s, safeHref: safeUrl(s.url) }))
    .filter((s) => s.safeHref !== "#");
  const boards = (r.boards || []).filter((b) => b.slug && b.name);
  const channelRows = socials.length
    ? `<ul class="yr-rwds" role="list">${socials.map((s) => `<li class="yr-rwd"><div class="yr-rwd-main"><p class="yr-rwd-n">${esc(s.name || s.brand || "Channel")}</p></div><div class="yr-rwd-side"><a class="yr-act" href="${s.safeHref}" target="_blank" rel="noopener noreferrer">Open channel<span class="yr-sr"> (opens in a new tab)</span></a></div></li>`).join("")}</ul>`
    : '<p class="yr-empty">No channel links yet.</p>';
  const boardRows = boards.length
    ? `<ul class="yr-rwds" role="list">${boards.map((b) => `<li class="yr-rwd"><div class="yr-rwd-main"><p class="yr-rwd-n">${esc(b.name)}</p></div><div class="yr-rwd-side"><a class="yr-act" href="/${esc(b.slug)}">Open leaderboard</a></div></li>`).join("")}</ul>`
    : '<p class="yr-empty">No public leaderboards yet.</p>';
  const content = `<header class="yr-vhead"><span class="yr-cue">Creator</span><h1 class="yr-h1">${esc(profileData.brand?.name || r.slug)}</h1><p class="yr-vhead-lede">${esc(profileData.brand?.tagline || "No profile description yet.")}</p></header><section class="yr-vsec" aria-labelledby="yr-profile-channels"><div class="yr-sec-head"><h2 class="yr-sec-title" id="yr-profile-channels">Channel links</h2></div>${channelRows}</section><section class="yr-vsec" aria-labelledby="yr-profile-boards"><div class="yr-sec-head"><h2 class="yr-sec-title" id="yr-profile-boards">Leaderboards</h2></div>${boardRows}</section>`;
  return shell({ r, ...opts, contentHtml: content, canonicalPath: canonicalPathFor("profile", r.slug, opts.isCustomDomain), title: `${profileData.brand?.name || r.slug} · Streamer profile`, description: `Streamer profile for ${profileData.brand?.name || r.slug}.` });
}

export function renderNewEmbed(data, opts) {
  const b = data.brand || {};
  const hidePrizes = data.prizes?.hidePrizeAmounts === true;
  const players = Array.isArray(data.players) ? data.players.slice().sort((a, z) => (Number(z.wagered) || 0) - (Number(a.wagered) || 0)) : [];
  // The embed keeps its table: it is a chrome-less widget inside someone
  // else's page, not a viewer surface of ours. Its empty state uses the public
  // shell's class, because .empty belongs to ui.css and is never loaded here.
  const currency = prizeCurrency(data);
  const rows = players.length ? players.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.name)}</td><td>${esc(formatMoney(currency, p.wagered))}</td><td>${hidePrizes ? "\u2014" : esc(formatMoney(currency, p.prize))}</td></tr>`).join("") : '<tr><td colspan="4"><p class="yr-empty">No players yet.</p></td></tr>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(b.name || opts.slug)}</title><link rel="stylesheet" href="/assets/site-shell.css"><link rel="stylesheet" href="/assets/devin-system.css"><style nonce="${esc(opts.nonce)}">body{margin:0;background:transparent}.yr-embed{max-width:680px;margin:0 auto;padding:12px}.yr-embed .yr-card{padding:18px}.yr-embed table{width:100%}</style></head><body class="yr-site"><main class="yr-embed"><section class="yr-card yr-lb"><p class="yr-cue">${esc(b.period || "Current board")}</p><h1 class="yr-h1">${esc(b.name || opts.slug)}</h1><p class="yr-lede">${esc(b.prizePool || "")}</p><div class="yr-table-wrap"><table class="yr-table"><thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col">Wagered</th><th scope="col">Prize</th></tr></thead><tbody>${rows}</tbody></table></div></section></main></body></html>`;
}

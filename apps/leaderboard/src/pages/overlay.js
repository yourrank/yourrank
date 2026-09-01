// overlay page
export const overlayPage = (data, opts = {}) => {
  const b = data.brand || {};
  const br = data.branding || {};
  const rankBy = data.rankBy === "wagered" ? "wagered" : "score";
  const players = (data.players || []).slice().sort((a, c) => Number(c[rankBy] || 0) - Number(a[rankBy] || 0)).slice(0, 5);
  const endsAt = data.endsAt || null;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => {
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(2).replace(/\.0+$/, "") + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
    return "$" + (n || 0).toLocaleString("en-US");
  };
  const fmtMetric = (player) => rankBy === "score" ? `${Number(player.score || 0).toLocaleString("en-US")} pts` : fmt(player.wagered);
  const medal = (i) => i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "#" + (i + 1);
  const rows = players.map((p, i) => `<div class="ov-row" data-name="${esc(p.name)}"><span class="ov-medal">${medal(i)}</span><span class="ov-name">${esc(p.name)}</span><span class="ov-wager">${fmtMetric(p)}</span></div>`).join("");
  const empty = 5 - players.length;
  const emptyRows = empty > 0 ? Array.from({ length: empty }, (_, i) => `<div class="ov-row ov-empty"><span class="ov-medal">#${players.length + i + 1}</span><span class="ov-name">—</span><span class="ov-wager">—</span></div>`).join("") : "";
  const accentA = (br.accentA && /^#[0-9a-fA-F]{6}$/.test(br.accentA)) ? br.accentA : "#53fc18";
  const accentB = (br.accentB && /^#[0-9a-fA-F]{6}$/.test(br.accentB)) ? br.accentB : "#35c211";
  const dataJson = JSON.stringify({ players, endsAt, rankBy }).replace(/</g, "\\u003c");
  const isTicker = opts.layout === "ticker" || opts.layout === "bar";
  const tickerRows = players.map((p, i) => `<div class="ov-ticker-item" data-name="${esc(p.name)}"><span class="ov-medal">${medal(i)}</span><span class="ov-name">${esc(p.name)}</span><span class="ov-wager">${fmtMetric(p)}</span></div>`).join("");

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(b.name)} — OBS Overlay</title>
<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=JetBrains+Mono:wght@600;700&display=swap" rel="stylesheet" />
<style nonce="${opts.nonce || ""}">
*{margin:0;padding:0;box-sizing:border-box}
html,body{${isTicker ? "width:100%;height:52px;" : "width:320px;"}overflow:hidden;background:transparent;font-family:'Plus Jakarta Sans','Inter',system-ui,sans-serif;color:#fff}
.ov-wrap{width:320px;padding:16px 18px;background:rgba(9,14,26,0.95);border-radius:16px;border:1px solid rgba(255,255,255,0.08);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 12px 36px rgba(0,0,0,0.55)}
.ov-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.ov-brand{display:flex;flex-direction:column;gap:1px}
.ov-brand-name{font-size:16px;font-weight:800;letter-spacing:-.02em;background:linear-gradient(135deg,${accentA},${accentB});-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
.ov-brand-sub{font-size:10px;font-weight:600;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:.08em}
.ov-live{display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:99px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#f87171}
.ov-live-dot{width:6px;height:6px;border-radius:50%;background:#ef4444;box-shadow:0 0 8px #ef4444;animation:ov-pulse 1.4s ease-in-out infinite}
@keyframes ov-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.75)}}
.ov-timer{display:flex;align-items:center;justify-content:center;gap:3px;margin-bottom:12px;padding:6px 10px;background:rgba(255,255,255,0.03);border-radius:8px;font-size:11px;color:rgba(255,255,255,0.5)}
.ov-timer b{font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:${accentA};min-width:20px;text-align:center}
.ov-timer-sep{color:rgba(255,255,255,0.25);margin:0 1px}
.ov-timer-label{font-size:9.5px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,0.4);text-align:center;margin-bottom:6px}
.ov-timer-over{font-size:11px;color:rgba(255,255,255,0.4);font-style:italic}
.ov-rows{display:flex;flex-direction:column;gap:5px}
.ov-row{display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:8px;border:1px solid rgba(255,255,255,0.05);transition:all .3s ease}
.ov-row:nth-child(1){background:linear-gradient(135deg,rgba(234,179,8,0.14),rgba(234,179,8,0.04));border-color:rgba(234,179,8,0.4);box-shadow:0 0 12px rgba(234,179,8,0.12)}
.ov-row:nth-child(2){background:linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02));border-color:rgba(226,232,240,0.3)}
.ov-row:nth-child(3){background:linear-gradient(135deg,rgba(217,119,6,0.12),rgba(217,119,6,0.02));border-color:rgba(217,119,6,0.35)}
.ov-row.ov-empty{opacity:.25}
.ov-row.ov-score-flash{animation:ov-flash .8s ease}
@keyframes ov-flash{0%{background:rgba(34,197,94,0.4);transform:scale(1.02)}100%{background:rgba(255,255,255,0.03);transform:scale(1)}}
.ov-medal{font-size:16px;min-width:24px;text-align:center;flex-shrink:0}
.ov-name{flex:1;font-size:13px;font-weight:600;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,0.6)}
.ov-wager{font-family:'JetBrains Mono',monospace;font-size:12.5px;font-weight:700;color:${accentA};flex-shrink:0;text-shadow:0 1px 3px rgba(0,0,0,0.6)}
.ov-footer{display:flex;align-items:center;justify-content:space-between;margin-top:12px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06)}
.ov-footer .ov-count{font-size:9.5px;font-weight:600;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:.08em}
.ov-footer .ov-powered{font-size:9px;font-weight:700;color:rgba(255,255,255,0.25);letter-spacing:.04em}
.ov-sponsor{display:none;font-size:9.5px;text-align:center;color:rgba(255,255,255,0.45);padding:6px 0;letter-spacing:.04em}
.ov-sponsor.is-visible{display:block}
.ov-sponsor a{color:inherit;text-decoration:none}

/* Ticker Bar Layout */
.ov-ticker-bar{width:100%;height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 20px;background:rgba(9,14,26,0.96);border-bottom:1px solid rgba(255,255,255,0.1);backdrop-filter:blur(16px);gap:20px}
.ov-ticker-brand{display:flex;align-items:center;gap:10px;flex-shrink:0}
.ov-ticker-items{display:flex;align-items:center;gap:12px;flex:1;overflow-x:auto;scrollbar-width:none}
.ov-ticker-items::-webkit-scrollbar{display:none}
.ov-ticker-item{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:8px;flex-shrink:0}
.ov-ticker-item:nth-child(1){border-color:rgba(234,179,8,0.4);background:rgba(234,179,8,0.08)}
.ov-ticker-item:nth-child(2){border-color:rgba(226,232,240,0.3);background:rgba(255,255,255,0.06)}
.ov-ticker-item:nth-child(3){border-color:rgba(217,119,6,0.35);background:rgba(217,119,6,0.06)}
.ov-ticker-timer{display:flex;align-items:center;gap:6px;flex-shrink:0;font-size:11px;color:rgba(255,255,255,0.6)}
.ov-ticker-timer b{font-family:'JetBrains Mono',monospace;color:${accentA};font-weight:700}

@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; } }
</style>
</head><body>
${isTicker ? `
<div class="ov-ticker-bar">
  <div class="ov-ticker-brand">
    <span class="ov-live"><span class="ov-live-dot"></span>LIVE</span>
    <span class="ov-brand-name">${esc(b.name)}</span>
  </div>
  <div class="ov-ticker-items" id="ov-players">${tickerRows}</div>
  ${endsAt ? `<div class="ov-ticker-timer" data-ov-timer><span>Ends in</span> <b data-ot>--</b>d <b data-ot>--</b>:<b data-ot>--</b>:<b data-ot>--</b></div>` : ""}
</div>` : `
<div class="ov-wrap">
<div class="ov-head">
<div class="ov-brand">
<span class="ov-brand-name">${esc(b.name)}</span>
<span class="ov-brand-sub">${rankBy === "wagered" ? `${esc(b.casino || "")}${b.casino && b.period ? " · " : ""}` : ""}${esc(b.period || "Monthly")}</span>
</div>
<span class="ov-live"><span class="ov-live-dot"></span>LIVE</span>
</div>
${endsAt ? `<p class="ov-timer-label">${esc(b.prizePool || "")} resets in</p>
<div class="ov-timer" data-ov-timer>
<b data-ot>--</b><span class="ov-timer-sep">d</span>
<b data-ot>--</b><span class="ov-timer-sep">:</span>
<b data-ot>--</b><span class="ov-timer-sep">:</span>
<b data-ot>--</b>
</div>` : ""}
<div class="ov-rows" id="ov-players">${rows}${emptyRows}</div>
<div class="ov-sponsor" data-ov-sponsor></div>
<div class="ov-footer">
<span class="ov-count"><span id="ov-count">${(data.players || []).length}</span> players</span>
<span class="ov-powered">YourRank</span>
</div>
</div>`}
<div id="ov-config" data-slug="${esc(opts.slug || "")}" data-layout="${esc(opts.layout || "card")}" data-theme="${esc(opts.theme || 'default')}" data-sponsor="${esc(opts.sponsor || "")}" data-sponsor-url="${esc(opts.sponsorUrl || "")}" data-json='${dataJson.replace(/'/g, "&#39;")}' hidden></div>
<script src="/assets/overlay.js?v=3"></script>
</body></html>`;
};

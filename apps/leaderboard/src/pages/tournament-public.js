// Public read-only tournament bracket: /<slug>/tournament, plus the plain
// stream variant /<slug>/tournament/stream for an OBS browser source.
// Renders from the viewer-safe shape in lib/tournament-public.js only.
// The page polls the public API and, when the bracket changes, swaps in the
// freshly server-rendered #tp-root so there is a single renderer.

export function tournamentBodyHtml(view, stream) {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  if (!view) {
    return '<div class="tp-empty"><h2 class="tp-empty-title">No tournament right now</h2>'
      + (stream ? "" : '<p class="tp-muted">When a tournament opens, its bracket appears here.</p>') + "</div>";
  }
  const statusText = { signups: "Signups open", setup: "Starting soon", live: "Live", finished: "Finished" }[view.status] || "";
  const meta = [view.game, view.entryCount ? `${view.entryCount} ${view.entryCount === 1 ? "player" : "players"}` : ""].filter(Boolean).map(esc).join(" · ");
  let html = '<header class="tp-head"><div><h1 class="tp-title">' + esc(view.title) + "</h1>"
    + (meta ? '<p class="tp-muted">' + meta + "</p>" : "") + "</div>"
    + '<span class="tp-status tp-status--' + esc(view.status) + '">' + esc(statusText) + "</span></header>";
  if (view.champion) {
    html += '<section class="tp-champion" aria-label="Champion"><p class="tp-champion-label">Champion</p>'
      + '<p class="tp-champion-name">' + esc(view.champion) + "</p>"
      + (view.runnerUp ? '<p class="tp-muted">Beat ' + esc(view.runnerUp) + (view.finalScore ? " " + esc(view.finalScore) : "") + " in the final</p>" : "")
      + "</section>";
  }
  if (view.status === "signups" && view.joinCommand) {
    html += '<p class="tp-join">Type <strong class="tp-cmd">' + esc(view.joinCommand) + "</strong> in "
      + (view.chatChannel ? esc(view.chatChannel) + "'s" : "the") + " Kick chat to join.</p>";
  }
  if (!view.rounds || view.rounds.length === 0) {
    if (view.players && view.players.length) {
      html += '<section class="tp-roster" aria-labelledby="tp-roster-title"><h2 class="tp-round-title" id="tp-roster-title">Players ('
        + esc(view.entryCount || view.players.length) + ')</h2><ol class="tp-roster-list">'
        + view.players.map((name) => '<li class="tp-roster-name">' + esc(name) + "</li>").join("") + "</ol></section>";
    }
    if (view.status !== "signups") html += '<p class="tp-muted tp-wait">The bracket appears here once the tournament starts.</p>';
    return html;
  }
  const slot = (p, round, index) => {
    if (p.bye) return '<li class="tp-player tp-player--bye"><span class="tp-name">Bye</span></li>';
    const name = p.name
      ? esc(p.name)
      : '<span class="tp-tbd">' + (round > 1 ? "Winner of match " + (index + 1) + " in the previous round" : "To be decided") + "</span>";
    const score = p.score === null || p.score === undefined ? "" : '<span class="tp-score">' + esc(p.score) + "</span>";
    return '<li class="tp-player' + (p.winner ? " tp-player--won" : "") + '"><span class="tp-name">' + name + "</span>"
      + (p.winner ? '<span class="tp-sr"> (winner)</span>' : "") + score + "</li>";
  };
  html += '<div class="tp-bracket" role="list" aria-label="Bracket">';
  for (const round of view.rounds) {
    html += '<section class="tp-round" role="listitem" aria-label="' + esc(round.label) + '"><h2 class="tp-round-title">' + esc(round.label) + "</h2><ol class=\"tp-matches\">";
    round.matches.forEach((m, i) => {
      const players = m.players.map((p, side) => slot(p, round.number, i * 2 + side)).join("");
      html += '<li class="tp-match tp-match--' + esc(m.state) + (m.live ? " tp-match--live" : "") + '">'
        + (m.live ? '<span class="tp-live">Live now</span>' : "")
        + '<ul class="tp-pair">' + players + "</ul></li>";
    });
    html += "</ol></section>";
  }
  return html + "</div>";
}

export function renderPublicTournamentPage({ view, slug, siteName, nonce, stream = false }) {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const apiPath = `/api/public/${encodeURIComponent(slug)}/tournament`;
  const title = `${view ? view.title : "Tournament"} · ${siteName || slug}`;
  const config = JSON.stringify({ api: apiPath, seen: JSON.stringify(view ?? null) }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style nonce="${nonce}">
:root{--tp-text:#0e1221;--tp-soft:#52618a;--tp-line:#e5e9f3;--tp-surface:#fff;--tp-inset:#f2f4fa;--tp-action:#5024f5;--tp-success:#087e48;--tp-canvas:#fafbfe}
*{box-sizing:border-box}
body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--tp-text);background:var(--tp-canvas);line-height:1.4}
main{max-width:1280px;margin:0 auto;padding:24px 16px 48px}
.tp-nav{display:flex;gap:12px;align-items:center;margin-bottom:20px;font-size:14px}
.tp-nav a{color:var(--tp-action);font-weight:600;text-decoration:none}
.tp-nav a:hover,.tp-nav a:focus-visible{text-decoration:underline}
a:focus-visible{outline:2px solid var(--tp-action);outline-offset:2px;border-radius:4px}
.tp-head{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;justify-content:space-between;margin-bottom:16px}
.tp-title{margin:0;font-size:28px;line-height:1.15;font-weight:800;letter-spacing:-.01em}
.tp-muted{margin:4px 0 0;color:var(--tp-soft);font-size:14px}
.tp-status{border-radius:999px;padding:4px 12px;font-size:13px;font-weight:700;background:var(--tp-inset);color:var(--tp-text);white-space:nowrap}
.tp-status--live{background:#e7f6ee;color:var(--tp-success)}
.tp-status--signups{background:#efebff;color:var(--tp-action)}
.tp-champion{border:1px solid var(--tp-line);border-left:4px solid var(--tp-success);background:var(--tp-surface);border-radius:12px;padding:16px 20px;margin-bottom:20px}
.tp-champion-label{margin:0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--tp-success)}
.tp-champion-name{margin:2px 0 0;font-size:26px;font-weight:800}
.tp-join{margin:0 0 20px;padding:12px 16px;border-radius:10px;background:var(--tp-inset);font-size:16px}
.tp-cmd{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--tp-surface);border:1px solid var(--tp-line);border-radius:6px;padding:1px 6px}
.tp-wait{margin-top:12px}
.tp-roster{margin-bottom:12px}
.tp-roster-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px}
.tp-roster-name{background:var(--tp-surface);border:1px solid var(--tp-line);border-radius:8px;padding:8px 12px;font-size:15px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tp-bracket{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(220px,1fr);gap:16px;overflow-x:auto;padding-bottom:8px}
.tp-round{display:flex;flex-direction:column;min-width:0}
.tp-round-title{margin:0 0 8px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--tp-soft)}
.tp-matches{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;justify-content:space-around;gap:12px;flex:1}
.tp-match{position:relative;background:var(--tp-surface);border:1px solid var(--tp-line);border-radius:10px;overflow:hidden}
.tp-match--live{border-color:var(--tp-success);box-shadow:0 0 0 1px var(--tp-success)}
.tp-match--bye{opacity:.7}
.tp-live{display:block;padding:3px 10px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#fff;background:var(--tp-success)}
.tp-pair{list-style:none;margin:0;padding:0}
.tp-player{display:flex;justify-content:space-between;gap:8px;padding:8px 12px;font-size:15px}
.tp-player+.tp-player{border-top:1px solid var(--tp-line)}
.tp-player--won{font-weight:800}
.tp-player--won .tp-score{color:var(--tp-success)}
.tp-player--bye .tp-name,.tp-tbd{color:var(--tp-soft);font-style:italic;font-weight:400;font-size:13px}
.tp-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tp-score{font-variant-numeric:tabular-nums;font-weight:700}
.tp-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.tp-empty{padding:48px 16px;text-align:center}
.tp-empty-title{margin:0;font-size:22px}
@media (max-width:640px){.tp-bracket{grid-auto-flow:row;grid-auto-columns:auto}.tp-title{font-size:24px}}
body.tp-stream{background:transparent;color:#fff}
body.tp-stream main{max-width:none;padding:16px}
body.tp-stream .tp-title{font-size:32px;text-shadow:0 1px 3px rgba(0,0,0,.6)}
body.tp-stream .tp-muted,body.tp-stream .tp-round-title{color:#e5e9f3;text-shadow:0 1px 2px rgba(0,0,0,.6)}
body.tp-stream .tp-match,body.tp-stream .tp-champion,body.tp-stream .tp-join,body.tp-stream .tp-roster-name{background:rgba(14,18,33,.86);border-color:rgba(255,255,255,.18);color:#fff}
body.tp-stream .tp-player+.tp-player{border-top-color:rgba(255,255,255,.14)}
body.tp-stream .tp-player--bye .tp-name,body.tp-stream .tp-tbd{color:#c3cbe0}
body.tp-stream .tp-cmd{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.2)}
body.tp-stream .tp-player--won .tp-score,body.tp-stream .tp-champion-label{color:#5ee0a0}
body.tp-stream .tp-bracket{grid-auto-flow:column;overflow:hidden}
</style>
</head>
<body class="${stream ? "tp-stream" : ""}">
<main>
${stream ? "" : `<nav class="tp-nav" aria-label="Community"><a href="/${esc(encodeURIComponent(slug))}">← ${esc(siteName || slug)}</a></nav>`}
<div id="tp-root">${tournamentBodyHtml(view, stream)}</div>
</main>
<script nonce="${nonce}">
(function(){
var config=${config};
var root=document.getElementById("tp-root");
var seen=config.seen;
var busy=false;
function refresh(){
  if(busy)return;
  busy=true;
  fetch(config.api,{headers:{accept:"application/json"},cache:"no-store"}).then(function(r){return r.ok?r.json():null;}).then(function(data){
    if(!data||!data.ok)return;
    var next=JSON.stringify(data.tournament===undefined?null:data.tournament);
    if(next===seen)return;
    return fetch(location.pathname,{headers:{accept:"text/html"},cache:"no-store"}).then(function(r){return r.ok?r.text():null;}).then(function(html){
      if(!html)return;
      var fresh=new DOMParser().parseFromString(html,"text/html").getElementById("tp-root");
      if(!fresh)return;
      root.innerHTML=fresh.innerHTML;
      seen=next;
    });
  }).catch(function(){}).then(function(){busy=false;});
}
setInterval(refresh,${stream ? 5000 : 15000});
})();
</script>
</body>
</html>`;
}

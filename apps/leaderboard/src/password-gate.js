function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// The gate is a standalone document — it is served before any board data is
// disclosed, so it carries no navigation, no creator content and no metadata
// description, and it is never indexable. Its presentation is the public
// viewer's: the same page head, the same field and action geometry, the same
// focus ring. The POST action, `current-password` autofill and server-side
// validation are untouched; only the presentation is shared.
export function renderPasswordGate(site, opts, error = "") {
  const name = esc(site.name || "Private board");
  const slug = esc(site.slug || "");
  const action = opts.isCustomDomain ? "/password" : `/${slug}/password`;
  const nonce = esc(opts.nonce || "");
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex, nofollow" />
<title>${name} · Password required</title>
<link rel="stylesheet" href="/assets/site-shell.css" />
<link rel="stylesheet" href="/assets/devin-system.css" />
<style nonce="${nonce}">
.yr-gate-wrap{flex:1;width:100%;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px}
.yr-gate-card{width:min(100%,420px);display:flex;flex-direction:column;gap:20px}
.yr-gate-form{display:flex;flex-direction:column;gap:8px}
.yr-gate-form label{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--yr-faint)}
/* --yr-surface/--yr-fog are the public shell's real field tokens: the panel
   token this gate once used is not defined by the public shell, and --yr-ink is
   the page background, so the typed password was ink-on-ink. */
.yr-gate-form input{font:inherit;min-height:48px;width:100%;border:1px solid var(--yr-edge);border-radius:8px;background:var(--yr-surface);color:var(--yr-fog);padding:10px 14px;caret-color:var(--yr-primary)}
.yr-gate-form input:focus{border-color:var(--yr-primary);outline:none}
.yr-gate-form input:focus-visible{outline:2px solid var(--yr-primary);outline-offset:2px}
.yr-gate-form input::placeholder{color:var(--yr-faint)}
.yr-gate-form input:-webkit-autofill{-webkit-text-fill-color:var(--yr-fog);box-shadow:0 0 0 1000px var(--yr-surface) inset}
.yr-gate-form .yr-btn{margin-top:4px;width:100%}
.yr-gate-error{color:var(--yr-warning-readable);font-size:13px;line-height:1.5;overflow-wrap:anywhere}
</style></head>
<body class="yr-site">
<main class="yr-gate-wrap" id="main-content">
<section class="yr-gate-card" aria-labelledby="password-title">
<header class="yr-vhead">
<span class="yr-cue">Private board</span>
<h1 class="yr-h1" id="password-title">${name}</h1>
<p class="yr-vhead-lede">This leaderboard is private. Enter the password the streamer gave you to continue.</p>
</header>
<form class="yr-gate-form" method="POST" action="${action}">
${error ? `<p class="yr-gate-error" role="alert"><span aria-hidden="true">⚠</span> ${esc(error)}</p>` : ""}
<label for="board-password">Password</label>
<input id="board-password" name="password" type="password" placeholder="Password" required autocomplete="current-password" ${error ? 'aria-invalid="true" autofocus ' : ""}/>
<button class="yr-btn" type="submit">Unlock</button>
</form>
</section>
</main>
</body></html>`;
}

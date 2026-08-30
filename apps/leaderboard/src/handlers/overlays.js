// OBS Live Overlays & Audio-Visual Alerts Suite.
import {
  ok,
  bad,
  rateLimit as defaultRateLimit,
  clientIp as defaultClientIp,
} from "../auth.js";
import {
  one as defaultOne,
} from "@yourrank/shared/db";

const OVERLAY_PAGE_RATE_LIMIT = 120;
const ACTIVE_EVENTS_RATE_LIMIT = 120;

function esc(str) {
  return String(str || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/**
 * GET /overlay/prediction — Transparent OBS Browser Source for active Prediction HUD
 */
export async function handleOverlayPredictionPage(request, env, deps = {}) {
  const {
    one = defaultOne,
    rateLimit = defaultRateLimit,
    clientIp = defaultClientIp,
  } = deps;
  const rl = await rateLimit(env, `overlay-prediction:${clientIp(request)}`, OVERLAY_PAGE_RATE_LIMIT, 60);
  if (!rl.ok) return bad("Rate limit exceeded. Try again shortly.", 429);

  const url = new URL(request.url);
  const siteSlug = url.searchParams.get("site");

  if (!siteSlug) {
    return new Response("Missing site parameter (e.g. /overlay/prediction?site=yourchannel)", { status: 400 });
  }

  const site = await one("SELECT id, name, slug FROM sites WHERE slug=$1 OR id::text=$1", [siteSlug]);
  if (!site) return new Response("Site not found", { status: 404 });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(site.name)} — Live Prediction HUD</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&family=JetBrains+Mono:wght@700&display=swap" rel="stylesheet" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: transparent;
      overflow: hidden;
      font-family: 'Plus Jakarta Sans', sans-serif;
      color: #ffffff;
      padding: 16px;
      display: flex;
      justify-content: center;
    }
    .hud-card {
      width: 420px;
      background: rgba(10, 15, 29, 0.94);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 16px;
      padding: 18px 20px;
      backdrop-filter: blur(20px);
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.65);
      animation: hud-slide 0.5s cubic-bezier(0.16, 1, 0.3, 1);
      transition: all 0.3s ease;
    }
    @keyframes hud-slide {
      from { transform: translateY(-30px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    .hud-badge-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .hud-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(47, 107, 255, 0.2);
      border: 1px solid rgba(47, 107, 255, 0.4);
      color: #60a5fa;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 4px 10px;
      border-radius: 999px;
    }
    .hud-dot {
      width: 6px;
      height: 6px;
      background: #3b82f6;
      border-radius: 50%;
      animation: hud-pulse 1.2s infinite;
    }
    @keyframes hud-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.8); }
    }
    .hud-timer {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      color: #f59e0b;
      font-weight: 700;
    }
    .hud-title {
      font-size: 17px;
      font-weight: 800;
      line-height: 1.35;
      margin-bottom: 14px;
      text-shadow: 0 2px 4px rgba(0,0,0,0.6);
    }
    .hud-options {
      display: flex;
      gap: 10px;
      margin-bottom: 12px;
    }
    .hud-opt {
      flex: 1;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .hud-opt--yes { border-color: rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.08); }
    .hud-opt--no { border-color: rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.08); }
    .hud-opt-label { font-size: 13px; font-weight: 700; }
    .hud-opt-pts { font-family: 'JetBrains Mono', monospace; font-size: 15px; font-weight: 800; }
    .hud-opt--yes .hud-opt-pts { color: #34d399; }
    .hud-opt--no .hud-opt-pts { color: #f87171; }
    .hud-bar-wrap {
      width: 100%;
      height: 10px;
      background: rgba(239, 68, 68, 0.8);
      border-radius: 999px;
      overflow: hidden;
      display: flex;
    }
    .hud-bar-fill {
      height: 100%;
      background: #10b981;
      transition: width 0.4s ease;
    }
    .hud-footer {
      display: flex;
      justify-content: space-between;
      margin-top: 8px;
      font-size: 11px;
      color: rgba(255, 255, 255, 0.5);
      font-weight: 700;
    }
    .hud-idle {
      text-align: center;
      padding: 20px;
      color: rgba(255, 255, 255, 0.4);
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div id="hud-root">
    <div class="hud-card" id="hud-card" style="display: none;">
      <div class="hud-badge-row">
        <span class="hud-pill"><span class="hud-dot"></span> LIVE PREDICTION</span>
        <span class="hud-timer" id="hud-timer">5:00</span>
      </div>
      <h2 class="hud-title" id="hud-title">Will the streamer win this match?</h2>
      <div class="hud-options">
        <div class="hud-opt hud-opt--yes">
          <span class="hud-opt-label" id="hud-label-a">Option A</span>
          <span class="hud-opt-pts" id="hud-pts-a">0 pts (50%)</span>
        </div>
        <div class="hud-opt hud-opt--no">
          <span class="hud-opt-label" id="hud-label-b">Option B</span>
          <span class="hud-opt-pts" id="hud-pts-b">0 pts (50%)</span>
        </div>
      </div>
      <div class="hud-bar-wrap">
        <div class="hud-bar-fill" id="hud-bar" style="width: 50%;"></div>
      </div>
      <div class="hud-footer">
        <span id="hud-pool">Total Pool: 0 pts</span>
        <span>Vote via !bet &amp; yourrank.ma</span>
      </div>
    </div>
  </div>

  <script>
    const siteSlug = ${JSON.stringify(site.slug)};
    async function updateHud() {
      try {
        const res = await fetch('/api/overlays/active-events?site=' + encodeURIComponent(siteSlug));
        if (!res.ok) return;
        const data = await res.json();
        const card = document.getElementById('hud-card');
        const pred = data.activePrediction;

        if (!pred || pred.status === 'settled' || pred.status === 'cancelled') {
          card.style.display = 'none';
          return;
        }

        card.style.display = 'block';
        document.getElementById('hud-title').textContent = pred.title;
        
        const opts = typeof pred.options === 'string' ? JSON.parse(pred.options) : (pred.options || []);
        const optA = opts[0] || { label: 'Option A', total_points: 0 };
        const optB = opts[1] || { label: 'Option B', total_points: 0 };
        const total = (optA.total_points || 0) + (optB.total_points || 0);
        const pctA = total > 0 ? Math.round((optA.total_points / total) * 100) : 50;

        document.getElementById('hud-label-a').textContent = optA.label;
        document.getElementById('hud-pts-a').textContent = (optA.total_points || 0) + ' pts (' + pctA + '%)';
        document.getElementById('hud-label-b').textContent = optB.label;
        document.getElementById('hud-pts-b').textContent = (optB.total_points || 0) + ' pts (' + (100 - pctA) + '%)';
        document.getElementById('hud-bar').style.width = pctA + '%';
        document.getElementById('hud-pool').textContent = 'Total Pool: ' + (pred.total_pool || total) + ' pts';

        if (pred.lock_at) {
          const remaining = Math.max(0, Math.floor((new Date(pred.lock_at).getTime() - Date.now()) / 1000));
          const mins = Math.floor(remaining / 60);
          const secs = remaining % 60;
          document.getElementById('hud-timer').textContent = remaining > 0 ? (mins + ':' + (secs < 10 ? '0' : '') + secs) : 'LOCKED';
        } else {
          document.getElementById('hud-timer').textContent = pred.status === 'locked' ? 'LOCKED' : 'OPEN';
        }
      } catch (err) {}
    }

    setInterval(updateHud, 2500);
    updateHud();
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/**
 * GET /overlay/alerts — Transparent OBS Browser Source for Audio-Visual Alerts & Sound effects
 */
export async function handleOverlayAlertsPage(request, env, deps = {}) {
  const {
    one = defaultOne,
    rateLimit = defaultRateLimit,
    clientIp = defaultClientIp,
  } = deps;
  const rl = await rateLimit(env, `overlay-alerts:${clientIp(request)}`, OVERLAY_PAGE_RATE_LIMIT, 60);
  if (!rl.ok) return bad("Rate limit exceeded. Try again shortly.", 429);

  const url = new URL(request.url);
  const siteSlug = url.searchParams.get("site");

  if (!siteSlug) {
    return new Response("Missing site parameter (e.g. /overlay/alerts?site=yourchannel)", { status: 400 });
  }

  const site = await one("SELECT id, name, slug FROM sites WHERE slug=$1 OR id::text=$1", [siteSlug]);
  if (!site) return new Response("Site not found", { status: 404 });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(site.name)} — Stream Alerts &amp; Sounds</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@800&family=JetBrains+Mono:wght@700&display=swap" rel="stylesheet" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: transparent;
      overflow: hidden;
      font-family: 'Plus Jakarta Sans', sans-serif;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
    }
    .alert-box {
      width: 460px;
      background: rgba(13, 20, 38, 0.96);
      border: 2px solid #3b82f6;
      border-radius: 20px;
      padding: 24px;
      display: flex;
      align-items: center;
      gap: 18px;
      backdrop-filter: blur(24px);
      box-shadow: 0 0 50px rgba(59, 130, 246, 0.45);
      animation: alert-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    @keyframes alert-pop {
      0% { transform: scale(0.5) translateY(40px); opacity: 0; }
      100% { transform: scale(1) translateY(0); opacity: 1; }
    }
    .alert-icon {
      font-size: 42px;
      background: rgba(255, 255, 255, 0.08);
      width: 72px;
      height: 72px;
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .alert-content h3 {
      font-size: 12px;
      font-weight: 800;
      color: #60a5fa;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    .alert-user {
      font-size: 22px;
      font-weight: 800;
      color: #fff;
      margin-bottom: 2px;
    }
    .alert-sub {
      font-size: 14px;
      color: #34d399;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <div id="alert-container"></div>
  <script>
    const siteSlug = ${JSON.stringify(site.slug)};
    let lastAlertId = null;

    function esc(s) {
      return String(s || '').replace(/[&<>"']/g, function(c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    // Web Audio Synthesizer Chime for alerts
    function playAlertChime() {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const now = ctx.currentTime;
        
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.1); // E5
        osc.frequency.setValueAtTime(783.99, now + 0.2); // G5
        osc.frequency.setValueAtTime(1046.50, now + 0.3); // C6
        
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.8);
      } catch(e) {}
    }

    function showAlert(title, user, desc, icon) {
      playAlertChime();
      const container = document.getElementById('alert-container');
      container.innerHTML = \`
        <div class="alert-box">
          <div class="alert-icon">\${esc(icon || '🎉')}</div>
          <div class="alert-content">
            <h3>\${esc(title)}</h3>
            <div class="alert-user">\${esc(user)}</div>
            <div class="alert-sub">\${esc(desc)}</div>
          </div>
        </div>
      \`;
      setTimeout(() => { container.innerHTML = ''; }, 6000);
    }

    async function pollAlerts() {
      try {
        const res = await fetch('/api/overlays/active-events?site=' + encodeURIComponent(siteSlug));
        if (!res.ok) return;
        const data = await res.json();
        if (data.latestAlert && data.latestAlert.id !== lastAlertId) {
          lastAlertId = data.latestAlert.id;
          const a = data.latestAlert;
          showAlert(a.title, a.username, a.description, a.icon);
        }
      } catch (err) {}
    }

    setInterval(pollAlerts, 3000);
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/**
 * GET /api/overlays/active-events — Live events endpoint for OBS overlays
 */
export async function handleGetActiveEvents(request, env, deps = {}) {
  const {
    one = defaultOne,
    rateLimit = defaultRateLimit,
    clientIp = defaultClientIp,
  } = deps;
  const rl = await rateLimit(env, `overlay-events:${clientIp(request)}`, ACTIVE_EVENTS_RATE_LIMIT, 60);
  if (!rl.ok) return bad("Rate limit exceeded. Try again shortly.", 429);

  const url = new URL(request.url);
  const siteSlugOrId = url.searchParams.get("site") || url.searchParams.get("siteId");
  if (!siteSlugOrId) return bad("Site identifier is required.");

  const site = await one("SELECT id, name FROM sites WHERE slug=$1 OR id::text=$1", [siteSlugOrId]);
  if (!site) return bad("Site not found.", 404);

  // 1. Active prediction
  const activePrediction = await one(
    `SELECT id, title, options, status, total_pool, min_bet, max_bet, lock_at
       FROM predictions
      WHERE site_id=$1 AND status IN ('open', 'locked')
      ORDER BY created_at DESC LIMIT 1`,
    [site.id]
  );

  // 2. Latest redemption / alert
  const latestRedemption = await one(
    `SELECT r.id, r.created_at, v.kick_username, i.name AS item_name
       FROM redemptions r
       JOIN site_viewers sv ON sv.id = r.site_viewer_id
       JOIN viewers v ON v.id = sv.viewer_id
       JOIN shop_items i ON i.id = r.shop_item_id
      WHERE sv.site_id=$1
      ORDER BY r.created_at DESC LIMIT 1`,
    [site.id]
  );

  let latestAlert = null;
  if (latestRedemption) {
    latestAlert = {
      id: latestRedemption.id,
      title: "New Claim!",
      username: latestRedemption.kick_username,
      description: latestRedemption.item_name,
      icon: "🎁",
      time: latestRedemption.created_at,
    };
  }

  return ok({
    siteId: site.id,
    activePrediction: activePrediction || null,
    latestAlert,
  });
}

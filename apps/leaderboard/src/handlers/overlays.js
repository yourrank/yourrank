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

  const SOUND_PRESETS = new Set(["chime", "ding", "fanfare", "none"]);
  const requestedSound = (url.searchParams.get("sound") || "chime").toLowerCase();
  const sound = SOUND_PRESETS.has(requestedSound) ? requestedSound : "chime";
  const clampNum = (v, min, max, dflt) => {
    if (v === null || v === "") return dflt;
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
  };
  const vol = clampNum(url.searchParams.get("vol"), 0, 100, 30);
  const gap = clampNum(url.searchParams.get("gap"), 0, 300, 0);

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
    const soundConfig = { preset: ${JSON.stringify(sound)}, volume: ${vol}, gapMs: ${Math.round(gap * 1000)} };
    let lastAlertId = null;
    let lastSoundAt = 0;

    function esc(s) {
      return String(s || '').replace(/[&<>"']/g, function(c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    function playAlertSound() {
      if (soundConfig.preset === 'none') return;
      var nowMs = Date.now();
      if (soundConfig.gapMs > 0 && nowMs - lastSoundAt < soundConfig.gapMs) return;
      lastSoundAt = nowMs;
      try {
        var AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        var ctx = new AudioContext();
        var now = ctx.currentTime;
        var master = ctx.createGain();
        master.gain.value = Math.max(0, Math.min(1, soundConfig.volume / 100)) * 0.85;
        master.connect(ctx.destination);

        var tone = function(type, freqs, endAt) {
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          osc.type = type;
          freqs.forEach(function(f) {
            osc.frequency.setValueAtTime(f.value, now + (f.at || 0));
          });
          gain.gain.setValueAtTime(0.0001, now);
          gain.gain.exponentialRampToValueAtTime(0.35, now + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, now + endAt);
          osc.connect(gain);
          gain.connect(master);
          osc.start(now);
          osc.stop(now + endAt);
        };

        if (soundConfig.preset === 'ding') {
          tone('sine', [{ value: 1318.5 }], 0.5);
        } else if (soundConfig.preset === 'fanfare') {
          tone('square', [{ value: 523.25 }, { value: 659.25, at: 0.12 }, { value: 783.99, at: 0.24 }], 0.7);
          tone('triangle', [{ value: 1046.5 }, { value: 1318.5, at: 0.3 }], 0.9);
        } else {
          tone('sine', [{ value: 523.25 }, { value: 659.25, at: 0.1 }, { value: 783.99, at: 0.2 }, { value: 1046.5, at: 0.3 }], 0.8);
        }
      } catch(e) {}
    }

    function showAlert(title, user, desc, icon) {
      playAlertSound();
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

  // Latest redemption / alert
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
    latestAlert,
  });
}

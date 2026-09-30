import { DEVIN_DESIGN_CONTRACT } from "@yourrank/shared/page-shell";

export const admin2faPage = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Verify · YourRank Admin</title>
<meta name="robots" content="noindex, nofollow" /><link rel="canonical" href="https://yourrank.site/admin" /><link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/assets/app.css" /><link rel="stylesheet" href="/assets/ui.css" /><link rel="stylesheet" href="/assets/devin-system.css" /><link rel="stylesheet" href="/assets/react/react.css" /><link rel="stylesheet" href="/assets/react/admin-2fa.css" /></head><body>${DEVIN_DESIGN_CONTRACT}
<noscript><div class="noscript-msg"><p>YourRank Admin requires JavaScript</p><p>Please enable JavaScript to verify two-factor authentication.</p></div></noscript>
<a href="#main-content" class="sr-only skip-link">Skip to content</a>
<header class="topbar"><div class="brand">Your<b>Rank</b> <span class="label ml-8">ADMIN</span></div>
<div class="topbar-right" id="admin-2fa-topbar-controls"></div></header>
<main class="wrap" id="main-content"><div class="yr-react" id="admin-2fa-app"><div id="tfaLoading" class="tfa-loading" aria-busy="true">Loading…</div></div></main>
<script src="/assets/qrcode.js"></script>
<script src="/assets/admin2fa.js?v=4" type="module"></script></body></html>`;

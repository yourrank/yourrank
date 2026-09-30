import { DEVIN_DESIGN_CONTRACT } from "@yourrank/shared/page-shell";

const adminLoading = `<div id="loading" class="admin-loading" aria-busy="true">
<div class="mb-18"><div class="skeleton skeleton-text--lg skel-w-160"></div><div class="skeleton skeleton-text--sm skel-w-240 mt-8"></div></div>
<div class="stats"><div class="stat"><div class="skeleton skeleton-text skel-w-60"></div><div class="skeleton skeleton-text--sm skel-w-50 mt-6"></div></div><div class="stat"><div class="skeleton skeleton-text skel-w-40"></div><div class="skeleton skeleton-text--sm skel-w-40 mt-6"></div></div><div class="stat"><div class="skeleton skeleton-text skel-w-30"></div><div class="skeleton skeleton-text--sm skel-w-50 mt-6"></div></div><div class="stat"><div class="skeleton skeleton-text skel-w-70"></div><div class="skeleton skeleton-text--sm skel-w-80 mt-6"></div></div></div>
<div class="card mt-18"><div class="skeleton skeleton-block skel-h-300"></div></div>
</div>`;

export const adminPage = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Admin · YourRank</title>
<meta name="robots" content="noindex, nofollow" /><link rel="canonical" href="https://yourrank.site/admin" /><link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/assets/app.css" /><link rel="stylesheet" href="/assets/ui.css" /><link rel="stylesheet" href="/assets/devin-system.css" /><link rel="stylesheet" href="/assets/react/react.css" /><link rel="stylesheet" href="/assets/react/admin.css" /></head><body>${DEVIN_DESIGN_CONTRACT}
<noscript><div class="noscript-msg"><p>YourRank Admin requires JavaScript</p><p>Please enable JavaScript in your browser settings to use the admin panel.</p></div></noscript>
<a href="#main-content" class="sr-only skip-link">Skip to content</a>
<header class="topbar"><div class="brand">Your<b>Rank</b> <span class="label ml-8">ADMIN</span></div>
<div class="topbar-right" id="admin-topbar-controls"></div></header>
<main class="wrap" id="main-content"><div class="yr-react" id="admin-app">${adminLoading}</div></main>
<script src="/assets/admin.js?v=5" type="module"></script></body></html>`;

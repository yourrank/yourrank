import { DEVIN_DESIGN_CONTRACT } from "@yourrank/shared/page-shell";
import { brandMarkSvg } from "@yourrank/shared/brand-assets";

// Creator account entry shares one frame; forms retain their own field contracts.
export function authPage({ title, path, content, signup = false }) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title} · YourRank</title>
<meta name="robots" content="noindex, nofollow" /><link rel="canonical" href="https://yourrank.site${path}" />
<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/assets/app.css" /><link rel="stylesheet" href="/assets/ui.css" /><link rel="stylesheet" href="/assets/devin-system.css" />
</head><body class="auth-entry">${DEVIN_DESIGN_CONTRACT}
<a href="#main-content" class="sr-only skip-link">Skip to content</a>
<div class="auth-entry-layout">
<header class="auth-entry-header"><a href="/" class="auth-entry-brand" aria-label="YourRank home"><span class="auth-entry-mark">${brandMarkSvg()}</span><span>YourRank</span></a><a class="auth-entry-switch" data-auth-switch href="${signup ? "/login" : "/signup"}">${signup ? "Sign in" : "Create account"}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg></a></header>
<main class="auth-entry-main" id="main-content"><div class="auth-entry-form" id="auth-card">${content}</div></main>
<footer class="auth-entry-footer"><span>Your community starts here.</span><nav aria-label="Legal"><a href="/terms">Terms</a><a href="/privacy">Privacy</a></nav></footer>
</div><script type="module" src="/assets/auth.js?v=5"></script></body></html>`;
}

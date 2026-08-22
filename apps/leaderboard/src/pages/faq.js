// FAQ page — answer-engine optimization (FAQPage schema)
import { DEVIN_DESIGN_CONTRACT } from "@yourrank/shared/page-shell";

export const paymentMethodsAnswer = "Paid plans are billed in crypto (BTC, ETH, USDT and 100+ more) through NOWPayments. Card checkout is not available yet.";

const faqs = [
  { q: "What is YourRank?", a: "YourRank is an all-in-one suite for streamers and communities. It includes three products: branded leaderboards, a Telegram bot with tracked offers, and a viewer Rewards & Shop powered by Kick channel points." },
  { q: "What are the three products?", a: "Leaderboards let you publish a branded public race. The Telegram bot publishes tracked offers, broadcasts, and commands for your community. Rewards & Shop lets viewers earn credits from Kick channel-point redemptions and spend them in your shop." },
  { q: "Is YourRank free?", a: "Yes. The Free plan includes one leaderboard with up to 10 players, one Telegram bot, three tracked offers, three ways to earn, and five shop items. Paid plans add more of each product, plus custom domains, OBS overlays, and developer tools (API)." },
  { q: "How do viewers earn credits?", a: "Streamers connect a Kick channel and create ways to earn for channel-point rewards. When a viewer redeems a reward on Kick, YourRank credits the viewer automatically." },
  { q: "Can viewers log in?", a: "Yes. Viewers can sign in with their Kick or Discord account. They log in at /me to see their balance across sites and redeem shop items." },
  { q: "What payment methods do you accept?", a: paymentMethodsAnswer },
  { q: "Do I need to write code?", a: "No. YourRank runs entirely in the browser and on Cloudflare. You create a page, customize it, and share the URL. The Telegram bot and Kick connection are configured from the dashboard." },
  { q: "How do I get support?", a: "Email support@yourrank.site or use the contact form at /help/support. Pro and Agency plans include priority support." },
];

const faqStructuredData = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((f) => ({"@type": "Question", name: f.q, acceptedAnswer: {"@type": "Answer", text: f.a}})),
});

const itemsHtml = faqs.map((f) => `<details class="faq-item"><summary>${f.q}</summary><p>${f.a}</p></details>`).join("");

export const faqPage = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>FAQ · YourRank suite</title>
<meta name="description" content="Frequently asked questions about YourRank: leaderboards, Telegram bot, viewer rewards, pricing, and support." />
<link rel="canonical" href="https://yourrank.site/faq" />
<meta property="og:title" content="FAQ · YourRank suite">
<meta property="og:description" content="Answers to common questions about YourRank leaderboards, Telegram bot, credits, and pricing.">
<meta property="og:url" content="https://yourrank.site/faq">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="FAQ · YourRank suite" />
<meta name="twitter:description" content="Answers to common questions about YourRank leaderboards, Telegram bot, credits, and pricing." />
<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/assets/ui.css" /><link rel="stylesheet" href="/assets/landing.css" /><link rel="stylesheet" href="/assets/devin-system.css" />
<script type="application/ld+json">${faqStructuredData}</script>
</head><body class="marketing-page marketing-page--faq" data-identity="devin-reference">${DEVIN_DESIGN_CONTRACT}
<a href="#main-content" class="sr-only skip-link">Skip to content</a>
<header><nav class="top wrap"><a href="/" class="brand" aria-label="YourRank home"><span class="brand-icon-wrap" aria-hidden="true"><svg class="brand-svg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg></span><span class="brand-text">Your<b>Rank</b></span></a>
<button class="nav-toggle" aria-label="Toggle menu" aria-expanded="false"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>
<div class="links"><a href="/">Home</a><a href="/#products">Products</a><a href="/pricing">Pricing</a><a href="/login">Sign in</a><a href="/signup" class="btn btn--accent">Create your free page</a></div></nav></header>
<main class="wrap pg-wrap" id="main-content">
<h1 class="pg-title">Frequently asked questions</h1>
<p class="prose-lead">Quick answers about the YourRank suite. Can't find what you need? <a href="/help/support">Contact support</a>.</p>
<div class="faq-list mt-32">
${itemsHtml}
</div>
</main>
<footer class="ftr ftr--platform"><div class="wrap">
<p class="ftr-copy">© {{YEAR}} YourRank · <a href="/help/support">Contact</a></p>
</div></footer>
<script src="/assets/landing.js?v=3"></script>
</body></html>`;

// Reviews / Google Business Profile page
import { DEVIN_DESIGN_CONTRACT } from "@yourrank/shared/page-shell";
import { brandLogoSvg } from "@yourrank/shared/brand-assets";

const gbpStructuredData = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  name: "YourRank",
  url: "https://yourrank.site",
  image: "{{GBP_PHOTO_URL}}",
  description: "All-in-one streamer suite: leaderboards, Telegram bot, and viewer rewards & shop.",
  priceRange: "$",
  address: {
    "@type": "PostalAddress",
    addressCountry: "MA",
  },

});

export const reviewsPage = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Reviews · YourRank</title>
<meta name="description" content="Leave a review for YourRank on Google and see what the community is saying about the streamer suite." />
<link rel="canonical" href="https://yourrank.site/reviews" />
<meta property="og:title" content="Reviews · YourRank">
<meta property="og:description" content="Leave a review for YourRank on Google.">
<meta property="og:url" content="https://yourrank.site/reviews">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Reviews · YourRank" />
<meta name="twitter:description" content="Leave a review for YourRank on Google." />
<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/assets/ui.css" /><link rel="stylesheet" href="/assets/landing.css" /><link rel="stylesheet" href="/assets/devin-system.css" />
<script type="application/ld+json">${gbpStructuredData}</script>
</head><body class="marketing-page marketing-page--reviews" data-identity="devin-reference">${DEVIN_DESIGN_CONTRACT}
<a href="#main-content" class="sr-only skip-link">Skip to content</a>
<header><nav class="top wrap"><a href="/" class="brand" aria-label="YourRank home"><span class="brand-icon-wrap" aria-hidden="true">${brandLogoSvg({ idPrefix: "yrRev" })}</span></a>
<button class="nav-toggle" aria-label="Toggle menu" aria-expanded="false"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>
<div class="links"><a href="/">Home</a><a href="/#products">Products</a><a href="/pricing">Pricing</a><a href="/faq">FAQ</a><a href="/login">Sign in</a><a href="/signup" class="btn btn--accent">Create your free page</a></div></nav></header>
<main class="wrap pg-wrap pg-wrap--center" id="main-content">
<h1 class="pg-title pg-title--center">Rate YourRank on Google</h1>
<p class="prose-lead lead--center">If YourRank helped you run a leaderboard, Telegram bot, or reward your viewers, leave a review. It helps other streamers find us.</p>
<a class="btn btn--accent btn--cta-lg" id="gbp-review" href="{{GBP_REVIEW_URL}}" target="_blank" rel="noopener">Leave a Google review</a>
<div class="mt-48">
  <img id="gbp-photo" class="gbp-photo" src="{{GBP_PHOTO_URL}}" alt="YourRank on Google Business Profile" hidden />
</div>
</main>
<footer class="ftr ftr--platform"><div class="wrap">
<p class="ftr-copy">© {{YEAR}} YourRank · <a href="/help/support">Contact</a></p>
</div></footer>
<script src="/assets/landing.js?v=3"></script>
</body></html>`;

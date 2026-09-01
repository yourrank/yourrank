// Shared legal page shell helper
// NOTE: fill in company identity from Dashboard → Admin → Identity before going live.
import { DEVIN_DESIGN_CONTRACT } from "@yourrank/shared/page-shell";

export function applyLegalIdentity(html, identity) {
  const i = identity || {};
  const companyName = i.company_name?.trim() || "YourRank";
  const country = i.company_country?.trim() || "";
  const number = i.company_number?.trim() || "";
  const supportEmail = i.support_email?.trim() || "contact@yourrank.site";
  const affiliate = i.affiliate_disclosure?.trim() || "Some creator links may be affiliate links. The creator is responsible for identifying their promotions and applicable terms.";

  const parts = [companyName, country ? `registered in ${country}` : "", number].filter(Boolean);
  const companyLine = parts.length ? `<p class="legal-company">${parts.join(" · ")}</p>` : "";

  return html
    .replace(/{{COMPANY_NAME}}/g, companyName)
    .replace(/{{COMPANY_COUNTRY}}/g, country)
    .replace(/{{COMPANY_NUMBER}}/g, number)
    .replace(/{{SUPPORT_EMAIL}}/g, supportEmail)
    .replace(/{{AFFILIATE_DISCLOSURE}}/g, affiliate)
    .replace(/{{COMPANY_LINE}}/g, companyLine);
}

function platformHeader() {
  return `<header class="topbar"><a class="brand" href="/">Your<b>Rank</b></a>
<div class="topbar-right"><a href="/#how">How it works</a><a href="/pricing">Pricing</a><a href="/login" class="btn btn--sm btn--ghost">Sign in</a><a href="/signup" class="btn btn--sm btn--accent">Create free page</a></div></header>`;
}

function platformFooter(pagePath) {
  const active = (p) => p === pagePath ? " aria-current=" : "";
  return `<footer class="ftr ftr--platform">
<div class="ftr-top">
  <div class="ftr-brand">
    <a class="brand" href="/">Your<b>Rank</b></a>
    <p>Leaderboards for streamers & communities</p>
  </div>
  <div class="ftr-cols">
    <div class="ftr-col">
      <b>Product</b>
      <a href="/#how">How it works</a>
      <a href="/pricing">Pricing</a>
      <a href="/docs">For developers</a>
      <a href="/help/support">Contact</a>
    </div>
    <div class="ftr-col">
      <b>Legal</b>
      <a href="/terms"${active("terms")}>Terms of Service</a>
      <a href="/privacy"${active("privacy")}>Privacy Policy</a>
      <a href="/cookies"${active("cookies")}>Cookie Policy</a>
      <a href="/refund"${active("refund")}>Refund Policy</a>
      <a href="/responsible"${active("responsible")}>Responsible Play</a>
    </div>
  </div>
</div>
{{COMPANY_LINE}}
<p class="ftr-affiliate">{{AFFILIATE_DISCLOSURE}}</p>
<p class="ftr-copy">© {{YEAR}} {{COMPANY_NAME}} · <a href="mailto:{{SUPPORT_EMAIL}}">{{SUPPORT_EMAIL}}</a></p>
<p class="ftr-fine">18+ · Community credits have no cash value. Participate responsibly.</p>
</footer>`;
}

export const legal = (title, updated, body, pagePath, desc) => `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title} · YourRank</title>
<meta name="description" content="${desc || title}" />
<link rel="canonical" href="https://yourrank.site/${pagePath}" /><link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/assets/app.css" /><link rel="stylesheet" href="/assets/ui.css" /><link rel="stylesheet" href="/assets/devin-system.css" /></head><body>${DEVIN_DESIGN_CONTRACT}
<a href="#main-content" class="sr-only skip-link">Skip to content</a>
${platformHeader()}
<main class="legal" id="main-content"><h1>${title}</h1><p class="legal-updated">Last updated: ${updated}</p>
${body}
</main>
${platformFooter(pagePath)}
</body></html>`;

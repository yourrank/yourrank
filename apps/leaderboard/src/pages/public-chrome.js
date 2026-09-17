// Responsive public header for Worker-served marketing pages (legal, reviews).
// Same destinations as the apex site header in apps/web; the drawer behaviour
// lives in landing.js (.nav-toggle / .links.open) and the devin-reference
// identity in devin-system.css owns the visual treatment.
import { brandLogoSvg } from "@yourrank/shared/brand-assets";

const NAV_LINKS = [
  { label: "How it works", href: "/#loop" },
  { label: "Products", href: "/#products" },
  { label: "Pricing", href: "/pricing" },
  { label: "FAQ", href: "/faq" },
  { label: "Demo", href: "/demo" },
  { label: "Sign in", href: "/login" },
];

export function publicHeader({ idPrefix = "yrPub" } = {}) {
  const links = NAV_LINKS.map((l) => `<a href="${l.href}">${l.label}</a>`).join("");
  return `<header><nav class="top wrap" aria-label="Main navigation"><a href="/" class="brand" aria-label="YourRank home">${brandLogoSvg({ className: "brand-logo", idPrefix })}</a>
<button class="nav-toggle" type="button" aria-label="Open navigation" aria-expanded="false" aria-controls="public-navigation"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>
<div class="links" id="public-navigation">${links}<a href="/signup" class="btn btn--accent">Get started</a></div></nav></header>`;
}

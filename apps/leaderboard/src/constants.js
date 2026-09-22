// Platform apex hostname. Used by request routing (to tell the platform's own
// host apart from customer custom domains) and by the custom-domain CNAME
// verification/instructions. Centralized here so the value lives in one place.
export const PLATFORM_HOST = "yourrank.site";

export const NON_SITE_PATHS = new Set([
  "api", "auth", "dashboard", "login", "logout", "signup", "verify-email", "invite", "me",
  "account", "contact", "faq", "reviews", "cookies", "privacy", "terms",
  "responsible", "refund", "setup", "demo", "sites", "telegram", "credits", "pricing",
  "overlays", "games", "switch", "docs", "about", "go", "logo", "favicon.ico",
  "changelog", "brand", "status", "giveaways",
]);

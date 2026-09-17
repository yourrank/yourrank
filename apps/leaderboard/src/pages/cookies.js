import { legal } from "./legal-helper.js";

// cookies page
export const cookiesPage = legal("Cookie Policy", "July 2026", `
<p>YourRank uses cookies and similar technologies to keep you signed in, remember your preferences, and understand how our pages are used. This policy explains what we use and how you can control it.</p>
<h2>Essential cookies</h2>
<p>These are required for the site to work. They include your session cookie (<code>yr_session</code>) and CSRF token cookie (<code>__csrf</code>). We do not use them for advertising or tracking you across the web.</p>
<h2>Analytics and performance</h2>
<p>With your consent, we collect aggregated page views, referrers, and scroll depth for your own leaderboard analytics. No third-party analytics trackers (Google Analytics, Meta Pixel, etc.) are loaded on YourRank pages.</p>
<h2>Your choices</h2>
<p>When you first visit, you can choose to accept only essential cookies or all cookies. You can change this at any time from <button type="button" class="ftr-link-btn ftr-link-btn--inline" data-cookie-preferences>Cookie preferences</button>, also linked in the footer of every page. Switching to essential only stops analytics cookies from being set from then on; it does not delete counts already recorded. If you disable cookies entirely, you will be signed out and some dashboard features may not work.</p>
<h2>Contact</h2>
<p>Questions about this policy: email <a href="mailto:{{SUPPORT_EMAIL}}">{{SUPPORT_EMAIL}}</a>.</p>`, "cookies", "YourRank cookie policy. Explains essential cookies, analytics, and how to manage your choices.");

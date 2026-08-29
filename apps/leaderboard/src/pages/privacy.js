import { legal } from "./legal-helper.js";

// privacy page
export const privacyPage = legal("Privacy Policy", "July 2026", `
<h2>What we collect</h2>
<p>As little as we can get away with:</p>
<ul>
<li><b>Account:</b> your email and a hashed password (we never store the password itself).</li>
<li><b>Page content:</b> whatever you put on your leaderboard — it's public by design.</li>
<li><b>Requests:</b> if you use the contact form, we keep what you send us (handle, contact info, note).</li>
<li><b>Billing records:</b> plan, amount, and payment status if verified recurring billing becomes available. No recurring checkout is currently active.</li>
</ul>
<h2>Cookies</h2>
<p>Essential cookies keep you signed in and secure your dashboard actions. With your consent, we also set analytics cookies to count page views and understand how visitors interact with leaderboards. You can choose to accept only essential cookies via the banner on your first visit. We never load third-party ad trackers or pixels.</p>
<h2>Who else sees data</h2>
<p>Our infrastructure runs on Cloudflare for hosting and service delivery. No recurring payment processor is currently active. We don't sell your data.</p>
<h2>How long we keep it</h2>
<p>As long as your account exists. You can download a copy of your data at any time from <a href="/dashboard/settings">Dashboard → Settings</a> (GDPR/CCPA data export). Want your account deleted? Go to <a href="/dashboard/settings">Dashboard → Plan &amp; billing → Danger zone</a> and click "Delete my account."</p>
<h2>Your page is public</h2>
<p>Anything you publish on your leaderboard page is visible to anyone with the link, including player names you enter. Mask player names (like <span class="mono">*****ess</span>) if your community expects it.</p>
<h2>Contact</h2>
<p>Privacy questions or deletion requests: email us at <a href="mailto:{{SUPPORT_EMAIL}}">{{SUPPORT_EMAIL}}</a>.</p>`, "privacy", "YourRank privacy policy. We collect minimal data: email, hashed password, and your public page content. No ad trackers.");

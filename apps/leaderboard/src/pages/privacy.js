import { legal } from "./legal-helper.js";

// privacy page
export const privacyPage = legal("Privacy Policy", "September 2026", `
<h2>What we collect</h2>
<p>As little as we can get away with:</p>
<ul>
<li><b>Account:</b> your email and a hashed password (we never store the password itself).</li>
<li><b>Page content:</b> whatever you put on your leaderboard — it's public by design.</li>
<li><b>Requests:</b> if you use the contact form, we keep what you send us (handle, contact info, note).</li>
<li><b>Billing records:</b> plan, amount, payment status, and provider references when you purchase a subscription.</li>
</ul>
<h2>Cookies</h2>
<p>Essential cookies keep you signed in and secure your dashboard actions. With your consent, we also set analytics cookies to count page views and understand how visitors interact with leaderboards. You can choose to accept only essential cookies via the banner on your first visit. We never load third-party ad trackers or pixels.</p>
<h2>Who else sees data</h2>
<p>Our infrastructure runs on Cloudflare for hosting and service delivery. When you open paid checkout, Polar receives your email, account identifier, and IP address to process the subscription, determine tax location, and provide billing support. Payment details are entered on Polar. We don't sell your data.</p>
<h2>How long we keep it</h2>
<p>As long as your account exists. You can download a copy of your data at any time from <a href="/dashboard/settings/data">Settings → Data</a> (GDPR/CCPA data export). Want your account deleted? Go to <a href="/dashboard/settings/data">Settings → Data</a> and click "Delete my account."</p>
<h2>Anti-abuse signals</h2>
<p>To stop one person from using several accounts to farm rewards or enter giveaways more than once, we collect two signals when you claim a code drop, check in, or verify a giveaway entry:</p><ul><li><b>Device fingerprint:</b> your browser computes a one-way hash from technical characteristics (canvas and WebGL rendering, installed fonts, screen size, time zone, and browser version). Only the hash is sent and stored — never the underlying values.</li><li><b>IP address:</b> we store a keyed one-way hash of your IP address (for IPv6, your /64 network prefix instead of your device's full address) with a timestamp. The raw IP is never stored. These records are deleted after 30 days.</li></ul><p>We also keep a history of which Kick or Telegram account was linked to which YourRank profile. These signals are used only to detect accounts that are likely operated by the same person. Streamers may see that accounts appear linked; they never see your IP address or device details, and no account is restricted automatically.</p>
<h2>Your page is public</h2>
<p>Anything you publish on your leaderboard page is visible to anyone with the link, including player names you enter. Mask player names (like <span class="mono">*****ess</span>) if your community expects it.</p>
<h2>Contact</h2>
<p>Privacy questions or deletion requests: email us at <a href="mailto:{{SUPPORT_EMAIL}}">{{SUPPORT_EMAIL}}</a>.</p>`, "privacy", "YourRank privacy policy. We collect minimal data: email, hashed password, and your public page content. No ad trackers.");

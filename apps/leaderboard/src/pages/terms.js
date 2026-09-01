import { legal } from "./legal-helper.js";

// terms page
export const termsPage = legal("Terms of Service", "July 2026", `
<h2>What YourRank is</h2>
<p>YourRank is a software platform that lets streamers and community managers operate public community sites, leaderboards, viewer memberships, free credits, creator-provided rewards, and related engagement tools from one dashboard.</p>
<p><b>YourRank is not a casino, bookmaker, or gambling operator.</b> The launch product accepts no deposits, permits no cash withdrawals, and does not operate cash wagering. Free credits have no cash value. Leaderboard standings are provided by the page owner — entered manually or updated automatically from third-party postbacks they configure. Rewards shown on a community page are offered and fulfilled by that page's owner, not by YourRank.</p>
<h2>Your account</h2>
<p>You need to be at least 18 to use YourRank. You're responsible for keeping your password safe and for everything published on your page. One account per person. Site capacity depends on your plan — Free includes one, Pro up to three, and Team up to ten.</p>
<h2>Your content and compliance</h2>
<p>Everything you put on your page — names, numbers, links, images — is yours, and so is the responsibility for it. Don't publish anything illegal, misleading (fake prizes you don't pay out), or that infringes someone else's rights. Don't impersonate other streamers or brands.</p>
<p>If your page promotes or references gambling, you are solely responsible for ensuring it complies with the laws, licensing, and platform rules that apply to you, your audience, and the jurisdictions you operate in. We encourage operating in regulated markets such as the United Kingdom, the Netherlands, and Canada where appropriate safeguards exist.</p>
<h2>Payments</h2>
<p>Free is currently available without a credit card. Recurring card checkout for Pro and Team is not available yet. Paid access will only be activated after confirmation from a verified billing provider; creating an account or selecting a paid plan does not itself create a charge or paid entitlement. A one-time 7-day Pro trial may be available from account settings.</p>
<p>When recurring billing becomes available, current price and cancellation terms will be shown before purchase and governed by the <a href="/refund">refund policy</a>. Downgrades preserve content and viewer rights; lower-plan limits restrict new creator operations rather than deleting existing data.</p>
<h2>What we can do</h2>
<p>We can suspend pages or accounts that break these terms, harm other users, or expose us to legal risk. We'll be reasonable about it. We may change prices or features with notice.</p>
<h2>Liability</h2>
<p>YourRank is provided as-is. We work to keep pages online, but we don't guarantee uninterrupted service and we're not liable for lost revenue, lost viewers, or disputes between you and your community. Our total liability is capped at what you paid us in the last 3 months.</p>
<h2>Contact</h2>
<p>Questions about these terms: email us at <a href="mailto:{{SUPPORT_EMAIL}}">{{SUPPORT_EMAIL}}</a>.</p>`, "terms", "YourRank terms of service. Covers accounts, content, payments, liability, and how we handle disputes.");

import { legal } from "./legal-helper.js";

// refund page
export const refundPage = legal("Refund & Cancellation Policy", "July 2026", `
<p><b>Free plan</b> — YourRank can be used free of charge, forever. No payment or credit card is required to create a page and test the service.</p>
<h2>Paid plans</h2>
<p>When enabled in Billing, Pro and Team subscriptions are processed by Polar. Selecting a plan does not itself create a charge or paid entitlement. The price, billing interval, and applicable taxes are shown at checkout. Access starts after payment is confirmed.</p>
<h2>Failed or duplicate charges</h2>
<p>If a charge is duplicated by mistake, contact us within 14 days and we will review the transaction. Approved duplicate charges will be refunded to the original payment method.</p>
<h2>How to cancel</h2>
<p>Open Settings → Billing → Manage subscription to cancel through Polar. Cancellation at the end of the billing period preserves access until the confirmed period ends. Cancel any renewing subscription before deleting your YourRank account.</p>
<h2>Contact</h2>
<p>Questions about billing or refunds: <a href="/help/support">contact us</a> or email <a href="mailto:{{SUPPORT_EMAIL}}">{{SUPPORT_EMAIL}}</a>.</p>`, "refund", "YourRank refund and cancellation policy for Free access and Polar subscriptions.");

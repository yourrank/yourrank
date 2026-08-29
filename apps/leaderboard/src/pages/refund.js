import { legal } from "./legal-helper.js";

// refund page
export const refundPage = legal("Refund & Cancellation Policy", "July 2026", `
<p><b>Free plan</b> — YourRank can be used free of charge, forever. No payment or credit card is required to create a page and test the service.</p>
<h2>Paid plans</h2>
<p>Recurring card checkout for Pro and Team is not currently available. Selecting a paid plan does not create a charge or paid entitlement. When billing opens, the provider, renewal date, cancellation state, and applicable refund terms will be shown before purchase.</p>
<h2>Failed or duplicate charges</h2>
<p>If a future charge is duplicated by mistake, contact us within 14 days and we will review the transaction. Approved duplicate charges will be refunded to the original payment method.</p>
<h2>How to cancel</h2>
<p>No recurring subscription can currently be started. Cancellation controls will be available with recurring checkout and will preserve paid access until the confirmed billing period ends.</p>
<h2>Contact</h2>
<p>Questions about billing or refunds: <a href="/help/support">contact us</a> or email <a href="mailto:{{SUPPORT_EMAIL}}">{{SUPPORT_EMAIL}}</a>.</p>`, "refund", "YourRank refund and cancellation policy for Free access and future verified recurring billing.");

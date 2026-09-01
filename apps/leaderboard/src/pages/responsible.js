import { legal } from "./legal-helper.js";

// responsible page
export const responsiblePage = legal("Responsible Play", "July 2026", `
<p><b>YourRank is a community participation platform.</b> Community credits are free, site-scoped, and have no cash value. They cannot be purchased, withdrawn, or transferred between communities. Creator-provided rewards are offered and fulfilled by the creator, not by YourRank.</p>
<h2>Participate safely</h2>
<ul>
<li>You must be <b>18 or older</b> to create or participate through an account.</li>
<li>Do not share your password, verification links, or connected-account credentials.</li>
<li>Read a creator's reward terms before claiming and contact the creator about fulfilment questions.</li>
<li>Treat credits, ranks, and rewards as community participation, never as money or income.</li>
</ul>
<h2>For creators</h2>
<p>Publish accurate rules, honour the rewards you offer, protect private viewer information, and resolve claims through the canonical fulfilment workflow. Pages that mislead their communities or misuse viewer data may be suspended.</p>
<h2>Need help?</h2>
<p>For a creator reward or community rule, contact that creator. For account access, privacy, or platform issues, contact <a href="mailto:{{SUPPORT_EMAIL}}">{{SUPPORT_EMAIL}}</a>.</p>`, "responsible", "Responsible participation guidance for YourRank creators and viewers, including free-credit and account-safety boundaries.");

// admin page
import { DEVIN_DESIGN_CONTRACT } from "@yourrank/shared/page-shell";

export const adminPage = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Admin · YourRank</title>
<meta name="robots" content="noindex, nofollow" /><link rel="canonical" href="https://yourrank.site/admin" /><link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/assets/app.css" /><link rel="stylesheet" href="/assets/ui.css" /><link rel="stylesheet" href="/assets/devin-system.css" /></head><body>${DEVIN_DESIGN_CONTRACT}
<div class="toast" id="status" role="status" aria-live="polite" hidden></div>
<noscript><div class="noscript-msg"><p>YourRank Admin requires JavaScript</p><p>Please enable JavaScript in your browser settings to use the admin panel.</p></div></noscript>
<a href="#main-content" class="sr-only skip-link">Skip to content</a>
<header class="topbar"><div class="brand">Your<b>Rank</b> <span class="label ml-8">ADMIN</span></div>
<div class="topbar-right"><span class="muted" id="userEmail"></span><a href="/dashboard" class="btn btn--sm btn--ghost">Dashboard</a><a href="#" id="logout" class="btn btn--sm btn--ghost">Sign out</a></div></header>
<main class="wrap" id="main-content"><div id="loading" class="py-26">
<div class="mb-18"><div class="skeleton skeleton-text--lg skel-w-160"></div><div class="skeleton skeleton-text--sm skel-w-240 mt-8"></div></div>
<div class="stats"><div class="stat"><div class="skeleton skeleton-text skel-w-60"></div><div class="skeleton skeleton-text--sm skel-w-50 mt-6"></div></div><div class="stat"><div class="skeleton skeleton-text skel-w-40"></div><div class="skeleton skeleton-text--sm skel-w-40 mt-6"></div></div><div class="stat"><div class="skeleton skeleton-text skel-w-30"></div><div class="skeleton skeleton-text--sm skel-w-50 mt-6"></div></div><div class="stat"><div class="skeleton skeleton-text skel-w-70"></div><div class="skeleton skeleton-text--sm skel-w-80 mt-6"></div></div></div>
<div class="card mt-18"><div class="skeleton skeleton-block skel-h-300"></div></div>
</div>
<div id="panel" hidden>
<div class="dash-head"><div><h1>Operator panel</h1><p class="live-link">Everything that happens on YourRank, in one place.</p></div></div>
<div class="stats"><div class="stat"><b id="s_users">–</b><span>accounts</span></div><div class="stat"><b id="s_pro">–</b><span>on Pro</span></div><div class="stat"><b id="s_leads">–</b><span>leads</span></div><div class="stat"><b id="s_rev">–</b><span>revenue (USD)</span></div></div>
<div class="tabs" role="tablist"><button class="tab is-on" id="tab-btn-users" data-tab="users" type="button" role="tab" aria-selected="true" aria-controls="tab-users">Users</button><button class="tab" id="tab-btn-leads" data-tab="leads" type="button" role="tab" aria-selected="false" aria-controls="tab-leads">Leads</button><button class="tab" id="tab-btn-payments" data-tab="payments" type="button" role="tab" aria-selected="false" aria-controls="tab-payments">Payments</button><button class="tab" id="tab-btn-support" data-tab="support" type="button" role="tab" aria-selected="false" aria-controls="tab-support">Support</button><button class="tab" id="tab-btn-features" data-tab="features" type="button" role="tab" aria-selected="false" aria-controls="tab-features">Features</button><button class="tab" id="tab-btn-audit" data-tab="audit" type="button" role="tab" aria-selected="false" aria-controls="tab-audit">Audit</button><button class="tab" id="tab-btn-identity" data-tab="identity" type="button" role="tab" aria-selected="false" aria-controls="tab-identity">Identity</button></div>
<div class="tabpane" id="tab-users" role="tabpanel" aria-labelledby="tab-btn-users">
<div class="card" style="margin-bottom:18px;display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
<div style="flex:1 1 220px"><label for="usersSearch" style="display:block;font-size:13px;color:var(--ink-soft);margin-bottom:4px">Search</label><input id="usersSearch" class="input" type="text" placeholder="Email or user ID" /></div>
<div><label for="usersStatusFilter" style="display:block;font-size:13px;color:var(--ink-soft);margin-bottom:4px">Status</label><select id="usersStatusFilter" class="select"><option value="all">All</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="unverified">Unverified</option></select></div>
<div><label for="usersPlanFilter" style="display:block;font-size:13px;color:var(--ink-soft);margin-bottom:4px">Plan</label><select id="usersPlanFilter" class="select"><option value="all">All</option><option value="free">Free</option><option value="pro">Pro</option><option value="team">Team</option></select></div>
<button class="btn btn--sm" id="usersFilterApply">Filter</button>
</div>
<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Email</th><th>Page</th><th>Plan</th><th>Status</th><th>2FA</th><th class="ta-r">Players</th><th>Joined</th><th>Actions</th></tr></thead><tbody id="usersBody"></tbody></table></div>
<div class="empty" id="usersEmpty" hidden>No users yet.</div>
<div id="usersPagination" class="admin-pagination"></div></div>
<div class="tabpane" id="tab-leads" role="tabpanel" aria-labelledby="tab-btn-leads" hidden>
<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Handle</th><th>Casino</th><th>Contact</th><th>Note</th><th>When</th></tr></thead><tbody id="leadsBody"></tbody></table></div>
<div id="leadsPagination" class="admin-pagination"></div>
<div class="empty" id="leadsEmpty" hidden>No leads yet. Share the landing page around.</div></div>
<div class="tabpane" id="tab-payments" role="tabpanel" aria-labelledby="tab-btn-payments" hidden>
<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>User</th><th>Provider</th><th class="ta-r">Amount</th><th>Status</th><th>When</th></tr></thead><tbody id="payBody"></tbody></table></div>
<div id="payPagination" class="admin-pagination"></div>
<div class="empty" id="payEmpty" hidden>No payments yet.</div></div>
<div class="tabpane" id="tab-support" role="tabpanel" aria-labelledby="tab-btn-support" hidden>
<div class="card" style="margin-bottom:18px">
<label for="supportFilter" class="sr-only">Filter support messages</label>
<select id="supportFilter" class="select" style="min-width:160px;padding:8px 10px;border-radius:6px;border:1px solid var(--line-2);background:var(--panel);color:var(--ink);font-size:13px">
<option value="all">All</option>
<option value="pending">Pending</option>
<option value="replied">Replied</option>
</select></div>
<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>When</th><th>User</th><th>Subject</th><th>Status</th><th></th></tr></thead><tbody id="supportBody"></tbody></table></div>
<div id="supportPagination" class="admin-pagination"></div>
<div class="empty" id="supportEmpty" hidden>No support messages yet.</div>
<div class="card mt-18" id="supportReplyCard" hidden>
<h2>Reply</h2>
<p class="card-sub">To <b id="replyToEmail"></b> · <span id="replySubject"></span></p>
<p class="hint" id="replyMessage" style="white-space:pre-wrap"></p>
<form id="replyForm">
<input type="hidden" id="replyId" />
<label for="replyText" class="sr-only">Reply</label>
<textarea id="replyText" class="textarea" rows="6" placeholder="Type your reply here…" required style="width:100%;padding:10px 12px;border:1px solid var(--line-2);border-radius:8px;background:var(--panel);color:var(--ink);font-size:14px;min-height:120px"></textarea>
<p class="status" id="replyStatus" role="status" aria-live="polite"></p>
<div class="btns-row" style="display:flex;justify-content:flex-end;gap:12px;margin-top:12px">
<button class="btn btn--ghost" type="button" id="replyCancel">Cancel</button>
<button class="btn btn--accent" type="submit">Send reply</button>
</div>
</form>
</div>
</div>
<p class="hint mt-18">Manual activation: use <b>+31d Pro</b> on any user after they pay you directly (PayPal, bank, whatever). Crypto payments through the site activate on their own. Reset links work for 24h — send them over Discord/Telegram if email isn't wired up.</p>
</div>
<div class="tabpane" id="tab-features" role="tabpanel" aria-labelledby="tab-btn-features" hidden>
<div class="card">
<h2>Feature flags</h2>
<p class="card-sub">Toggle features globally or override them for a specific user.</p>
<div id="featuresStatus" role="status" aria-live="polite"></div>
<div class="admin-table-wrap" style="margin-top:14px"><table class="admin-table"><thead><tr><th>Key</th><th>Name</th><th>Default</th><th>Override for user</th><th></th></tr></thead><tbody id="featuresBody"></tbody></table></div>
<div class="empty" id="featuresEmpty" hidden>No feature flags yet.</div>
</div>
</div>
<div class="tabpane" id="tab-audit" role="tabpanel" aria-labelledby="tab-btn-audit" hidden>
<div class="card">
<h2>Audit log</h2>
<p class="card-sub">Recent admin actions and plan changes. Times are in your local timezone.</p>
<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr></thead><tbody id="auditBody"></tbody></table></div>
<div class="empty" id="auditEmpty" hidden>No audit events yet.</div>
<div id="auditPagination" class="admin-pagination"></div>
</div>
</div>
<div class="tabpane" id="tab-identity" role="tabpanel" aria-labelledby="tab-btn-identity" hidden>
<div class="card" id="identityCard">
<h2>Platform identity</h2>
<p class="card-sub">Legal company details used on terms, privacy, refund, and footer pages. Required before launch.</p>
<p class="status" id="identityStatus" role="status" aria-live="polite" hidden></p>
<form id="identityForm" class="form-stack">
<div class="field"><label for="i_company_name">Company name</label><input class="input" id="i_company_name" type="text" placeholder="YourRank Ltd" required /></div>
<div class="field"><label for="i_company_country">Registered country</label><input class="input" id="i_company_country" type="text" placeholder="United Kingdom" /></div>
<div class="field"><label for="i_company_number">Company registration number</label><input class="input" id="i_company_number" type="text" placeholder="12345678" /></div>
<div class="field"><label for="i_support_email">Support email</label><input class="input" id="i_support_email" type="email" placeholder="contact@yourrank.site" /></div>
<div class="field"><label for="i_affiliate_disclosure">Affiliate disclosure</label><textarea class="textarea" id="i_affiliate_disclosure" rows="3"></textarea><p class="hint">Shown in the footer of every public and platform page.</p></div>
<div class="btns-row" style="display:flex;justify-content:flex-end;gap:12px;margin-top:12px"><button class="btn btn--accent" type="submit">Save identity</button></div>
</form>
</div>
</div></main>
<script src="/assets/admin.js?v=4" type="module"></script></body></html>`;

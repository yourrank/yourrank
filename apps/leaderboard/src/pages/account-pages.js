// Account page bodies, one directly-authored template per tab.
// The surrounding chrome (sidebar, topbar, titles) lives in account.jsx.

const profileWidget = `<div class="lb-widget lb-widget--full acc-card-security" id="profile">
        <div class="acc-card-header">
          <div class="acc-card-icon-wrap" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </div>
          <div>
            <h2>Password &amp; Security</h2>
            <p class="card-sub">Manage your account authentication credentials and login password.</p>
          </div>
        </div>
        <div class="acc-form-wrap">
          <div class="field">
            <label for="accCurrentPassword">Current password</label>
            <div class="field-password-wrap">
              <input type="password" id="accCurrentPassword" autocomplete="current-password" placeholder="••••••••" />
              <button class="btn-pwd-toggle" type="button" data-pwd-toggle="accCurrentPassword" aria-label="Toggle current password visibility" tabindex="-1">
                <svg class="eye-open" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                <svg class="eye-closed" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none"><path d="m15 18-.722-3.25"/><path d="M2 8a10.645 10.645 0 0 0 20 0"/><path d="m20 15-1.726-2.05"/><path d="m4 15 1.726-2.05"/><path d="m9 18 .722-3.25"/></svg>
              </button>
            </div>
          </div>
          <div class="field">
            <label for="accNewPassword">New password</label>
            <div class="field-password-wrap">
              <input type="password" id="accNewPassword" autocomplete="new-password" minlength="8" placeholder="At least 8 characters" />
              <button class="btn-pwd-toggle" type="button" data-pwd-toggle="accNewPassword" aria-label="Toggle new password visibility" tabindex="-1">
                <svg class="eye-open" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                <svg class="eye-closed" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none"><path d="m15 18-.722-3.25"/><path d="M2 8a10.645 10.645 0 0 0 20 0"/><path d="m20 15-1.726-2.05"/><path d="m4 15 1.726-2.05"/><path d="m9 18 .722-3.25"/></svg>
              </button>
            </div>
            <div class="pwd-reqs" id="pwdReqs" aria-live="polite">
              <span class="pwd-req" id="pwdReqLength"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/></svg> Minimum 8 characters</span>
              <span class="pwd-req" id="pwdReqCase"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/></svg> Upper &amp; lower case</span>
              <span class="pwd-req" id="pwdReqNumber"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/></svg> A number</span>
              <span class="pwd-req" id="pwdReqSymbol"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/></svg> A symbol</span>
            </div>
          </div>
          <div class="d-flex gap-8 items-center flex-wrap mt-6">
            <button class="btn btn--accent" id="accChangePassword" type="button">Update password</button>
            <span class="hint" id="accPasswordStatus" role="status" aria-live="polite"></span>
          </div>
        </div>
        <hr class="hr" />
        <div class="acc-sessions-section">
          <div class="d-flex justify-between items-center mb-12 flex-wrap gap-8">
            <div>
              <h3 class="m-0">Active sessions</h3>
              <p class="card-sub m-0 mt-2">Web browsers and devices currently signed in to your account.</p>
            </div>
            <div class="d-flex gap-8 flex-wrap">
              <button class="btn btn--ghost btn--sm" id="accSignOut" type="button">Sign out</button>
              <button class="btn btn--ghost btn--sm" id="accRevokeSessions" type="button">Sign out other sessions</button>
            </div>
          </div>
          <div id="accSessions"><p class="hint">Loading sessions…</p></div>
          <p class="hint" id="accSessionsStatus" role="status" aria-live="polite"></p>
        </div>
      </div>`;

const planWidget = `<div class="lb-widget lb-widget--full" id="plan">
        <h2>Billing</h2>
        <p class="card-sub">Billing, usage and payment history.</p>

        <div class="plan-summary" id="planSummary"></div>
        <div class="plan-banner" id="planBanner" role="status" aria-live="polite" hidden></div>

        <h3 class="m-0 mt-18 mb-8">Usage &amp; limits</h3>
        <p class="card-sub">What you are using across all products. Limit messages in other dashboards link here.</p>
        <div class="plan-usage" id="planUsage"><p class="hint">Loading usage…</p></div>

        <h3 class="m-0 mt-18 mb-8">Compare plans</h3>
        <div class="plan-grid" id="planGrid"></div>
        <div class="plan-trial" id="planTrial" hidden><p class="hint">Not ready to pay? Try every Pro feature free for 7 days.</p><button class="btn btn--accent" id="trialBtn" type="button">Start free Pro trial</button><p class="status" id="trialStatus" role="status" aria-live="polite"></p></div>
        <p class="hint" id="planHint">Paid plans are billed in crypto (BTC, ETH, USDT and 100+ more) and activate automatically once the network confirms.</p>

        <section class="plan-referral" id="planReferral">
          <h3 class="m-0 mt-18 mb-4">Earn free Pro days</h3>
          <p class="card-sub">Share your link. Every sign-up adds 31 days of Pro.</p>
          <div class="v3-ref-link-row"><input id="refLink" readonly aria-label="Your referral link" value="" /><button class="v3-btn v3-btn--accent" id="refCopy" type="button">Copy link</button></div>
          <div class="v3-stat-tiles"><div><b id="refCount"><span class="v3-skel-kpi" aria-hidden="true"></span></b><span>Streamers joined</span></div><div><b id="refDays"><span class="v3-skel-kpi" aria-hidden="true"></span></b><span>Free Pro days earned</span></div><div><b id="refSaved"><span class="v3-skel-kpi" aria-hidden="true"></span></b><span>Estimated value</span></div></div>
          <p id="refStatus" role="status" aria-live="polite"></p>
        </section>

        <div id="pendingPayment" hidden class="plan-pending">
          <h3 class="m-0 mb-8">Pending payment</h3>
          <p class="status" role="status" aria-live="polite"></p>
          <a class="btn btn--sm" id="pendingPaymentLink" href="#">Complete payment</a>
        </div>

        <div id="cancelWrap" hidden class="plan-cancel">
          <h3 class="m-0 mb-8">Cancel or change plan</h3>
          <p class="card-sub">What happens before you cancel or downgrade.</p>
          <ul class="hint plan-cancel-list">
            <li>You keep your current plan features until the expiry date shown above.</li>
            <li>After expiry, your account reverts to Free and paid features stop working.</li>
            <li>If you are over Free limits (sites, players, ways to earn, items), you won't be able to add more until you upgrade again.</li>
            <li>Existing site data, members, and orders are never deleted by a downgrade.</li>
          </ul>
          <p class="hint" id="cancelStatus" role="status" aria-live="polite"></p>
          <button class="btn btn--sm btn--danger" id="cancelBtn" type="button">Cancel subscription</button>
        </div>

        <div id="historyCard" hidden>
          <h3 class="m-0 mt-18 mb-4">Payment history</h3>
          <p class="card-sub">Your past payments and receipts.</p>
          <div class="admin-table-wrap"><table class="admin-table" id="historyTable"><thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>Status</th></tr></thead><tbody id="historyBody"></tbody></table></div>
          <div class="empty" id="historyEmpty" hidden>No payments yet. Completed payments and receipts will appear here after you upgrade.</div>
          <p class="hint">Receipts are also emailed to your account address after each successful payment.</p>
        </div>
      </div>`;

const postbacksWidget = `<div class="lb-widget lb-widget--full" id="postbacks">
        <h2>Automatic sponsor score updates</h2>
        <p class="card-sub">Automatically update player scores and track sponsor-reported sign-ups and deposits directly from your casino or brand sponsor.</p>

        <div id="postbackStatusCard" class="card card--status" hidden>
          <div class="d-flex items-center gap-8">
            <span class="status-dot" id="postbackStatusDot"></span>
            <b id="postbackStatusText">—</b>
          </div>
          <p class="hint" id="postbackStatusHint"></p>
        </div>

        <div id="postbackShareCard" hidden>
          <h3 class="m-0 mt-18 mb-8">What to send your sponsor or affiliate manager</h3>
          <p class="hint">Give this secure deposit tracking link to your affiliate manager or sponsor developer. It connects to your leaderboard without exposing your private account password.</p>
          <div class="field">
              <label>Deposit tracking link</label>
            <div class="d-flex gap-8 items-center flex-wrap">
              <code id="postbackSigned" class="overlay-url"></code>
              <button class="btn btn--sm btn--accent ic-btn" id="postbackCopySigned" type="button">Copy link</button>
            </div>
          </div>
          <div class="field">
            <label>Deposit tracking setup guide</label>
            <p class="hint">Your sponsor uses this guide to send confirmed deposit information to your leaderboard.</p>
            <button class="btn btn--sm btn--ghost" id="postbackCopyManager" type="button">Copy full setup guide for sponsor</button>
          </div>
          <div class="field">
            <label>Test live updates</label>
            <p class="hint">Send a simulated player score update to verify your leaderboard updates in real time.</p>
            <button class="btn btn--sm" id="postbackTest" type="button">Send test score update</button>
            <span class="hint" id="postbackTestStatus" role="status" aria-live="polite"></span>
          </div>
        </div>

        <div id="postbackKeyCard" hidden>
          <h3 class="m-0 mt-18 mb-8">Private sponsor access key</h3>
          <p class="hint">Keep this key confidential. Only share it with trusted connected apps. Rotating revokes the previous key instantly.</p>
          <div class="field">
            <label>Your private key</label>
            <div class="d-flex gap-8 items-center flex-wrap">
              <code id="postbackKey" class="overlay-url"></code>
              <button class="btn btn--sm btn--accent ic-btn" id="postbackCopyKey" type="button">Copy key</button>
              <button class="btn btn--sm" id="postbackRotate" type="button">Generate new key</button>
              <button class="btn btn--sm btn--danger" id="postbackRevoke" type="button">Deactivate key</button>
            </div>
          </div>
        </div>

        <details class="adv" id="postbackAdvanced" hidden>
            <summary>Advanced settings</summary>
          <div class="field mt-14">
            <label>Legacy link (sunset {{NEXT_YEAR}})</label>
            <div class="d-flex gap-8 items-center flex-wrap">
              <code id="postbackLegacy" class="overlay-url"></code>
              <button class="btn btn--sm ic-btn" id="postbackCopyLegacy" type="button">Copy</button>
            </div>
            <p class="hint">This older link is kept for compatibility and may stop working after the date shown above.</p>
          </div>
        </details>

        <div id="postbackUpgrade" hidden>
          <p class="hint">Automatic score updates are a paid feature. Upgrade to Pro to create connection keys and view live score updates.</p>
          <a class="btn btn--accent" href="/dashboard/settings/billing">See billing</a>
        </div>

        <hr class="hr" />
        <h3 class="m-0 mt-18 mb-4">Recent sponsor activity</h3>
        <div class="admin-table-wrap"><table class="admin-table" id="conversionsTable"><thead><tr><th>Time</th><th>Event</th><th>Score / Amount</th><th>Currency</th><th>Campaign / Offer</th></tr></thead><tbody id="conversionsBody"></tbody></table></div>
        <p class="empty" id="conversionsEmpty" hidden>No sponsor activity yet. Connect deposit tracking to see updates here.</p>
      </div>`;

const connectedWidget = `<div class="lb-widget lb-widget--full" id="connected">
        <h2>Connected accounts</h2>
        <p class="card-sub">Accounts and connected apps linked to your streamer profile.</p>
        <div id="connectedAccounts"><p class="hint">Loading…</p></div>
        <p class="hint">Identities are not merged across providers unless you explicitly enable linking.</p>
      </div>`;

const dataWidget = `<div class="lb-widget lb-widget--full" id="data">
          <h2>Account data &amp; backup</h2>
          <p class="card-sub">Download complete backups of your leaderboards, scores, and creator settings, or manage account deletion.</p>
          <section class="account-data-export" aria-labelledby="accountExportTitle">
            <h3 class="m-0" id="accountExportTitle">Download Creator Backup</h3>
            <p class="card-sub">Download a full backup of everything: settings, players, shop items, and analytics.</p>
            <div class="d-flex gap-8 items-center flex-wrap">
              <button class="btn btn--accent" id="accExportData" type="button">Generate Account Backup</button>
              <span class="hint" id="accExportStatus" role="status" aria-live="polite"></span>
            </div>
          </section>
          <hr class="hr" />
          <section class="account-danger-zone" aria-labelledby="accountDangerTitle">
            <h3 class="m-0 mt-18 mb-4" id="accountDangerTitle">Permanently delete creator account</h3>
            <p class="card-sub">Permanently delete your master streamer account and all live leaderboards. This action is irreversible.</p>
            <button class="btn btn--danger" id="deleteAccountBtn" type="button">Delete Creator Account</button>
          </section>
        </div>`;

const deleteAccountModal = `<div class="modal" id="deleteAccountModal" role="dialog" aria-modal="true" aria-labelledby="deleteAccountModalTitle" aria-describedby="deleteAccountModalDescription" aria-hidden="true" hidden>
  <div class="modal-card">
    <h3 id="deleteAccountModalTitle">Delete your account?</h3>
    <p id="deleteAccountModalDescription">This will remove all your data — leaderboards, players, archives, subscriptions, and connected bots. This cannot be undone.</p>
    <div class="field"><label for="deleteAccountConfirm">Type <b>DELETE</b> to confirm</label><input id="deleteAccountConfirm" autocomplete="off" placeholder="DELETE" /></div>
    <div class="field" id="deleteAccountPasswordWrap" hidden><label for="deleteAccountPassword">Enter your password</label><input id="deleteAccountPassword" type="password" autocomplete="current-password" placeholder="Password" /></div>
    <div class="d-flex gap-10 flex-wrap">
      <button class="btn btn--danger" id="deleteAccountConfirmBtn" type="button">Delete my account</button>
      <button class="btn btn--ghost" id="deleteAccountCancelBtn" type="button">Cancel</button>
    </div>
    <p class="status" id="deleteAccountModalStatus" role="status" aria-live="polite"></p>
  </div>
</div>
`;

const teamWidget = `<div class="lb-widget lb-widget--full" id="team">
        <div class="d-flex justify-between items-center mb-16 flex-wrap gap-12">
          <div>
            <h2 class="m-0">Team &amp; Moderators</h2>
            <p class="card-sub m-0 mt-2">Delegate leaderboard score updates and shop fulfillment to trusted mods without sharing your login or billing credentials.</p>
          </div>
          <button class="btn btn--accent" id="btnOpenInviteModal" type="button">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true" style="margin-right:6px;vertical-align:-2px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Moderator / Manager
          </button>
        </div>

        <div class="acc-team-section">
          <h3 class="m-0 mb-8">Active Team Members</h3>
          <div id="teamMembersList">
            <p class="hint">Loading team members…</p>
          </div>
        </div>

        <hr class="hr" />

        <div class="acc-team-section">
          <h3 class="m-0 mb-8">Pending Invitations</h3>
          <div id="teamInvitesList">
            <p class="hint">No pending invitations.</p>
          </div>
        </div>

        <hr class="hr" />

        <div class="acc-team-roles-guide">
          <h3 class="m-0 mb-8">Role Permissions Overview</h3>
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Capability</th>
                  <th>Owner (You)</th>
                  <th>Manager</th>
                  <th>Moderator (Mod)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Leaderboards &amp; scores</strong><br/><span class="hint">Update players, scores, reset period</span></td>
                  <td><span class="pill pill--good">Full access</span></td>
                  <td><span class="pill pill--good">Full access</span></td>
                  <td><span class="pill pill--good">Full access</span></td>
                </tr>
                <tr>
                  <td><strong>Rewards fulfilment</strong><br/><span class="hint">Approve and fulfil member orders</span></td>
                  <td><span class="pill pill--good">Full access</span></td>
                  <td><span class="pill pill--good">Full access</span></td>
                  <td><span class="pill pill--good">Full access</span></td>
                </tr>
                <tr>
                  <td><strong>Telegram</strong><br/><span class="hint">Manage commands, offers, and broadcasts</span></td>
                  <td><span class="pill pill--good">Full access</span></td>
                  <td><span class="pill pill--good">Full access</span></td>
                  <td><span class="pill pill--muted">No access</span></td>
                </tr>
                <tr>
                  <td><strong>Billing &amp; Subscription</strong><br/><span class="hint">Payment methods, crypto checkouts, plans</span></td>
                  <td><span class="pill pill--good">Full access</span></td>
                  <td><span class="pill pill--muted">No access</span></td>
                  <td><span class="pill pill--muted">No access</span></td>
                </tr>
                <tr>
                  <td><strong>Account Security &amp; Credentials</strong><br/><span class="hint">Change password, email, delete site</span></td>
                  <td><span class="pill pill--good">Full access</span></td>
                  <td><span class="pill pill--muted">No access</span></td>
                  <td><span class="pill pill--muted">No access</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

<div class="modal" id="inviteMemberModal" role="dialog" aria-modal="true" aria-labelledby="inviteModalTitle" hidden>
  <div class="modal-card">
    <h3 id="inviteModalTitle">Invite Team Member</h3>
    <p class="card-sub">Invite a moderator or manager to help operate this site. They will receive a unique link to join.</p>
    <div class="field">
      <label for="inviteEmail">Member email</label>
      <input id="inviteEmail" type="email" placeholder="mod@example.com" required />
    </div>
    <div class="field">
      <label for="inviteRole">Assigned Role</label>
      <select id="inviteRole" class="field-select">
        <option value="moderator" selected>Moderator (Can update leaderboards and fulfil shop orders)</option>
        <option value="manager">Manager (Can manage leaderboards, shop, and Telegram bot)</option>
      </select>
    </div>
    <div class="d-flex gap-10 flex-wrap mt-14">
      <button class="btn btn--accent" id="btnSendInvite" type="button">Create Invitation</button>
      <button class="btn btn--ghost" id="btnCloseInviteModal" type="button">Cancel</button>
    </div>
    <p class="status" id="inviteModalStatus" role="status" aria-live="polite"></p>
    <div id="inviteResultWrap" class="mt-14" hidden>
      <label>Shareable Invite Link</label>
      <div class="d-flex gap-8 items-center flex-wrap">
        <input type="text" id="inviteLinkInput" readonly style="flex:1;background:rgba(0,0,0,0.3);color:#fff;" />
        <button class="btn btn--sm" id="btnCopyInviteLink" type="button">Copy Link</button>
      </div>
      <p class="hint">This link is valid for 7 days.</p>
    </div>
  </div>
</div>`;

export const settingsWidgets = {
  account: profileWidget,
  team: teamWidget,
  plan: planWidget,
  postbacks: postbacksWidget,
  connected: connectedWidget,
  data: dataWidget + deleteAccountModal,
};

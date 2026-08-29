// Account page bodies, one directly-authored template per tab.
// The surrounding chrome (sidebar, topbar, titles) lives in account.jsx.

const profileWidget = `<div class="lb-widget lb-widget--full acc-card-security" id="profile">
        <section class="account-settings-section" aria-labelledby="accountIdentityTitle">
          <h2 id="accountIdentityTitle">Profile</h2>
          <p class="card-sub">The identity used for your YourRank account.</p>
          <dl class="account-detail-list">
            <div><dt>Name</dt><dd id="accSummaryName">Account</dd></div>
            <div><dt>Email</dt><dd id="accSummaryEmail">—</dd></div>
          </dl>
        </section>
        <section class="account-settings-section" aria-labelledby="accountPasswordTitle">
          <h2 id="accountPasswordTitle">Password</h2>
          <p class="card-sub">Use a strong password you do not use elsewhere.</p>
          <div class="acc-form-wrap">
          <div class="field">
            <label for="accCurrentPassword">Current password</label>
            <div class="field-password-wrap">
              <input type="password" id="accCurrentPassword" autocomplete="current-password" />
              <button class="btn-pwd-toggle" type="button" data-pwd-toggle="accCurrentPassword" aria-label="Show current password">
                <svg class="eye-open" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                <svg class="eye-closed" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none"><path d="m15 18-.722-3.25"/><path d="M2 8a10.645 10.645 0 0 0 20 0"/><path d="m20 15-1.726-2.05"/><path d="m4 15 1.726-2.05"/><path d="m9 18 .722-3.25"/></svg>
              </button>
            </div>
          </div>
          <div class="field">
            <label for="accNewPassword">New password</label>
            <div class="field-password-wrap">
              <input type="password" id="accNewPassword" autocomplete="new-password" minlength="8" aria-describedby="pwdReqs" />
              <button class="btn-pwd-toggle" type="button" data-pwd-toggle="accNewPassword" aria-label="Show new password">
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
        </section>
        <section class="account-settings-section acc-sessions-section" aria-labelledby="accountSessionsTitle">
          <div class="d-flex justify-between items-center mb-12 flex-wrap gap-8">
            <div>
              <h2 class="m-0" id="accountSessionsTitle">Signed-in devices</h2>
              <p class="card-sub m-0 mt-2">Browsers and devices with access to this account.</p>
            </div>
            <div class="d-flex gap-8 flex-wrap">
              <button class="btn btn--ghost btn--sm" id="accSignOut" type="button">Sign out</button>
              <button class="btn btn--ghost btn--sm" id="accRevokeSessions" type="button">Sign out other sessions</button>
            </div>
          </div>
          <div id="accSessions"><p class="hint">Loading sessions…</p></div>
          <p class="hint" id="accSessionsStatus" role="status" aria-live="polite"></p>
        </section>
      </div>`;

const planWidget = `<div class="lb-widget lb-widget--full" id="plan">
        <section class="account-settings-section" aria-labelledby="currentPlanTitle">
          <h2 id="currentPlanTitle">Current plan</h2>
          <p class="card-sub">Your current entitlement and the limits available to this account.</p>
        <div class="plan-summary" id="planSummary"></div>
        <div class="plan-banner" id="planBanner" role="status" aria-live="polite" hidden></div>
        </section>

        <section class="account-settings-section" aria-labelledby="planUsageTitle">
        <h2 id="planUsageTitle">Usage</h2>
        <p class="card-sub">Your current use across YourRank products.</p>
        <div class="plan-usage" id="planUsage"><p class="hint">Loading usage…</p></div>
        </section>

        <details class="account-settings-disclosure">
        <summary>Compare plans</summary>
        <div class="account-settings-disclosure-body">
        <div class="plan-grid" id="planGrid"></div>
        <div class="plan-trial" id="planTrial" hidden><p class="hint">Not ready to pay? Try every Pro feature free for 7 days.</p><button class="btn btn--accent" id="trialBtn" type="button">Start free Pro trial</button><p class="status" id="trialStatus" role="status" aria-live="polite"></p></div>
        <p class="hint" id="planHint">Recurring checkout is not available yet. Choosing a paid plan will not charge your account or activate paid access.</p>
        </div>
        </details>

        <details class="account-settings-disclosure" id="planReferral">
          <summary>Earn free Pro days</summary>
          <div class="account-settings-disclosure-body">
          <p class="card-sub">Share your link. Every sign-up adds 31 days of Pro.</p>
          <div class="v3-ref-link-row"><input id="refLink" readonly aria-label="Your referral link" value="" /><button class="v3-btn v3-btn--accent" id="refCopy" type="button">Copy link</button></div>
          <div class="v3-stat-tiles"><div><b id="refCount"><span class="v3-skel-kpi" aria-hidden="true"></span></b><span>Streamers joined</span></div><div><b id="refDays"><span class="v3-skel-kpi" aria-hidden="true"></span></b><span>Free Pro days earned</span></div><div><b id="refSaved"><span class="v3-skel-kpi" aria-hidden="true"></span></b><span>Estimated value</span></div></div>
          <p id="refStatus" role="status" aria-live="polite"></p>
          </div>
        </details>

        <section class="account-settings-section" id="historyCard" hidden aria-labelledby="paymentHistoryTitle">
          <h2 id="paymentHistoryTitle">Payment history</h2>
          <p class="card-sub">Your past payments and receipts.</p>
          <div class="admin-table-wrap"><table class="admin-table" id="historyTable"><thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>Status</th></tr></thead><tbody id="historyBody"></tbody></table></div>
          <div class="empty" id="historyEmpty" hidden>No payments yet. Completed payments and receipts will appear here after you upgrade.</div>
        </section>
      </div>`;

const postbacksWidget = `<details class="lb-widget lb-widget--full account-settings-disclosure" id="postbacks">
        <summary>Sponsor score updates</summary>
        <div class="account-settings-disclosure-body">
        <p class="card-sub">Connect a sponsor so confirmed activity can update player scores automatically.</p>

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
            <summary>Legacy setup</summary>
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
        </div>
      </details>`;

const connectedWidget = `<div class="lb-widget lb-widget--full" id="connected">
        <h2>Connected accounts</h2>
        <p class="card-sub">Services linked to your creator account.</p>
        <div id="connectedAccounts"><p class="hint">Loading…</p></div>
      </div>`;

const dataWidget = `<div class="lb-widget lb-widget--full" id="data">
          <section class="account-settings-section account-data-export" aria-labelledby="accountExportTitle">
            <h2 id="accountExportTitle">Export your data</h2>
            <p class="card-sub">Download a copy of your settings, players, shop items, and analytics.</p>
            <div class="d-flex gap-8 items-center flex-wrap">
              <button class="btn btn--accent" id="accExportData" type="button">Generate export</button>
              <span class="hint" id="accExportStatus" role="status" aria-live="polite"></span>
            </div>
          </section>
          <section class="account-settings-section account-danger-zone" aria-labelledby="accountDangerTitle">
            <h2 id="accountDangerTitle">Danger zone</h2>
            <h3>Delete account</h3>
            <p class="card-sub">Permanently delete your creator account and all of its sites. This cannot be undone.</p>
            <button class="btn btn--danger" id="deleteAccountBtn" type="button">Delete account</button>
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
            <h2 class="m-0">Team members</h2>
            <p class="card-sub m-0 mt-2">Invite trusted people to help manage the selected site without sharing your login.</p>
          </div>
          <button class="btn btn--accent" id="btnOpenInviteModal" type="button">
            Invite member
          </button>
        </div>

        <div class="acc-team-section">
          <h3 class="m-0 mb-8">Current team</h3>
          <div id="teamMembersList">
            <p class="hint">Loading team members…</p>
          </div>
        </div>

        <div class="acc-team-section">
          <h3 class="m-0 mb-8">Pending invites</h3>
          <div id="teamInvitesList">
            <p class="hint">No pending invitations.</p>
          </div>
        </div>

        <details class="account-settings-disclosure acc-team-roles-guide">
          <summary>Choosing a role</summary>
          <div class="account-settings-disclosure-body account-role-list">
            <div>
              <strong>Manager</strong>
              <p>Can manage leaderboards, rewards, and Telegram for this site. Cannot manage billing or account security.</p>
            </div>
            <div>
              <strong>Moderator</strong>
              <p>Can update leaderboards and fulfil reward orders. Cannot manage Telegram, billing, or account security.</p>
            </div>
          </div>
        </details>
      </div>

<div class="modal" id="inviteMemberModal" role="dialog" aria-modal="true" aria-labelledby="inviteModalTitle" aria-describedby="inviteModalDescription" aria-hidden="true" hidden>
  <div class="modal-card">
    <h3 id="inviteModalTitle">Invite team member</h3>
    <p class="card-sub" id="inviteModalDescription">Choose what this person can manage for the selected site.</p>
    <div class="field">
      <label for="inviteEmail">Email address</label>
      <input id="inviteEmail" type="email" autocomplete="email" placeholder="creator@example.com" required />
    </div>
    <div class="field">
      <label for="inviteRole">Role</label>
      <select id="inviteRole" class="field-select">
        <option value="moderator" selected>Moderator — leaderboards and reward orders</option>
        <option value="manager">Manager — leaderboards, rewards, and Telegram</option>
      </select>
    </div>
    <div class="d-flex gap-10 flex-wrap mt-14">
      <button class="btn btn--accent" id="btnSendInvite" type="button">Create invite</button>
      <button class="btn btn--ghost" id="btnCloseInviteModal" type="button">Cancel</button>
    </div>
    <p class="status" id="inviteModalStatus" role="status" aria-live="polite"></p>
    <div id="inviteResultWrap" class="mt-14" hidden>
      <label for="inviteLinkInput">Invite link</label>
      <div class="d-flex gap-8 items-center flex-wrap">
        <input type="text" id="inviteLinkInput" readonly />
        <button class="btn btn--sm" id="btnCopyInviteLink" type="button">Copy link</button>
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

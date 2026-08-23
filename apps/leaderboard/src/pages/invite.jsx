/** @jsxRuntime automatic */
/** @jsxImportSource hono/jsx */

import { raw } from "hono/html";

export function InvitePage({ invite, token, user } = {}) {
  const isExpired = invite ? (invite.status === "expired" || new Date(invite.expiresAt).getTime() < Date.now()) : false;
  const isRevoked = invite ? invite.status === "revoked" : false;
  const isAccepted = invite ? invite.status === "accepted" : false;
  const isValid = invite && !isExpired && !isRevoked && !isAccepted;

  const roleLabel = invite?.role === "manager" ? "Manager" : "Moderator";
  const roleDesc = invite?.role === "manager"
    ? "Full operational access to manage leaderboards, viewer rewards & shop fulfillment, casino offers, and bot commands."
    : "Access to update live leaderboard scores and review and fulfil viewer orders.";

  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Team Invitation · YourRank</title>
        <meta name="robots" content="noindex, nofollow" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="/assets/app.css" />
        <link rel="stylesheet" href="/assets/ui.css" />
        <link rel="stylesheet" href="/assets/devin-system.css" />
        <style dangerouslySetInnerHTML={{ __html: `
          .invite-shell { min-height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 24px; background: radial-gradient(circle at 50% 10%, rgba(234, 179, 8, 0.08) 0%, rgba(15, 23, 42, 0) 60%), #0b0f19; }
          .invite-card { max-width: 480px; width: 100%; background: #131b2e; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; padding: 32px; box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5); text-align: center; }
          .invite-icon { width: 56px; height: 56px; border-radius: 50%; background: rgba(234, 179, 8, 0.15); color: #eab308; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px; }
          .invite-icon--error { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
          .invite-badge { display: inline-block; padding: 4px 12px; border-radius: 9999px; background: rgba(234, 179, 8, 0.2); color: #fbbf24; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; }
          .invite-title { font-size: 24px; font-weight: 800; color: #fff; margin: 0 0 8px 0; }
          .invite-subtitle { color: #94a3b8; font-size: 15px; line-height: 1.5; margin: 0 0 24px 0; }
          .invite-role-box { background: rgba(0, 0, 0, 0.25); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 12px; padding: 16px; text-align: left; margin-bottom: 24px; }
          .invite-role-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
          .invite-role-title { font-size: 14px; font-weight: 700; color: #f8fafc; }
          .invite-role-desc { font-size: 13px; color: #94a3b8; margin: 0; line-height: 1.4; }
          .invite-actions { display: flex; flex-direction: column; gap: 10px; }
          .btn-accept { width: 100%; padding: 12px; background: #eab308; color: #000; font-weight: 700; border-radius: 8px; border: none; cursor: pointer; font-size: 15px; transition: transform 0.1s ease, background 0.15s ease; }
          .btn-accept:hover { background: #facc15; transform: translateY(-1px); }
          .btn-secondary { width: 100%; padding: 12px; background: rgba(255, 255, 255, 0.08); color: #fff; font-weight: 600; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.1); cursor: pointer; text-decoration: none; display: block; box-sizing: border-box; text-align: center; }
          .btn-secondary:hover { background: rgba(255, 255, 255, 0.14); }
          .invite-signed-in { font-size: 13px; color: #64748b; margin-top: 16px; }
        ` }} />
      </head>
      <body>
        <main class="invite-shell">
          <div class="invite-card">
            {!invite || !isValid ? (
              <div>
                <div class="invite-icon invite-icon--error" aria-hidden="true">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                </div>
                <h1 class="invite-title">
                  {isRevoked ? "Invitation Revoked" : isExpired ? "Invitation Expired" : isAccepted ? "Already Accepted" : "Invalid Invitation"}
                </h1>
                <p class="invite-subtitle">
                  {isRevoked
                    ? "This invitation has been cancelled by the site owner."
                    : isExpired
                    ? "This invitation link has expired. Ask the site owner to send a new invite."
                    : isAccepted
                    ? "This invitation has already been accepted."
                    : "We could not find this invitation. Please check the link or ask the site owner to resend it."}
                </p>
                <a class="btn-secondary" href="/dashboard">Go to Dashboard</a>
              </div>
            ) : (
              <div>
                <div class="invite-icon" aria-hidden="true">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </div>
                <div class="invite-badge">Team Invitation</div>
                <h1 class="invite-title">Join {invite.siteName || "Leaderboard"}</h1>
                <p class="invite-subtitle">
                  <strong>{invite.ownerName || "The streamer"}</strong> invited you to help manage their YourRank site.
                </p>

                <div class="invite-role-box">
                  <div class="invite-role-header">
                    <span class="invite-role-title">Role: {roleLabel}</span>
                    <span class="pill pill--good">{invite.role}</span>
                  </div>
                  <p class="invite-role-desc">{roleDesc}</p>
                </div>

                <div class="invite-actions">
                  {user ? (
                    <div>
                      <button class="btn-accept" id="btnAcceptInvite" data-token={token}>Accept Invitation &amp; Open Dashboard</button>
                      <p class="invite-signed-in">Signed in as <strong>{user.email}</strong></p>
                    </div>
                  ) : (
                    <div>
                      <a class="btn-accept" style="display: block; text-decoration: none; text-align: center; margin-bottom: 10px;" href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>
                        Sign in to Accept
                      </a>
                      <a class="btn-secondary" href={`/signup?next=${encodeURIComponent(`/invite/${token}`)}`}>
                        Create New Account
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </main>

        <script src="/assets/invite.js" defer></script>
      </body>
    </html>
  );
}

export const invitePage = {
  config: { title: "Team Invitation · YourRank" },
  Component: InvitePage,
};

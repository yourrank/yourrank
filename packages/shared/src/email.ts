// Outbound email helpers shared by both Workers (Resend).
import { query, one, exec } from "./db.js";

export interface EmailEnv {
  RESEND_API_KEY?: string;
  SUPPORT_EMAIL?: string;
  MAIL_FROM?: string;
}

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
}

export interface SendResult {
  sent: boolean;
  reason?: string;
}

export async function sendEmail(env: EmailEnv, { to, subject, html, text, from }: EmailPayload): Promise<SendResult> {
  if (!env.RESEND_API_KEY) return { sent: false, reason: "not_configured" };
  const supportEmail = env.SUPPORT_EMAIL || "contact@yourrank.site";
  const fromAddr = from || env.MAIL_FROM || supportEmail || "YourRank <onboarding@resend.dev>";
  const toAddr = String(to).match(/<([^>]+)>/g)?.map((m) => m.slice(1, -1)).pop() || String(to).trim();
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: fromAddr, to: [toAddr], subject, html, text }),
    });
    return r.ok ? { sent: true } : { sent: false, reason: `http_${r.status}` };
  } catch (err) {
    console.error("[email]: resend API call failed", err);
    return { sent: false, reason: "network" };
  }
}

export function resetEmail(link: string) {
  const text = `Reset your YourRank password:\n\n${link}\n\nThis link works for 1 hour. If you didn't ask for this, ignore this email.`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 12px">Reset your YourRank password</h2>
<p style="color:#555;line-height:1.5">Someone (hopefully you) asked to reset the password for this account. The link works for 1 hour.</p>
<p style="margin:24px 0"><a href="${link}" style="background:#111;color:#fff;padding:12px 20px;text-decoration:none;border-radius:6px;display:inline-block">Set a new password</a></p>
<p style="color:#999;font-size:13px">If you didn't ask for this, you can ignore this email — nothing changes.</p></div>`;
  return { subject: "Reset your YourRank password", html, text };
}

export interface OnboardingUser {
  id: string;
  email: string;
  display_name?: string | null;
  slug?: string | null;
}

export interface OnboardingOptions extends OnboardingUser {
  origin?: string;
}

export function onboardingEmail(day: 0 | 3 | 7, user: OnboardingOptions) {
  const name = user.display_name || String(user.email).split("@")[0] || "there";
  const origin = user.origin || "https://yourrank.site";
  const dashboard = `${origin}/dashboard`;
  const billing = `${origin}/dashboard?nav=manage`;
  const botDashboard = `${origin}/dashboard/telegram`;

  if (day === 0) {
    const subject = "Welcome to YourRank — set up your first leaderboard";
    const text = `Hi ${name},\n\nWelcome to YourRank. Your leaderboard is live at ${origin}/${user.slug || ""}\n\nNext steps:\n1. Add players or import them from CSV in ${dashboard}\n2. Customize the design and sections\n3. Share your page with viewers\n\nNeed help? Reply to this email or use /support in Telegram.\n\nYourRank team`;
    const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 12px">Welcome to YourRank, ${name}</h2>
<p style="color:#555;line-height:1.5">Your leaderboard is live. Here are the fastest ways to get value:</p>
<ul style="color:#555;line-height:1.6;padding-left:20px">
  <li><a href="${dashboard}">Add players</a> or import a CSV</li>
  <li>Pick a design and toggle sections in the dashboard</li>
  <li>Share your public page: ${origin}/${user.slug || ""}</li>
</ul>
<p style="margin:24px 0"><a href="${dashboard}" style="background:#111;color:#fff;padding:12px 20px;text-decoration:none;border-radius:6px;display:inline-block">Open dashboard</a></p>
<p style="color:#999;font-size:13px">Need help? Reply to this email.</p></div>`;
    return { subject, html, text };
  }

  if (day === 3) {
    const subject = "YourRank tip: connect your Telegram bot + offers";
    const text = `Hi ${name},\n\nBy now you have a leaderboard. The next growth loop is Telegram:\n\n1. Connect a bot at ${botDashboard}\n2. Add casino offers so viewers can click tracked links\n3. Set up postback URLs in Settings so deposits count automatically\n\nYourRank team`;
    const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 12px">Turn clicks into conversions</h2>
<p style="color:#555;line-height:1.5">Your leaderboard is running. The next growth loop is Telegram + offers:</p>
<ul style="color:#555;line-height:1.6;padding-left:20px">
  <li><a href="${botDashboard}">Connect a Telegram bot</a></li>
  <li>Add casino offers with tracked links</li>
  <li>Set up postback URLs in Settings so deposits count automatically</li>
</ul>
<p style="margin:24px 0"><a href="${botDashboard}" style="background:#111;color:#fff;padding:12px 20px;text-decoration:none;border-radius:6px;display:inline-block">Open bot dashboard</a></p>
<p style="color:#999;font-size:13px">Need help? Reply to this email.</p></div>`;
    return { subject, html, text };
  }

  // day === 7
  const subject = "YourRank Pro: custom domain, OBS overlay + free trial";
  const text = `Hi ${name},\n\nYou've been using YourRank for a week. Pro adds:\n\n- Custom domain\n- Up to 3 sites\n- OBS overlay\n- Up to 1,000 players per site\n\nYou can start a one-time 7-day Pro trial. Recurring checkout is not available yet.\n\n${billing}\n\nYourRank team`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 12px">Ready to upgrade, ${name}?</h2>
<p style="color:#555;line-height:1.5">You've been using YourRank for a week. Pro unlocks:</p>
<ul style="color:#555;line-height:1.6;padding-left:20px">
  <li>Custom domain</li>
  <li>Up to 3 sites</li>
  <li>OBS overlay</li>
  <li>Up to 1,000 players per site</li>
</ul>
<p style="margin:24px 0"><a href="${billing}" style="background:#5b5bf5;color:#fff;padding:12px 20px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600">Start free Pro trial</a></p>
<p style="color:#999;font-size:13px">Recurring checkout is not available yet. Paid access only starts after verified provider confirmation.</p></div>`;
  return { subject, html, text };
}

export async function sendOnboardingEmail(
  env: EmailEnv,
  day: 0 | 3 | 7,
  user: OnboardingOptions,
  waitUntil?: (p: Promise<unknown>) => void
): Promise<SendResult> {
  const task = async (): Promise<SendResult> => {
    const mail = onboardingEmail(day, user);
    const result = await sendEmail(env, { to: user.email, ...mail });
    if (!result.sent) return result;
    await one(
      `INSERT INTO user_onboarding_emails (user_id, day, sent_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id, day) DO NOTHING
       RETURNING id`,
      [user.id, day]
    );
    return { sent: true };
  };

  if (waitUntil) {
    waitUntil(task().catch((err) => console.error(`[onboarding] day ${day} failed for ${user.email}:`, err)));
    return { sent: true, reason: "deferred" };
  }
  return task();
}

export interface ExpiryUser {
  id: string;
  email: string;
  display_name: string | null;
  plan: string;
  plan_expires_at: string;
  days_left: number;
}

export function expiryEmail(daysLeft: number, origin = "https://yourrank.site") {
  const billing = `${origin}/dashboard?nav=manage`;
  if (daysLeft < 0) {
    const subject = "Your YourRank plan has expired";
    const text = `Hi there,\n\nYour paid YourRank plan expired and your page has reverted to the Free plan. Renew at any time to restore Pro features:\n\n${billing}\n\nYourRank team`;
    const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 12px">Your plan has expired</h2>
<p style="color:#555;line-height:1.5">Your paid plan expired and your page has reverted to Free. Renew to restore Pro features.</p>
<p style="margin:24px 0"><a href="${billing}" style="background:#111;color:#fff;padding:12px 20px;text-decoration:none;border-radius:6px;display:inline-block">Renew plan</a></p>
<p style="color:#999;font-size:13px">Questions? Reply to this email.</p></div>`;
    return { subject, html, text };
  }
  const dayText = daysLeft === 0 ? "today" : daysLeft === 1 ? "in 1 day" : `in ${daysLeft} days`;
  const subject = `Your YourRank plan expires ${dayText}`;
  const text = `Hi there,\n\nYour paid YourRank plan expires ${dayText}. Renew now to keep your Pro features:\n\n${billing}\n\nYourRank team`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 12px">Your plan expires ${dayText}</h2>
<p style="color:#555;line-height:1.5">Renew before it expires to keep your Pro features uninterrupted.</p>
<p style="margin:24px 0"><a href="${billing}" style="background:#111;color:#fff;padding:12px 20px;text-decoration:none;border-radius:6px;display:inline-block">Renew plan</a></p>
<p style="color:#999;font-size:13px">Questions? Reply to this email.</p></div>`;
  return { subject, html, text };
}

export async function sendExpiryWarnings(env: EmailEnv, opts: { origin?: string } = {}): Promise<{ sent: number; skipped: number }> {
  if (!env.RESEND_API_KEY) return { sent: 0, skipped: 0 };
  const origin = opts.origin || "https://yourrank.site";

  const rows = await query<ExpiryUser>(
    `SELECT u.id, u.email, u.display_name, u.plan,
            u.plan_expires_at,
            FLOOR(EXTRACT(EPOCH FROM (u.plan_expires_at - now())) / 86400)::int AS days_left
       FROM users u
      WHERE u.plan_expires_at IS NOT NULL
        AND u.plan_expires_at <= now() + interval '7 days'
        AND u.plan_expires_at >= now() - interval '7 days'
      ORDER BY u.plan_expires_at`,
    []
  );

  let sent = 0;
  let skipped = 0;
  for (const row of rows) {
    const kind = row.days_left < 0 ? "expired" : "upcoming";
    const lookback = kind === "expired" ? "1 day" : "5 days";
    const recent = await one<{ id: string }>(
      `SELECT id FROM expiry_warnings
        WHERE user_id = $1 AND kind = $2 AND sent_at > now() - interval '${lookback}'
        LIMIT 1`,
      [row.id, kind]
    );
    if (recent) { skipped++; continue; }

    const mail = expiryEmail(row.days_left, origin);
    const result = await sendEmail(env, { to: row.email, ...mail });
    if (!result.sent) { skipped++; continue; }

    await exec(
      `INSERT INTO expiry_warnings (user_id, kind) VALUES ($1, $2)`,
      [row.id, kind]
    );
    sent++;
  }
  return { sent, skipped };
}

export async function sendPendingOnboardingEmails(env: EmailEnv): Promise<{ sent: number; skipped: number }> {
  if (!env.RESEND_API_KEY) return { sent: 0, skipped: 0 };

  const candidates = await query<{ id: string; email: string; display_name: string | null; slug: string | null; day: number }>(
    `SELECT u.id, u.email, u.display_name, s.slug,
            (CURRENT_DATE - u.created_at::date) AS day
       FROM users u
       LEFT JOIN sites s ON s.user_id = u.id
      WHERE u.status = 'active'
        AND (CURRENT_DATE - u.created_at::date) IN (0, 3, 7)
        AND NOT EXISTS (
          SELECT 1 FROM user_onboarding_emails e
           WHERE e.user_id = u.id AND e.day = (CURRENT_DATE - u.created_at::date)
        )
      ORDER BY u.created_at DESC
      LIMIT 500`,
    []
  );

  let sent = 0;
  let skipped = 0;
  for (const c of candidates) {
    const result = await sendOnboardingEmail(env, c.day as 0 | 3 | 7, {
      id: c.id,
      email: c.email,
      display_name: c.display_name,
      slug: c.slug,
    });
    if (result.sent) sent++;
    else skipped++;
  }
  return { sent, skipped };
}

export function verifyEmailEmail(link: string) {
  const subject = "Confirm your YourRank email";
  const text = `Welcome to YourRank.

Confirm your email by opening this link:

${link}

If you didn't create this account, you can ignore this email.`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 12px">Confirm your email</h2>
<p style="color:#555;line-height:1.5">Click the button below to finish creating your YourRank account.</p>
<p style="margin:24px 0"><a href="${link}" style="background:#111;color:#fff;padding:12px 20px;text-decoration:none;border-radius:6px;display:inline-block">Confirm email</a></p>
<p style="color:#999;font-size:13px">If the button doesn't work, copy and paste this link: <a href="${link}">${link}</a></p>
</div>`;
  return { subject, html, text };
}

export async function sendVerificationEmail(env: EmailEnv, email: string, link: string): Promise<SendResult> {
  return sendEmail(env, { to: email, ...verifyEmailEmail(link) });
}

// Public contact/support form handler.
// Stores the message and emails the support inbox when RESEND_API_KEY is set.
import { json, bad, rateLimitHeaders, clientIp, rateLimit, readJson } from "../auth.js";
import { sendEmail as defaultSendEmail } from "../email.js";
import { exec as defaultExec } from "@yourrank/shared/db";

const MAX_LEN = 4000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const KIND_LABELS = { support: "Support", feedback: "Feedback" };
const CONTEXT_LABELS = {
  dashboard: "Dashboard",
  leaderboard: "Leaderboard",
  bot: "Bot",
  analytics: "Analytics",
  attribution: "Attribution",
  billing: "Billing",
};

export async function handleContact(request, env, deps = {}) {
  const {
    rateLimit: rateLimitImpl = rateLimit,
    sendEmail: sendEmailImpl = defaultSendEmail,
    exec: execImpl = defaultExec,
  } = deps;
  // Rate-limit by IP: 3 submissions per 5 minutes.
  const ip = clientIp(request);
  const rl = await rateLimitImpl(env, `contact:${ip}`, 3, 300);
  if (!rl.ok) return bad("Too many messages. Please wait a few minutes.", 429, rateLimitHeaders(rl));

  const body = await readJson(request);
  if (!body) return bad("Invalid JSON.", 400);

  const name = String(body?.name || "").trim();
  const email = String(body?.email || "").trim().toLowerCase();
  const subject = String(body?.subject || "").trim();
  const message = String(body?.message || "").trim();
  const kind = String(body?.kind || "").trim().toLowerCase();
  const context = String(body?.context || "").trim().toLowerCase();

  if (!name || name.length > 120) return bad("Name is required (max 120 characters).", 400);
  if (!email || !EMAIL_RE.test(email) || email.length > 254) return bad("A valid email is required.", 400);
  if (subject.length > 120) return bad("Subject must be 120 characters or fewer.", 400);
  if (!message || message.length < 10 || message.length > MAX_LEN) return bad("Message must be between 10 and 4000 characters.", 400);
  if (kind && !KIND_LABELS[kind]) return bad("Choose a valid message type.", 400);
  if (context && !CONTEXT_LABELS[context]) return bad("Choose a valid message context.", 400);

  const defaultSubject = kind === "feedback" ? "Product feedback" : "Contact form";
  const category = kind
    ? `${KIND_LABELS[kind]}${context ? ` · ${CONTEXT_LABELS[context]}` : ""}`
    : "";
  const storedSubject = `${category ? `[${category}] ` : ""}${subject || defaultSubject}`;

  try {
    await execImpl(
      `INSERT INTO support_messages (name, email, subject, message, ip_hash)
       VALUES ($1, $2, $3, $4, $5)`,
      [name, email, storedSubject, message, await hashIp(ip)]
    );
  } catch (err) {
    console.error("[contact] failed to store message:", err);
    return bad("Could not save your message. Please try again.", 500);
  }

  const supportEmail = env.SUPPORT_EMAIL || "contact@yourrank.site";
  try {
    const delivery = await sendEmailImpl(env, {
    to: supportEmail,
    subject: `[YourRank] ${storedSubject} from ${name}`,
    text: `Name: ${name}\nEmail: ${email}\nSubject: ${storedSubject}\n\n${message}`,
    html: `<p><b>Name:</b> ${esc(name)}</p>
<p><b>Email:</b> ${esc(email)}</p>
<p><b>Subject:</b> ${esc(storedSubject)}</p>
<pre style="white-space:pre-wrap">${esc(message)}</pre>`,
    });
    if (delivery?.sent === false) console.warn('[contact] message stored; inbox email notification unavailable');
  } catch {
    // Durable receipt already succeeded. Asking for a retry would duplicate the message.
    console.warn('[contact] message stored; inbox email notification failed');
  }

  return json({ ok: true, message: "YourRank received your message. Any reply will go to the email you provided." }, 200, rateLimitHeaders(rl));
}

async function hashIp(ip) {
  const enc = new TextEncoder().encode(ip || "");
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

import { esc, SECURE_HTML, withNonce } from "../middleware/headers.js";

const CONNECTIONS_PATH = "/dashboard/settings/connections";

// The Login Widget evaluates its callback and embeds Telegram's own frame.
// Keep these allowances on the linking document, never on the dashboard CSP.
export function telegramAccountLinkHeaders(nonce) {
  const csp = SECURE_HTML["Content-Security-Policy"]
    .replace("script-src 'self'", "script-src 'self' 'unsafe-eval' https://telegram.org")
    .replace("connect-src 'self'", "connect-src 'self' https://telegram.org")
    .replace("frame-src 'self'", "frame-src 'self' https://telegram.org https://oauth.telegram.org");
  return withNonce({ ...SECURE_HTML, "Content-Security-Policy": csp }, nonce);
}

export function telegramAccountLinkPage({ botUsername, csrfToken, nonce, returnPath = CONNECTIONS_PATH }) {
  const username = String(botUsername || "").replace(/^@/, "");
  const configured = /^[A-Za-z0-9_]{5,32}$/.test(username);
  const token = JSON.stringify(csrfToken).replace(/</g, "\\u003c");
  const safeReturnPath = returnPath.startsWith(`${CONNECTIONS_PATH}?board=`) || returnPath === CONNECTIONS_PATH
    ? returnPath : CONNECTIONS_PATH;
  const returnScript = JSON.stringify(safeReturnPath).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect Telegram · YourRank</title><link rel="stylesheet" href="/assets/app.css"><link rel="stylesheet" href="/assets/ui.css"><style nonce="${esc(nonce)}">
    body{min-height:100vh;display:grid;place-items:center;margin:0;padding:24px;background:var(--yr-bg,#f7f8fb);color:var(--yr-ink,#15233d);font:400 15px/1.5 system-ui,sans-serif}
    .link-card{width:min(100%,440px);padding:32px;border:1px solid var(--yr-line,#dce3ed);border-radius:16px;background:var(--yr-panel,#fff);box-shadow:0 12px 32px rgba(10,27,55,.06)}
    .brand{font-size:18px;font-weight:750;letter-spacing:-.03em}.eyebrow{margin:28px 0 8px;color:var(--yr-ink-mute,#64748b);font-size:13px}h1{margin:0 0 10px;font-size:26px;line-height:1.2;letter-spacing:-.04em}p{margin:0 0 20px;color:var(--yr-ink-mute,#64748b)}.back{display:inline-block;margin-top:26px;color:var(--yr-accent,#2865db);text-decoration:none;font-weight:600}.back:hover{text-decoration:underline}.back:focus-visible{outline:2px solid var(--yr-accent,#2865db);outline-offset:4px}#linkMessage{margin:18px 0 0;color:var(--yr-red,#b42332)}#linkMessage[hidden]{display:none}
  </style></head><body><main class="link-card"><div class="brand">YourRank</div><div class="eyebrow">Account connections</div><h1>Connect Telegram account</h1><p>Confirm your Telegram identity to link it to your YourRank account.</p>
    ${configured ? `<script nonce="${esc(nonce)}">window.onTelegramAccountAuth=async function(identity){const message=document.getElementById("linkMessage");message.hidden=true;try{const response=await fetch("/api/auth/telegram/link",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json","x-csrf-token":${token}},body:JSON.stringify(identity)});const result=await response.json().catch(()=>({}));if(!response.ok||!result.ok){message.textContent=result.error||"Could not connect Telegram. Please try again.";message.hidden=false;return;}location.assign(${returnScript});}catch{message.textContent="Could not connect Telegram. Please try again.";message.hidden=false;}};</script><script nonce="${esc(nonce)}" async src="https://telegram.org/js/telegram-widget.js?22" data-telegram-login="${esc(username)}" data-size="large" data-onauth="onTelegramAccountAuth"></script>` : `<p>Telegram account linking is temporarily unavailable.</p>`}
    <p id="linkMessage" role="alert" hidden></p><a class="back" href="${esc(safeReturnPath)}">Back to Connections</a></main></body></html>`;
}

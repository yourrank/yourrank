// @ts-nocheck
const LOGO_WIDTHS = [64, 128, 256, 512];

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[c]));

export const safeUrl = (u) => {
  const s = String(u ?? "").trim();
  return s && /^(https?:|mailto:|tel:)/i.test(s) ? esc(encodeURI(s)) : "#";
};

export function logoSrcSet(baseUrl) {
  // An inline draft logo carries its own bytes, so there is no width to ask the
  // logo route for and appending one would corrupt the data URI.
  if (!baseUrl || /^data:/i.test(String(baseUrl).trim())) return "";
  const sep = baseUrl.includes("?") ? "&" : "?";
  return LOGO_WIDTHS.map((w) => `${esc(baseUrl)}${sep}w=${w} ${w}w`).join(", ");
}

export function renderLegalSidebar(data, legalHref) {
  const l = data?.legal || {};
  const links = [
    { k: "terms", l: "Terms of Service" },
    { k: "privacy", l: "Privacy Policy" },
    { k: "cookies", l: "Cookie Policy" },
    { k: "refund", l: "Refund Policy" },
    { k: "contact", l: "Contact Us" },
  ];
  return links
    .filter((x) => l[`${x.k}Enabled`] !== false)
    .map((x) => `\n            <a href="${legalHref(x.k)}">${x.l}</a>`)
    .join("");
}

/** Human-readable remaining wait for reward cooldowns: "45m", "2h 5m", "3d 4h". */
export function formatWaitSeconds(seconds) {
  const total = Math.max(0, Math.ceil(Number(seconds) || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
}

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
    { k: "responsible", l: "Responsible Play" },
  ];
  return links
    .filter((x) => l[`${x.k}Enabled`] !== false)
    .map((x) => `\n            <a href="${legalHref(x.k)}">${x.l}</a>`)
    .join("");
}

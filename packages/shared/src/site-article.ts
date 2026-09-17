import { esc } from "./public-render-helpers.js";

/**
 * A community article is something a viewer reads, not a dashboard: one H1,
 * who publishes it and where it applies, the real last-updated date when one
 * is known, sibling policy navigation, the copy, and one support block.
 */
export interface ArticleNavLink {
  label: string;
  href: string;
  active?: boolean;
}

export interface CommunityArticle {
  /** Short eyebrow above the title, e.g. "Policy" or "Information". */
  cue: string;
  title: string;
  /** Who publishes and answers for this article: the creator or YourRank. */
  owner: string;
  /** Where the article applies, e.g. "Nova's community on YourRank". */
  scope: string;
  /** Only rendered when it is a real, parseable date; never invented. */
  updatedAt?: string | number | Date | null;
  nav?: readonly ArticleNavLink[];
  navLabel?: string;
  bodyHtml: string;
  support?: { title: string; html: string } | null;
}

export function articleUpdatedAt(value: CommunityArticle["updatedAt"]): { iso: string; label: string } | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    iso: date.toISOString().slice(0, 10),
    label: date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }),
  };
}

export function renderCommunityArticle(article: CommunityArticle): string {
  const updated = articleUpdatedAt(article.updatedAt);
  const meta = [
    `<div><dt>Published by</dt><dd>${esc(article.owner)}</dd></div>`,
    `<div><dt>Applies to</dt><dd>${esc(article.scope)}</dd></div>`,
    updated ? `<div><dt>Last updated</dt><dd><time datetime="${updated.iso}">${esc(updated.label)}</time></dd></div>` : "",
  ].join("");

  const links = (article.nav ?? []).filter((l) => l && l.label && l.href);
  const nav = links.length
    ? `<nav class="viewer-article-nav" aria-label="${esc(article.navLabel || "Community policies")}"><ul>${links
      .map((l) => `<li><a href="${esc(l.href)}"${l.active ? ' aria-current="page"' : ""}>${esc(l.label)}</a></li>`)
      .join("")}</ul></nav>`
    : "";

  const support = article.support
    ? `<section class="viewer-article-support" aria-labelledby="viewer-article-support-title"><h2 id="viewer-article-support-title">${esc(article.support.title)}</h2>${article.support.html}</section>`
    : "";

  return `<article class="viewer-article"><header class="viewer-article-head"><p class="yr-cue">${esc(article.cue)}</p><h1 class="yr-h1">${esc(article.title)}</h1><dl class="viewer-article-meta">${meta}</dl></header>${nav}<div class="yr-prose viewer-article-body">${article.bodyHtml}</div>${support}</article>`;
}

import { describe, expect, it } from "bun:test";
import { articleUpdatedAt, renderCommunityArticle } from "../site-article.js";

const article = {
  cue: "Policy",
  title: "Terms of Service",
  owner: "Nova",
  scope: "Nova's community on YourRank",
  nav: [
    { label: "Terms of Service", href: "/nova/terms", active: true },
    { label: "Privacy Policy", href: "/nova/privacy" },
  ],
  bodyHtml: "<p>Body copy.</p>",
  support: { title: "Need help?", html: "<p>Reach Nova on Discord.</p>" },
};

describe("renderCommunityArticle", () => {
  it("renders one H1, owner and scope, sibling nav and a single support block", () => {
    const html = renderCommunityArticle(article);
    expect(html.match(/<h1/g)?.length).toBe(1);
    expect(html).toContain('<article class="viewer-article">');
    expect(html).toContain("<dt>Published by</dt><dd>Nova</dd>");
    expect(html).toContain("<dt>Applies to</dt><dd>Nova&#39;s community on YourRank</dd>");
    expect(html).toContain('<nav class="viewer-article-nav" aria-label="Community policies">');
    expect(html).toContain('<a href="/nova/terms" aria-current="page">Terms of Service</a>');
    expect(html).toContain('<a href="/nova/privacy">Privacy Policy</a>');
    expect(html).toContain('<div class="yr-prose viewer-article-body"><p>Body copy.</p></div>');
    expect(html.match(/viewer-article-support"/g)?.length).toBe(1);
    expect(html).toContain('<h2 id="viewer-article-support-title">Need help?</h2>');
  });

  it("only shows a last-updated date when a real one exists", () => {
    expect(renderCommunityArticle(article)).not.toContain("Last updated");
    expect(renderCommunityArticle({ ...article, updatedAt: "not a date" })).not.toContain("Last updated");
    const dated = renderCommunityArticle({ ...article, updatedAt: "2026-09-12T10:00:00Z" });
    expect(dated).toContain('<dt>Last updated</dt><dd><time datetime="2026-09-12">12 September 2026</time></dd>');
    expect(articleUpdatedAt(null)).toBeNull();
    expect(articleUpdatedAt(new Date("2026-01-05T00:00:00Z"))?.iso).toBe("2026-01-05");
  });

  it("omits the nav and support block when there is nothing to show, and escapes text", () => {
    const html = renderCommunityArticle({ ...article, nav: [], support: null, title: "<b>Terms</b>" });
    expect(html).not.toContain("viewer-article-nav");
    expect(html).not.toContain("viewer-article-support");
    expect(html).toContain("<h1 class=\"yr-h1\">&lt;b&gt;Terms&lt;/b&gt;</h1>");
  });
});

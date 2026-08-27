import { beforeEach, describe, expect, it, mock } from "bun:test";

const mockCurrentUser = mock(() => Promise.resolve({ id: "user-1", plan: "pro", plan_expires_at: Date.now() + 86400000 }));
const mockGetUserSiteById = mock(() => Promise.resolve(null));

import { handleDashboardPreview } from "../handlers/preview.js";

const SITE = {
  id: "site-1",
  slug: "actual-board",
  data: {
    brand: { name: "Actual Board", casino: "Stake", prizePool: "$5,000", period: "Monthly" },
    branding: { template: "classic", accentA: "#111111", accentB: "#222222" },
    players: [{ name: "Actual Player", wagered: 1000, prize: 100 }],
    partner: {},
    rules: [],
    socials: [],
    whyStats: [],
  },
};

describe("handleDashboardPreview", () => {
  beforeEach(() => {
    mockCurrentUser.mockReset();
    mockGetUserSiteById.mockReset();
    mockCurrentUser.mockResolvedValue({ id: "user-1", plan: "pro", plan_expires_at: Date.now() + 86400000 });
    mockGetUserSiteById.mockResolvedValue(SITE);
  });

  it("requires an authenticated dashboard session", async () => {
    mockCurrentUser.mockResolvedValueOnce(null);
    const res = await handleDashboardPreview(
      new Request("https://test.com/dashboard/preview?board=site-1"),
      {},
      "nonce123",
      { currentUserImpl: (...args) => mockCurrentUser(...args), getUserSiteByIdImpl: (...args) => mockGetUserSiteById(...args) },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://test.com/login");
  });

  it("returns 404 when the requested board is not owned by the user", async () => {
    mockGetUserSiteById.mockResolvedValueOnce(null);
    const res = await handleDashboardPreview(
      new Request("https://test.com/dashboard/preview?board=other-site"),
      {},
      "nonce123",
      { currentUserImpl: (...args) => mockCurrentUser(...args), getUserSiteByIdImpl: (...args) => mockGetUserSiteById(...args) },
    );
    expect(res.status).toBe(404);
    expect(mockGetUserSiteById).toHaveBeenCalledWith({}, "user-1", "other-site", "pro");
  });

  it("overrides preview theme data without mutating stored board data", async () => {
    const res = await handleDashboardPreview(
      new Request("https://test.com/dashboard/preview?board=site-1&accentA=%2300ffd1&accentB=%23ff2cd0"),
      {},
      "nonce123",
      { currentUserImpl: (...args) => mockCurrentUser(...args), getUserSiteByIdImpl: (...args) => mockGetUserSiteById(...args) },
    );
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('class="yr-site"');
    expect(html).toContain("Actual Board");
    expect(html).toContain("--yr-accent:#00ffd1");
    expect(html).toContain("Actual Player");
    expect(SITE.data.branding).toEqual({
      template: "classic",
      accentA: "#111111",
      accentB: "#222222",
    });
  });

  function previewRequest(query, draft) {
    const body = new URLSearchParams({ draft: JSON.stringify(draft) });
    return new Request(`https://test.com/dashboard/preview?${query}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  }

  function impls() {
    return { currentUserImpl: (...args) => mockCurrentUser(...args), getUserSiteByIdImpl: (...args) => mockGetUserSiteById(...args) };
  }

  it("renders unsaved brand text through the renderer's escaping, never as markup", async () => {
    const res = await handleDashboardPreview(
      previewRequest("board=site-1&device=desktop", {
        brand: { name: "Draft <script>alert(1)</script>", tagline: "Nightly races" },
      }),
      {},
      "nonce123",
      impls(),
    );
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("Nightly races");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    // A draft preview is never cacheable or shareable.
    expect(res.headers.get("cache-control")).toContain("private");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("drops in-canvas editing for read-only settings previews", async () => {
    const editable = await handleDashboardPreview(previewRequest("board=site-1&device=desktop", {}), {}, "nonce123", impls());
    const readOnly = await handleDashboardPreview(previewRequest("board=site-1&device=desktop&edit=0", {}), {}, "nonce123", impls());
    const editableHtml = await editable.text();
    const readOnlyHtml = await readOnly.text();

    expect(editableHtml).toContain("yr_edit_request");
    expect(editableHtml).toContain("cursor: text");
    expect(readOnlyHtml).not.toContain("yr_edit_request");
    expect(readOnlyHtml).not.toContain("cursor: text");
    expect(readOnlyHtml).toContain('class="yr-site"');
  });

  it("shows a picked logo before it is saved, and its removal too", async () => {
    const uri = "data:image/webp;base64,UklGRgAAAABXRUJQ";
    const html = async (branding) => (await handleDashboardPreview(
      previewRequest("board=site-1&device=desktop&edit=0", branding ? { branding } : {}),
      {},
      "nonce123",
      impls(),
    )).text();

    const picked = await html({ logo: { 64: uri, 512: uri } });
    expect(picked).toContain(`src="${uri}"`);
    // A data URI carries its own bytes: asking the logo route for widths would
    // corrupt it, so the inline mark ships without a srcset.
    expect(picked).not.toContain(`${uri}?w=64`);

    const single = await html({ logo: uri });
    expect(single).toContain(`src="${uri}"`);

    mockGetUserSiteById.mockResolvedValue({ ...SITE, data: { ...SITE.data, branding: { ...SITE.data.branding, hasLogo: true } } });
    const removed = await html({ logo: null });
    expect(removed).not.toContain("/logo/actual-board");
    const untouched = await html(null);
    expect(untouched).toContain("/logo/actual-board");
  });

  it("renders the mobile viewport at the width a phone viewer gets", async () => {
    const res = await handleDashboardPreview(previewRequest("board=site-1&device=mobile&edit=0", {}), {}, "nonce123", impls());
    const html = await res.text();
    expect(html).toContain("min-width: 390px");
    expect(html).not.toContain("min-width: 1100px");
  });
});
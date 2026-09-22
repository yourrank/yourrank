// YR-044: the signup handle field, the client script and every Worker entry
// that accepts a slug share one normalization contract (@yourrank/shared/community-handle).
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { COMMUNITY_HANDLE_RULES } from "@yourrank/shared/community-handle";
import { signupPage } from "../pages/signup.js";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("community handle field", () => {
  it("labels the field Community handle with a fixed domain prefix, the allowed characters and a live preview", () => {
    expect(signupPage).toContain('<label for="slug">Community handle</label>');
    expect(signupPage).toContain('<span class="auth-url-prefix">yourrank.site/</span>');
    expect(signupPage).toContain(`<span class="hint" id="slug-tip">${COMMUNITY_HANDLE_RULES} You can also paste your yourrank.site link.</span>`);
    expect(signupPage).toMatch(/<input id="slug"[^>]*aria-describedby="slug-err slug-tip slugPreview slugNote"/);
    expect(signupPage).toMatch(/<input id="slug"[^>]*autocapitalize="none"/);
    expect(signupPage).toContain('<span class="hint" id="slugNote" aria-live="polite"></span>');
    expect(signupPage).not.toContain("Your page URL");
  });

  it("the signup script previews, explains and submits the shared normalized handle", () => {
    const auth = read("../assets/auth.js");
    expect(auth).toContain('import { COMMUNITY_HANDLE_HOST, normalizeCommunityHandle } from "@yourrank/shared/community-handle";');
    expect(auth).not.toMatch(/function slugify/);
    expect(auth).toContain("payload.slug = handle.handle;");
    expect(auth).toContain('setFieldError("slug", payload.slugError)');
    expect(auth).toContain('setFieldError("slug", result.error)');
    expect(auth).toContain("slugNote.textContent = typed.trim() && result.ok ? result.note || \"\" : \"\"");
  });

  it("signup, site creation and site rename validate through the same contract and reserved set", () => {
    const signup = read("../handlers/auth.js");
    expect(signup).toContain('import { normalizeCommunityHandle, RESERVED_COMMUNITY_HANDLES } from "@yourrank/shared/community-handle";');
    expect(signup).toContain('if (requested && !requested.ok) return json({ ok: false, error: requested.error, field: "slug" }, 400);');
    const sites = read("../handlers/sites.js").replace(/\r\n/g, "\n");
    expect(sites).toContain("const handle = normalizeCommunityHandle(body.slug);\n  if (!handle.ok) return bad(handle.error);");
    const site = read("../site.js");
    expect(site).toContain("const handle = normalizeCommunityHandle(payload.slug);");
    expect(site).toContain('code: handle.reason === "reserved" ? "slug_reserved" : "slug_invalid", field: "slug"');
    expect(read("../auth.js")).not.toContain("export const RESERVED");
  });
});

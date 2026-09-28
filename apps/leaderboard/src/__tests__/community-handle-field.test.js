// YR-044: the signup handle field, the client script and every Worker entry
// that accepts a slug share one normalization contract (@yourrank/shared/community-handle).
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { signupPage } from "../pages/signup.js";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("community handle field", () => {
  it("does not ask signup users to choose a page URL", () => {
    expect(signupPage).not.toContain('id="slug"');
    expect(signupPage).not.toContain("Community handle");
  });

  it("the signup script does not send a page URL", () => {
    const auth = read("../assets/auth.js");
    expect(auth).not.toContain("normalizeCommunityHandle");
    expect(auth).not.toMatch(/payload\.slug\s*=/);
  });

  it("signup, site creation and site rename validate through the same contract and reserved set", () => {
    const signup = read("../handlers/auth.js");
    expect(signup).toContain('import { normalizeCommunityHandle } from "@yourrank/shared/community-handle";');
    expect(signup).toContain('if (requested && !requested.ok) return json({ ok: false, error: requested.error, field: "slug" }, 400);');
    const sites = read("../handlers/sites.js").replace(/\r\n/g, "\n");
    expect(sites).toContain("const handle = normalizeCommunityHandle(body.slug);\n  if (!handle.ok) return bad(handle.error);");
    const site = read("../site.js");
    expect(site).toContain("const handle = normalizeCommunityHandle(payload.slug);");
    expect(site).toContain('code: handle.reason === "reserved" ? "slug_reserved" : "slug_invalid", field: "slug"');
    expect(read("../auth.js")).not.toContain("export const RESERVED");
  });
});

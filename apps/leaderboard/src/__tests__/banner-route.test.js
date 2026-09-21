// /banner/:slug serves the selected site's community cover. It mirrors the
// /logo/:slug contract: content bytes decide the MIME type, an ETag derived
// from the stored bytes makes replacement and removal visible after a hard
// refresh, and a missing banner is a clean 404 — never a broken image.
import { describe, expect, it } from "bun:test";
import { serveBanner } from "../index.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03, 0x04]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x01, 0x02]);
const DATA_URI = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;
const WEBP_URI = `data:image/webp;base64,${Buffer.from(WEBP).toString("base64")}`;

const banner = (path, lookup, headers = {}) =>
  serveBanner(new Request(`https://yourrank.site${path}`, { headers }), path, lookup);
const lookupWith = (bannerData) => {
  const calls = [];
  const fn = (slug) => { calls.push(slug); return Promise.resolve(bannerData == null ? null : { banner_data: bannerData }); };
  fn.calls = calls;
  return fn;
};

describe("/banner/:slug", () => {
  it("serves the stored banner with its detected content type and a caching ETag", async () => {
    const lookup = lookupWith(DATA_URI);
    const res = await banner("/banner/streamer", lookup);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("public");
    expect(res.headers.get("etag")).toBeTruthy();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    // The route is scoped by the requested site's slug.
    expect(lookup.calls).toEqual(["streamer"]);
  });

  it("serves each supported format under its own magic bytes, never the declared type", async () => {
    const res = await banner("/banner/streamer", lookupWith(WEBP_URI));
    expect(res.headers.get("content-type")).toBe("image/webp");
  });

  it("answers 304 when the browser revalidates an unchanged banner", async () => {
    const lookup = lookupWith(DATA_URI);
    const first = await banner("/banner/streamer", lookup);
    const etag = first.headers.get("etag");
    const second = await banner("/banner/streamer", lookup, { "if-none-match": etag });
    expect(second.status).toBe(304);
    expect(second.headers.get("etag")).toBe(etag);
  });

  it("changes the ETag when the banner is replaced, so a hard refresh cannot resurrect the old image", async () => {
    const first = await banner("/banner/streamer", lookupWith(DATA_URI));
    const replaced = await banner("/banner/streamer", lookupWith(WEBP_URI), { "if-none-match": first.headers.get("etag") });
    expect(replaced.status).toBe(200);
    expect(replaced.headers.get("etag")).not.toBe(first.headers.get("etag"));
    expect(replaced.headers.get("content-type")).toBe("image/webp");
  });

  it("404s after the banner is removed, so the fallback layout takes over", async () => {
    for (const stored of [null, "", undefined]) {
      const res = await banner("/banner/streamer", lookupWith(stored));
      expect(res.status).toBe(404);
    }
  });

  it("never serves bytes that fail the magic-byte recheck", async () => {
    const forged = `data:image/png;base64,${Buffer.from("GIF89a not a png").toString("base64")}`;
    const res = await banner("/banner/streamer", lookupWith(forged));
    expect(res.status).toBe(404);
  });

  it("isolates banners by site: one community's cover never answers for another", async () => {
    const lookup = (slug) => Promise.resolve(slug === "site-a" ? { banner_data: DATA_URI } : null);
    expect((await banner("/banner/site-a", lookup)).status).toBe(200);
    expect((await banner("/banner/site-b", lookup)).status).toBe(404);
  });
});

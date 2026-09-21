// H-19 — logo uploads must be validated by decoded magic bytes.
import { describe, it, expect } from "bun:test";
import { validateLogoData, validateBannerData, detectImageMime } from "../site.js";

function toDataUri(mime, bytes) {
  const b64 = btoa(String.fromCharCode(...bytes));
  return `data:${mime};base64,${b64}`;
}

// Minimal magic-byte headers; the validators only inspect the first 12 bytes.
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x00]);
const JPEG_BYTES = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01]);
const WEBP_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

describe("detectImageMime", () => {
  it("detects PNG", () => {
    expect(detectImageMime(PNG_BYTES)).toBe("image/png");
  });
  it("detects JPEG", () => {
    expect(detectImageMime(JPEG_BYTES)).toBe("image/jpeg");
  });
  it("detects WebP", () => {
    expect(detectImageMime(WEBP_BYTES)).toBe("image/webp");
  });
  it("returns null for arbitrary bytes", () => {
    expect(detectImageMime(new Uint8Array([0x00, 0x00, 0x00, 0x00]))).toBeNull();
  });
});

describe("validateLogoData", () => {
  it("accepts a valid PNG data URI", () => {
    const uri = toDataUri("image/png", PNG_BYTES);
    const result = validateLogoData(uri);
    expect(result.ok).toBe(true);
    expect(result.mime).toBe("image/png");
  });

  it("accepts a valid JPEG data URI", () => {
    const uri = toDataUri("image/jpeg", JPEG_BYTES);
    const result = validateLogoData(uri);
    expect(result.ok).toBe(true);
    expect(result.mime).toBe("image/jpeg");
  });

  it("accepts a valid WebP data URI", () => {
    const uri = toDataUri("image/webp", WEBP_BYTES);
    const result = validateLogoData(uri);
    expect(result.ok).toBe(true);
    expect(result.mime).toBe("image/webp");
  });

  it("rejects a mismatch between declared MIME and magic bytes", () => {
    const uri = toDataUri("image/png", JPEG_BYTES);
    const result = validateLogoData(uri);
    expect(result.ok).toBeUndefined();
    expect(result.error).toContain("content is jpeg");
  });

  it("rejects unknown magic bytes", () => {
    const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38]);
    const uri = toDataUri("image/png", bytes);
    const result = validateLogoData(uri);
    expect(result.ok).toBeUndefined();
    expect(result.error).toContain("file type could not be verified");
  });

  it("rejects non-data-URI input", () => {
    const result = validateLogoData("https://example.com/logo.png");
    expect(result.error).toContain("base64 data URI");
  });

  it("rejects a data URI with an unsupported MIME", () => {
    const uri = toDataUri("image/gif", [0x47, 0x49, 0x46, 0x38]);
    const result = validateLogoData(uri);
    expect(result.error).toContain("base64 data URI");
  });
});

describe("validateBannerData", () => {
  it("accepts valid PNG, JPEG and WebP data URIs", () => {
    expect(validateBannerData(toDataUri("image/png", PNG_BYTES)).ok).toBe(true);
    expect(validateBannerData(toDataUri("image/jpeg", JPEG_BYTES)).ok).toBe(true);
    expect(validateBannerData(toDataUri("image/webp", WEBP_BYTES)).ok).toBe(true);
  });

  it("rejects a mismatch between declared MIME and magic bytes", () => {
    const result = validateBannerData(toDataUri("image/webp", PNG_BYTES));
    expect(result.ok).toBeUndefined();
    expect(result.error).toContain("content is png");
  });

  it("rejects SVG and other unsupported types outright", () => {
    const svg = `data:image/svg+xml;base64,${btoa("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>")}`;
    const result = validateBannerData(svg);
    expect(result.ok).toBeUndefined();
    expect(result.error).toContain("PNG, JPEG or WebP");
  });

  it("rejects unknown magic bytes", () => {
    const result = validateBannerData(toDataUri("image/png", new Uint8Array([0x47, 0x49, 0x46, 0x38])));
    expect(result.ok).toBeUndefined();
    expect(result.error).toContain("could not be verified");
  });

  it("rejects banners over the banner ceiling while still accepting logo-sized images", () => {
    // A payload larger than the logo ceiling but under the banner ceiling is
    // fine for a banner: banners are wide covers, not thumbnails.
    const mid = new Uint8Array([...PNG_BYTES, ...new Uint8Array(210 * 1024)]);
    expect(validateLogoData(toDataUri("image/png", mid)).ok).toBeUndefined();
    expect(validateBannerData(toDataUri("image/png", mid)).ok).toBe(true);
    // Past the banner ceiling even a banner is refused.
    const huge = new Uint8Array([...PNG_BYTES, ...new Uint8Array(501 * 1024)]);
    const result = validateBannerData(toDataUri("image/png", huge));
    expect(result.ok).toBeUndefined();
    expect(result.error).toContain("too large");
  });

  it("rejects non-data-URI input", () => {
    expect(validateBannerData("https://example.com/banner.png").ok).toBeUndefined();
    expect(validateBannerData(null).ok).toBeUndefined();
    expect(validateBannerData(undefined).ok).toBeUndefined();
  });
});

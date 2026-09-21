// H-19: Logo uploads are validated by decoded magic bytes, not just the data-URI
// regex. We still store the base64 blob in Postgres until an R2 bucket is
// provisioned; moving the asset out of the database is deferred to the infra task.
const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;
const MAX_LOGO_CHARS = 250000; // chars of data URI (~187KB decoded)
const MAX_LOGO_BYTES = 200 * 1024;
const MAX_LOGO_JSON_CHARS = 400000; // srcset object with multiple pre-sized WebP blobs
const MAX_LOGO_TOTAL_BYTES = 240 * 1024;
// The banner is one wide cover image, not a srcset: wider than a logo, but
// still bounded so the sites row stays small.
const MAX_BANNER_CHARS = 700000; // chars of data URI (~525KB decoded)
const MAX_BANNER_BYTES = 500 * 1024;

function validateImageDataUri(dataUri, { label, maxChars, maxBytes, maxText }) {
  const m = LOGO_RE.exec(String(dataUri ?? ""));
  if (!m) return { error: `${label} must be a base64 data URI for PNG, JPEG or WebP.` };

  const declaredMime = `image/${m[1]}`;
  const base64 = m[2];
  if (base64.length > maxChars) {
    return { error: `${label} is too large. Keep it under ~${maxText}.` };
  }

  let bytes;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    return { error: `${label} base64 is malformed.` };
  }
  if (bytes.length > maxBytes) {
    return { error: `${label} is too large. Keep it under ~${maxText}.` };
  }

  const detected = detectImageMime(bytes);
  if (!detected) {
    return { error: `${label} file type could not be verified from its contents.` };
  }
  if (detected !== declaredMime) {
    return { error: `${label} content is ${detected.split("/")[1]} but declared as ${declaredMime.split("/")[1]}.` };
  }

  const normalised = `data:${detected};base64,${bytes.toString("base64")}`;
  return { ok: true, mime: detected, dataUri: normalised, bytes: bytes.length };
}

function validateSingleLogoData(dataUri) {
  return validateImageDataUri(dataUri, { label: "Logo", maxChars: MAX_LOGO_CHARS, maxBytes: MAX_LOGO_BYTES, maxText: "180KB" });
}

const PNG_MAGIC = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
const JPEG_MAGIC = [0xFF, 0xD8];
const WEBP_MAGIC = [0x52, 0x49, 0x46, 0x46];

function bytesMatch(buf, magic) {
  if (buf.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buf[i] !== magic[i]) return false;
  }
  return true;
}

export function detectImageMime(buf) {
  if (bytesMatch(buf, PNG_MAGIC)) return "image/png";
  if (bytesMatch(buf, JPEG_MAGIC)) return "image/jpeg";
  if (bytesMatch(buf, WEBP_MAGIC) && buf.length >= 12 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
    return "image/webp";
  }
  return null;
}

/** Validate a logo data URI (or a srcset object of URIs) by decoding and checking magic bytes. */
export function validateLogoData(dataUri) {
  if (dataUri && typeof dataUri === "object") {
    const keys = Object.keys(dataUri);
    if (keys.length === 0) return { error: "Logo must be a base64 data URI for PNG, JPEG or WebP." };
    const normalised = {};
    let totalBytes = 0;
    for (const k of keys) {
      const single = validateSingleLogoData(dataUri[k]);
      if (single.error) return { error: `Logo size ${k}: ${single.error}` };
      totalBytes += single.bytes || 0;
      normalised[k] = single.dataUri;
    }
    const json = JSON.stringify(normalised);
    if (json.length > MAX_LOGO_JSON_CHARS) {
      return { error: "Logo set is too large. Try a smaller image." };
    }
    if (totalBytes > MAX_LOGO_TOTAL_BYTES) {
      return { error: "Logo set is too large. Keep it under ~240KB." };
    }
    return { ok: true, mime: "image/webp", dataUri: json };
  }
  return validateSingleLogoData(dataUri);
}

/** Validate a banner data URI (a single wide cover image) by decoding and checking magic bytes. */
export function validateBannerData(dataUri) {
  return validateImageDataUri(dataUri, { label: "Banner", maxChars: MAX_BANNER_CHARS, maxBytes: MAX_BANNER_BYTES, maxText: "480KB" });
}

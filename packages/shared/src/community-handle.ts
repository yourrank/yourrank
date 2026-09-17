// One normalization/validation contract for the community handle — the
// `<slug>` in yourrank.site/<slug>. The signup form, the dashboard site
// creator and the Worker handlers all run the same function so the value a
// person sees, the preview and the saved slug agree.

export const COMMUNITY_HANDLE_HOST = "yourrank.site";
export const COMMUNITY_HANDLE_MAX = 40;
export const COMMUNITY_HANDLE_RULES = "Lowercase letters, numbers and hyphens, up to 40 characters.";

// Handles a community can never take, because the Worker already serves that
// path. `demo` belongs here: signup once handed it out and the new board sat
// behind the hardcoded demo tour at /demo, unreachable to its owner.
export const RESERVED_COMMUNITY_HANDLES: ReadonlySet<string> = new Set([
  "api", "assets", "login", "signup", "logout", "dashboard", "admin", "account", "billing", "favicon", "robots",
  "sitemap", "index", "forgot", "reset", "terms", "privacy", "responsible", "logo", "go", "stats", "bot", "hook",
  "r", "pb", "health", "demo", "invite",
]);

const OWN_HOSTS = new Set([COMMUNITY_HANDLE_HOST, `www.${COMMUNITY_HANDLE_HOST}`, `app.${COMMUNITY_HANDLE_HOST}`, `next.${COMMUNITY_HANDLE_HOST}`, "localhost"]);

export type CommunityHandleReason = "empty" | "external_url" | "multiple_segments" | "invalid" | "too_long" | "reserved";

export interface CommunityHandleResult {
  /** Normalized handle, or "" when the input cannot become one. */
  handle: string;
  ok: boolean;
  /** Set when `ok` is false — an actionable field error. */
  error?: string;
  /** Set when the visible input was changed to reach `handle`; explains the normalization. */
  note?: string;
  reason?: CommunityHandleReason;
}

export const COMMUNITY_HANDLE_ERRORS: Record<CommunityHandleReason, string> = {
  empty: "Enter a community handle.",
  external_url: `That link is not on ${COMMUNITY_HANDLE_HOST}. Enter just the handle, the part after ${COMMUNITY_HANDLE_HOST}/.`,
  multiple_segments: `Paste the community link itself, like ${COMMUNITY_HANDLE_HOST}/your-handle, or enter just the handle.`,
  invalid: `Use letters or numbers in the handle. ${COMMUNITY_HANDLE_RULES}`,
  too_long: `Keep the handle to ${COMMUNITY_HANDLE_MAX} characters or fewer.`,
  reserved: "That handle is reserved by YourRank. Pick another.",
};

/** Lowercase, collapse anything that is not a-z/0-9 into single hyphens, trim hyphens. Does not truncate. */
export function slugifyHandle(input: unknown): string {
  return String(input ?? "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function fail(reason: CommunityHandleReason): CommunityHandleResult {
  return { handle: "", ok: false, reason, error: COMMUNITY_HANDLE_ERRORS[reason] };
}

function stripHost(host: string): string {
  return host.toLowerCase().replace(/:\d+$/, "");
}

/**
 * Turn what a person typed or pasted into a community handle.
 * - Own-site URLs (`https://yourrank.site/Handle`, `yourrank.site/handle/`) yield their single path segment.
 * - URLs on other hosts, or paths with more than one segment, are rejected with an actionable error.
 * - The hostname never becomes part of the handle.
 */
export function normalizeCommunityHandle(input: unknown, reserved: ReadonlySet<string> = RESERVED_COMMUNITY_HANDLES): CommunityHandleResult {
  const raw = String(input ?? "").trim();
  if (!raw) return fail("empty");

  let candidate = raw;
  const url = raw.match(/^(?:[a-z][a-z0-9+.-]*:\/\/)?([^/\s?#]+\.[^/\s?#]+|localhost(?::\d+)?)(\/.*)?$/i);
  if (url) {
    if (!OWN_HOSTS.has(stripHost(url[1]))) return fail("external_url");
    candidate = (url[2] || "").replace(/[?#].*$/, "");
  }
  try { candidate = decodeURIComponent(candidate); } catch { /* keep the raw text; slugify drops what it cannot use */ }
  const segments = candidate.split("/").map((s) => s.trim()).filter(Boolean);
  if (segments.length > 1) return fail("multiple_segments");
  if (url && segments.length === 0) return fail("empty");
  const source = segments[0] ?? "";

  const handle = slugifyHandle(source);
  if (!handle) return fail("invalid");
  if (handle.length > COMMUNITY_HANDLE_MAX) return { ...fail("too_long"), handle };
  if (reserved.has(handle)) return { ...fail("reserved"), handle };

  const result: CommunityHandleResult = { handle, ok: true };
  if (handle !== raw) {
    result.note = url
      ? `Using the handle from your link: ${COMMUNITY_HANDLE_HOST}/${handle}`
      : `Saved as ${COMMUNITY_HANDLE_HOST}/${handle} — ${COMMUNITY_HANDLE_RULES.charAt(0).toLowerCase()}${COMMUNITY_HANDLE_RULES.slice(1)}`;
  }
  return result;
}

/**
 * Creator contact methods: the one place that decides whether a community
 * can be reached about its own rewards and claims.
 *
 * Four MVP fields live in the site record (`extra_json.contact`). Everything
 * that renders, gates or reports creator contact — the public Contact page,
 * the viewer support modal, reward publishing, the creator dashboard — reads
 * `creatorContactMethods()` so "has a contact method" means the same thing
 * everywhere. Only values that pass validation are ever returned or rendered.
 */

export type CreatorContactType = "email" | "discord" | "social" | "url";

export const CREATOR_CONTACT_TYPES: readonly CreatorContactType[] = ["email", "discord", "social", "url"];

export interface CreatorContactConfig {
  email: string;
  discord: string;
  social: string;
  url: string;
}

export interface CreatorContactMethod {
  type: CreatorContactType;
  /** Public button label, e.g. "Email creator". */
  label: string;
  /** Safe href: `mailto:` for email, `https:` for everything else. */
  href: string;
  /** The stored value (address or URL) for display/tests. */
  value: string;
  /** Whether the href leaves the site (needs `target=_blank` + noopener). */
  external: boolean;
}

export interface CreatorContactAvailability {
  available: boolean;
  methods: CreatorContactMethod[];
}

export interface CreatorContactFieldError {
  field: CreatorContactType;
  message: string;
}

export interface CreatorContactValidation {
  contact: CreatorContactConfig;
  errors: CreatorContactFieldError[];
}

export const CREATOR_CONTACT_LABELS: Record<CreatorContactType, string> = {
  email: "Email creator",
  discord: "Discord",
  social: "X",
  url: "Contact website",
};

export const CREATOR_CONTACT_FIELD_LABELS: Record<CreatorContactType, string> = {
  email: "Email",
  discord: "Discord",
  social: "X / social",
  url: "Custom contact URL",
};

const MAX_VALUE_LENGTH = 254;
// Deliberately simple: one local part, one @, one dotted host; no display
// names, spaces, quotes or angle brackets, which is also what keeps a
// `mailto:` href injection-free.
const EMAIL_RE = /^[^\s@<>"'(),;:\\[\]]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const DISCORD_HOSTS = new Set(["discord.gg", "discord.com", "www.discord.com", "discordapp.com", "www.discordapp.com"]);

export const EMPTY_CREATOR_CONTACT: Readonly<CreatorContactConfig> = Object.freeze({ email: "", discord: "", social: "", url: "" });

function trimValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isValidContactEmail(value: string): boolean {
  return value.length <= MAX_VALUE_LENGTH && EMAIL_RE.test(value);
}

/** Only absolute `https:` URLs with a host count as a safe external link. */
export function parseHttpsUrl(value: string): URL | null {
  if (!value || value.length > MAX_VALUE_LENGTH) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) return null;
  return parsed;
}

export function isValidDiscordUrl(value: string): boolean {
  const parsed = parseHttpsUrl(value);
  return !!parsed && DISCORD_HOSTS.has(parsed.hostname.toLowerCase());
}

/**
 * Trims and validates a submitted contact config. Invalid fields are
 * reported and emptied so a caller can either reject the save or fall back
 * to the sanitized value; unknown keys are dropped.
 */
export function validateCreatorContact(input: unknown): CreatorContactValidation {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const contact: CreatorContactConfig = { ...EMPTY_CREATOR_CONTACT };
  const errors: CreatorContactFieldError[] = [];

  const email = trimValue(raw.email);
  if (email && !isValidContactEmail(email)) errors.push({ field: "email", message: "Enter a valid email address." });
  else contact.email = email;

  const discord = trimValue(raw.discord);
  if (discord && !isValidDiscordUrl(discord)) errors.push({ field: "discord", message: "Enter a Discord invite or server link, starting with https://discord.gg/ or https://discord.com/." });
  else contact.discord = discord;

  const social = trimValue(raw.social);
  if (social && !parseHttpsUrl(social)) errors.push({ field: "social", message: "Enter a valid link, starting with https://" });
  else contact.social = social;

  const url = trimValue(raw.url);
  if (url && !parseHttpsUrl(url)) errors.push({ field: "url", message: "Enter a valid link, starting with https://" });
  else contact.url = url;

  return { contact, errors };
}

/** Sanitized config: invalid or missing fields become empty strings. */
export function normalizeCreatorContact(input: unknown): CreatorContactConfig {
  return validateCreatorContact(input).contact;
}

/**
 * Usable contact methods for a public site record (`data.contact`).
 * Accepts either the full public shape or a bare contact config.
 */
export function creatorContactMethods(data: unknown): CreatorContactAvailability {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const source = "contact" in record ? record.contact : record;
  const contact = normalizeCreatorContact(source);
  const methods: CreatorContactMethod[] = [];
  if (contact.email) methods.push({ type: "email", label: CREATOR_CONTACT_LABELS.email, href: `mailto:${contact.email}`, value: contact.email, external: false });
  if (contact.discord) methods.push({ type: "discord", label: CREATOR_CONTACT_LABELS.discord, href: contact.discord, value: contact.discord, external: true });
  if (contact.social) methods.push({ type: "social", label: CREATOR_CONTACT_LABELS.social, href: contact.social, value: contact.social, external: true });
  if (contact.url) methods.push({ type: "url", label: CREATOR_CONTACT_LABELS.url, href: contact.url, value: contact.url, external: true });
  return { available: methods.length > 0, methods };
}

export function hasCreatorContactMethod(data: unknown): boolean {
  return creatorContactMethods(data).available;
}

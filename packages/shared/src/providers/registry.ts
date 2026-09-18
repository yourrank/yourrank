import { buildDiscordAuthorizeURL } from "../discord-oauth.js";
import { kickProvider } from "./kick.js";
import { hasCapability, type ProviderAdapter, type ProviderCapability, type ProviderId } from "./types.js";

// Discord today is viewer identity only (existing "Log in with Discord").
// Roles/automation are deliberately not registered.
const discordProvider: ProviderAdapter = {
  id: "discord",
  label: "Discord",
  viewerAuth: {
    buildAuthorizeURL(env, state, redirectUri) {
      return buildDiscordAuthorizeURL(env, state, "identify", redirectUri);
    },
  },
};

const PROVIDERS: Readonly<Partial<Record<ProviderId, ProviderAdapter>>> = Object.freeze({
  kick: kickProvider,
  discord: discordProvider,
});

export function getProvider(id: string | null | undefined): ProviderAdapter | undefined {
  return id ? PROVIDERS[id as ProviderId] : undefined;
}

export function listProviders(capability?: ProviderCapability): ProviderAdapter[] {
  const all = Object.values(PROVIDERS) as ProviderAdapter[];
  return capability ? all.filter((p) => hasCapability(p, capability)) : all;
}

export { hasCapability };
export type { ProviderAdapter, ProviderCapability, ProviderId };

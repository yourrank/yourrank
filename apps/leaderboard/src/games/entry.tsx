/** @jsxImportSource preact */
// ============================================================================
//  Island entry point — the only script the games route loads directly.
//
//  It reads the server-rendered boot payload (see src/games-embed.js), resolves
//  the viewer, builds the store and mounts the shell. Everything game-specific
//  arrives later as its own chunk (see registry.ts), so this bundle stays the
//  shell plus Preact.
//
//  The island lives inside a host page that owns the site chrome: it takes over
//  one element and touches nothing else on the page.
// ============================================================================
import { render } from "preact";
import { createGamesApi } from "./api/client.js";
import { isGameId } from "./registry.js";
import { createGamesStore } from "./state/store.js";
import { GamesShell } from "./ui/GamesShell.js";
import type { GameId, ViewerState } from "./types.js";
import { safeImageUrl, safePath } from "./url.js";

interface BootPayload {
  slug: string;
  siteName: string;
  logoUrl: string | null;
  homeUrl: string;
  /** Kick/Discord sign-in URL for this site, built server-side. */
  signInHref: string;
  earnHref: string;
  /** Render the island's own header — off when the host page shows branding. */
  header?: boolean;
}

const SIGNED_OUT: ViewerState = { authenticated: false, displayName: null, avatarUrl: null, balance: 0 };

function readBoot(root: Element): BootPayload | null {
  const raw = root.getAttribute("data-gx-boot");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BootPayload;
  } catch {
    return null;
  }
}

/**
 * Resolves the viewer from the existing session endpoint. A failure here means
 * "signed out" for rendering purposes only — the backend still authenticates
 * every bet, so a wrong guess here can never let someone wager.
 */
async function resolveViewer(slug: string): Promise<ViewerState> {
  try {
    const res = await fetch("/api/viewer/me", { credentials: "same-origin", headers: { accept: "application/json" } });
    if (!res.ok) return SIGNED_OUT;
    const data = (await res.json()) as {
      viewer?: { kickUsername?: string | null; discordUsername?: string | null; avatarUrl?: string | null };
      boards?: Array<{ slug: string; balance: number }>;
    };
    if (!data?.viewer) return SIGNED_OUT;
    const board = (data.boards || []).find((b) => b.slug === slug);
    return {
      authenticated: true,
      displayName: data.viewer.kickUsername || data.viewer.discordUsername || null,
      avatarUrl: data.viewer.avatarUrl || null,
      balance: Number(board?.balance ?? 0),
    };
  } catch {
    return SIGNED_OUT;
  }
}

function initialGame(): GameId | null {
  const param = new URLSearchParams(window.location.search).get("game");
  return isGameId(param) ? param : null;
}

export async function mountGames(root: HTMLElement): Promise<void> {
  const boot = readBoot(root);
  if (!boot) return;

  // There is one API: the real one. A failing request stays a failure rather
  // than falling back to fabricated rounds.
  const api = createGamesApi({ slug: boot.slug });
  const viewer = await resolveViewer(boot.slug);

  const store = createGamesStore({
    api,
    slug: boot.slug,
    viewer,
    signInHref: safePath(boot.signInHref, `/${encodeURIComponent(boot.slug)}`),
    earnHref: safePath(boot.earnHref, `/${encodeURIComponent(boot.slug)}`),
    initialGame: initialGame(),
  });

  root.replaceChildren();
  render(
    <GamesShell
      store={store}
      showHeader={boot.header !== false}
      branding={{
        siteName: boot.siteName,
        logoUrl: safeImageUrl(boot.logoUrl),
        homeUrl: safePath(boot.homeUrl, `/${encodeURIComponent(boot.slug)}`),
      }}
    />,
    root
  );
}

const mountPoint = document.getElementById("gx-root");
if (mountPoint) void mountGames(mountPoint);

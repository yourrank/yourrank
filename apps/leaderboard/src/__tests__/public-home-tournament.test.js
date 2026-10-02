// Home's tournament banner: renderSite leaves a hidden slot on the public Home
// page and site-shell.js fills it from /api/public/:slug/tournament, so the
// banner follows the tournament even when the Home HTML is cached.
//
// Run: bun test src/__tests__/public-home-tournament.test.js

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import { renderSite } from "@yourrank/shared/site-render";
import { publicTournamentView } from "../lib/tournament-public.js";

const siteShellSource = readFileSync(join(import.meta.dir, "../assets/site-shell.js"), "utf8");
const ORIGIN = "https://example.test";

const baseData = {
  brand: { name: "Creator Name", tagline: "Weekly board", period: "Monthly", prizePool: "$500" },
  branding: { template: "cyber_arcade", font: "Inter", options: {} },
  players: [{ name: "Alice", rank: 1, amount: 5000, prize: "$100" }],
  prizes: { currency: "$", prizeLabel: "Prize" },
  shopItems: [],
  socials: [],
  siteSections: { home: true, leaderboard: true, shop: true, me: true },
};

function renderHome() {
  return renderSite({
    r: { slug: "creator", plan: "pro", data: baseData },
    section: "home",
    viewer: null,
    viewerData: null,
    opts: { slug: "creator", homeUrl: ORIGIN, nonce: "n", isCustomDomain: false },
  });
}

async function openHome(body, { status = 200 } = {}) {
  const window = new Window({ url: `${ORIGIN}/creator`, settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableErrorCapturing: true } });
  const { document } = window;
  document.documentElement.innerHTML = await renderHome();
  const requests = [];
  window.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith("/tournament")) return new window.Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    return new window.Response("{}", { status: 404 });
  };
  const globals = ["window", "document", "location", "history", "fetch", "DOMParser", "Event", "URL", "AbortController"];
  new Function(...globals, siteShellSource)(window, document, window.location, window.history, window.fetch, window.DOMParser, window.Event, window.URL, window.AbortController);
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  return { window, document, requests, slot: document.querySelector("[data-public-tournament]") };
}

function match(round, index, p1, p2, extra = {}) {
  return { round_number: round, match_index: index, player1_name: p1, player2_name: p2, player1_score: null, player2_score: null, winner_name: null, status: "ready", ...extra };
}

const liveView = publicTournamentView(
  { title: "Friday Cup", game_name: "Rocket League", bracket_size: 4, status: "active" },
  [match(1, 0, "Nova", "Kai"), match(1, 1, "Rin", "Zed"), match(2, 0, null, null, { status: "pending" })],
  { entryCount: 4 },
);

describe("Home tournament slot", () => {
  it("renders hidden on Home only, linking to the public bracket", async () => {
    const home = await renderHome();
    expect(home).toContain('<section class="viewer-tournament" data-public-tournament="creator" data-tournament-href="/creator/tournament" aria-labelledby="viewer-tournament-title" hidden></section>');
    const board = await renderSite({ r: { slug: "creator", plan: "pro", data: baseData }, section: "leaderboard", viewer: null, viewerData: null, opts: { slug: "creator", homeUrl: ORIGIN, nonce: "n" } });
    expect(board).not.toContain("data-public-tournament");
    const custom = await renderSite({ r: { slug: "creator", plan: "pro", data: baseData }, section: "home", viewer: null, viewerData: null, opts: { slug: "creator", homeUrl: ORIGIN, nonce: "n", isCustomDomain: true } });
    expect(custom).not.toContain("data-public-tournament");
  });
});

describe("Home tournament banner", () => {
  it("shows a live tournament with the current match and a bracket link", async () => {
    const { slot, requests } = await openHome({ ok: true, tournament: liveView });
    expect(requests).toContain("/api/public/creator/tournament");
    expect(slot.hidden).toBe(false);
    expect(slot.dataset.state).toBe("live");
    expect(slot.querySelector(".viewer-tournament-tag").textContent).toBe("Tournament live · Rocket League");
    expect(slot.querySelector("h2#viewer-tournament-title").textContent).toBe("Friday Cup");
    expect(slot.querySelector(".viewer-tournament-note").textContent).toBe("Now playing: Nova vs Kai");
    const link = slot.querySelector("a.yr-btn");
    expect(link.textContent).toBe("Follow the bracket");
    expect(link.getAttribute("href")).toBe("/creator/tournament");
  });

  it("shows open signups with the chat command", async () => {
    const view = publicTournamentView(
      { title: "Friday Cup", status: "draft", signup_state: "open", entry_keyword: "!join", chat_channel: "creator" },
      [],
      { entryCount: 3, players: ["Nova", "Kai", "Rin"] },
    );
    const { slot } = await openHome({ ok: true, tournament: view });
    expect(slot.hidden).toBe(false);
    expect(slot.querySelector(".viewer-tournament-tag").textContent).toBe("Signups open");
    expect(slot.querySelector(".viewer-tournament-note code").textContent).toBe("!join");
    expect(slot.querySelector(".viewer-tournament-note").textContent).toBe("Type !join in chat to enter. 3 players so far.");
    expect(slot.querySelector("a.yr-btn").textContent).toBe("See who's in");
  });

  it("shows a recently finished tournament's champion, and nothing once it is old", async () => {
    const final = [match(1, 0, "Nova", "Kai", { status: "completed", player1_score: 2, player2_score: 1, winner_name: "Nova" })];
    const recent = publicTournamentView({ title: "Friday Cup", bracket_size: 2, status: "completed", winner_name: "Nova", featured: true }, final, { entryCount: 2 });
    const { slot } = await openHome({ ok: true, tournament: recent });
    expect(slot.hidden).toBe(false);
    expect(slot.querySelector(".viewer-tournament-tag").textContent).toBe("Champion");
    expect(slot.querySelector(".viewer-tournament-note").textContent).toBe("Nova beat Kai in the final 2–1.");
    expect(slot.querySelector("a.yr-btn").textContent).toBe("See the final bracket");

    const old = publicTournamentView({ title: "Friday Cup", bracket_size: 2, status: "completed", winner_name: "Nova", featured: false }, final, { entryCount: 2 });
    expect(old.featured).toBe(false);
    const stale = await openHome({ ok: true, tournament: old });
    expect(stale.slot.hidden).toBe(true);
    expect(stale.slot.innerHTML).toBe("");
  });

  it("stays hidden without a public tournament or when the API fails", async () => {
    expect((await openHome({ ok: true, tournament: null })).slot.hidden).toBe(true);
    expect((await openHome({ ok: false }, { status: 404 })).slot.hidden).toBe(true);
  });

  it("sets tournament names as text, never as markup", async () => {
    const view = { ...liveView, title: '<img src=x onerror="alert(1)">', game: null };
    const { slot } = await openHome({ ok: true, tournament: view });
    expect(slot.querySelector("img")).toBeNull();
    expect(slot.querySelector("h2").textContent).toBe('<img src=x onerror="alert(1)">');
  });
});

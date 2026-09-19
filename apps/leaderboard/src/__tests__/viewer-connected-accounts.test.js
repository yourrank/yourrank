// Connected Accounts presentation: the real viewer-dashboard.js renders provider
// rows into the real server-rendered account page in a DOM, so logos, status
// hierarchy and copy are asserted on what the browser would actually show.
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import { viewerDashboardPage } from "../pages/viewer-dashboard.js";

const dashboardSource = readFileSync(join(import.meta.dir, "../assets/viewer-dashboard.js"), "utf8");
const ORIGIN = "https://example.test";

const me = {
  ok: true,
  viewer: { displayName: "36_ates", avatarUrl: null, createdAt: "2026-09-01T00:00:00Z", connections: [{ provider: "kick", username: "36_ates", linkedAt: "2026-09-18T10:00:00Z" }] },
  authProviders: { kick: true, discord: false },
  connectedAccounts: [
    { provider: "kick", label: "Kick", state: "connected", username: "36_ates", linkedAt: "2026-09-18T10:00:00Z", connectUrl: null },
    { provider: "discord", label: "Discord", state: "unavailable", username: null, linkedAt: null, connectUrl: null },
  ],
  communities: [],
};

async function openAccountPage(payload = me) {
  const window = new Window({ url: `${ORIGIN}/me#vd-connections`, settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableErrorCapturing: true } });
  const { document } = window;
  const html = await viewerDashboardPage(null, payload.authProviders, { state: "authenticated", viewer: null });
  document.documentElement.innerHTML = typeof html === "string" ? html : await html.text();
  window.fetch = async () => new window.Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  const globals = ["window", "document", "location", "history", "fetch", "Event", "URL", "AbortController"];
  new Function(...globals, dashboardSource)(window, document, window.location, window.history, window.fetch, window.Event, window.URL, window.AbortController);
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  await window.happyDOM.waitUntilComplete();
  return { window, document };
}

describe("Connected Accounts provider presentation", () => {
  let browser;
  afterEach(async () => { await browser?.window.happyDOM.close(); browser = null; });

  it("does not repeat the page heading inside the card and starts with provider rows", async () => {
    browser = await openAccountPage();
    const card = browser.document.querySelector("#vd-connections .vd-settings-card");
    expect(card.querySelector("h2")).toBeNull();
    expect(card.textContent).not.toContain("Accounts connected to your YourRank identity.");
    expect(card.firstElementChild.id).toBe("vd-provider-list");
    expect(card.firstElementChild.firstElementChild.classList.contains("vd-provider")).toBe(true);
  });

  it("begins each row with the official provider logo and groups identity details", async () => {
    browser = await openAccountPage();
    const rows = Array.from(browser.document.querySelectorAll("#vd-provider-list .vd-provider"));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const logo = row.firstElementChild;
      expect(logo.tagName).toBe("svg");
      expect(logo.classList.contains("vd-provider-logo")).toBe(true);
      expect(logo.classList.contains("viewer-icon")).toBe(false);
      expect(row.children[1].classList.contains("vd-provider-copy")).toBe(true);
    }
    expect(rows[0].querySelector(".vd-provider-logo").getAttribute("data-provider")).toBe("kick");
    expect(rows[1].querySelector(".vd-provider-logo").getAttribute("data-provider")).toBe("discord");
    expect(rows[0].querySelector("h3").textContent).toBe("Kick");
    expect(rows[0].querySelector("p").textContent).toMatch(/^@36_ates · Connected /);
  });

  it("keeps Connected green and renders Unavailable as neutral, without a connect action", async () => {
    browser = await openAccountPage();
    const [kick, discord] = browser.document.querySelectorAll("#vd-provider-list .vd-provider");
    const connected = kick.querySelector(".vd-connection-status");
    expect(connected.textContent).toBe("Connected");
    expect(connected.classList.contains("vd-connection-status--muted")).toBe(false);
    expect(kick.getAttribute("data-state")).toBe("connected");
    const unavailable = discord.querySelector(".vd-connection-status");
    expect(unavailable.textContent).toBe("Unavailable");
    expect(unavailable.classList.contains("vd-connection-status--muted")).toBe(true);
    expect(discord.getAttribute("data-state")).toBe("unavailable");
    expect(discord.querySelector("a.btn")).toBeNull();
  });

  it("renders a real Connect action only when the API supplies a connect URL", async () => {
    browser = await openAccountPage({
      ...me,
      authProviders: { kick: true, discord: true },
      connectedAccounts: [me.connectedAccounts[0], { ...me.connectedAccounts[1], state: "available", connectUrl: "/auth/discord/start?intent=link" }],
    });
    const discord = browser.document.querySelectorAll("#vd-provider-list .vd-provider")[1];
    expect(discord.querySelector("a.btn").getAttribute("href")).toBe("/auth/discord/start?intent=link");
    expect(discord.querySelector("a.btn").textContent).toBe("Connect Discord");
    expect(discord.querySelector(".vd-connection-status")).toBeNull();
  });

  it("shows the simplified note as a quiet info line, not the technical callout", async () => {
    browser = await openAccountPage();
    const card = browser.document.querySelector("#vd-connections .vd-settings-card");
    expect(card.querySelector(".vd-info")).toBeNull();
    const note = card.querySelector(".vd-note");
    expect(note.textContent.trim()).toBe("Connect providers here to use the same YourRank account across platforms.");
    expect(note.querySelector("svg.viewer-icon")).not.toBeNull();
    expect(card.textContent).not.toContain("separate viewer account");
  });

  it("Privacy & Security: Authentication uses the provider row + neutral note, Privacy keeps the policy action without placeholder copy", async () => {
    browser = await openAccountPage();
    const [auth, privacy] = browser.document.querySelectorAll("#vd-security .vd-settings-card");
    expect(auth.querySelector("h2").textContent).toBe("Authentication");
    expect(auth.querySelector('#vd-security-providers .vd-provider .vd-provider-logo[data-provider="kick"]')).not.toBeNull();
    expect(auth.querySelector(".vd-info")).toBeNull();
    expect(auth.querySelector(".vd-note").textContent.trim()).toBe("Sign-in security is managed by your connected provider.");
    expect(auth.textContent).not.toMatch(/two-factor|session management|aren't available/i);
    expect(privacy.querySelector("h2").textContent).toBe("Privacy");
    expect(privacy.querySelector("p").textContent).toBe("Your YourRank account identifies you across communities. Credits, claims and activity stay scoped to each community.");
    expect(privacy.textContent).not.toMatch(/aren't available/i);
    expect(privacy.querySelector('a.btn[href="/privacy"]').textContent).toContain("Privacy policy");
  });

  it("reuses the same provider row (with logo) for the Profile and Authentication summaries", async () => {
    browser = await openAccountPage();
    for (const id of ["vd-profile-providers", "vd-security-providers"]) {
      const row = browser.document.querySelector(`#${id} .vd-provider`);
      expect(row.querySelector('.vd-provider-logo[data-provider="kick"]')).not.toBeNull();
      expect(row.querySelector(".vd-connection-status").textContent).toBe("Connected");
    }
  });
});

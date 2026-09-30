// Connected Accounts presentation is asserted on the canonical React island
// mounted into the real server-rendered account page.
import { afterEach, describe, expect, it } from "bun:test";
import { makeViewerAccountEnvironment } from "./viewer-account-react-utils.js";

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
  const browser = await makeViewerAccountEnvironment({
    auth: { state: "authenticated", viewer: null },
    response: (path) => ({
      body: path === "/api/viewer/export" ? { ok: true, exportId: "exp-1" } : payload,
    }),
    url: `${ORIGIN}/me#vd-connections`,
    providerAvailability: payload.authProviders,
  });
  await browser.ready();
  return browser;
}

describe("Connected Accounts provider presentation", () => {
  let browser;
  afterEach(async () => { await browser?.close(); browser = null; });

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

  it("Data & Account: compact key/value info, export instructions only after requesting, subtle danger delete card", async () => {
    browser = await openAccountPage();
    const [info, exportCard, del] = browser.document.querySelectorAll("#vd-data .vd-settings-card");
    expect(info.textContent).not.toContain("Email management");
    const facts = [...info.querySelectorAll(".vd-facts div")].map((row) => [row.querySelector("dt").textContent, row.querySelector("dd").textContent]);
    const memberSince = new Date(me.viewer.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    expect(facts).toEqual([["Display name", "36_ates"], ["Member since", memberSince]]);

    expect(exportCard.querySelector(".vd-export-row > p").textContent).toContain("Your viewer identity, provider connections");
    expect(exportCard.querySelector("h3")).toBeNull();
    expect(exportCard.querySelector("#vd-export-progress").hidden).toBe(true);
    expect(exportCard.querySelector(".vd-export-actions #vd-export")).not.toBeNull();
    await browser.click(exportCard.querySelector("#vd-export"));
    expect(exportCard.querySelector("#vd-export-progress").hidden).toBe(false);
    expect(exportCard.querySelector("#vd-export-progress").textContent).toContain("Keep this page open");
    expect(exportCard.querySelector("#vd-export-status").textContent).toContain("being prepared");
    expect(exportCard.querySelector("#vd-export-check").hidden).toBe(false);

    expect(del.classList.contains("vd-danger-card")).toBe(true);
    expect(del.textContent).not.toContain("isn't available");
    expect(del.textContent).toContain("Permanently delete your YourRank account and associated account data.");
    expect(del.textContent).toContain("Contact support to request account deletion.");
    const cta = del.querySelector("a.btn");
    expect(cta.classList.contains("btn--danger")).toBe(true);
    expect(cta.classList.contains("btn--accent")).toBe(false);
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

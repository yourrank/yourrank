// Viewer support modal: the real viewer-app.js + viewer-support.js run in a DOM
// against the real server-rendered account and community pages, so opening,
// categories, diagnostics, creator routing, submission and focus/close
// behaviour are asserted on what a browser would actually do.
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "happy-dom";
import { renderSite } from "@yourrank/shared/site-render";
import { hasCreatorContactMethod } from "@yourrank/shared/creator-contact";
import { viewerDashboardPage } from "../pages/viewer-dashboard.js";
import { helpSupportPage } from "../pages/help.js";

const assets = join(import.meta.dir, "../assets");
const sources = Object.fromEntries(["viewer-app.js", "site-shell.js", "viewer-dashboard.js", "viewer-support.js"].map((name) => [name, readFileSync(join(assets, name), "utf8")]));
const ORIGIN = "https://example.test";
const COMMUNITY = { slug: "creator", name: "Creator Name", href: "/creator" };
const SUPPORT_CATEGORIES = ["Account", "Sign in / connected accounts", "Technical issue", "Data & privacy", "Other"];

const me = {
  ok: true,
  viewer: { displayName: "36_ates", avatarUrl: null, createdAt: "2026-09-01T00:00:00Z", connections: [] },
  authProviders: { kick: true, discord: false },
  connectedAccounts: [{ provider: "kick", label: "Kick", state: "connected", username: "36_ates", linkedAt: "2026-09-18T10:00:00Z", connectUrl: null }],
  communities: [],
};

const siteData = {
  brand: { name: "Creator Name", tagline: "Weekly board", period: "Monthly", prizePool: "$500" },
  branding: { template: "cyber_arcade", font: "Inter", options: {} },
  players: [{ name: "Alice", rank: 1, wagered: 5000, prize: "$100" }],
  prizes: { currency: "$", wagerLabel: "Wagered", prizeLabel: "Prize" },
  shopItems: [], socials: [],
  siteSections: { home: true, leaderboard: true, shop: true, games: false, me: true },
};

async function accountHtml(community) {
  const html = await viewerDashboardPage(community, me.authProviders, { state: "authenticated", viewer: null });
  return typeof html === "string" ? html : await html.text();
}
function communityHtml(contact) {
  return renderSite({
    r: { slug: "creator", plan: "pro", data: { ...siteData, contact } }, section: "home", viewer: { kick_username: "viewer_one" },
    viewerData: { viewerOnSite: { balance: 10, blocked: false }, ledger: [], claims: [], participation: [] },
    opts: { slug: "creator", homeUrl: ORIGIN, nonce: "n", isCustomDomain: false },
  });
}

/** A viewer-shell browser: the real scripts and a scripted /api/contact. */
async function openBrowser({ page = "account", community = null, siteContact = undefined, publicSite = "ok", contact = () => ({ status: 200, body: { ok: true, receiptId: "r-1" } }) } = {}) {
  const url = page === "account" ? `${ORIGIN}/me${community ? `?community=${community.slug}` : ""}` : `${ORIGIN}/creator`;
  const window = new Window({ url, settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableErrorCapturing: true, handleDisabledFileLoadingAsSuccess: true } });
  const { document } = window;
  document.documentElement.innerHTML = page === "account" ? await accountHtml(community) : await communityHtml(siteContact);
  const calls = [];
  const lookups = [];
  const json = (status, body) => new window.Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  window.fetch = async (input, init = {}) => {
    const requested = new URL(String(input), ORIGIN);
    if (requested.pathname === "/api/contact") {
      calls.push({ init, payload: JSON.parse(init.body) });
      const result = await contact(calls.length);
      if (result instanceof Error) throw result;
      return json(result.status, result.body);
    }
    if (requested.pathname === "/api/public/creator") {
      lookups.push(requested.pathname);
      if (publicSite === "error") return json(500, {});
      return json(200, { ...siteData, contact: siteContact, contactAvailable: hasCreatorContactMethod(siteContact) });
    }
    if (requested.pathname.startsWith("/api/")) return json(200, me);
    if (requested.pathname.startsWith("/assets/")) return new window.Response("", { status: 200, headers: { "content-type": "text/javascript" } });
    return json(404, {});
  };
  const globals = ["window", "document", "location", "history", "fetch", "DOMParser", "Event", "URL", "AbortController", "navigator", "crypto"];
  const run = (source) => new Function(...globals, source)(window, document, window.location, window.history, window.fetch, window.DOMParser, window.Event, window.URL, window.AbortController, window.navigator, globalThis.crypto);
  const originalAppend = document.body.appendChild.bind(document.body);
  // Page controllers load through <script src>; evaluate them from disk before the
  // element connects, so happy-dom's synthetic load event finds them initialised.
  document.body.appendChild = (node) => {
    const src = node.tagName === "SCRIPT" && node.getAttribute("src");
    if (src && sources[src.replace("/assets/", "")]) run(sources[src.replace("/assets/", "")]);
    return originalAppend(node);
  };
  run(sources["viewer-app.js"]);
  await window.__yrViewerAppReady;
  await settle(window);
  return { window, document, calls, lookups };
}

async function settle(window) {
  for (let i = 0; i < 12; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  await window.happyDOM.waitUntilComplete();
}

function click(window, element) {
  element.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
}

async function openFrom(browser, selector) {
  const link = browser.document.querySelector(selector);
  expect(link, selector).not.toBeNull();
  click(browser.window, link);
  await settle(browser.window);
  const dialog = browser.document.querySelector("dialog.yr-support-modal");
  expect(dialog).not.toBeNull();
  expect(dialog.open).toBe(true);
  return { link, dialog };
}

function chooseCategory(browser, dialog, value) {
  const input = dialog.querySelector(`input[name="category"][value="${value}"]`);
  input.checked = true;
  input.dispatchEvent(new browser.window.Event("change", { bubbles: true }));
}

function fill(browser, dialog, { email = "viewer@example.com", message = "Something is wrong with my account settings." } = {}) {
  dialog.querySelector("#yr-support-email").value = email;
  dialog.querySelector("#yr-support-message").value = message;
}

async function send(browser, dialog) {
  dialog.querySelector("form").dispatchEvent(new browser.window.Event("submit", { bubbles: true, cancelable: true }));
  await settle(browser.window);
}

const HELP_LINK = '.viewer-topbar a[aria-label="Help and contact"]';
const DATA_LINK = "#vd-data a.btn--danger";

describe("viewer support modal", () => {
  let browser;
  afterEach(async () => { await browser?.window.happyDOM.close(); browser = null; });

  it("opens from Help & contact without leaving the account page", async () => {
    browser = await openBrowser();
    const before = browser.window.location.href;
    const { dialog } = await openFrom(browser, HELP_LINK);
    expect(browser.window.location.href).toBe(before);
    expect(dialog.querySelector("#yr-support-title").textContent).toBe("Contact YourRank support");
    expect(dialog.textContent).toContain("For YourRank account and website issues.");
    expect(dialog.textContent).toContain("Reward fulfillment is handled by community creators.");
    expect(dialog.getAttribute("aria-labelledby")).toBe("yr-support-title");
    expect(browser.document.body.classList.contains("yr-support-open")).toBe(true);
    // No page-level chrome leaks into the modal.
    expect(dialog.querySelector(".help-subnav, .viewer-overview, .vd-membership, .contact-public")).toBeNull();
  });

  it("opens the same modal from the Data & Account contact action", async () => {
    browser = await openBrowser();
    const { dialog } = await openFrom(browser, DATA_LINK);
    expect(dialog.querySelector("#yr-support-title").textContent).toBe("Contact YourRank support");
    expect(browser.document.querySelectorAll("dialog.yr-support-modal")).toHaveLength(1);
  });

  it("renders exactly the YourRank support categories, with no reward/claim category", async () => {
    browser = await openBrowser();
    const { dialog } = await openFrom(browser, HELP_LINK);
    expect(dialog.querySelector("legend").textContent).toBe("What do you need help with?");
    const labels = Array.from(dialog.querySelectorAll(".yr-support-chip span")).map((el) => el.textContent);
    expect(labels).toEqual(SUPPORT_CATEGORIES);
    expect(labels.join(" ").toLowerCase()).not.toMatch(/reward|claim/);
    expect(dialog.querySelector('input[name="category"]:checked').value).toBe("account");
  });

  it("routes reward/claim issues to the creator only once the community's contact method is confirmed", async () => {
    browser = await openBrowser({ community: COMMUNITY, siteContact: { email: "creator@example.com" } });
    const { dialog } = await openFrom(browser, HELP_LINK);
    const note = dialog.querySelector(".yr-support-note");
    expect(note.getAttribute("data-support-reward-note")).toBe("available");
    expect(note.textContent).toContain("Reward or claim issue?");
    expect(note.textContent).toContain("Rewards are managed by the community creator.");
    const action = note.querySelector("a[data-support-creator]");
    expect(action.textContent.trim()).toBe("Contact creator");
    expect(action.getAttribute("href")).toBe("/creator/contact");
    expect(dialog.textContent).not.toContain("Go to reward");
    expect(browser.lookups).toHaveLength(1);
  });

  it("shows a non-clickable message when the community has no contact method", async () => {
    browser = await openBrowser({ community: COMMUNITY, siteContact: { email: "", discord: "" } });
    const { dialog } = await openFrom(browser, HELP_LINK);
    const note = dialog.querySelector(".yr-support-note");
    expect(note.getAttribute("data-support-reward-note")).toBe("unavailable");
    expect(note.textContent).toContain("Reward or claim issue?");
    expect(note.textContent).toContain("This creator hasn't provided a contact method yet.");
    expect(note.querySelector("a")).toBeNull();
    expect(dialog.querySelector("a[data-support-creator]")).toBeNull();
  });

  it("never offers the creator link when availability cannot be confirmed", async () => {
    browser = await openBrowser({ community: COMMUNITY, publicSite: "error" });
    const { dialog } = await openFrom(browser, HELP_LINK);
    const note = dialog.querySelector(".yr-support-note");
    expect(note.getAttribute("data-support-reward-note")).toBe("unknown");
    expect(note.querySelector("a")).toBeNull();
  });

  it("hides the creator action when no community is in context", async () => {
    browser = await openBrowser();
    const { dialog } = await openFrom(browser, HELP_LINK);
    expect(dialog.querySelector("a[data-support-creator]")).toBeNull();
    expect(dialog.querySelector(".yr-support-note").textContent).toContain("Reward or claim issue?");
    expect(browser.lookups).toHaveLength(0);
  });

  it("reads availability from the community page itself without a second request", async () => {
    browser = await openBrowser({ page: "community", siteContact: { discord: "https://discord.gg/creator" } });
    expect(browser.document.body.dataset.creatorContact).toBe("true");
    const { dialog } = await openFrom(browser, HELP_LINK);
    expect(dialog.querySelector("a[data-support-creator]").getAttribute("href")).toBe("/creator/contact");
    expect(browser.lookups).toHaveLength(0);

    await browser.window.happyDOM.close();
    browser = await openBrowser({ page: "community" });
    expect(browser.document.body.dataset.creatorContact).toBe("false");
    const empty = await openFrom(browser, HELP_LINK);
    expect(empty.dialog.querySelector("a[data-support-creator]")).toBeNull();
    expect(empty.dialog.querySelector(".yr-support-note").textContent).toContain("This creator hasn't provided a contact method yet.");
  });

  it("reveals diagnostics only for Technical issue", async () => {
    browser = await openBrowser();
    const { dialog } = await openFrom(browser, HELP_LINK);
    const toggle = dialog.querySelector("[data-support-diagnostics]");
    expect(toggle.hidden).toBe(true);
    chooseCategory(browser, dialog, "technical");
    expect(toggle.hidden).toBe(false);
    expect(toggle.textContent).toContain("Include diagnostics");
    expect(toggle.querySelector('input[type="checkbox"][role="switch"]')).not.toBeNull();
    chooseCategory(browser, dialog, "privacy");
    expect(toggle.hidden).toBe(true);
    expect(dialog.querySelector('input[type="file"]')).toBeNull();
  });

  it("submits through /api/contact with the existing contract and shows the success state in place", async () => {
    browser = await openBrowser({ community: COMMUNITY });
    const before = browser.window.location.href;
    const { dialog } = await openFrom(browser, HELP_LINK);
    chooseCategory(browser, dialog, "technical");
    dialog.querySelector('input[name="diagnostics"]').checked = true;
    fill(browser, dialog, { message: "The rewards page does not load for me." });
    await send(browser, dialog);
    expect(browser.calls).toHaveLength(1);
    const { init, payload } = browser.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");
    expect("x-csrf-token" in init.headers).toBe(true);
    expect(payload.kind).toBe("support");
    expect(payload.subject).toBe("Technical issue");
    expect(payload.email).toBe("viewer@example.com");
    expect(payload.name).toBe("36_ates");
    expect(payload.message.startsWith("The rewards page does not load for me.")).toBe(true);
    expect(payload.message).toContain("— Diagnostics —");
    expect(payload.requestId).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(dialog.open).toBe(true);
    expect(browser.window.location.href).toBe(before);
    expect(dialog.querySelector("form")).toBeNull();
    const success = dialog.querySelector(".yr-support-success");
    expect(success.querySelector("h2").textContent).toBe("Message sent");
    expect(success.textContent).toContain("YourRank received your message.");
    expect(success.textContent).toContain("We'll reply to the email you provided if a response is needed.");
    expect(browser.document.activeElement).toBe(success);
    click(browser.window, success.querySelector("[data-support-close]"));
    expect(dialog.open).toBe(false);
  });

  it("omits diagnostics from the payload for non-technical categories", async () => {
    browser = await openBrowser();
    const { dialog } = await openFrom(browser, HELP_LINK);
    chooseCategory(browser, dialog, "signin");
    fill(browser, dialog);
    await send(browser, dialog);
    expect(browser.calls[0].payload.subject).toBe("Sign in / connected accounts");
    expect(browser.calls[0].payload.message).not.toContain("Diagnostics");
  });

  it("keeps the draft and the same request id when submission fails, then succeeds on retry", async () => {
    let attempt = 0;
    browser = await openBrowser({ contact: () => (++attempt === 1 ? { status: 500, body: {} } : { status: 200, body: { ok: true } }) });
    const { dialog } = await openFrom(browser, HELP_LINK);
    fill(browser, dialog, { message: "My connected Kick account shows the wrong name." });
    await send(browser, dialog);
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector("#yr-support-message").value).toBe("My connected Kick account shows the wrong name.");
    expect(dialog.querySelector("#yr-support-email").value).toBe("viewer@example.com");
    expect(dialog.querySelector(".yr-support-status").textContent).toContain("your draft is still here");
    expect(dialog.querySelector("[data-support-submit]").disabled).toBe(false);
    await send(browser, dialog);
    expect(browser.calls).toHaveLength(2);
    expect(browser.calls[1].payload.requestId).toBe(browser.calls[0].payload.requestId);
    expect(dialog.querySelector(".yr-support-success")).not.toBeNull();
  });

  it("keeps the draft on a network failure and on 429", async () => {
    let attempt = 0;
    browser = await openBrowser({ contact: () => (++attempt === 1 ? new TypeError("Failed to fetch") : { status: 429, body: { error: "Too many messages. Please wait a few minutes." } }) });
    const { dialog } = await openFrom(browser, HELP_LINK);
    fill(browser, dialog);
    await send(browser, dialog);
    expect(dialog.querySelector(".yr-support-status").textContent).toContain("nothing was sent");
    await send(browser, dialog);
    expect(dialog.querySelector(".yr-support-status").textContent).toBe("Too many messages. Please wait a few minutes.");
    expect(dialog.querySelector("#yr-support-message").value).not.toBe("");
  });

  it("validates email and message before sending anything", async () => {
    browser = await openBrowser();
    const { dialog } = await openFrom(browser, HELP_LINK);
    fill(browser, dialog, { email: "", message: "short" });
    await send(browser, dialog);
    expect(browser.calls).toHaveLength(0);
    expect(dialog.querySelector("#yr-support-email-err").textContent).toContain("Email is required");
    expect(dialog.querySelector("#yr-support-message-err").textContent).toContain("at least 10 characters");
    expect(dialog.querySelector("#yr-support-email").getAttribute("aria-invalid")).toBe("true");
  });

  it("does not prefill an email the viewer never provided", async () => {
    browser = await openBrowser();
    const { dialog } = await openFrom(browser, HELP_LINK);
    expect(dialog.querySelector("#yr-support-email").value).toBe("");
    expect(dialog.querySelector("#yr-support-email").required).toBe(true);
  });

  it("moves focus into the modal, closes on Cancel/×/backdrop and returns focus to the opener", async () => {
    browser = await openBrowser();
    const { link, dialog } = await openFrom(browser, HELP_LINK);
    expect(dialog.contains(browser.document.activeElement)).toBe(true);
    click(browser.window, dialog.querySelector(".yr-support-close"));
    expect(dialog.open).toBe(false);
    expect(browser.document.body.classList.contains("yr-support-open")).toBe(false);
    expect(browser.document.activeElement).toBe(link);

    await openFrom(browser, HELP_LINK);
    click(browser.window, dialog.querySelector(".yr-support-actions [data-support-close]"));
    expect(dialog.open).toBe(false);

    await openFrom(browser, HELP_LINK);
    dialog.dispatchEvent(new browser.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(dialog.open).toBe(false);
  });

  it("does not close while a submission is pending", async () => {
    let release;
    browser = await openBrowser({ contact: () => new Promise((resolve) => { release = () => resolve({ status: 200, body: { ok: true } }); }) });
    const { dialog } = await openFrom(browser, HELP_LINK);
    fill(browser, dialog);
    dialog.querySelector("form").dispatchEvent(new browser.window.Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(browser.window.YRViewerSupport.isPending()).toBe(true);
    expect(dialog.querySelector("[data-support-submit]").disabled).toBe(true);
    const cancel = new browser.window.Event("cancel", { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    dialog.dispatchEvent(new browser.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(browser.window.YRViewerSupport.close()).toBe(false);
    expect(dialog.open).toBe(true);
    release();
    await settle(browser.window);
    expect(dialog.querySelector(".yr-support-success")).not.toBeNull();
  });

  it("keeps Feedback as a separate mode with its own categories", async () => {
    browser = await openBrowser();
    const link = browser.document.createElement("a");
    link.href = "/help/feedback?audience=viewer&return=%2Fme";
    link.textContent = "Feedback";
    browser.document.querySelector(".viewer-main").appendChild(link);
    click(browser.window, link);
    await settle(browser.window);
    const dialog = browser.document.querySelector("dialog.yr-support-modal");
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector("#yr-support-title").textContent).toBe("Share feedback");
    expect(Array.from(dialog.querySelectorAll(".yr-support-chip span")).map((el) => el.textContent)).toEqual(["Bug", "Feature request", "Other"]);
    expect(dialog.querySelector("[data-support-diagnostics]")).toBeNull();
    expect(dialog.querySelector(".yr-support-note")).toBeNull();
    chooseCategory(browser, dialog, "feature");
    fill(browser, dialog, { message: "Please add a dark mode toggle to the rewards page." });
    await send(browser, dialog);
    expect(browser.calls[0].payload.kind).toBe("feedback");
    expect(browser.calls[0].payload.subject).toBe("Feature request");
  });

  it("leaves non-viewer help links alone", async () => {
    browser = await openBrowser();
    const link = browser.document.createElement("a");
    link.href = "/help/support";
    browser.document.querySelector(".viewer-main").appendChild(link);
    click(browser.window, link);
    await settle(browser.window);
    expect(browser.document.querySelector("dialog.yr-support-modal")).toBeNull();
  });
});

describe("/help/support fallback route", () => {
  it("still renders the viewer support page for deep links and no-JS visitors", async () => {
    const html = helpSupportPage.Component({ viewerHelp: { returnTo: "/me", community: null } });
    expect(html).toContain('id="contactForm"');
    expect(html).toContain("Contact support");
    expect(helpSupportPage.configFor({ viewerHelp: { returnTo: "/me" } }).bodyClass).toContain("viewer-help-page");
  });
});

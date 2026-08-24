import { dashboardChromeHtml } from "@yourrank/shared/dashboard-chrome";
import { dashboardNavItems, workspaceAccountTopbarHtml, workspaceSearchHtml } from "./dashboard-shell.jsx";

// Help center pages: a creator-facing hub plus Support and Feedback forms.
// A signed-in streamer keeps the workspace chrome (rail, topbar, account menu).
// A visitor gets the public site chrome instead of the workspace rail, so Help
// is never an isolated navigation universe with no way back to the site.
const TABS = [
  { key: "help", label: "Overview", href: "/help" },
  { key: "support", label: "Support", href: "/help/support" },
  { key: "feedback", label: "Feedback", href: "/help/feedback" },
];

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

// The rail owns section roots; Support and Feedback are page subnavigation, so
// the visitor shell renders them as tabs under the page title.
function subnavHtml(active, workspace = false) {
  const navClass = workspace ? "v3-tabs help-workspace-subnav" : "help-subnav";
  const linkClass = workspace ? "v3-tab" : "help-subnav-link";
  const links = TABS.map((tab) => {
    const isActive = tab.key === active;
    return `<a class="${linkClass}${isActive ? " is-on" : ""}" href="${tab.href}"${isActive ? ' aria-current="page"' : ""}>${tab.label}</a>`;
  }).join("");
  return workspace
    ? `<nav class="${navClass}" aria-label="Help &amp; feedback">${links}</nav>`
    : `<nav class="${navClass}" aria-label="Help &amp; feedback">${links}</nav>`;
}

function contactFormHtml({ kind, subjectPlaceholder, messagePlaceholder }) {
  return `<form id="contactForm" class="card"><h2>Send us a message</h2>
        <div class="field"><label for="c_name">Name</label><input id="c_name" name="name" type="text" autocomplete="name" required maxlength="120" /></div>
        <div class="field"><label for="c_email">Email</label><input id="c_email" name="email" type="email" autocomplete="email" required maxlength="254" /></div>
        <input type="hidden" id="c_kind" name="kind" value="${kind}" />
        <input id="c_context" name="context" type="hidden" />
        <div class="field"><label for="c_subject">Subject</label><input id="c_subject" name="subject" type="text" maxlength="120" placeholder="${subjectPlaceholder}" /></div>
        <div class="field"><label for="c_message">Message</label><textarea id="c_message" name="message" rows="6" required minlength="10" maxlength="4000" placeholder="${messagePlaceholder}"></textarea></div>
        <div class="err" id="c_err" role="alert" aria-live="assertive"></div>
        <button class="btn btn--accent w-full" type="submit" id="c_submit">Send message</button>
        <p class="hint text-accent" id="c_success" hidden>Message received. We'll reply by email.</p>
      </form>
      <p class="hint mt-18" id="c_back_wrap" hidden><a id="c_back" href="/">← Back</a></p>
      <p class="hint mt-24">You can also email <a href="mailto:{{SUPPORT_EMAIL}}">{{SUPPORT_EMAIL}}</a> directly.</p>`;
}

function hubSectionsHtml() {
  return `<section class="operator-help-section" aria-labelledby="help-site">
  <h2 id="help-site">Site and public page</h2>
  <p>Use the site editor to configure the public page visitors see.</p>
  <ul class="operator-help-list">
    <li><a href="/dashboard/leaderboard/setup">Set up a site</a><span>Add the site details, schedule, and visitor access.</span></li>
    <li><a href="/dashboard/leaderboard/players">Manage players</a><span>Add and update the ranked rows used by the leaderboard.</span></li>
    <li><a href="/dashboard/leaderboard/design">Change design</a><span>Edit the public page’s branding and visual settings.</span></li>
    <li><a href="/dashboard/leaderboard/share">Share the public page</a><span>Find the public URL, stream overlay, embed code, and share links.</span></li>
  </ul>
</section>

<section class="operator-help-section" aria-labelledby="help-credits">
  <h2 id="help-credits">Rewards and member fulfilment</h2>
  <p>Manage how credits are earned, what members can unlock, and pending orders.</p>
  <ul class="operator-help-list">
    <li><a href="/dashboard/site/connections">Connect Kick</a><span>Link the Kick channel used for credit rewards.</span></li>
    <li><a href="/dashboard/rewards/rules">Create a way to earn</a><span>Choose a Kick reward and set how many credits it awards.</span></li>
    <li><a href="/dashboard/rewards/shop">Add a shop item</a><span>Create something members can unlock with their credits.</span></li>
    <li><a href="/dashboard/rewards/redemptions">Process orders</a><span>Review pending member orders and approve or cancel them.</span></li>
    <li><a href="/dashboard/audience/members">Check member balances</a><span>See member balances and recent earning activity.</span></li>
    <li><a href="/dashboard/rewards/activity">Review credit activity</a><span>Filter credit activity by member and activity type.</span></li>
  </ul>
</section>

<section class="operator-help-section" aria-labelledby="help-telegram">
  <h2 id="help-telegram">Telegram</h2>
  <p>Connect your Telegram bot, manage commands, and send broadcasts to subscribers.</p>
  <ul class="operator-help-list">
    <li><a href="/dashboard/telegram/bots">Connect a Telegram bot</a><span>Add the connect code, then manage the connected bot.</span></li>
    <li><a href="/dashboard/telegram/commands">Edit commands</a><span>Change the replies your bot sends when viewers type a command.</span></li>
    <li><a href="/dashboard/telegram/broadcasts">Send a broadcast</a><span>Compose, preview, and send or schedule a subscriber message.</span></li>
    <li><a href="/dashboard/telegram/offers">Manage offers</a><span>Manage the offers available to your community.</span></li>
  </ul>
</section>

<section class="operator-help-section" aria-labelledby="help-account">
  <h2 id="help-account">Account and settings</h2>
  <p>Account settings are separate from settings for one selected site.</p>
  <ul class="operator-help-list">
    <li><a href="/dashboard/settings/account">Account</a><span>Change your password and review active sessions.</span></li>
    <li><a href="/dashboard/site">Site settings</a><span>Manage visitor access, alerts, connected tools, and the web address for the selected site.</span></li>
    <li><a href="/dashboard/settings/billing">Billing</a><span>Manage the subscription and review billing access.</span></li>
    <li><a href="/dashboard/settings/connections">Connections</a><span>Review connected services.</span></li>
    <li><a href="/dashboard/settings/data">Data</a><span>Export account data or manage account deletion.</span></li>
  </ul>
</section>

<div class="operator-help-actions">
  <a class="btn btn--accent" href="/help/support">Contact support</a>
  <a class="btn" href="/help/feedback">Give feedback</a>
</div>`;
}

const HUB_TITLE = "Help & feedback";
const HUB_INTRO = "Find the right place for a task, contact support, or share feedback.";
const HUB_LEAD = "Choose what you are trying to do and jump straight to the right place.";

/** Signed-in creator: Help stays inside the workspace shell. */
function workspaceHelp({ active, title, subtitle, titleId, subtitleId, content, user, activePath }) {
  return dashboardChromeHtml({
    nav: dashboardNavItems(),
    active,
    navLabel: "Dashboard",
    headLabel: "Help & feedback",
    title,
    titleId,
    subtitle,
    subtitleId,
    user,
    activePath,
    topbarHtml: `${workspaceAccountTopbarHtml({ context: "Help & feedback", title, help: true })}${workspaceSearchHtml()}`,
    content: `<div class="operator-help">${subnavHtml(active, true)}${content}</div>`,
    railProfile: true,
    collapsible: true,
    embeddedInMain: true,
  });
}

/** Visitor: Help renders as an ordinary public page under the site header. */
function publicHelp({ active, id, title, intro, titleId, introId, body }) {
  return `<div class="operator-help" id="${id}">
<h1${titleId ? ` id="${titleId}"` : ""}>${esc(title)}</h1>
<p class="operator-help-lead"${introId ? ` id="${introId}"` : ""}>${esc(intro)}</p>
${subnavHtml(active)}
${body}
</div>`;
}

const WORKSPACE_STYLES = ["/assets/app.css", "/assets/shell-nav.css", "/assets/ui.css", "/assets/dashboard-v4.css"];
// The visitor shell is a public page: no workspace layer, and the shared site
// header and footer are rendered by the page shell.
const PUBLIC_OVERRIDES = {
  styles: ["/assets/app.css", "/assets/shell-nav.css", "/assets/ui.css"],
  mainClass: "wrap public-help-page",
  nav: true,
  footer: true,
  footerBrandHref: "/",
  wide: false,
};

function helpContent({ active, h1, intro, kind, subjectPlaceholder, messagePlaceholder, user, activePath }) {
  const form = contactFormHtml({ kind, subjectPlaceholder, messagePlaceholder });
  if (!user) {
    return publicHelp({
      active,
      id: `help-${active}`,
      title: h1,
      titleId: "contactTitle",
      intro,
      introId: "contactIntro",
      body: `<div class="contact-public">${form}</div>`,
    });
  }
  return workspaceHelp({
    active,
    title: h1,
    titleId: "contactTitle",
    subtitle: intro,
    subtitleId: "contactIntro",
    content: `<div class="lb-widget contact-workspace">${form}</div>`,
    user,
    activePath,
  });
}

function helpPage(opts) {
  const config = {
    title: `${opts.title} · YourRank`,
    canonical: opts.canonical,
    description: opts.description,
    robots: "index, follow",
    styles: WORKSPACE_STYLES,
    scripts: ['<script src="/assets/contact.js?v=1" type="module"></script>', '<script src="/assets/shell-nav.js?v=3" defer></script>'],
    mainClass: "wrap yr-ui",
    nav: false,
    footer: false,
    wide: true,
  };
  return {
    config,
    configFor: ({ user } = {}) => (user ? config : { ...config, ...PUBLIC_OVERRIDES }),
    Component: (renderOpts) => helpContent({ ...opts, ...renderOpts }),
  };
}

function helpHubContent({ user, activePath }) {
  const sections = hubSectionsHtml();
  if (!user) {
    return publicHelp({
      active: "help",
      id: "help-hub",
      title: HUB_TITLE,
      intro: HUB_LEAD,
      body: sections,
    });
  }
  return workspaceHelp({
    active: "help",
    title: HUB_TITLE,
    subtitle: HUB_INTRO,
    content: `<div id="help-hub">
<p class="operator-help-lead">${HUB_LEAD}</p>

${sections}
</div>`,
    user,
    activePath,
  });
}

const helpHubConfig = {
  title: "Help & feedback · YourRank",
  canonical: "https://yourrank.site/help",
  description: "Task-oriented help for creators using YourRank sites, rewards, messaging, analytics, and account settings.",
  robots: "index, follow",
  styles: WORKSPACE_STYLES,
  scripts: ['<script src="/assets/shell-nav.js?v=3" defer></script>'],
  mainClass: "wrap yr-ui",
  nav: false,
  footer: false,
  wide: true,
};

export const helpHubPage = {
  config: helpHubConfig,
  configFor: ({ user } = {}) => (user ? helpHubConfig : { ...helpHubConfig, ...PUBLIC_OVERRIDES }),
  Component: (renderOpts) => helpHubContent(renderOpts),
};

export const helpSupportPage = helpPage({
  active: "support",
  title: "Contact support",
  description: "Get help with YourRank. Questions, feedback, and support.",
  canonical: "https://yourrank.site/help/support",
  h1: "Contact support",
  intro: "Tell us what went wrong or what you need help with. We'll reply by email.",
  kind: "support",
  subjectPlaceholder: "What do you need help with?",
  messagePlaceholder: "Describe the problem and what you expected to happen...",
});

export const helpFeedbackPage = helpPage({
  active: "feedback",
  title: "Give feedback",
  description: "Share product feedback and feature requests for YourRank.",
  canonical: "https://yourrank.site/help/feedback",
  h1: "Give feedback",
  intro: "Tell us what would make YourRank better. Every message reaches the product team.",
  kind: "feedback",
  subjectPlaceholder: "What could be better?",
  messagePlaceholder: "Share an idea, frustration, or feature request...",
});

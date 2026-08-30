import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { PAGES } from "../pages.jsx";
import { leaderboardPageHtml } from "@yourrank/shared/page-shell";
import { publicNavHtml, shellNavHtml } from "@yourrank/shared/shell-nav";

const contactJs = readFileSync(new URL("../assets/contact.js", import.meta.url), "utf8");

// Help has two audiences and two canonical shells: a signed-in creator keeps the
// workspace chrome (`dashboardChromeHtml`), while a visitor gets the public site
// chrome so Help is never an isolated universe with no route back. The user is
// threaded through Component(renderOpts) and configFor(renderOpts), matching how
// the Worker renders these pages.
function render(pageKey, user, activePath = "/help/support") {
  const page = PAGES[pageKey];
  const config = page.configFor({ user, activePath });
  const html = leaderboardPageHtml({
    ...config,
    content: page.Component({ user, activePath }).toString(),
  });
  return html.replace("<!--GM_NAV-->", user
    ? shellNavHtml({ activePath, user, accountHref: "/dashboard/settings" })
    : publicNavHtml({ activePath }));
}

const user = { display_name: "Streamer One", email: "streamer@example.com", plan: "pro" };

describe("help pages", () => {
  it("renders the creator help hub in both shells", () => {
    const signedIn = render("helpHub", user, "/help");
    const signedOut = render("helpHub", null, "/help");
    for (const html of [signedIn, signedOut]) {
      expect(html).toContain("Help &amp; feedback");
      expect(html).toContain("Choose what you are trying to do");
      expect(html).toContain('href="/help/support"');
      expect(html).toContain('href="/help/feedback"');
      expect(html).toContain('href="/dashboard/rewards/rules"');
      expect(html).not.toContain("Operator help");
    }
    // Signed-in identity appears in the rail's profile menu. The primary rail
    // stays focused on daily creator work while Help lives in the account menu.
    expect(signedIn).toContain("Streamer One");
    expect(signedIn).toContain("lb-side");
    expect(signedIn).toContain('data-auth-workspace="true"');
    expect(signedIn).toContain('class="v3-tabs help-workspace-subnav"');
    expect((signedIn.match(/class="v3-tabs help-workspace-subnav"/g) || []).length).toBe(1);
    expect((signedIn.match(/class="v3-tab is-on"/g) || []).length).toBe(1);
    for (const href of ["/help", "/help/support", "/help/feedback"]) {
      expect(signedIn).toContain(`href="${href}"`);
    }
    expect(signedIn).toContain('class="v3-tab is-on" href="/help" aria-current="page"');
    expect(signedIn).toContain('class="lb-topbar-hud"');
    expect(signedIn).toContain('id="topbarCmdTrigger"');
    // A visitor gets the public site chrome, never the workspace rail: the
    // workspace stylesheet is scoped to [data-auth-workspace], so the rail
    // markup without it is the unstyled screen this split exists to prevent.
    expect(signedOut).not.toContain("lb-side");
    expect(signedOut).not.toContain('data-auth-workspace="true"');
    expect(signedOut).not.toContain("/assets/dashboard-v4.css");
    expect(signedOut).toContain("gm-shell-nav");
    expect(signedOut).toContain('<a class="gm-brand" href="/">');
    expect(signedOut).toContain('href="/pricing"');
    expect(signedOut).toContain("gm-shell-footer");
    expect(signedOut).toContain('class="help-subnav"');
    expect(signedOut).toContain('aria-current="page"');
    for (const href of [
      "/dashboard/leaderboard",
      "/dashboard/rewards",
      "/dashboard/telegram",
      "/dashboard/analytics",
      "/dashboard/settings",
    ]) expect(signedIn).toContain(`href="${href}"`);
    expect(signedIn).not.toContain('href="/dashboard/giveaways"');
    expect(signedIn).not.toContain('href="/dashboard/games"');
    expect(signedIn).toContain("Help &amp; feedback");
    expect(signedIn).toContain('href="/help/support?area=help');
    expect(signedIn).not.toContain('data-nav="help"');
    expect(signedIn).not.toContain('data-nav="support"');
    expect(signedIn).not.toContain('data-nav="feedback"');
  });

  for (const key of ["helpSupport", "helpFeedback"]) {
    it(`${key} renders the app rail for a signed-in streamer`, () => {
      const html = render(key, user);
      expect(html).toContain("lb-side");
      expect(html).toContain("lb-side-profile");
      expect(html).toContain("Streamer One");
      expect(html).toContain('data-auth-workspace="true"');
      expect(html).toContain('class="v3-tabs help-workspace-subnav"');
      expect((html.match(/class="v3-tabs help-workspace-subnav"/g) || []).length).toBe(1);
      expect((html.match(/class="v3-tab is-on"/g) || []).length).toBe(1);
      for (const href of ["/help", "/help/support", "/help/feedback"]) {
        expect(html).toContain(`href="${href}"`);
      }
      const activeHref = key === "helpSupport" ? "/help/support" : "/help/feedback";
      expect(html).toContain(`class="v3-tab is-on" href="${activeHref}" aria-current="page"`);
      expect(html).toContain('class="lb-topbar-hud"');
      expect(html).toContain('id="topbarCmdTrigger"');
      expect((html.match(/<main\b/g) || []).length).toBe(1);
    });

    it(`${key} renders for a visitor in the public site chrome`, () => {
      const html = render(key, null);
      expect(html).not.toContain("lb-side");
      expect(html).not.toContain('data-auth-workspace="true"');
      expect(html).toContain("gm-shell-nav");
      expect(html).toContain('<a class="gm-brand" href="/">');
      expect(html).toContain("gm-shell-footer");
      // Support and Feedback are page subnavigation, not rail sections.
      expect(html).toContain('class="help-subnav"');
      expect(html).toContain('id="contactForm"');
      expect((html.match(/<main\b/g) || []).length).toBe(1);
    });

    it(`${key} keeps the contact form and its script`, () => {
      const html = render(key, user);
      expect(html).toContain('id="contactForm"');
      expect(html).toContain("/assets/contact.js");
      expect(html).toContain('id="c_message"');
    });

    it(`${key} offers a path back to the dashboard`, () => {
      const html = render(key, user);
      expect(html).toContain('href="/dashboard"');
    });
  }

  it("does not promise an unverified support response time", () => {
    const html = render("helpSupport", user);
    expect(html).toContain("We'll reply by email");
    expect(html).not.toContain("usually within 1 business day");
  });

  it("keeps server-rendered support and feedback context intact on the client", () => {
    expect(contactJs).toContain('import { resolveContactType } from "./contact-context.js";');
    expect(contactJs).toContain("const serverType = kind?.value;");
    expect(contactJs).toContain("resolveContactType({ helpTab, queryType: requestedType, serverType })");
    expect(contactJs).toContain('type === "feedback" ? "Give feedback" : "Contact support"');
    expect(contactJs).toContain('kind.value = type');
  });

  it("keeps Help accessible without adding it back to the primary rail", () => {
    const html = render("helpSupport", user);
    expect(html).toContain("Help &amp; feedback");
    expect(html).toContain('href="/help/support?area=help');
    expect(html).not.toContain('data-nav="help"');
    expect(html).toContain('data-nav="settings"');
    expect(html).toContain('data-nav="redemptions"');
  });
});

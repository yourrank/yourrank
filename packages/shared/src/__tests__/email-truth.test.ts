import { describe, expect, it } from "bun:test";
import { onboardingEmail, loginCodeEmail } from "../email";

describe("onboarding email truth", () => {
  it("describes a new site as a draft and keeps restricted mechanics out of follow-up", () => {
    const user = { id: "user-1", email: "creator@example.com", display_name: "Creator", slug: "creator", origin: "https://test.com" };
    const welcome = onboardingEmail(0, user);
    const followUp = onboardingEmail(3, user);

    expect(welcome.text).toContain("draft community site");
    expect(welcome.text).not.toContain("leaderboard is live");
    expect(`${followUp.subject}\n${followUp.text}\n${followUp.html}`).not.toMatch(/casino|deposit|raffle|prediction|wager/i);
    expect(followUp.text).toContain("free code drop");
  });
});

describe("login code email", () => {
  it("shows the 6-digit code prominently with its expiry and ignore note", () => {
    const mail = loginCodeEmail("482913");
    expect(mail.subject).toBe("Your YourRank sign-in code");
    expect(mail.text).toContain("482913");
    expect(mail.html).toContain("482913");
    expect(mail.text).toContain("10 minutes");
    expect(mail.text).toMatch(/didn't request/i);
    expect(mail.html).toContain("monospace");
  });
});

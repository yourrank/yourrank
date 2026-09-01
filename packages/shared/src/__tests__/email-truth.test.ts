import { describe, expect, it } from "bun:test";
import { onboardingEmail } from "../email";

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

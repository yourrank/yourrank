import Link from "next/link";
import { MarketingShell } from "@/components/site-shell";

// DEF-13: Was silently permanentRedirect("/sites"). Games is a flagship feature
// and deserves its own marketing page instead of a disorienting bounce.
export const metadata = {
  title: "Provably Fair Games — YourRank",
  description: "Give your viewers Mines, Plinko, and Dice powered by cryptographically verifiable fairness — live on your leaderboard site.",
};

export default function GamesPage() {
  return (
    <MarketingShell>
      <section className="mx-auto max-w-5xl px-6 pt-28 pb-16">
        <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-devin-ink-soft mb-4">
          Provably Fair Games
        </p>
        <h1 className="text-[clamp(2rem,5vw,3.5rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-ink mb-6 max-w-2xl">
          Viewer games your community can trust.
        </h1>
        <p className="max-w-lg text-base text-devin-ink-soft leading-relaxed mb-10">
          Mines, Plinko, and Dice — each wager is verifiable on-chain so viewers
          can confirm every outcome is fair. Wagering uses your site&apos;s credit
          balance, keeping the loop inside your community.
        </p>
        <div className="flex flex-wrap gap-3 mb-16">
          <Link href="/signup" className="btn btn--primary">Start free</Link>
          <a href="/demo/games" className="btn btn--ghost">See a live demo</a>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            { name: "Mines", icon: "💣", desc: "Tap safe tiles to multiply your credits. One mine ends the round." },
            { name: "Plinko", icon: "🎯", desc: "Drop a ball and watch it bounce to a payout multiplier in real time." },
            { name: "Dice", icon: "🎲", desc: "Predict high or low. Set your own risk level and watch the roll." },
          ].map((g) => (
            <div key={g.name} className="rounded-[2px] border border-devin-line p-6">
              <div className="text-3xl mb-3">{g.icon}</div>
              <h3 className="font-semibold text-ink mb-2">{g.name}</h3>
              <p className="text-sm text-devin-ink-soft leading-relaxed">{g.desc}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 rounded-[2px] border border-devin-line p-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div>
            <p className="font-semibold text-ink mb-1">Already using YourRank?</p>
            <p className="text-sm text-devin-ink-soft">Enable Provably Fair Games from your dashboard feature flags.</p>
          </div>
          <a href="/dashboard" className="btn btn--ghost shrink-0">Open dashboard</a>
        </div>
      </section>
    </MarketingShell>
  );
}

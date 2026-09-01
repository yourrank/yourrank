import type { Metadata } from "next";
import { MagneticCursor } from "@/components/home/magnetic-cursor";
import { MarketingShell } from "@/components/site-shell";

export const metadata: Metadata = {
  title: "About — YourRank",
  description: "Why YourRank exists: one connected suite that replaces the spreadsheets, bots, and copy-pasted links streamers use to run their community.",
  alternates: { canonical: "https://yourrank.site/about" },
};

const BELIEFS = [
  {
    title: "One suite, not five tools",
    body: "A streamer's leaderboard, Telegram bot, rewards shop, viewer memberships, and overlays should share one dashboard and one set of data — update a score once and every surface reflects it.",
  },
  {
    title: "Built for streamers, not developers",
    body: "Nobody should need to understand webhooks or tokens to run their community. Setup is guided, and the product proves each step worked before moving on.",
  },
  {
    title: "Community credits, never cash",
    body: "Credits have no cash value anywhere in the launch product. There are no deposits and no cashouts — credits connect safe participation to creator-provided rewards.",
  },
  {
    title: "Calm, honest design",
    body: "High contrast, no clutter, no dark patterns, and no invented numbers. If the product can't do something yet, the site says so.",
  },
];

export default function AboutPage() {
  return (
    <MagneticCursor>
      <MarketingShell>
        <section className="px-6 pb-16 pt-32 sm:pt-40">
          <div className="mx-auto max-w-3xl">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-devin-primary">About</p>
            <h1 className="mt-4 text-[clamp(2.5rem,6vw,4rem)] font-medium leading-[1.02] tracking-[-0.03em]">
              Built to replace the spreadsheet era of streaming.
            </h1>
            <div className="mt-8 grid max-w-2xl gap-5 text-lg leading-relaxed text-devin-ink-soft">
              <p>
                Most streamer communities run on a fragile stack: a Google Sheet for points, a Discord bot for pings, a
                folder of links, and a lot of manual work between streams. Every piece lives somewhere different, and
                none of them talk to each other.
              </p>
              <p>
                YourRank replaces that stack with one connected suite: a branded public site with live standings, a
                Telegram bot that reaches viewers off-stream, a credits shop synced to Kick channel points, an OBS
                overlay for the broadcast, and viewer memberships that keep each community relationship clear.
              </p>
              <p>
                It runs on Cloudflare&apos;s edge, starts free, and is built so that a streamer — not a developer — can set
                the whole thing up.
              </p>
            </div>
          </div>
        </section>
        <section className="border-t border-devin-line bg-devin-secondary/20 px-6 py-20">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-2xl font-medium tracking-[-0.02em]">What we believe.</h2>
            <div className="mt-8 grid gap-px overflow-hidden rounded-[16px] border border-devin-line bg-devin-line sm:grid-cols-2">
              {BELIEFS.map((belief) => (
                <div key={belief.title} className="bg-white p-6 sm:p-8">
                  <h3 className="font-medium">{belief.title}</h3>
                  <p className="mt-3 leading-relaxed text-devin-ink-soft">{belief.body}</p>
                </div>
              ))}
            </div>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <a href="/signup" data-magnetic className="inline-flex min-h-11 items-center rounded-[2px] bg-devin-primary px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-devin-primary-hover">Create your free page</a>
              <a href="/demo" className="text-sm text-devin-ink-soft underline-offset-4 hover:text-devin-ink hover:underline">Explore the demo &rarr;</a>
            </div>
          </div>
        </section>
      </MarketingShell>
    </MagneticCursor>
  );
}

import type { Metadata } from "next";
import { MagneticCursor } from "@/components/home/magnetic-cursor";
import { MarketingShell } from "@/components/site-shell";

export const metadata: Metadata = {
  title: "Changelog — YourRank",
  description: "What's new in YourRank: product updates, improvements, and fixes, in reverse-chronological order.",
  alternates: { canonical: "https://yourrank.site/changelog" },
};

type EntryTag = "New" | "Improvement" | "Fix";

const TAG_STYLES: Record<EntryTag, string> = {
  New: "bg-devin-primary text-white",
  Improvement: "bg-devin-secondary text-devin-ink",
  Fix: "border border-devin-line text-devin-ink-soft",
};

const ENTRIES: Array<{ date: string; title: string; tag: EntryTag; body: string }> = [
  {
    date: "August 18, 2026",
    tag: "New",
    title: "Telegram moves inside the dashboard",
    body: "Your Telegram bots, offers, broadcasts, and commands are now managed at /dashboard/telegram alongside everything else — no separate bot dashboard to sign in to.",
  },
  {
    date: "August 18, 2026",
    tag: "Improvement",
    title: "A simpler dashboard, organized around what you do",
    body: "The dashboard sidebar was reshaped into nine streamer-named sections — Home, My site, Boards, Giveaways, Telegram, Rewards & Shop, Viewers, Analytics, Settings — with one sub-navigation per section. Every old link redirects to its new home.",
  },
  {
    date: "August 18, 2026",
    tag: "New",
    title: "A new public site",
    body: "The homepage was rebuilt with an interactive product tour, and free code drops gained a dedicated safe Activity path with participation evidence.",
  },
  {
    date: "August 18, 2026",
    tag: "Fix",
    title: "Telegram delivery made reliable",
    body: "Broadcast delivery, offer expiry, and postback routing in the Telegram bot were repaired, so scheduled sends and tracked links behave the way the dashboard says they will.",
  },
  {
    date: "August 17, 2026",
    tag: "Improvement",
    title: "Security hardening across the public surface",
    body: "Viewer credit endpoints now require authentication, public overlays are rate-limited, tournament score submissions are authorized, and public intake endpoints are bounded.",
  },
  {
    date: "August 17, 2026",
    tag: "Fix",
    title: "Faster, steadier analytics",
    body: "The analytics pipeline got queue reliability fixes, dead-letter replay tooling, and one shared database client per request — dashboard stats stay fresh even under load.",
  },
  {
    date: "July 18, 2026",
    tag: "Fix",
    title: "Dashboard editor polish",
    body: "Saving validates correctly, cached dashboard data refreshes when it should, and plan checks no longer misread your tier.",
  },
  {
    date: "July 8, 2026",
    tag: "Improvement",
    title: "Bot rate limiting and save fixes",
    body: "The Telegram bot handles bursts of commands gracefully, and challenge end dates save correctly from the editor.",
  },
  {
    date: "July 2, 2026",
    tag: "New",
    title: "YourRank launches",
    body: "The first public release: branded leaderboard sites, the Telegram bot, and the streamer dashboard, running on Cloudflare's edge.",
  },
];

export default function ChangelogPage() {
  return (
    <MagneticCursor>
      <MarketingShell>
        <section className="px-6 pb-12 pt-32 sm:pt-40">
          <div className="mx-auto max-w-3xl">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-devin-primary">Changelog</p>
            <h1 className="mt-4 text-[clamp(2.5rem,6vw,4rem)] font-medium leading-[1.02] tracking-[-0.03em]">
              What&apos;s new.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-devin-ink-soft">
              Product updates, improvements, and fixes — newest first.
            </p>
          </div>
        </section>
        <section className="px-6 pb-24 sm:pb-32">
          <div className="mx-auto max-w-3xl">
            <ol className="border-t border-devin-line">
              {ENTRIES.map((entry) => (
                <li key={entry.title} className="grid gap-2 border-b border-devin-line py-8 sm:grid-cols-[160px_1fr] sm:gap-8">
                  <time className="pt-0.5 font-mono text-xs text-devin-ink-soft">{entry.date}</time>
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-lg font-medium">{entry.title}</h2>
                      <span className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest ${TAG_STYLES[entry.tag]}`}>
                        {entry.tag}
                      </span>
                    </div>
                    <p className="mt-3 max-w-xl leading-relaxed text-devin-ink-soft">{entry.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </MarketingShell>
    </MagneticCursor>
  );
}

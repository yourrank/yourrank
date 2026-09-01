import type { Metadata } from "next";
import { MagneticCursor } from "@/components/home/magnetic-cursor";
import { MarketingShell } from "@/components/site-shell";

export const metadata: Metadata = {
  title: "Switch — YourRank",
  description: "Why streamers move their community from spreadsheets and Discord bots to one connected suite: leaderboards, Telegram, rewards, memberships, and overlays.",
  alternates: { canonical: "https://yourrank.site/switch" },
};

const ROWS: Array<{ task: string; manual: string; yourrank: string }> = [
  {
    task: "Publish standings",
    manual: "A shared spreadsheet viewers have to find, open, and trust",
    yourrank: "A branded public site with live standings and a countdown",
  },
  {
    task: "Update scores",
    manual: "Edit cells by hand and re-share the link after every change",
    yourrank: "Update once in the dashboard — site, overlay, and bot all reflect it",
  },
  {
    task: "Show it on stream",
    manual: "Screenshot the sheet or screen-share a browser tab",
    yourrank: "OBS browser-source overlay that updates itself",
  },
  {
    task: "Reach viewers off-stream",
    manual: "Ping @everyone in Discord and hope it's seen",
    yourrank: "Telegram broadcasts with per-link click tracking",
  },
  {
    task: "Reward participation",
    manual: "DIY point tallies and manual DM fulfilment",
    yourrank: "Kick channel-point sync, a credits shop, and a fulfilment ledger",
  },
  {
    task: "Run a free code drop",
    manual: "Copy a code into chat and reconcile participants by hand",
    yourrank: "Create a free code drop with replay, expiry, and participation evidence built in",
  },
  {
    task: "Answer \u201cwhat's my rank?\u201d",
    manual: "Repeat it in chat every stream",
    yourrank: "Viewers check /rank in Telegram or their own profile page",
  },
];

const KEEPS = [
  { title: "Keep Discord for talking", body: "YourRank doesn't replace your community's chat. It replaces the spreadsheet, the manual point tally, and the copy-pasted links around it \u2014 and can post updates into your Discord on Pro." },
  { title: "Bring your data with you", body: "Import your existing standings from CSV on any paid plan, so nobody loses their rank when you switch." },
  { title: "Start free, switch gradually", body: "The Free plan is a working community site with a leaderboard, bot, rewards, and viewer memberships. Run it next to your current setup until you're sure." },
];

export default function SwitchPage() {
  return (
    <MagneticCursor>
      <MarketingShell>
        <section className="px-6 pb-16 pt-32 sm:pb-24 sm:pt-40">
          <div className="mx-auto max-w-6xl">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-devin-primary">Switch</p>
            <h1 className="mt-4 max-w-4xl text-[clamp(3rem,7vw,5.5rem)] font-medium leading-[0.98] tracking-[-0.035em]">
              Retire the spreadsheet.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-devin-ink-soft">
              Most streamer leaderboards live in a Google Sheet, a Discord bot, and a pile of links held together by habit.
              YourRank replaces that stack with one connected suite &mdash; and keeps everything your community already earned.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="/signup" data-magnetic className="inline-flex min-h-11 items-center rounded-[2px] bg-devin-primary px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-devin-primary-hover">Start free</a>
              <a href="/demo" data-magnetic className="inline-flex min-h-11 items-center rounded-[2px] border border-devin-line px-5 py-3 text-sm font-medium transition-colors hover:border-devin-ink/40">Explore demo</a>
            </div>
          </div>
        </section>

        <section className="border-y border-devin-line bg-devin-secondary/35 px-6 py-24 sm:py-32">
          <div className="mx-auto max-w-6xl">
            <h2 className="text-4xl font-medium leading-[1.05] tracking-[-0.02em] sm:text-5xl">The same work, side by side.</h2>
            <div className="mt-12 overflow-x-auto rounded-[16px] border border-devin-line bg-white" role="region" aria-label="YourRank versus a manual stack" tabIndex={0}>
              <table className="w-full min-w-[680px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-devin-line text-left">
                    <th scope="col" className="px-5 py-4 font-medium text-devin-ink">Task</th>
                    <th scope="col" className="px-5 py-4 font-medium text-devin-ink-soft">Sheets + Discord bots</th>
                    <th scope="col" className="px-5 py-4 font-medium text-devin-primary">YourRank</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row) => (
                    <tr key={row.task} className="border-b border-devin-line last:border-b-0 align-top">
                      <th scope="row" className="px-5 py-4 text-left font-medium text-devin-ink">{row.task}</th>
                      <td className="px-5 py-4 leading-relaxed text-devin-ink-soft">{row.manual}</td>
                      <td className="px-5 py-4 leading-relaxed text-devin-ink">{row.yourrank}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="px-6 py-24 sm:py-32">
          <div className="mx-auto max-w-6xl">
            <h2 className="text-3xl font-medium tracking-[-0.02em]">Switching without losing anything.</h2>
            <div className="mt-10 grid gap-px overflow-hidden rounded-[2px] border border-devin-line bg-devin-line md:grid-cols-3">
              {KEEPS.map((item) => (
                <div key={item.title} className="bg-white p-7">
                  <h3 className="text-lg font-medium">{item.title}</h3>
                  <p className="mt-3 text-[15px] leading-relaxed text-devin-ink-soft">{item.body}</p>
                </div>
              ))}
            </div>
            <div className="mt-14 flex flex-wrap items-center gap-4 border-t border-devin-line pt-8">
              <a href="/signup" data-magnetic className="inline-flex min-h-11 items-center rounded-[2px] bg-devin-primary px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-devin-primary-hover">Create your free page</a>
              <a href="/pricing" className="text-sm text-devin-ink-soft underline-offset-4 hover:text-devin-ink hover:underline">See plans &amp; limits &rarr;</a>
            </div>
          </div>
        </section>
      </MarketingShell>
    </MagneticCursor>
  );
}

import Link from "next/link";

import { PLAN_META, PLAN_PRICING, PUBLIC_PLAN_TIERS } from "@yourrank/shared/plans";

const PROOF_ITEMS = [
  "Giveaways from Kick chat",
  "One entry per Kick account",
  "Tournament brackets",
  "Kick channel points",
  "Reward shop",
  "Branded community site",
  "OBS-ready overlays",
  "Telegram bot",
];

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="m3.2 8.2 3 3.1 6.7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="m4 4 8 8m0-8-8 8" strokeLinecap="round" />
    </svg>
  );
}

export function ProofMarquee() {
  const items = [...PROOF_ITEMS, ...PROOF_ITEMS];
  return (
    <section aria-label="YourRank capabilities" className="border-y border-devin-line bg-devin-surface py-5">
      <div className="overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]">
        <div className="animate-marquee flex w-max items-center">
          {items.map((item, index) => (
            <span key={`${item}-${index}`} className="flex items-center gap-8 whitespace-nowrap px-4 font-mono text-[11px] uppercase tracking-[0.12em] text-devin-ink-soft">
              {item}
              <span className="h-1 w-1 rounded-full bg-devin-primary" />
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  {
    number: "01",
    title: "Connect Kick",
    body: "Link your Kick channel and publish your community page with your name, branding, and leaderboard.",
  },
  {
    number: "02",
    title: "Run it from chat",
    body: "Start a giveaway or open tournament signups. Viewers type the keyword in chat to join, one entry per Kick account.",
  },
  {
    number: "03",
    title: "Reward regulars",
    body: "Channel points turn into credits viewers spend on rewards you choose, and you fulfil every order from one queue.",
  },
];

export function HowItWorks() {
  return (
    <section
      id="loop"
      tabIndex={-1}
      aria-labelledby="loop-heading"
      className="bg-devin-surface px-6 py-24 sm:py-32"
    >
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <div>
            <h2 id="loop-heading" className="max-w-[12ch] text-[clamp(2.5rem,5vw,4.5rem)] font-medium leading-[0.98] tracking-[-0.035em] text-devin-ink">
              Live on stream in three steps.
            </h2>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-devin-ink-soft">
              No spreadsheets, no copying names out of chat, no separate bot for every event.
            </p>
          </div>

          <ol className="border-t border-devin-line">
            {STEPS.map((step) => (
              <li key={step.number} className="grid gap-4 border-b border-devin-line py-8 sm:grid-cols-[52px_150px_1fr] sm:items-start sm:gap-6">
                <span className="font-mono text-xs text-devin-primary">{step.number}</span>
                <h3 className="text-xl font-medium tracking-[-0.02em] text-devin-ink">{step.title}</h3>
                <p className="max-w-lg text-[15px] leading-relaxed text-devin-ink-soft">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

const YOURRANK_ADVANTAGES = [
  "Giveaways and tournament signups straight from Kick chat",
  "One entry per Kick account, with linked-account review",
  "Channel points become credits for your reward shop",
  "One community page viewers come back to",
];

const MANUAL_STACK = [
  "A chat bot for giveaways, a spreadsheet for brackets",
  "The same viewer entering on a second account",
  "Rewards tracked by hand in DMs",
  "Links scattered across Discord and socials",
];

export function ComparisonSection() {
  return (
    <section className="border-y border-devin-line bg-[#121111] px-6 py-24 text-white sm:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-3xl">
          <h2 className="text-[clamp(2.5rem,5vw,4.6rem)] font-medium leading-[0.98] tracking-[-0.035em]">
            Everything your stream events need, in one place.
          </h2>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/58">
            Most streamers run events with a mix of bots, spreadsheets, and DMs. YourRank keeps the entries, winners, and rewards together.
          </p>
        </div>

        <div className="mt-14 grid overflow-hidden rounded-[16px] border border-white/14 bg-white/14 lg:grid-cols-2">
          <div className="bg-white p-7 text-devin-ink sm:p-9">
            <div className="flex items-center justify-between gap-4 border-b border-devin-line pb-5">
              <h3 className="text-2xl font-medium tracking-[-0.025em]">YourRank</h3>
              <span className="rounded-full bg-devin-primary px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-white">One place</span>
            </div>
            <ul className="divide-y divide-devin-line/70">
              {YOURRANK_ADVANTAGES.map((item) => (
                <li key={item} className="flex min-h-16 items-center gap-3 py-4 text-sm leading-relaxed">
                  <span className="text-devin-primary"><CheckIcon /></span>
                  {item}
                </li>
              ))}
            </ul>
            <Link href="/signup" data-magnetic className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-[2px] bg-devin-primary px-5 text-sm font-medium text-white transition-colors hover:bg-devin-primary-hover">
              Get started <ArrowIcon />
            </Link>
          </div>

          <div className="bg-[#191919] p-7 sm:p-9">
            <div className="border-b border-white/12 pb-5">
              <h3 className="text-2xl font-medium tracking-[-0.025em] text-white/76">A manual stack</h3>
            </div>
            <ul className="divide-y divide-white/10">
              {MANUAL_STACK.map((item) => (
                <li key={item} className="flex min-h-16 items-center gap-3 py-4 text-sm leading-relaxed text-white/48">
                  <span className="text-white/30"><CloseIcon /></span>
                  {item}
                </li>
              ))}
            </ul>
            <a href="/demo" className="mt-5 inline-flex min-h-12 items-center gap-2 rounded-[2px] border border-white/18 px-5 text-sm font-medium text-white/72 transition-colors hover:border-white/45 hover:text-white">
              See the live demo <ArrowIcon />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

const PLAN_ORDER = PUBLIC_PLAN_TIERS;

export function PricingSnapshot() {
  return (
    <section className="bg-devin-surface px-6 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col justify-between gap-7 sm:flex-row sm:items-end">
          <div>
            <h2 className="max-w-[13ch] text-[clamp(2.5rem,5vw,4.6rem)] font-medium leading-[0.98] tracking-[-0.035em] text-devin-ink">
              Start with the community you have.
            </h2>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-devin-ink-soft">
              Start free with chat giveaways and a reward shop. Add tournaments on Starter, and automation on Pro.
            </p>
          </div>
          <Link href="/pricing" className="inline-flex min-h-11 items-center gap-2 self-start text-sm font-medium text-devin-ink underline decoration-devin-line underline-offset-4 hover:decoration-devin-primary sm:self-auto">
            Compare every limit <ArrowIcon />
          </Link>
        </div>

        <div className="mt-14 grid gap-px overflow-hidden rounded-[16px] border border-devin-line bg-devin-line lg:grid-cols-3">
          {PLAN_ORDER.map((tier) => {
            const plan = PLAN_META[tier];
            const href = `/signup?plan=${tier}`;
            return (
              <article key={tier} className={`flex min-h-[430px] flex-col bg-white p-7 ${plan.highlight ? "relative outline outline-1 -outline-offset-1 outline-devin-primary" : ""}`}>
                {plan.highlight && (
                  <span className="mb-5 self-start rounded-full bg-devin-primary px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-white">Recommended</span>
                )}
                <h3 className="text-lg font-medium text-devin-ink">{plan.name}</h3>
                <p className="mt-5 flex items-end gap-1 text-devin-ink">
                  <span className="text-4xl font-medium tracking-[-0.04em]">${PLAN_PRICING[tier].monthlyUsd}</span>
                  <span className="pb-1 text-xs text-devin-ink-soft">{tier === "free" ? "forever" : "/month"}</span>
                </p>
                <ul className="mt-7 flex-1 space-y-3">
                  {plan.features.slice(0, 5).map((feature) => (
                    <li key={feature} className="flex gap-2.5 text-sm leading-relaxed text-devin-ink-soft">
                      <span className="mt-0.5 text-devin-primary"><CheckIcon /></span>
                      {feature}
                    </li>
                  ))}
                </ul>
                {plan.availability && <p className="mt-5 rounded-[8px] border border-devin-line bg-devin-secondary/35 px-3 py-2.5 text-xs leading-relaxed text-devin-ink" id={`home-plan-${tier}-availability`}>{plan.availability}</p>}
                <Link href={href} aria-describedby={plan.availability ? `home-plan-${tier}-availability` : undefined} data-magnetic className={`mt-7 inline-flex min-h-11 items-center justify-center rounded-[2px] px-4 text-sm font-medium transition-colors ${plan.highlight ? "bg-devin-primary text-white hover:bg-devin-primary-hover" : "border border-devin-line text-devin-ink hover:border-devin-ink/40"}`}>
                  {plan.cta}
                </Link>
              </article>
            );
          })}
        </div>
        <p className="mt-5 text-sm leading-relaxed text-devin-ink-soft">
          Free has no time limit. Paid plans unlock as soon as your payment is confirmed, and you can cancel anytime.
        </p>
      </div>
    </section>
  );
}

import { MagneticCursor } from "./home/magnetic-cursor";
import { MarketingShell } from "./site-shell";

export type ProductKind = "sites" | "telegram" | "credits" | "overlays";

export interface ProductPageContent {
  kind: ProductKind;
  title: string;
  intro: string;
  outcome: string;
  steps: Array<{ number: string; title: string; body: string }>;
}

const PEERS = [
  { label: "Sites", href: "/sites", kind: "sites" },
  { label: "Telegram", href: "/telegram", kind: "telegram" },
  { label: "Credits & Shop", href: "/credits", kind: "credits" },
  { label: "Overlays", href: "/overlays", kind: "overlays" },
] as const;

function SitesVisual() {
  const rows = [
    ["01", "Alex", "9,500"],
    ["02", "Bree", "7,200"],
    ["03", "Casey", "5,400"],
    ["04", "Drew", "3,100"],
  ];
  return (
    <div className="grid min-h-[430px] md:grid-cols-[180px_1fr]">
      <aside className="border-b border-devin-line bg-devin-secondary/45 p-5 md:border-b-0 md:border-r">
        <p className="font-mono text-[10px] uppercase tracking-widest text-devin-ink-soft">Site editor</p>
        <div className="mt-5 grid gap-1 text-sm">
          {['Home', 'Leaderboard', 'Rewards', 'My Community'].map((item, index) => (
            <span key={item} className={`rounded-[2px] px-3 py-2 ${index === 1 ? 'bg-white text-devin-ink' : 'text-devin-ink-soft'}`}>
              {item}
            </span>
          ))}
        </div>
        <span className="mt-8 inline-flex items-center gap-2 font-mono text-[10px] text-devin-ink-soft">
          <span className="h-1.5 w-1.5 rounded-full bg-devin-primary" /> Published
        </span>
      </aside>
      <div className="bg-white p-5 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-devin-line pb-6">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-devin-primary">Live standings</p>
            <h2 className="mt-2 text-2xl font-medium">Demo Community</h2>
          </div>
          <span className="rounded-full border border-devin-line px-3 py-1 font-mono text-[10px]">ENDS IN 04D 12H</span>
        </div>
        <div className="mt-5 divide-y divide-devin-line border-y border-devin-line">
          {rows.map(([rank, name, points]) => (
            <div key={rank} className="grid grid-cols-[42px_1fr_auto] items-center py-4 text-sm">
              <span className="font-mono text-xs text-devin-ink-soft">{rank}</span>
              <span className="font-medium">{name}</span>
              <span className="font-mono text-xs">{points} pts</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TelegramVisual() {
  return (
    <div className="grid min-h-[430px] md:grid-cols-[200px_1fr_240px]">
      <aside className="border-b border-devin-line bg-devin-secondary/45 p-5 md:border-b-0 md:border-r">
        <p className="font-mono text-[10px] uppercase tracking-widest text-devin-ink-soft">Telegram</p>
        <p className="mt-3 text-sm font-medium">Community Bot</p>
        <div className="mt-6 grid gap-1 text-sm text-devin-ink-soft">
          <span className="rounded-[2px] bg-white px-3 py-2 text-devin-ink">Broadcasts</span>
          <span className="px-3 py-2">Commands</span>
          <span className="px-3 py-2">Subscribers</span>
          <span className="px-3 py-2">Tracked offers</span>
        </div>
      </aside>
      <div className="border-b border-devin-line bg-white p-6 md:border-b-0 md:border-r sm:p-8">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-widest text-devin-primary">Message preview</p>
          <span className="font-mono text-[10px] text-devin-ink-soft">DRAFT</span>
        </div>
        <div className="mt-8 max-w-sm rounded-[14px] rounded-bl-[2px] bg-devin-secondary p-5">
          <p className="text-sm font-medium">The leaderboard just changed.</p>
          <p className="mt-2 text-sm leading-relaxed text-devin-ink-soft">
            Check the latest standings and see what the community is unlocking next.
          </p>
          <span className="mt-4 block rounded-[2px] bg-devin-primary px-3 py-2 text-center text-xs font-medium text-white">View standings</span>
        </div>
      </div>
      <aside className="bg-devin-secondary/20 p-5">
        <p className="font-mono text-[10px] uppercase tracking-widest text-devin-ink-soft">Delivery</p>
        <dl className="mt-6 grid gap-5 text-sm">
          <div><dt className="text-devin-ink-soft">Audience</dt><dd className="mt-1 font-medium">Subscribers</dd></div>
          <div><dt className="text-devin-ink-soft">Link tracking</dt><dd className="mt-1 font-medium">Enabled</dd></div>
          <div><dt className="text-devin-ink-soft">Status</dt><dd className="mt-1 font-medium">Ready to send</dd></div>
        </dl>
      </aside>
    </div>
  );
}

function CreditsVisual() {
  const rewards = [
    ["VIP role", "2,500 cr", "12 left"],
    ["Stream shoutout", "1,200 cr", "Available"],
    ["Community badge", "800 cr", "Available"],
  ];
  return (
    <div className="min-h-[430px] bg-white p-5 sm:p-8">
      <div className="grid gap-px overflow-hidden rounded-[2px] border border-devin-line bg-devin-line sm:grid-cols-3">
        {[['Circulating credits', '48,240'], ['Pending redemptions', '06'], ['Rewards available', '14']].map(([label, value]) => (
          <div key={label} className="bg-white p-5">
            <p className="font-mono text-[10px] uppercase tracking-widest text-devin-ink-soft">{label}</p>
            <p className="mt-3 text-2xl font-medium">{value}</p>
          </div>
        ))}
      </div>
      <div className="mt-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-devin-primary">Reward catalog</p>
          <h2 className="mt-2 text-2xl font-medium">Give participation a destination.</h2>
        </div>
        <span className="rounded-[2px] bg-devin-ink px-3 py-2 text-xs font-medium text-white">Add reward</span>
      </div>
      <div className="mt-5 divide-y divide-devin-line border-y border-devin-line">
        {rewards.map(([reward, price, stock]) => (
          <div key={reward} className="grid grid-cols-[1fr_auto] items-center gap-4 py-4 sm:grid-cols-[1fr_120px_120px]">
            <span className="text-sm font-medium">{reward}</span>
            <span className="font-mono text-xs">{price}</span>
            <span className="hidden text-right font-mono text-xs text-devin-ink-soft sm:block">{stock}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OverlaysVisual() {
  const ranks = [
    ["01", "Alex", "9,500"],
    ["02", "Bree", "7,200"],
    ["03", "Casey", "5,400"],
  ];
  return (
    <div className="grid min-h-[430px] md:grid-cols-[1fr_240px]">
      <div className="relative flex items-end border-b border-devin-line bg-devin-ink p-5 sm:p-8 md:border-b-0 md:border-r">
        <span className="absolute left-5 top-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-white sm:left-8 sm:top-8">
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" /> Live
        </span>
        <div className="w-full max-w-sm rounded-[10px] bg-black/70 p-4 text-white backdrop-blur">
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-white/60">Standings</span>
            <span className="font-mono text-[10px] text-white/60">Ends 04d 12h</span>
          </div>
          <div className="mt-2 divide-y divide-white/10">
            {ranks.map(([rank, name, points]) => (
              <div key={rank} className="grid grid-cols-[32px_1fr_auto] items-center py-2 text-sm">
                <span className="font-mono text-xs text-white/50">{rank}</span>
                <span className="font-medium">{name}</span>
                <span className="font-mono text-xs">{points} pts</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <aside className="bg-devin-secondary/20 p-5">
        <p className="font-mono text-[10px] uppercase tracking-widest text-devin-ink-soft">Browser source</p>
        <dl className="mt-6 grid gap-5 text-sm">
          <div><dt className="text-devin-ink-soft">Layout</dt><dd className="mt-1 font-medium">Card · Ticker · Bar</dd></div>
          <div><dt className="text-devin-ink-soft">Data</dt><dd className="mt-1 font-medium">Live standings</dd></div>
          <div><dt className="text-devin-ink-soft">Weight</dt><dd className="mt-1 font-medium">Plain HTML &amp; CSS</dd></div>
          <div><dt className="text-devin-ink-soft">Setup</dt><dd className="mt-1 font-medium">One URL in OBS</dd></div>
        </dl>
      </aside>
    </div>
  );
}

function ProductVisual({ kind }: { kind: ProductKind }) {
  if (kind === "telegram") return <TelegramVisual />;
  if (kind === "credits") return <CreditsVisual />;
  if (kind === "overlays") return <OverlaysVisual />;
  return <SitesVisual />;
}

export function ProductPage({ content }: { content: ProductPageContent }) {
  return (
    <MagneticCursor>
      <MarketingShell>
        <section className="px-6 pb-16 pt-32 sm:pb-24 sm:pt-40">
          <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,.65fr)] lg:items-end">
            <div>
              <h1 className="max-w-4xl text-[clamp(3rem,7vw,5.5rem)] font-medium leading-[0.98] tracking-[-0.035em]">
                {content.title}
              </h1>
            </div>
            <div className="border-t border-devin-ink pt-5">
              <p className="text-lg leading-relaxed text-devin-ink-soft">{content.intro}</p>
              <div className="mt-7 flex flex-wrap gap-3">
                <a href="/signup" data-magnetic className="inline-flex min-h-11 items-center rounded-[2px] bg-devin-primary px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-devin-primary-hover">Start free</a>
                <a href="/demo" data-magnetic className="inline-flex min-h-11 items-center rounded-[2px] border border-devin-line px-5 py-3 text-sm font-medium transition-colors hover:border-devin-ink/40">Explore demo</a>
              </div>
            </div>
          </div>
        </section>

        <section className="px-6 pb-24">
          <div className="mx-auto max-w-6xl overflow-hidden rounded-[16px] border border-devin-line bg-devin-secondary/25">
            <div className="flex items-center justify-between border-b border-devin-line px-4 py-3">
              <div className="flex gap-1.5" aria-hidden="true"><span className="h-2 w-2 rounded-full bg-devin-line" /><span className="h-2 w-2 rounded-full bg-devin-line" /><span className="h-2 w-2 rounded-full bg-devin-line" /></div>
              <span className="font-mono text-[10px] text-devin-ink-soft">Illustrative workspace · synthetic data</span>
            </div>
            <ProductVisual kind={content.kind} />
          </div>
        </section>

        <section className="border-y border-devin-line bg-devin-secondary/35 px-6 py-24 sm:py-32">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-8 lg:grid-cols-2">
              <h2 className="text-4xl font-medium leading-[1.05] tracking-[-0.02em] sm:text-5xl">How it works.</h2>
              <p className="max-w-xl text-2xl leading-snug text-devin-ink-soft sm:text-3xl">{content.outcome}</p>
            </div>
            <ol className="mt-16 border-t border-devin-line">
              {content.steps.map((step) => (
                <li key={step.number} className="grid gap-4 border-b border-devin-line py-7 sm:grid-cols-[80px_1fr_1fr] sm:items-start">
                  <span className="font-mono text-xs text-devin-ink-soft">{step.number}</span>
                  <h3 className="text-xl font-medium">{step.title}</h3>
                  <p className="max-w-lg text-[15px] leading-relaxed text-devin-ink-soft">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="px-6 py-24 sm:py-32">
          <div className="mx-auto max-w-6xl">
            <h2 className="text-3xl font-medium tracking-[-0.02em]">Explore the connected suite.</h2>
            <div className="mt-8 grid border-y border-devin-line sm:grid-cols-2 lg:grid-cols-4">
              {PEERS.map((peer) => (
                <a
                  key={peer.kind}
                  href={peer.href}
                  data-magnetic
                  aria-current={peer.kind === content.kind ? "page" : undefined}
                  className={`group flex items-center justify-between border-b border-devin-line px-5 py-6 text-lg font-medium transition-colors last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 ${peer.kind === content.kind ? 'bg-devin-secondary/40' : 'hover:bg-devin-secondary/25'}`}
                >
                  {peer.label}<span className="text-devin-primary transition-transform group-hover:translate-x-1">→</span>
                </a>
              ))}
            </div>
          </div>
        </section>
      </MarketingShell>
    </MagneticCursor>
  );
}

import { brandLogoSvg } from "@yourrank/shared/brand-assets";

function BrandGlyph() {
  return <span dangerouslySetInnerHTML={{ __html: brandLogoSvg({ className: "h-5 w-[94px]" }) }} />;
}

function ActivityGlyph({ kind }: { kind: "giveaway" | "tournament" | "credit" }) {
  const paths = {
    giveaway: <path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-1.5-3-5-3.5-5-1.25C7 7 9.5 7 12 7Zm0 0c1.5-3 5-3.5 5-1.25C17 7 14.5 7 12 7Z" />,
    tournament: <path d="M4 5h4v4H4zM4 15h4v4H4zM8 7h3v10H8M11 12h4M15 10h5v4h-5z" />,
    credit: <path d="M12 3.5v17M16 7.25c-.8-1-2-1.5-3.8-1.5-2.2 0-3.7 1.1-3.7 2.8 0 4 7.5 1.5 7.5 5.7 0 1.8-1.5 3-4 3-1.8 0-3.3-.55-4.25-1.7" />,
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[kind]}
    </svg>
  );
}

const ACTIVITY = [
  { kind: "giveaway" as const, title: "Giveaway winner drawn", detail: "!join · 412 entries · 1 per Kick account", time: "now" },
  { kind: "tournament" as const, title: "Tournament signups closed", detail: "Friday Cup · 32 players · bracket ready", time: "6m" },
  { kind: "credit" as const, title: "Reward fulfilled", detail: "VIP role · 2,500 credits", time: "14m" },
];

const PLAYERS = [
  ["01", "NovaByte", "9,500"],
  ["02", "RinLive", "7,200"],
  ["03", "MikaWave", "5,400"],
];

export function WorkspacePreview() {
  return (
    <div className="overflow-hidden rounded-[16px] border border-devin-line bg-white text-left text-devin-ink">
      <div className="flex h-12 items-center justify-between border-b border-devin-line bg-[#121111] px-4 text-white sm:px-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <BrandGlyph />
          YourRank
        </div>
        <div className="hidden items-center gap-2 rounded-[4px] border border-white/15 px-3 py-1.5 text-xs text-white/72 sm:flex">
          Friday Stream
          <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="m3 4.5 3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-white/70">
          <span className="h-1.5 w-1.5 rounded-full bg-devin-primary" />
          Live
        </div>
      </div>

      <div className="grid min-h-[430px] sm:grid-cols-[170px_1fr] lg:grid-cols-[210px_1fr]">
        <aside className="hidden border-r border-white/8 bg-[#121111] p-4 text-white sm:block">
          <div className="rounded-[8px] border border-white/12 bg-white/[0.03] p-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/45">Active site</p>
            <p className="mt-2 text-sm font-medium">Friday Stream</p>
          </div>
          <nav className="mt-5 grid gap-1" aria-label="Illustrative workspace navigation">
            {["Overview", "Giveaways", "Tournaments", "Credits & Shop", "Site"].map((item, index) => (
              <div
                key={item}
                className={`flex min-h-10 items-center rounded-[4px] px-3 text-xs ${index === 0 ? "bg-white/8 text-white" : "text-white/55"}`}
              >
                {index === 0 && <span className="mr-2 h-1.5 w-1.5 rounded-full bg-devin-primary" />}
                {item}
              </div>
            ))}
          </nav>
          <div className="mt-8 border-t border-white/10 pt-4 font-mono text-[9px] uppercase tracking-[0.12em] text-white/40">
            Illustrative workspace
          </div>
        </aside>

        <div className="bg-[#FCFCFC] p-4 sm:p-6 lg:p-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-devin-ink-soft">Stream night</p>
              <h2 className="mt-1 text-2xl font-medium tracking-[-0.025em]">Overview</h2>
            </div>
            <span className="rounded-full border border-devin-line bg-white px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-devin-ink-soft">
              Synthetic demo data
            </span>
          </div>

          <div className="mt-6 grid overflow-hidden rounded-[10px] border border-devin-line bg-devin-line sm:grid-cols-3">
            {[
              ["Giveaway entries", "412", "Tonight"],
              ["Tournament players", "32", "Friday Cup"],
              ["Credits issued", "18.4k", "This cycle"],
            ].map(([label, value, meta]) => (
              <div key={label} className="bg-white p-4 sm:p-5">
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-devin-ink-soft">{label}</p>
                <div className="mt-2 flex items-end justify-between gap-2">
                  <span className="text-2xl font-medium tracking-[-0.03em]">{value}</span>
                  <span className="text-[10px] text-devin-ink-soft">{meta}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-[10px] border border-devin-line bg-white p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Community activity</h3>
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-devin-primary">Connected</span>
              </div>
              <div className="mt-3 divide-y divide-devin-line/70">
                {ACTIVITY.map((item) => (
                  <div key={item.title} className="grid grid-cols-[24px_1fr_auto] items-center gap-2 py-3 first:pt-1">
                    <span className="text-devin-primary"><ActivityGlyph kind={item.kind} /></span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{item.title}</span>
                      <span className="block truncate text-[10px] text-devin-ink-soft">{item.detail}</span>
                    </span>
                    <span className="font-mono text-[9px] text-devin-ink-soft">{item.time}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[10px] border border-devin-line bg-white p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Top participants</h3>
                <span className="h-2 w-2 rounded-full bg-devin-primary" />
              </div>
              <div className="mt-3 divide-y divide-devin-line/70">
                {PLAYERS.map(([rank, name, points]) => (
                  <div key={rank} className="grid grid-cols-[24px_1fr_auto] gap-2 py-3 text-xs">
                    <span className="font-mono text-devin-ink-soft">{rank}</span>
                    <span className="truncate font-medium">{name}</span>
                    <span className="font-mono">{points}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

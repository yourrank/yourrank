import Image from "next/image";

export type ProductShotKind = "home" | "giveaways" | "tournaments" | "rewards";

const SHOTS: Record<ProductShotKind, { width: number; height: number; path: string; alt: string }> = {
  home: {
    width: 2560,
    height: 1600,
    path: "/dashboard",
    alt: "YourRank dashboard Home for Friday Stream: a code drop and a chat giveaway live now, community pulse for the last 30 days, and recent activity.",
  },
  giveaways: {
    width: 2800,
    height: 1880,
    path: "/dashboard/giveaways",
    alt: "YourRank chat giveaway: keyword !join, Kick connected, 12 participants with two linked accounts excluded until you include them again.",
  },
  tournaments: {
    width: 2560,
    height: 2000,
    path: "/dashboard/tournaments",
    alt: "YourRank tournament Friday Night Cup: 8-player bracket with quarterfinals, semifinals and final, round 2 in progress.",
  },
  rewards: {
    width: 2560,
    height: 1600,
    path: "/dashboard/rewards",
    alt: "YourRank Rewards overview: Kick connected, 3 claims to review, and credits earned, spent and held by members over the last 30 days.",
  },
};

export function ProductShot({ kind, priority = false, className = "" }: { kind: ProductShotKind; priority?: boolean; className?: string }) {
  const shot = SHOTS[kind];
  return (
    <figure className={`flex flex-col overflow-hidden rounded-[14px] border border-devin-line bg-white text-left ${className}`}>
      <div className="flex shrink-0 items-center gap-2 border-b border-devin-line px-4 py-2.5">
        <span className="h-2 w-2 rounded-full bg-devin-secondary" />
        <span className="h-2 w-2 rounded-full bg-devin-secondary" />
        <span className="h-2 w-2 rounded-full bg-devin-secondary" />
        <span className="ml-2 hidden min-w-0 truncate font-mono text-[10px] text-devin-ink-soft sm:inline">{`yourrank.site${shot.path}`}</span>
        <figcaption className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-[0.1em] text-devin-ink-soft">
          Real dashboard · sample data
        </figcaption>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden bg-[#f5f7fa]">
        <Image
          src={`/brand/product/${kind}.webp`}
          alt={shot.alt}
          width={shot.width}
          height={shot.height}
          unoptimized
          priority={priority}
          className="block h-full w-full object-cover object-left-top"
        />
      </div>
    </figure>
  );
}

export function WorkspacePreview() {
  return <ProductShot kind="home" className="shadow-[0_30px_80px_-40px_rgba(18,17,17,0.35)]" />;
}

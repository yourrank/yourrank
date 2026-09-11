import Link from "next/link";
import type { Metadata } from "next";
import { MagneticCursor } from "@/components/home/magnetic-cursor";
import { MarketingShell } from "@/components/site-shell";

export const metadata: Metadata = {
  title: "Brand — YourRank",
  description: "Official YourRank brand assets: the triple-chevron mark, the YourRank wordmark, colors, and Powered by YourRank badges for streamer panels.",
  alternates: { canonical: "https://yourrank.site/brand" },
};

const LOGOS = [
  { name: "Mark — dark", file: "/brand/yourrank-mark-dark.svg", bg: "bg-white", note: "Triple-chevron mark, for light backgrounds" },
  { name: "Mark — light", file: "/brand/yourrank-mark-light.svg", bg: "bg-devin-ink", note: "Triple-chevron mark, for dark backgrounds" },
  { name: "Mark — blue", file: "/brand/yourrank-mark-blue.svg", bg: "bg-white", note: "Accent variant" },
  { name: "Wordmark — dark", file: "/brand/yourrank-wordmark-dark.svg", bg: "bg-white", note: "Mark plus YourRank letterforms, for light backgrounds" },
  { name: "Wordmark — light", file: "/brand/yourrank-wordmark-light.svg", bg: "bg-devin-ink", note: "Mark plus YourRank letterforms, for dark backgrounds" },
];

const BADGES = [
  { name: "Powered by YourRank — dark", file: "/brand/powered-by-yourrank-dark.svg", bg: "bg-white" },
  { name: "Powered by YourRank — light", file: "/brand/powered-by-yourrank-light.svg", bg: "bg-devin-secondary/40" },
];

const COLORS = [
  { name: "Primary blue", hex: "#2200FF", className: "bg-devin-primary" },
  { name: "Ink", hex: "#0A0A0A", className: "bg-devin-ink" },
  { name: "Surface", hex: "#FCFCFC", className: "bg-devin-surface border border-devin-line" },
];

export default function BrandPage() {
  return (
    <MagneticCursor>
      <MarketingShell>
        <section className="px-6 pb-12 pt-32 sm:pt-40">
          <div className="mx-auto max-w-5xl">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-devin-primary">Brand</p>
            <h1 className="mt-4 text-[clamp(2.5rem,6vw,4rem)] font-medium leading-[1.02] tracking-[-0.03em]">
              Brand assets.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-devin-ink-soft">
              One mark and one wordmark: the triple-chevron YourRank chevron stack, and the same chevrons paired with the
              YourRank letterforms. These files are generated from the geometry the product itself renders, so they never
              drift from the app. Free to use when referring to YourRank or linking to your community site — please
              don&apos;t alter the marks, redraw them, or imply endorsement.
            </p>
          </div>
        </section>

        <section className="px-6 pb-16">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-2xl font-medium tracking-[-0.02em]">Logos</h2>
            <div className="mt-6 grid gap-px overflow-hidden rounded-[16px] border border-devin-line bg-devin-line sm:grid-cols-2 lg:grid-cols-3">
              {LOGOS.map((logo) => (
                <div key={logo.name} className="bg-white">
                  <div className={`flex h-36 items-center justify-center ${logo.bg}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={logo.file} alt={logo.name} className="max-h-16 w-auto max-w-[240px]" />
                  </div>
                  <div className="flex items-center justify-between border-t border-devin-line px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">{logo.name}</p>
                      <p className="text-xs text-devin-ink-soft">{logo.note}</p>
                    </div>
                    <a href={logo.file} download className="rounded-[2px] border border-devin-line px-3 py-1.5 text-xs font-medium transition-colors hover:border-devin-ink/40">
                      SVG
                    </a>
                  </div>
                </div>
              ))}
              <div aria-hidden="true" className="hidden bg-white lg:block" />
            </div>
          </div>
        </section>

        <section className="px-6 pb-16">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-2xl font-medium tracking-[-0.02em]">Streamer badges</h2>
            <p className="mt-3 max-w-2xl leading-relaxed text-devin-ink-soft">
              Drop a &quot;Powered by YourRank&quot; badge in your Twitch or Kick panels and link it to your community site.
            </p>
            <div className="mt-6 grid gap-px overflow-hidden rounded-[16px] border border-devin-line bg-devin-line sm:grid-cols-2">
              {BADGES.map((badge) => (
                <div key={badge.name} className="bg-white">
                  <div className={`flex h-28 items-center justify-center ${badge.bg}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={badge.file} alt={badge.name} className="h-11 w-auto" />
                  </div>
                  <div className="flex items-center justify-between border-t border-devin-line px-4 py-3">
                    <p className="text-sm font-medium">{badge.name}</p>
                    <a href={badge.file} download className="rounded-[2px] border border-devin-line px-3 py-1.5 text-xs font-medium transition-colors hover:border-devin-ink/40">
                      SVG
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-6 pb-24 sm:pb-32">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-2xl font-medium tracking-[-0.02em]">Colors &amp; type</h2>
            <div className="mt-6 grid gap-px overflow-hidden rounded-[16px] border border-devin-line bg-devin-line sm:grid-cols-3">
              {COLORS.map((color) => (
                <div key={color.hex} className="bg-white p-5">
                  <div className={`h-16 rounded-[8px] ${color.className}`} />
                  <p className="mt-3 text-sm font-medium">{color.name}</p>
                  <p className="font-mono text-xs text-devin-ink-soft">{color.hex}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 max-w-2xl leading-relaxed text-devin-ink-soft">
              Typography is <span className="font-medium text-devin-ink">Inter</span> for interface and headings, with a
              monospace face for labels and data. Questions about usage?{" "}
              <Link href="/contact" className="text-devin-ink underline underline-offset-4 hover:text-devin-primary">Contact us</Link>.
            </p>
          </div>
        </section>
      </MarketingShell>
    </MagneticCursor>
  );
}

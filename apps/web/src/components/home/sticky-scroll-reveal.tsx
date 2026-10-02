"use client";

import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion";
import { useRef, useState } from "react";
import Link from "next/link";
import { DEVIN_EASE } from "./reveal";

type ProductKind = "giveaways" | "tournaments" | "credits";

interface ProductStory {
  kind: ProductKind;
  label: string;
  title: string;
  description: string;
  href: string;
  action: string;
}

const PRODUCTS: ProductStory[] = [
  {
    kind: "giveaways",
    label: "Giveaways",
    title: "Run them from chat, keep them fair.",
    description: "Viewers type your keyword in Kick chat to enter. Each Kick account gets one entry, likely-linked accounts show up for your review, and you draw the winner on stream.",
    href: "/demo",
    action: "See the live demo",
  },
  {
    kind: "tournaments",
    label: "Tournaments",
    title: "Signups in chat, brackets built for you.",
    description: "Open signups with a chat keyword, close them when you are ready, and run the bracket round by round. Included from Starter.",
    href: "/pricing",
    action: "Compare plans",
  },
  {
    kind: "credits",
    label: "Rewards",
    title: "Give channel points somewhere to go.",
    description: "Map Kick channel points to credits, publish rewards you pick, and fulfil every redemption from one queue.",
    href: "/credits",
    action: "Explore Credits & Shop",
  },
];

function GiveawaysVisual() {
  const chat = [
    ["NovaByte", "!join", "Entered"],
    ["RinLive", "!join", "Entered"],
    ["NovaByte", "!join", "Already entered"],
    ["MikaWave", "!join", "Entered"],
  ];
  return (
    <div className="h-full bg-white p-4 sm:p-6">
      <div className="flex items-center justify-between border-b border-devin-line pb-4">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-devin-ink-soft">Chat giveaway · keyword !join</p>
          <p className="mt-1 text-lg font-medium">Friday giveaway</p>
        </div>
        <span className="flex items-center gap-2 text-[10px] font-medium text-devin-ink-soft">
          <span className="h-1.5 w-1.5 rounded-full bg-devin-primary" /> Open
        </span>
      </div>
      <div className="mt-5 divide-y divide-devin-line/70 rounded-[8px] border border-devin-line">
        {chat.map(([name, message, state], index) => (
          <div key={`${name}-${index}`} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-xs">
            <span>
              <span className="font-medium">{name}</span>
              <span className="ml-2 font-mono text-devin-ink-soft">{message}</span>
            </span>
            <span className={`font-mono text-[9px] uppercase tracking-[0.1em] ${state === "Entered" ? "text-devin-primary" : "text-devin-ink-soft line-through decoration-devin-ink/30"}`}>{state}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-[1fr_auto] items-center gap-4 rounded-[8px] bg-[#121111] p-4 text-white">
        <div>
          <p className="text-sm">412 entries · one per Kick account</p>
          <p className="mt-1 text-[11px] text-white/60">Second entries from the same account are ignored.</p>
        </div>
        <span className="rounded-[2px] bg-devin-primary px-3 py-2 text-[10px] font-medium">Draw winner</span>
      </div>
    </div>
  );
}

function TournamentsVisual() {
  const quarter = [["NovaByte", "RinLive"], ["MikaWave", "OrbitNoir"], ["PixelJo", "Lumen"], ["Kestrel", "Vanta"]];
  const semi = [["NovaByte", "MikaWave"], ["Lumen", "Kestrel"]];
  const Match = ({ players, winner }: { players: string[]; winner?: string }) => (
    <div className="overflow-hidden rounded-[6px] border border-devin-line bg-white">
      {players.map((name) => (
        <div key={name} className={`flex items-center justify-between px-2.5 py-1.5 text-[11px] ${name === winner ? "font-medium text-devin-ink" : "text-devin-ink-soft"}`}>
          {name}
          {name === winner && <span className="h-1.5 w-1.5 rounded-full bg-devin-primary" />}
        </div>
      ))}
    </div>
  );
  return (
    <div className="h-full bg-white p-4 sm:p-6">
      <div className="flex items-center justify-between border-b border-devin-line pb-4">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-devin-ink-soft">32 signed up from chat</p>
          <p className="mt-1 text-lg font-medium">Friday Cup</p>
        </div>
        <span className="rounded-[2px] bg-devin-ink px-3 py-2 text-[10px] font-medium text-white">Round 2</span>
      </div>
      <div className="mt-5 grid grid-cols-3 items-center gap-3">
        <div className="grid gap-2">
          {quarter.map((players, index) => <Match key={index} players={players} winner={["NovaByte", "MikaWave", "Lumen", "Kestrel"][index]} />)}
        </div>
        <div className="grid gap-10">
          {semi.map((players, index) => <Match key={index} players={players} winner={index === 0 ? "NovaByte" : undefined} />)}
        </div>
        <div className="grid gap-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-devin-ink-soft">Final</p>
          <Match players={["NovaByte", "TBD"]} />
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between rounded-[8px] border border-devin-line bg-devin-secondary/40 p-4">
        <span className="text-xs text-devin-ink-soft">Next match goes live</span>
        <span className="font-mono text-sm font-medium">20:30</span>
      </div>
    </div>
  );
}

function CreditsVisual() {
  const rewards = [
    ["Stream shoutout", "500 cr", "Active"],
    ["Community VIP role", "2,500 cr", "12 left"],
    ["Community coaching call", "5,000 cr", "3 left"],
  ];
  return (
    <div className="h-full bg-white p-4 sm:p-6">
      <div className="flex items-center justify-between border-b border-devin-line pb-4">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-devin-ink-soft">Credits & Shop</p>
          <p className="mt-1 text-lg font-medium">Reward catalog</p>
        </div>
        <span className="rounded-[2px] bg-devin-primary px-3 py-2 text-[10px] font-medium text-white">Add reward</span>
      </div>
      <div className="mt-5 grid gap-3">
        {rewards.map(([name, cost, state]) => (
          <div key={name} className="grid grid-cols-[1fr_auto] gap-4 rounded-[8px] border border-devin-line p-4">
            <div>
              <p className="text-sm font-medium">{name}</p>
              <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-devin-ink-soft">{state}</p>
            </div>
            <span className="self-center font-mono text-xs">{cost}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between rounded-[8px] border border-devin-line bg-devin-secondary/40 p-4">
        <span className="text-xs text-devin-ink-soft">Pending fulfilment</span>
        <span className="font-mono text-lg font-medium">07</span>
      </div>
    </div>
  );
}

function ProductVisual({ kind }: { kind: ProductKind }) {
  return (
    <div className="h-full overflow-hidden rounded-[14px] border border-devin-line bg-white">
      <div className="flex items-center gap-2 border-b border-devin-line px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-devin-secondary" />
        <span className="h-2 w-2 rounded-full bg-devin-secondary" />
        <span className="h-2 w-2 rounded-full bg-devin-secondary" />
        <span className="ml-2 font-mono text-[9px] uppercase tracking-[0.1em] text-devin-ink-soft">Illustrative product view</span>
      </div>
      <div className="h-[calc(100%-41px)]">
        {kind === "giveaways" && <GiveawaysVisual />}
        {kind === "tournaments" && <TournamentsVisual />}
        {kind === "credits" && <CreditsVisual />}
      </div>
    </div>
  );
}

export function StickyProductStory() {
  const sectionRef = useRef<HTMLElement>(null);
  const [activeProduct, setActiveProduct] = useState(0);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start center", "end center"],
  });

  useMotionValueEvent(scrollYProgress, "change", (latest) => {
    const next = Math.min(PRODUCTS.length - 1, Math.max(0, Math.round(latest * (PRODUCTS.length - 1))));
    setActiveProduct((current) => (current === next ? current : next));
  });

  return (
    <section ref={sectionRef} id="products" className="border-t border-devin-line bg-devin-secondary/35 px-6 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-3xl">
          <h2 className="text-[clamp(2.5rem,5.2vw,4.8rem)] font-medium leading-[0.98] tracking-[-0.035em] text-devin-ink">
            Three reasons viewers keep showing up.
          </h2>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-devin-ink-soft">
            Giveaways bring them in, tournaments give them something to play for, and rewards give them a reason to come back next stream.
          </p>
        </div>

        <div className="mt-16 grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
          <div>
            {PRODUCTS.map((product, index) => (
              <article key={product.kind} className="flex min-h-[56vh] items-center border-t border-devin-line py-14 first:border-t-0 lg:min-h-[68vh]">
                <div>
                  <h3 className="text-3xl font-medium leading-[1.05] tracking-[-0.025em] text-devin-ink sm:text-4xl">
                    {product.label}. {product.title}
                  </h3>
                  <p className="mt-5 max-w-lg text-base leading-relaxed text-devin-ink-soft">{product.description}</p>
                  <Link href={product.href} data-magnetic className="mt-7 inline-flex min-h-11 items-center rounded-[2px] border border-devin-line bg-white px-4 text-sm font-medium text-devin-ink transition-colors hover:border-devin-ink/40">
                    {product.action}
                    <svg aria-hidden="true" viewBox="0 0 16 16" className="ml-2 h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Link>
                  <div className="mt-8 h-[390px] lg:hidden">
                    <ProductVisual kind={product.kind} />
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="relative hidden lg:block">
            <div className="sticky top-28 h-[min(66vh,620px)]">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={PRODUCTS[activeProduct].kind}
                  initial={reduceMotion ? false : { opacity: 0, y: 24, clipPath: "inset(8% 0 0 0 round 14px)" }}
                  animate={{ opacity: 1, y: 0, clipPath: "inset(0% 0 0 0 round 14px)" }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: -18 }}
                  transition={{ duration: 0.48, ease: DEVIN_EASE }}
                  className="h-full"
                >
                  <ProductVisual kind={PRODUCTS[activeProduct].kind} />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

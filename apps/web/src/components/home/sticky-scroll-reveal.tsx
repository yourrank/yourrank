"use client";

import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion";
import { useRef, useState } from "react";
import { DEVIN_EASE } from "./reveal";

type ProductKind = "sites" | "telegram" | "credits";

interface ProductStory {
  kind: ProductKind;
  title: string;
  description: string;
  href: string;
  action: string;
}

const PRODUCTS: ProductStory[] = [
  {
    kind: "sites",
    title: "Publish the place viewers return to.",
    description: "Create a branded community site with live standings, rewards, viewer membership, and an OBS-ready overlay at one memorable address.",
    href: "/sites",
    action: "Explore Sites",
  },
  {
    kind: "telegram",
    title: "Keep the conversation moving between streams.",
    description: "Connect Telegram commands, broadcasts, and tracked offers to the same audience journey—without losing the site context.",
    href: "/telegram",
    action: "Explore Telegram",
  },
  {
    kind: "credits",
    title: "Turn participation into a reason to come back.",
    description: "Map Kick channel points to credits, publish rewards, and track every redemption through a transparent fulfilment queue.",
    href: "/credits",
    action: "Explore Credits & Shop",
  },
];

function SitesVisual() {
  return (
    <div className="h-full bg-white p-4 sm:p-6">
      <div className="flex items-center justify-between border-b border-devin-line pb-4">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-devin-ink-soft">kick-sub-race.yourrank.site</p>
          <p className="mt-1 text-lg font-medium">Community standings</p>
        </div>
        <span className="rounded-[2px] bg-devin-ink px-3 py-2 text-[10px] font-medium text-white">Published</span>
      </div>
      <div className="mt-5 overflow-hidden rounded-[8px] border border-devin-line">
        {["NovaByte", "RinLive", "MikaWave", "OrbitNoir"].map((name, index) => (
          <div key={name} className="grid grid-cols-[30px_1fr_auto] items-center border-b border-devin-line/70 px-3 py-3 text-xs last:border-b-0">
            <span className="font-mono text-devin-ink-soft">{String(index + 1).padStart(2, "0")}</span>
            <span className="font-medium">{name}</span>
            <span className="font-mono">{["9,500", "7,200", "5,400", "3,100"][index]} pts</span>
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-[8px] border border-devin-line p-4">
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-devin-ink-soft">Next event</p>
          <p className="mt-2 text-sm font-medium">Friday · 20:00</p>
        </div>
        <div className="rounded-[8px] border border-devin-primary/30 bg-devin-primary/[0.04] p-4">
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-devin-primary">Live overlay</p>
          <p className="mt-2 text-sm font-medium">Ready for OBS</p>
        </div>
      </div>
    </div>
  );
}

function TelegramVisual() {
  const messages = [
    ["Broadcast", "Reward drop goes live in 20 minutes.", "842 queued"],
    ["/rank", "Viewer rank reply is active.", "Enabled"],
    ["Tracked offer", "Friday campaign link copied 156 times.", "14 days"],
  ];
  return (
    <div className="h-full bg-white p-4 sm:p-6">
      <div className="flex items-center justify-between border-b border-devin-line pb-4">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-devin-ink-soft">Telegram operations</p>
          <p className="mt-1 text-lg font-medium">Community bot</p>
        </div>
        <span className="flex items-center gap-2 text-[10px] font-medium text-devin-ink-soft">
          <span className="h-1.5 w-1.5 rounded-full bg-devin-primary" /> Connected
        </span>
      </div>
      <div className="mt-5 divide-y divide-devin-line/70 rounded-[8px] border border-devin-line">
        {messages.map(([label, body, state]) => (
          <div key={label} className="grid gap-3 p-4 sm:grid-cols-[92px_1fr_auto] sm:items-center">
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-devin-primary">{label}</span>
            <span className="text-xs text-devin-ink">{body}</span>
            <span className="font-mono text-[9px] text-devin-ink-soft">{state}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-[8px] bg-[#121111] p-4 text-white">
        <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/50">Next broadcast</p>
        <p className="mt-2 text-sm">New shop rewards are ready. View the catalog on your community site.</p>
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
        {kind === "sites" && <SitesVisual />}
        {kind === "telegram" && <TelegramVisual />}
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
            One audience journey. Three connected products.
          </h2>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-devin-ink-soft">
            YourRank keeps the public site, Telegram activity, and viewer rewards in one operating context.
          </p>
        </div>

        <div className="mt-16 grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
          <div>
            {PRODUCTS.map((product, index) => (
              <article key={product.kind} className="flex min-h-[56vh] items-center border-t border-devin-line py-14 first:border-t-0 lg:min-h-[68vh]">
                <div>
                  <h3 className="text-3xl font-medium leading-[1.05] tracking-[-0.025em] text-devin-ink sm:text-4xl">
                    {product.kind === "sites" ? "Sites" : product.kind === "telegram" ? "Telegram" : "Credits & Shop"}. {product.title}
                  </h3>
                  <p className="mt-5 max-w-lg text-base leading-relaxed text-devin-ink-soft">{product.description}</p>
                  <a href={product.href} data-magnetic className="mt-7 inline-flex min-h-11 items-center rounded-[2px] border border-devin-line bg-white px-4 text-sm font-medium text-devin-ink transition-colors hover:border-devin-ink/40">
                    {product.action}
                    <svg aria-hidden="true" viewBox="0 0 16 16" className="ml-2 h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </a>
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

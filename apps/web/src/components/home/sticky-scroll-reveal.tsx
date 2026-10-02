"use client";

import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion";
import { useRef, useState } from "react";
import Link from "next/link";
import { DEVIN_EASE } from "./reveal";
import { ProductShot, type ProductShotKind } from "./workspace-preview";

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

const PRODUCT_SHOTS: Record<ProductKind, ProductShotKind> = {
  giveaways: "giveaways",
  tournaments: "tournaments",
  credits: "rewards",
};

function ProductVisual({ kind }: { kind: ProductKind }) {
  return <ProductShot kind={PRODUCT_SHOTS[kind]} />;
}

export function StickyProductStory() {
  const sectionRef = useRef<HTMLElement>(null);
  const articleRefs = useRef<(HTMLElement | null)[]>([]);
  const [activeProduct, setActiveProduct] = useState(0);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start center", "end center"],
  });

  useMotionValueEvent(scrollYProgress, "change", () => {
    const middle = window.innerHeight / 2;
    let next = 0;
    articleRefs.current.forEach((article, index) => {
      if (article && article.getBoundingClientRect().top <= middle) next = index;
    });
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
              <article key={product.kind} ref={(node) => { articleRefs.current[index] = node; }} className="flex min-h-[56vh] items-center border-t border-devin-line py-14 first:border-t-0 lg:min-h-[68vh]">
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
                  <div className="mt-8 lg:hidden">
                    <ProductVisual kind={product.kind} />
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="relative hidden lg:block">
            <div className="sticky top-28">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={PRODUCTS[activeProduct].kind}
                  initial={reduceMotion ? false : { opacity: 0, y: 24, clipPath: "inset(8% 0 0 0 round 14px)" }}
                  animate={{ opacity: 1, y: 0, clipPath: "inset(0% 0 0 0 round 14px)" }}
                  exit={reduceMotion ? undefined : { opacity: 0, y: -18 }}
                  transition={{ duration: 0.48, ease: DEVIN_EASE }}
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

"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import Link from "next/link";
import { DEVIN_EASE } from "./reveal";

const ROTATING_WORDS = ["regulars", "fans", "subscribers", "superfans"];
const ROTATION_INTERVAL = 2200;

export function Hero() {
  const reduceMotion = useReducedMotion();
  const [wordState, setWordState] = useState({ active: 0, previous: 0 });
  const motionEnabled = reduceMotion === false;

  useEffect(() => {
    if (!motionEnabled) return;

    const timer = window.setInterval(() => {
      setWordState((current) => ({
        active: (current.active + 1) % ROTATING_WORDS.length,
        previous: current.active,
      }));
    }, ROTATION_INTERVAL);

    return () => window.clearInterval(timer);
  }, [motionEnabled]);

  return (
    <section className="relative overflow-hidden bg-devin-surface px-6 pb-20 pt-28 sm:pb-44 sm:pt-44">
      <div className="relative mx-auto max-w-5xl text-center">
        <h1 className="mx-auto max-w-[14ch] text-[clamp(2.75rem,7vw,5.8rem)] font-medium leading-[0.96] tracking-[-0.04em] text-devin-ink">
          <span className="sr-only">Turn viewers into regulars who come back.</span>
          <span aria-hidden="true">
            <span className="block overflow-hidden pb-[0.06em]">
              <motion.span
                className="block"
                initial={reduceMotion ? false : { y: "105%", opacity: 0.35 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.82, delay: 0.08, ease: DEVIN_EASE }}
              >
                Turn viewers into
              </motion.span>
            </span>
            <span className="block pb-[0.06em]">
              <motion.span
                className="grid place-items-center text-devin-primary font-semibold"
                initial={reduceMotion ? false : { y: "0.35em", opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.58, delay: 0.17, ease: DEVIN_EASE }}
              >
                <span className="inline-grid place-items-center">
                  <span className="invisible col-start-1 row-start-1 whitespace-nowrap" aria-hidden="true">
                    subscribers
                  </span>
                  {ROTATING_WORDS.map((word, index) => (
                    <motion.span
                      key={word}
                      className="col-start-1 row-start-1 whitespace-nowrap"
                      initial={{ y: index === 0 ? 0 : "0.35em", opacity: index === 0 ? 1 : 0 }}
                      animate={{
                        y: index === wordState.active ? 0 : index === wordState.previous ? "-0.35em" : "0.35em",
                        opacity: index === wordState.active ? 1 : 0,
                      }}
                      transition={
                        motionEnabled
                          ? index === wordState.previous
                            ? { duration: 0.2, ease: DEVIN_EASE }
                            : index === wordState.active
                              ? { duration: 0.34, delay: 0.2, ease: DEVIN_EASE }
                              : { duration: 0 }
                          : { duration: 0 }
                      }
                    >
                      {word}
                    </motion.span>
                  ))}
                </span>
              </motion.span>
            </span>
            <span className="block overflow-hidden pb-[0.06em]">
              <motion.span
                className="block"
                initial={reduceMotion ? false : { y: "105%", opacity: 0.35 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.82, delay: 0.26, ease: DEVIN_EASE }}
              >
                who come back.
              </motion.span>
            </span>
          </span>
        </h1>

        <motion.p
          initial={reduceMotion ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.34, ease: DEVIN_EASE }}
          className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-devin-ink-soft sm:mt-7 sm:text-lg"
        >
          Publish a branded site, keep the conversation active on Telegram, and turn viewer participation into rewards—all from one workspace.
        </motion.p>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.46, ease: DEVIN_EASE }}
          className="mt-7 flex flex-wrap items-center justify-center gap-3 sm:mt-9"
        >
          <Link href="/signup" data-magnetic className="inline-flex min-h-12 items-center rounded-[2px] bg-devin-primary px-6 text-sm font-medium text-white transition-colors hover:bg-devin-primary-hover">
            Get started
          </Link>
          <a href="/demo" data-magnetic className="inline-flex min-h-12 items-center rounded-[2px] border border-devin-line bg-white px-6 text-sm font-medium text-devin-ink transition-colors hover:border-devin-ink/40">
            Explore the live demo
          </a>
        </motion.div>

        <motion.a
          href="/sites"
          data-magnetic
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.58, ease: DEVIN_EASE }}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full border border-devin-line bg-white py-1.5 pl-2 pr-4 text-xs text-devin-ink"
        >
          <span className="rounded-full bg-devin-primary px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-white">Live</span>
          See the connected suite
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 text-devin-ink-soft" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 12 12 4M6 4h6v6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </motion.a>
      </div>
    </section>
  );
}

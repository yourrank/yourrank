"use client";

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { PolicyLinks } from "../policy-links";

const FOOTER_LINKS = [
  ["Sites", "/sites"],
  ["Telegram", "/telegram"],
  ["Credits & Shop", "/credits"],
  ["Pricing", "/pricing"],
  ["FAQ", "/faq"],
] as const;

const LOOP_WORDS = ["Publish", "Activate", "Reward", "Return"];

export function MotionFooter() {
  const wrapperRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const wordmarkRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    gsap.registerPlugin(ScrollTrigger);
    const context = gsap.context(() => {
      gsap.fromTo(
        wordmarkRef.current,
        { yPercent: 24, opacity: 0.18 },
        {
          yPercent: 0,
          opacity: 0.52,
          ease: "none",
          scrollTrigger: { trigger: wrapper, start: "top bottom", end: "bottom bottom", scrub: 0.8 },
        },
      );
      gsap.fromTo(
        [titleRef.current, actionsRef.current],
        { y: 42, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          stagger: 0.12,
          ease: "power3.out",
          scrollTrigger: { trigger: wrapper, start: "top 68%", end: "top 30%", scrub: 0.55 },
        },
      );
    }, wrapper);

    return () => context.revert();
  }, []);

  return (
    <section ref={wrapperRef} className="yr-footer-reveal relative h-[82vh] min-h-[620px] overflow-hidden bg-[#121111] text-white [clip-path:inset(0)]">
      <footer className="yr-cinematic-footer fixed inset-x-0 bottom-0 flex h-[82vh] min-h-[620px] flex-col overflow-hidden bg-[#121111] text-white">
        <div className="border-y border-white/12 py-3">
          <div className="animate-marquee flex w-max items-center font-mono text-[10px] uppercase tracking-[0.18em] text-white/55 motion-reduce:animate-none">
            {[...LOOP_WORDS, ...LOOP_WORDS, ...LOOP_WORDS, ...LOOP_WORDS].map((word, index) => (
              <span key={`${word}-${index}`} className="flex items-center gap-7 px-3">
                {word}
                <span className="h-1 w-1 rounded-full bg-devin-primary" />
              </span>
            ))}
          </div>
        </div>

        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
          <h2 ref={titleRef} className="max-w-4xl text-[clamp(3rem,7vw,6rem)] font-medium leading-[0.94] tracking-[-0.04em]">
            Build the place your viewers return to.
          </h2>
          <div ref={actionsRef} className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup" data-magnetic className="inline-flex min-h-12 items-center rounded-[2px] bg-devin-primary px-6 text-sm font-medium text-white transition-colors hover:bg-devin-primary-hover">
              Get started
            </Link>
            <a href="/demo" data-magnetic className="inline-flex min-h-12 items-center rounded-[2px] border border-white/24 px-6 text-sm font-medium text-white transition-colors hover:border-white/55">
              Explore the live demo
            </a>
          </div>
          <p className="mt-6 text-sm text-white/48">No code or hosting required.</p>
        </div>

        <div className="relative z-10 border-t border-white/12 px-6 py-5">
          <PolicyLinks />
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-xs text-white/48 sm:flex-row">
            <span>© YourRank · Entertainment and community engagement only.</span>
            <nav aria-label="Footer navigation" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
              {FOOTER_LINKS.map(([label, href]) => (
                <Link key={label} href={href} className="inline-flex min-h-11 items-center transition-colors hover:text-white">{label}</Link>
              ))}
            </nav>
          </div>
        </div>

        <div ref={wordmarkRef} aria-hidden="true" className="pointer-events-none absolute -bottom-[0.13em] left-1/2 -translate-x-1/2 select-none whitespace-nowrap text-[22vw] font-semibold leading-none tracking-[-0.07em] text-transparent [-webkit-text-stroke:1px_rgba(255,255,255,0.16)]">
          YOURRANK
        </div>
      </footer>
    </section>
  );
}

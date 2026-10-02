"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import { WorkspacePreview } from "./workspace-preview";

export function WorkspaceScrollReveal() {
  const sectionRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });

  const rotateX = useTransform(scrollYProgress, [0.02, 0.38, 0.7], [13, 0, 0]);
  const scale = useTransform(scrollYProgress, [0.02, 0.38, 0.72], [0.88, 1, 1]);
  const translateY = useTransform(scrollYProgress, [0.02, 0.38, 0.72], [84, 0, -34]);

  return (
    <section
      ref={sectionRef}
      aria-label="YourRank workspace demonstration"
      className="relative -mt-20 h-[66rem] overflow-clip bg-devin-surface px-3 sm:-mt-28 sm:h-[78rem] sm:px-6"
    >
      <div className="sticky top-[72px] flex h-[calc(100vh-72px)] items-center justify-center [perspective:1400px]">
        <motion.div
          style={{
            rotateX: reduceMotion ? 0 : rotateX,
            scale: reduceMotion ? 1 : scale,
            y: reduceMotion ? 0 : translateY,
          }}
          className="w-full max-w-[1160px] origin-top will-change-transform"
        >
          <div className="mb-3 flex items-center justify-between px-1 font-mono text-[10px] uppercase tracking-[0.14em] text-devin-ink-soft sm:mb-4">
            <span>One place for every stream event</span>
            <span className="hidden sm:inline">Scroll to enter</span>
          </div>
          <WorkspacePreview />
        </motion.div>
      </div>
    </section>
  );
}

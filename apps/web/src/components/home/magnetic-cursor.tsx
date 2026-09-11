"use client";

import gsap from "gsap";
import { useEffect, useRef, type ReactNode } from "react";

const CURSOR_SIZE = 18;

// DEF-11: users who prefer standard pointer dynamics can disable the
// trailing accent from the header toggle. The preference persists in
// localStorage and applies on the next mount via the same key.
export const CURSOR_EFFECTS_EVENT = "yr-cursor-effects-change";

export function cursorEffectsEnabled(): boolean {
  try {
    return localStorage.getItem("yr-cursor-effects") !== "off";
  } catch {
    return true;
  }
}

export function MagneticCursor({ children }: { children: ReactNode }) {
  const cursorRef = useRef<HTMLDivElement>(null);
  const pulseRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const finePointer = window.matchMedia("(pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!finePointer.matches || reducedMotion.matches) return;

    const cursor = cursorRef.current;
    const pulse = pulseRef.current;
    if (!cursor || !pulse) return;

    const releaseMagnetic = (element: HTMLElement | null) => {
      if (!element) return;
      gsap.to(element, {
        x: 0,
        y: 0,
        duration: 0.65,
        ease: "elastic.out(1, 0.45)",
        overwrite: true,
      });
    };

    const activate = () => {
      document.documentElement.dataset.yrCursor = "active";
      gsap.set(cursor, { xPercent: -50, yPercent: -50, x: -80, y: -80, opacity: 0 });
      gsap.set(pulse, { xPercent: -50, yPercent: -50, opacity: 0 });

      const moveX = gsap.quickTo(cursor, "x", { duration: 0.24, ease: "power3.out" });
      const moveY = gsap.quickTo(cursor, "y", { duration: 0.24, ease: "power3.out" });
      let activeMagnetic: HTMLElement | null = null;

      const onPointerMove = (event: PointerEvent) => {
        moveX(event.clientX);
        moveY(event.clientY);
        gsap.to(cursor, { opacity: 1, duration: 0.18, overwrite: "auto" });

        const target = event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-magnetic]")
          : null;

        if (target !== activeMagnetic) {
          releaseMagnetic(activeMagnetic);
          activeMagnetic = target;
          gsap.to(cursor, {
            scale: target ? 2.35 : 1,
            backgroundColor: target ? "rgba(34, 0, 255, 0.18)" : "#2200FF",
            borderColor: target ? "#2200FF" : "transparent",
            duration: 0.28,
            ease: "power3.out",
            overwrite: "auto",
          });
        }

        if (activeMagnetic) {
          const rect = activeMagnetic.getBoundingClientRect();
          const x = event.clientX - (rect.left + rect.width / 2);
          const y = event.clientY - (rect.top + rect.height / 2);
          gsap.to(activeMagnetic, {
            x: x * 0.12,
            y: y * 0.12,
            duration: 0.3,
            ease: "power3.out",
            overwrite: true,
          });
        }
      };

      const onPointerDown = (event: PointerEvent) => {
        gsap.set(pulse, {
          x: event.clientX,
          y: event.clientY,
          width: CURSOR_SIZE,
          height: CURSOR_SIZE,
          opacity: 0.55,
          scale: 0.7,
        });
        gsap.to(pulse, {
          opacity: 0,
          scale: 3.8,
          duration: 0.42,
          ease: "power2.out",
          overwrite: true,
        });
        gsap.to(cursor, {
          scale: activeMagnetic ? 1.8 : 0.68,
          duration: 0.1,
          yoyo: true,
          repeat: 1,
          overwrite: "auto",
        });
      };

      const hide = () => gsap.to(cursor, { opacity: 0, duration: 0.2 });
      const show = () => gsap.to(cursor, { opacity: 1, duration: 0.2 });

      window.addEventListener("pointermove", onPointerMove, { passive: true });
      window.addEventListener("pointerdown", onPointerDown, { passive: true });
      document.addEventListener("mouseleave", hide);
      document.addEventListener("mouseenter", show);

      return () => {
        releaseMagnetic(activeMagnetic);
        delete document.documentElement.dataset.yrCursor;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerdown", onPointerDown);
        document.removeEventListener("mouseleave", hide);
        document.removeEventListener("mouseenter", show);
      };
    };

    let deactivate: (() => void) | null = cursorEffectsEnabled() ? activate() : null;

    const onPreferenceChange = () => {
      if (cursorEffectsEnabled() && !deactivate) deactivate = activate();
      else if (!cursorEffectsEnabled() && deactivate) {
        deactivate();
        deactivate = null;
      }
    };
    window.addEventListener(CURSOR_EFFECTS_EVENT, onPreferenceChange);

    return () => {
      window.removeEventListener(CURSOR_EFFECTS_EVENT, onPreferenceChange);
      deactivate?.();
    };
  }, []);

  return (
    <>
      <div
        ref={cursorRef}
        aria-hidden="true"
        className="yr-magnetic-cursor"
      />
      <div ref={pulseRef} aria-hidden="true" className="yr-cursor-pulse" />
      {children}
    </>
  );
}

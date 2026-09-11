"use client";

import { MarketingShell } from "@/components/site-shell";
import Link from "next/link";
import { useEffect } from "react";

// DEF-04: Missing error.tsx — runtime errors were showing raw Next.js crash screen.
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[YourRank] Page error:", error);
  }, [error]);

  return (
    <MarketingShell>
      <section className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center gap-6">
        <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-devin-ink-soft">
          Something went wrong
        </p>
        <h1 className="text-[clamp(2rem,5vw,3.5rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-ink">
          An unexpected error occurred.
        </h1>
        <p className="max-w-sm text-sm text-devin-ink-soft leading-relaxed">
          Our team has been notified. You can try refreshing the page or go back
          to the home page.
        </p>
        {error.digest && (
          <p className="text-xs font-mono text-devin-ink-soft opacity-60">
            Error ID: {error.digest}
          </p>
        )}
        <div className="flex flex-wrap gap-3 justify-center">
          <button onClick={reset} className="btn btn--primary" type="button">
            Try again
          </button>
          <Link href="/" className="btn btn--ghost">Go home</Link>
        </div>
      </section>
    </MarketingShell>
  );
}

import { MarketingShell } from "@/components/site-shell";
import Link from "next/link";

// DEF-04: Missing not-found.tsx — was showing raw Next.js 404 with no shell.
export default function NotFound() {
  return (
    <MarketingShell>
      <section className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center gap-6">
        <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-devin-ink-soft">
          404 — Page Not Found
        </p>
        <h1 className="text-[clamp(2rem,5vw,3.5rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-ink">
          This page doesn&apos;t exist.
        </h1>
        <p className="max-w-sm text-sm text-devin-ink-soft leading-relaxed">
          The link may be broken, the page may have moved, or you may have
          mistyped the address.
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Link href="/" className="btn btn--primary">Go home</Link>
          <Link href="/docs" className="btn btn--ghost">Documentation</Link>
          <Link href="/faq" className="btn btn--ghost">Help &amp; FAQ</Link>
        </div>
      </section>
    </MarketingShell>
  );
}

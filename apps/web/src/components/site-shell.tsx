"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { brandLogoSvg } from "@yourrank/shared/brand-assets";

const NAV_LINKS = [
  { label: "How it works", href: "/#loop" },
  { label: "Products", href: "/#products" },
  { label: "Demo", href: "/demo" },
  { label: "Pricing", href: "/pricing" },
  { label: "FAQ", href: "/faq" },
];

export function BrandMark() {
  return <span dangerouslySetInnerHTML={{ __html: brandLogoSvg({ className: "h-6 w-[110px]" }) }} />;
}

export function SiteHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isCurrent = (href: string) => !href.includes("#") && pathname === href;

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-devin-line bg-devin-surface/95 backdrop-blur-sm">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6 sm:h-[72px]" aria-label="Main navigation">
        <a
          href="/"
          className="text-[15px] font-semibold tracking-tight text-devin-ink"
          aria-label="YourRank home"
        >
          <BrandMark />
        </a>
        <div className="hidden items-center gap-7 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              aria-current={isCurrent(link.href) ? "page" : undefined}
              className="text-sm text-devin-ink-soft transition-colors hover:text-devin-ink"
            >
              {link.label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <a
            href="/login"
            className="hidden min-h-11 items-center text-sm text-devin-ink-soft transition-colors hover:text-devin-ink sm:inline-flex"
          >
            Sign in
          </a>
          <a
            href="/signup"
            className="inline-flex min-h-11 items-center rounded-[2px] bg-devin-primary px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-devin-primary-hover"
          >
            Get started
          </a>
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-[2px] border border-devin-line text-devin-ink md:hidden"
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMobileOpen((open) => !open)}
          >
            <span aria-hidden="true" className="grid gap-1">
              <span className="block h-px w-4 bg-current" />
              <span className="block h-px w-4 bg-current" />
              <span className="block h-px w-4 bg-current" />
            </span>
          </button>
        </div>
      </nav>
      {mobileOpen && (
        <nav
          id="mobile-navigation"
          className="border-t border-devin-line bg-devin-surface px-6 py-4 md:hidden"
          aria-label="Mobile navigation"
        >
          <div className="mx-auto grid max-w-6xl">
            {NAV_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                aria-current={isCurrent(link.href) ? "page" : undefined}
                className="flex min-h-11 items-center border-b border-devin-line text-sm text-devin-ink-soft last:border-b-0 hover:text-devin-ink"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <a href="/login" className="flex min-h-11 items-center text-sm font-medium text-devin-ink" onClick={() => setMobileOpen(false)}>
              Sign in
            </a>
          </div>
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-devin-line bg-devin-surface px-6 py-12">
      <div className="mx-auto grid max-w-6xl gap-10 sm:grid-cols-[1fr_auto_auto]">
        <div>
          <a href="/" className="text-[15px] font-semibold tracking-tight text-devin-ink">
            <BrandMark />
          </a>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-devin-ink-soft">
            Sites, Telegram, and viewer rewards in one connected community suite.
          </p>
        </div>
        <div className="grid content-start gap-2 text-sm">
          <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-devin-ink-soft">Products</p>
          <a href="/sites" className="text-devin-ink hover:text-devin-primary">Sites</a>
          <a href="/telegram" className="text-devin-ink hover:text-devin-primary">Telegram</a>
          <a href="/credits" className="text-devin-ink hover:text-devin-primary">Credits &amp; Shop</a>
          <a href="/overlays" className="text-devin-ink hover:text-devin-primary">Overlays</a>
        </div>
        <div className="grid content-start gap-2 text-sm">
          <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-devin-ink-soft">Company</p>
          <a href="/pricing" className="text-devin-ink hover:text-devin-primary">Pricing</a>
          <a href="/switch" className="text-devin-ink hover:text-devin-primary">Why switch</a>
          <a href="/about" className="text-devin-ink hover:text-devin-primary">About</a>
          <a href="/docs" className="text-devin-ink hover:text-devin-primary">Docs</a>
          <a href="/faq" className="text-devin-ink hover:text-devin-primary">FAQ</a>
          <a href="/changelog" className="text-devin-ink hover:text-devin-primary">Changelog</a>
          <a href="/status" className="text-devin-ink hover:text-devin-primary">Status</a>
          <a href="/brand" className="text-devin-ink hover:text-devin-primary">Brand</a>
          <a href="/contact" className="text-devin-ink hover:text-devin-primary">Contact</a>
        </div>
      </div>
      <div className="mx-auto mt-10 flex max-w-6xl flex-col justify-between gap-3 border-t border-devin-line pt-5 text-xs text-devin-ink-soft sm:flex-row">
        <span>© YourRank · contact@yourrank.site</span>
        <span className="font-mono">18+ · Entertainment only. Play responsibly.</span>
      </div>
    </footer>
  );
}

export function MarketingShell({ children, footer = true }: { children: ReactNode; footer?: boolean }) {
  return (
    <div className="min-h-screen bg-devin-surface text-devin-ink">
      <a
        href="#main-content"
        className="fixed left-4 top-3 z-[60] -translate-y-24 rounded-[2px] bg-devin-ink px-4 py-3 text-sm font-medium text-white transition-transform focus:translate-y-0"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main-content" tabIndex={-1}>{children}</main>
      {footer && <SiteFooter />}
    </div>
  );
}

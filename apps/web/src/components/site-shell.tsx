"use client";

import { PolicyLinks } from "./policy-links";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { brandLogoSvg } from "@yourrank/shared/brand-assets";
import { cursorEffectsEnabled, CURSOR_EFFECTS_EVENT } from "./home/magnetic-cursor";

// DEF-12: These are internal Next.js App Router routes — use <Link> for
// client-side transitions and prefetching. External / worker-hosted routes
// (/login, /signup, /dashboard, /demo) must stay as plain <a> tags since
// they are served by a different Cloudflare Worker origin.
const NAV_LINKS = [
  { label: "How it works", href: "/#loop" },
  { label: "Products", href: "/#products" },
  { label: "Pricing", href: "/pricing" },
  { label: "FAQ", href: "/faq" },
];

export function BrandMark() {
  return <span dangerouslySetInnerHTML={{ __html: brandLogoSvg({ className: "h-6 w-[110px]" }) }} />;
}

// DEF-11: users who prefer standard pointer dynamics can turn the magnetic
// cursor accent off. The choice persists in localStorage and is applied by
// the MagneticCursor effect immediately via a custom event.
function CursorToggle() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    setEnabled(cursorEffectsEnabled());
    const sync = () => setEnabled(cursorEffectsEnabled());
    window.addEventListener(CURSOR_EFFECTS_EVENT, sync);
    return () => window.removeEventListener(CURSOR_EFFECTS_EVENT, sync);
  }, []);

  const toggle = () => {
    const next = !cursorEffectsEnabled();
    try { localStorage.setItem("yr-cursor-effects", next ? "on" : "off"); } catch { /* private mode */ }
    window.dispatchEvent(new Event(CURSOR_EFFECTS_EVENT));
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enabled}
      className="hidden min-h-11 items-center text-sm text-devin-ink-soft transition-colors hover:text-devin-ink lg:inline-flex"
      title={enabled ? "Turn off cursor effects" : "Turn on cursor effects"}
    >
      {enabled ? "Effects on" : "Effects off"}
    </button>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isCurrent = (href: string) => !href.includes("#") && pathname === href;

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-devin-line bg-devin-surface/95 backdrop-blur-sm">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6 sm:h-[72px]" aria-label="Main navigation">
        <Link
          href="/"
          className="text-[15px] font-semibold tracking-tight text-devin-ink"
          aria-label="YourRank home"
        >
          <BrandMark />
        </Link>
        <div className="hidden items-center gap-7 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              aria-current={isCurrent(link.href) ? "page" : undefined}
              className="text-sm text-devin-ink-soft transition-colors hover:text-devin-ink"
            >
              {link.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {/* /demo, /login and /signup are worker-hosted — keep plain <a> */}
          <CursorToggle />
          <a
            href="/demo"
            className="hidden min-h-11 items-center text-sm text-devin-ink-soft transition-colors hover:text-devin-ink md:inline-flex"
          >
            Demo
          </a>
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
              <Link
                key={link.label}
                href={link.href}
                aria-current={isCurrent(link.href) ? "page" : undefined}
                className="flex min-h-11 items-center border-b border-devin-line text-sm text-devin-ink-soft last:border-b-0 hover:text-devin-ink"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            {/* /demo and /login are worker-hosted — keep plain <a> */}
            <a href="/demo" className="flex min-h-11 items-center text-sm font-medium text-devin-ink" onClick={() => setMobileOpen(false)}>
              Demo
            </a>
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
          <Link href="/" className="text-[15px] font-semibold tracking-tight text-devin-ink">
            <BrandMark />
          </Link>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-devin-ink-soft">
            Sites, Telegram, and viewer rewards in one connected community suite.
          </p>
        </div>
        <div className="grid content-start gap-2 text-sm">
          <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-devin-ink-soft">Products</p>
          <Link href="/sites" className="text-devin-ink hover:text-devin-primary">Sites</Link>
          <Link href="/telegram" className="text-devin-ink hover:text-devin-primary">Telegram</Link>
          <Link href="/credits" className="text-devin-ink hover:text-devin-primary">Credits &amp; Shop</Link>
          <Link href="/overlays" className="text-devin-ink hover:text-devin-primary">Overlays</Link>
        </div>
        <div className="grid content-start gap-2 text-sm">
          <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-devin-ink-soft">Company</p>
          <Link href="/pricing" className="text-devin-ink hover:text-devin-primary">Pricing</Link>
          <Link href="/switch" className="text-devin-ink hover:text-devin-primary">Why switch</Link>
          <Link href="/about" className="text-devin-ink hover:text-devin-primary">About</Link>
          <Link href="/docs" className="text-devin-ink hover:text-devin-primary">Docs</Link>
          <Link href="/faq" className="text-devin-ink hover:text-devin-primary">FAQ</Link>
          <Link href="/changelog" className="text-devin-ink hover:text-devin-primary">Changelog</Link>
          <Link href="/status" className="text-devin-ink hover:text-devin-primary">Status</Link>
          <Link href="/brand" className="text-devin-ink hover:text-devin-primary">Brand</Link>
        </div>
      </div>
      <div className="mx-auto mt-10 flex max-w-6xl flex-col justify-between gap-3 border-t border-devin-line pt-5 text-xs text-devin-ink-soft sm:flex-row">
        <span>© YourRank · contact@yourrank.site</span>
        <PolicyLinks />
        <span className="font-mono">18+ · Entertainment only. Play responsibly.</span>
      </div>
    </footer>
  );
}

function useFragmentFocus() {
  useEffect(() => {
    const focusFragment = () => {
      const fragment = window.location.hash.slice(1);
      if (!fragment) return;

      let id: string;
      try {
        id = decodeURIComponent(fragment);
      } catch {
        return;
      }

      const target = document.getElementById(id);
      if (target instanceof HTMLElement) target.focus();
    };

    focusFragment();
    window.addEventListener("hashchange", focusFragment);
    return () => window.removeEventListener("hashchange", focusFragment);
  }, []);
}

export function MarketingShell({ children, footer = true }: { children: ReactNode; footer?: boolean }) {
  useFragmentFocus();

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

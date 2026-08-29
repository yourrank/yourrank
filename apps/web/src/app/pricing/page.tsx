import type { Metadata } from "next";
import { MagneticCursor } from "../../components/home/magnetic-cursor";
import { MarketingShell } from "../../components/site-shell";
import { PricingPlans } from "./pricing-plans";

export const metadata: Metadata = {
  title: "Pricing · YourRank",
  description: "Free, Pro, and Team plans for creator communities, with clear active-viewer and operational limits.",
  alternates: { canonical: "https://yourrank.site/pricing" },
};

const BILLING_FAQ = [
  {
    q: "What is an active viewer?",
    a: "A signed-in Viewer Account that takes a verified community action during the preceding rolling 30 days. The same viewer counts once across every site you own.",
  },
  {
    q: "What happens if Free goes over 200 active viewers?",
    a: "You get a 14-day grace period. Viewers keep access, memberships, credits, orders, and participation. If usage remains over 200 after grace, only new creator-side expansion is paused until usage falls or the plan is upgraded.",
  },
  {
    q: "Can I pay for Pro or Team today?",
    a: "Recurring card checkout is not available yet. We will only activate paid access through a verified billing provider; no crypto fallback or automatic charge is used.",
  },
  {
    q: "Do viewers pay?",
    a: "No. Viewer Accounts, memberships, earned credits, orders, privacy, and ordinary participation remain available without a viewer charge.",
  },
];

export default function PricingPage() {
  return (
    <MagneticCursor>
      <MarketingShell>
        <main>
          <section className="px-6 pb-14 pt-32 sm:pb-18 sm:pt-40">
            <div className="mx-auto max-w-6xl">
              <h1 className="max-w-[15ch] text-[clamp(2.75rem,6.5vw,5.2rem)] font-medium leading-[0.98] tracking-[-0.035em] text-devin-ink">
                Start free. Add operating room when the community grows.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-devin-ink-soft">
                Plans scale with distinct signed-in viewers active across your account in the last 30 days. Viewer access is never switched off because a creator exceeds an allowance.
              </p>
            </div>
          </section>

          <PricingPlans />

          <section className="px-6 py-20 sm:py-24">
            <div className="mx-auto max-w-6xl">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <h2 className="text-3xl font-medium tracking-[-0.02em] text-devin-ink sm:text-4xl">Billing questions.</h2>
                <a href="/faq" className="text-sm font-medium text-devin-ink underline decoration-devin-line underline-offset-4 hover:decoration-devin-primary">
                  Read the product FAQ
                </a>
              </div>
              <dl className="mt-10 border-t border-devin-line">
                {BILLING_FAQ.map((item) => (
                  <div key={item.q} className="grid gap-3 border-b border-devin-line py-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                    <dt className="text-lg font-medium text-devin-ink">{item.q}</dt>
                    <dd className="max-w-xl text-[15px] leading-relaxed text-devin-ink-soft">{item.a}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-14 flex justify-center">
                <a href="/signup?plan=free" data-magnetic className="inline-flex min-h-12 items-center rounded-[2px] bg-devin-primary px-7 py-3.5 text-sm font-medium text-white transition-colors hover:bg-devin-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-devin-primary">
                  Start free
                </a>
              </div>
            </div>
          </section>
        </main>
      </MarketingShell>
    </MagneticCursor>
  );
}

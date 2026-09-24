import Link from "next/link";
import type { Metadata } from "next";
import { MagneticCursor } from "@/components/home/magnetic-cursor";
import { MarketingShell } from "@/components/site-shell";
import { getPlanLimit } from "@yourrank/shared/plans";

const FREE_PLAYERS = getPlanLimit("free", "players_per_site").toLocaleString("en-US");
const FREE_VIEWERS = getPlanLimit("free", "active_viewers_30d").toLocaleString("en-US");
const FREE_MAPPINGS = getPlanLimit("free", "reward_mappings");
const FREE_SHOP_ITEMS = getPlanLimit("free", "shop_items");

export const metadata: Metadata = {
  title: "FAQ — YourRank",
  description: "Frequently asked questions about YourRank: leaderboards, Telegram bot, viewer rewards, pricing, and support.",
  alternates: { canonical: "https://yourrank.site/faq" },
};

const PAYMENT_METHODS_ANSWER =
  "Card checkout with Polar is live for monthly and annual billing. Paid access is activated only after a verified Polar confirmation; you can cancel anytime from the customer portal.";

const FAQ_GROUPS: Array<{ category: string; items: Array<{ q: string; a: string }> }> = [
  {
    category: "Product",
    items: [
      { q: "What is YourRank?", a: "YourRank is an all-in-one suite for streamers and communities. It includes three products: branded leaderboards, a Telegram bot with tracked offers, and a viewer Rewards & Shop powered by Kick channel points." },
      { q: "What are the three products?", a: "Leaderboards let you publish a branded public race. The Telegram bot publishes tracked offers, broadcasts, and commands for your community. Rewards & Shop lets viewers earn credits from Kick channel-point redemptions and spend them in your shop." },
      { q: "Do I need to write code?", a: "No. YourRank runs entirely in the browser and on Cloudflare. You create a page, customize it, and share the URL. The Telegram bot and Kick connection are configured from the dashboard." },
    ],
  },
  {
    category: "Viewers & rewards",
    items: [
      { q: "How do viewers earn credits?", a: "Streamers connect a Kick channel and create credit rules for channel-point rewards. When a viewer redeems a reward on Kick, YourRank credits the viewer automatically." },
      { q: "Can viewers log in?", a: "Yes. Viewers can sign in with their Kick or Discord account. They log in at /me to see their balance across boards and redeem shop items." },
    ],
  },
  {
    category: "Pricing & billing",
    items: [
      { q: "Is YourRank free?", a: `Yes. Free includes one site, up to ${FREE_PLAYERS} leaderboard players, ${FREE_VIEWERS} distinct active viewers in the rolling 30-day account window, ${FREE_MAPPINGS} reward mappings, and ${FREE_SHOP_ITEMS} shop items. Pro and Team add truthful operational capacity and existing paid capabilities.` },
      { q: "What payment methods do you accept?", a: PAYMENT_METHODS_ANSWER },
    ],
  },
  {
    category: "Support",
    items: [
      { q: "How do I get support?", a: "Email support@yourrank.site or use the contact form at /help/support." },
    ],
  },
];

const ALL_FAQS = FAQ_GROUPS.flatMap((group) => group.items);

const faqStructuredData = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: ALL_FAQS.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
});

export default function FaqPage() {
  return (
    <MagneticCursor>
      <MarketingShell>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqStructuredData }} />
        <section className="px-6 pb-12 pt-32 sm:pt-40">
          <div className="mx-auto max-w-3xl">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-devin-primary">FAQ</p>
            <h1 className="mt-4 text-[clamp(2.5rem,6vw,4rem)] font-medium leading-[1.02] tracking-[-0.03em]">
              Frequently asked questions.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-devin-ink-soft">
              Quick answers about the YourRank suite. Can&apos;t find what you need?{" "}
              <Link href="/help/support" className="text-devin-ink underline underline-offset-4 hover:text-devin-primary">Contact support</Link>.
            </p>
          </div>
        </section>
        <section className="px-6 pb-24 sm:pb-32">
          <div className="mx-auto max-w-3xl">
            {FAQ_GROUPS.map((group) => (
              <div key={group.category} className="mt-12 first:mt-4">
                <h2 className="font-mono text-[11px] uppercase tracking-widest text-devin-ink-soft">{group.category}</h2>
                <dl className="mt-4 divide-y divide-devin-line border-y border-devin-line">
                  {group.items.map((item) => (
                    <div key={item.q} className="py-6">
                      <dt className="text-lg font-medium">{item.q}</dt>
                      <dd className="mt-3 max-w-2xl leading-relaxed text-devin-ink-soft">{item.a}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
            <div className="mt-14 flex flex-wrap items-center gap-4">
              <Link href="/signup" data-magnetic className="inline-flex min-h-11 items-center rounded-[2px] bg-devin-primary px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-devin-primary-hover">Create your free page</Link>
              <Link href="/pricing" className="text-sm text-devin-ink-soft underline-offset-4 hover:text-devin-ink hover:underline">See pricing &rarr;</Link>
            </div>
          </div>
        </section>
      </MarketingShell>
    </MagneticCursor>
  );
}

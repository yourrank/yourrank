import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Hero } from "@/components/home/hero";
import {
  ComparisonSection,
  HowItWorks,
  PricingSnapshot,
  ProofMarquee,
} from "@/components/home/sections";
import { MagneticCursor } from "@/components/home/magnetic-cursor";
import { WorkspaceScrollReveal } from "@/components/home/container-scroll-animation";
import { StickyProductStory } from "@/components/home/sticky-scroll-reveal";
import { MotionFooter } from "@/components/home/motion-footer";
import { MarketingShell } from "@/components/site-shell";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "YourRank — Giveaways, tournaments & rewards for Kick streamers",
  description:
    "Run giveaways and tournaments from Kick chat, keep entries to one per Kick account, and give viewers rewards worth coming back for.",
  openGraph: {
    title: "YourRank — Giveaways, tournaments & rewards for Kick streamers",
    description:
      "Run giveaways and tournaments from Kick chat, keep entries to one per Kick account, and give viewers rewards worth coming back for.",
    url: "https://yourrank.site/",
    type: "website",
    images: ["https://yourrank.site/og.png"],
  },
  alternates: {
    canonical: "https://yourrank.site/",
  },
};

export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) {
    redirect("/dashboard");
  }

  return (
    <MagneticCursor>
      <MarketingShell footer={false}>
        <Hero />
        <WorkspaceScrollReveal />
        <ProofMarquee />
        <StickyProductStory />
        <HowItWorks />
        <ComparisonSection />
        <PricingSnapshot />
        <MotionFooter />
      </MarketingShell>
    </MagneticCursor>
  );
}

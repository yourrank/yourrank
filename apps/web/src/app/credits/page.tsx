import type { Metadata } from "next";
import { ProductPage } from "@/components/product-page";

export const metadata: Metadata = {
  title: "Credits & Shop — YourRank",
  description: "Connect viewer participation to credits, balances, rewards, redemptions, and fulfilment in one site-scoped workspace.",
  alternates: { canonical: "https://yourrank.site/credits" },
};

export default function CreditsPage() {
  return <ProductPage content={{
    kind: "credits",
    title: "Make every act of participation count.",
    intro: "Connect safe participation to viewer balances, a reward catalog, claims, and a fulfilment trail your team can follow.",
    outcome: "A visible path from participation to reward.",
    steps: [
      { number: "01", title: "Define how credits work", body: "Configure site-scoped earning rules and keep viewer balances connected to the right community." },
      { number: "02", title: "Build the reward catalog", body: "Add inventory and redemption details so viewers understand what is available and what it costs." },
      { number: "03", title: "Complete the handoff", body: "Track queued, processing, and completed fulfilment states without presenting entertainment credits as cash or prizes." },
    ],
  }} />;
}

import type { Metadata } from "next";
import { ProductPage } from "@/components/product-page";

export const metadata: Metadata = {
  title: "Sites — YourRank",
  description: "Launch a branded community site with live standings, rewards, viewer membership, and an OBS-ready overlay.",
  alternates: { canonical: "https://yourrank.site/sites" },
};

export default function SitesPage() {
  return <ProductPage content={{
    kind: "sites",
    title: "Give your community a place worth returning to.",
    intro: "Publish a branded destination where viewers can follow standings, join your community, and reach their rewards without losing the thread.",
    outcome: "From a blank page to a live community destination.",
    steps: [
      { number: "01", title: "Choose the experience", body: "Set the public sections your viewers need: home content, leaderboard, rewards, and viewer access." },
      { number: "02", title: "Make it yours", body: "Apply your name, visuals, links, offers, and challenge details while keeping every state easy to scan." },
      { number: "03", title: "Publish and share", body: "Launch at a YourRank address or connected custom domain, then use the OBS-ready overlay on stream." },
    ],
  }} />;
}

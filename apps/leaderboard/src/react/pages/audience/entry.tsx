import { defineIsland } from "../../lib/island";
import { AudiencePage } from "./page";
import type { AudienceTab } from "./types";

const TABS: AudienceTab[] = ["viewers", "history", "reviews", "linked"];
const island = defineIsland<{ tab: AudienceTab }>("audience-app", AudiencePage, () => {
  const tab = document.getElementById("audience-app")?.getAttribute("data-audience-tab") || "viewers";
  return { tab: TABS.includes(tab as AudienceTab) ? tab as AudienceTab : "viewers" };
});

export const enter = island.enter;
export const leave = island.leave;

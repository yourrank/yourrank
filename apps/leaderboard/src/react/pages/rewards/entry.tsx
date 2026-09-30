import { defineIsland } from "../../lib/island";
import { RewardsPage } from "./page";
import type { RewardsTab } from "./types";
import "./styles.css";

const TABS: RewardsTab[] = ["channel", "overview", "rules", "shop", "redemptions"];
const island = defineIsland<{ tab: RewardsTab }>("cr-app", RewardsPage, () => {
  const tab = document.getElementById("cr-app")?.getAttribute("data-cr-tab") || "overview";
  return { tab: TABS.includes(tab as RewardsTab) ? tab as RewardsTab : "overview" };
});

export const enter = island.enter;
export const leave = island.leave;

import { defineIsland } from "../../lib/island";
import { GiveawaysPage } from "./page";

const island = defineIsland("giveaway-root", GiveawaysPage, () => ({
  initialTab: document.getElementById("giveaway-root")?.getAttribute("data-tab") || "chat",
}));

export const enter = island.enter;
export const leave = island.leave;

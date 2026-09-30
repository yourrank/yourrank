import { defineIsland } from "../../lib/island";
import { AudiencePage } from "./page";
import type { AudienceTab } from "./types";

const tab = (document.getElementById("audience-app")?.getAttribute("data-audience-tab") || "viewers") as AudienceTab;
const island = defineIsland("audience-app", () => <AudiencePage tab={tab} />);

export const enter = island.enter;
export const leave = island.leave;

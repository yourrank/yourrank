import { defineIsland } from "../../lib/island";
import { TournamentsPage } from "./page";

const island = defineIsland("tournament-root", TournamentsPage);

export const enter = island.enter;
export const leave = island.leave;

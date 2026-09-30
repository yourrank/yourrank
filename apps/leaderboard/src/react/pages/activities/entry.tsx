import { defineIsland } from "../../lib/island";
import { ActivitiesPage, setActivitiesPageDependenciesForTests } from "./page";

const island = defineIsland("activities-root", ActivitiesPage);

export { setActivitiesPageDependenciesForTests };
export const enter = island.enter;
export const leave = island.leave;

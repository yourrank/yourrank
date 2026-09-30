import { defineIsland } from "../../lib/island";
import { SettingsPage } from "./page";

const island = defineIsland("acc-app", SettingsPage);

export const enter = island.enter;
export const leave = island.leave;

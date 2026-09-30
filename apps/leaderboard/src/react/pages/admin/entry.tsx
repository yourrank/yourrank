import { defineIsland } from "../../lib/island";
import { AdminPage } from "./page";
import "./styles.css";

const island = defineIsland("admin-app", AdminPage);

export const enter = island.enter;
export const leave = island.leave;

import { defineIsland } from "../../lib/island";
import { AdminTwoFactorPage } from "./page";
import "./styles.css";

const island = defineIsland("admin-2fa-app", AdminTwoFactorPage);

export const enter = island.enter;
export const leave = island.leave;

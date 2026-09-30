import "./dashboard/command-palette.js";
import { state as dashboardState } from "./dashboard/state.js";
import { sitePath, siteQuery } from "./dashboard/board-shell.js";

let rewardsIslandPromise;
let audienceModulePromise;
let generation = 0;
let activeModule;

function getModule() {
  const tab = document.getElementById("cr-app")?.dataset.crTab || "";
  if (tab === "viewers" || tab === "history") {
    audienceModulePromise ||= import("./audience-credits.js");
    return audienceModulePromise;
  }
  rewardsIslandPromise ||= import("./react/rewards.js");
  return rewardsIslandPromise;
}

export async function enter() {
  const ticket = ++generation;
  const module = await getModule();
  if (ticket !== generation) return;
  activeModule = module;
  module.enter();
}

export function leave() {
  generation += 1;
  activeModule?.leave();
  activeModule = undefined;
}

export function applyOAuthContext() {
  const siteId = siteQuery() || dashboardState.ACTIVE_SITE_ID || "";
  const href = sitePath("/auth/kick", siteId);
  for (const id of ["cr-channel-connect", "cr-channel-reconnect"]) {
    const link = document.getElementById(id);
    if (link) link.href = href;
  }
}

if (!window.__yrSpaShell) {
  const boot = () => {
    enter().catch((error) => console.error("[credits] page failed to mount:", error));
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
}

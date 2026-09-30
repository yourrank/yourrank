import "./dashboard/command-palette.js";

let islandPromise;
let generation = 0;
let active = false;

function getIsland() {
  islandPromise ||= import("./react/giveaways.js");
  return islandPromise;
}

export async function enter() {
  active = true;
  const ticket = ++generation;
  const island = await getIsland();
  if (active && ticket === generation) island.enter();
}

export function leave() {
  active = false;
  generation += 1;
  if (islandPromise) void islandPromise.then((island) => island.leave());
}

if (!window.__yrSpaShell) {
  const boot = () => {
    enter().catch((error) => {
      window.__yrBoot?.fail(error instanceof Error ? error.message : "The Giveaways React page could not be loaded.");
      console.error("[giveaways] React island failed to mount:", error);
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
}

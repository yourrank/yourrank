let islandPromise;
let generation = 0;
let active = false;

function getIsland() {
  islandPromise ||= import("./react/admin.js");
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
  const boot = () => { enter().catch((error) => console.error("[admin] React island failed to mount:", error)); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
}

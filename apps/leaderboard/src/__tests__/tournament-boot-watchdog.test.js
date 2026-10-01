import { afterAll, afterEach, expect, it } from "bun:test";
import { actAndFlush, document, restoreTournamentDomGlobals, window } from "./tournament-react-utils.js";
import { renderGiveawaysHtml } from "../pages/giveaway-pages.js";

let tournamentsShim;
let previousBoot;
let previousSpaShell;

afterEach(async () => {
  if (tournamentsShim) {
    await actAndFlush(() => tournamentsShim.leave());
    tournamentsShim = null;
  }
  window.__yrBoot = previousBoot;
  window.__yrSpaShell = previousSpaShell;
});

afterAll(restoreTournamentDomGlobals);

it("signals boot after the Tournaments island enters in the SPA shell", async () => {
  previousBoot = window.__yrBoot;
  previousSpaShell = window.__yrSpaShell;
  window.__yrSpaShell = true;
  document.body.innerHTML = renderGiveawaysHtml("tournaments");
  let signalCount = 0;
  const failures = [];
  window.__yrBoot = {
    signal: () => { signalCount += 1; },
    fail: (message) => { failures.push(message); },
  };

  tournamentsShim = await import("../assets/tournaments.js");
  await actAndFlush(() => tournamentsShim.enter());

  expect(signalCount).toBe(1);
  expect(failures).toEqual([]);
});

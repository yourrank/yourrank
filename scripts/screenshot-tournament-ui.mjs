// Screenshot pass for the tournament rebuild (spec-mandated captures into
// .local-logs/tournament-rebuild/). Uses the same fixture variants as
// verify-tournament-bracket.mjs.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href);

const OUT = ".local-logs/tournament-rebuild";
const BIN = process.env.FIXTURE_BIN || "bun";
await mkdir(OUT, { recursive: true });

async function startFixture(variant, port) {
  const proc = spawn(BIN, ["scripts/dashboard-polish-fixtures.mjs"], {
    env: { ...process.env, FIXTURE_TOURNAMENT: variant, FIXTURE_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("fixture timeout")), 15000);
    proc.stdout.on("data", (b) => { if (String(b).includes(String(port))) { clearTimeout(t); resolve(); } });
    proc.on("exit", (c) => { clearTimeout(t); reject(new Error(`exit ${c}`)); });
  });
  return proc;
}

const browser = await chromium.launch({ headless: true });

const jobs = [
  { variant: "completed8", port: 8980, shots: [
    { name: "completed8-entries-1440", tab: "entries", w: 1440 },
    { name: "completed8-bracket-1440", tab: "bracket", w: 1440 },
    { name: "completed8-full-bracket-1440", tab: "bracket", w: 1440, expand: true },
    { name: "completed8-settings-1440", tab: "settings", w: 1440 },
    { name: "completed8-bracket-390", tab: "bracket", w: 390 },
    { name: "completed8-entries-390", tab: "entries", w: 390 },
  ] },
  { variant: "live16", port: 8981, shots: [
    { name: "live16-bracket-1440", tab: "bracket", w: 1440 },
    { name: "live16-full-bracket-1440", tab: "bracket", w: 1440, expand: true },
  ] },
  { variant: "live4", port: 8982, shots: [
    { name: "live4-bracket-1440", tab: "bracket", w: 1440 },
  ] },
];

for (const job of jobs) {
  const fixture = await startFixture(job.variant, job.port);
  try {
    const page = await browser.newPage({ colorScheme: "dark" });
    page.on("pageerror", (e) => console.log("pageerror:", e.message));
    await page.route("https://**/*", (r) => r.abort());
    await page.goto(`http://127.0.0.1:${job.port}/dashboard/giveaways/tournaments`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#tournament-workspace:not([hidden])", { timeout: 15000 });
    for (const shot of job.shots) {
      await page.setViewportSize({ width: shot.w, height: 900 });
      await page.click(`[data-tournament-tab="${shot.tab}"]`);
      if (shot.expand) {
        await page.click("#tournament-bracket-expand");
        await page.waitForSelector("#tournament-bracket-modal", { timeout: 15000 });
      }
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${shot.name}.png`, ...(shot.expand ? {} : { fullPage: true }) });
      console.log("shot", shot.name);
      if (shot.expand) await page.click("#tournament-bracket-close");
    }
    await page.close();
  } finally {
    fixture.kill();
  }
}
await browser.close();
await writeFile(`${OUT}/_done.txt`, "ok\n");
console.log("done");

import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import {
  OVERLAY_DESIGN_DEFAULT,
  buildOverlayPath,
  normalizeOverlayDesign,
  previewPath,
} from "../assets/dashboard/overlay-designer.js";
import { overlayPage } from "../pages/overlay.js";

// P4-2: live visual overlay designer — the designer composes x/y/scale into
// the public overlay URL, so the contract tested here is: normalized designs,
// a URL that round-trips into canvas-mode overlay rendering, and an honest
// demo fallback for free plans.

const DATA = {
  brand: { name: "Test Board", period: "Monthly" },
  branding: {},
  players: [{ name: "Ana", score: 30 }, { name: "Bo", score: 10 }],
};

describe("overlay design normalization", () => {
  it("falls back to the centered default card", () => {
    expect(normalizeOverlayDesign(null)).toEqual(OVERLAY_DESIGN_DEFAULT);
    expect(normalizeOverlayDesign({})).toEqual(OVERLAY_DESIGN_DEFAULT);
    expect(normalizeOverlayDesign({ x: "junk", y: NaN, scale: "nope" })).toEqual(OVERLAY_DESIGN_DEFAULT);
  });

  it("clamps position and scale into the designer's safe range", () => {
    expect(normalizeOverlayDesign({ x: -20, y: 480, scale: 9 })).toEqual({ layout: "card", x: 5, y: 95, scale: 2, animate: true });
    expect(normalizeOverlayDesign({ x: 12.4, y: 88.6, scale: 0.4 })).toEqual({ layout: "card", x: 12.4, y: 88.6, scale: 0.5, animate: true });
  });

  it("defaults animation to ON and only turns it off for an explicit false", () => {
    expect(OVERLAY_DESIGN_DEFAULT.animate).toBe(true);
    expect(normalizeOverlayDesign({}).animate).toBe(true);
    expect(normalizeOverlayDesign({ animate: "junk" }).animate).toBe(true);
    expect(normalizeOverlayDesign({ animate: false }).animate).toBe(false);
    expect(normalizeOverlayDesign({ animate: 0 }).animate).toBe(false);
    expect(normalizeOverlayDesign({ animate: "0" }).animate).toBe(false);
  });

  it("centers the ticker bar horizontally because it spans the canvas", () => {
    expect(normalizeOverlayDesign({ layout: "ticker", x: 10, y: 90 }).x).toBe(50);
    expect(normalizeOverlayDesign({ layout: "ticker", y: 90 }).y).toBe(90);
  });
});

describe("overlay URL composition", () => {
  it("encodes the whole design in the public overlay path", () => {
    expect(buildOverlayPath("streamer", { layout: "ticker", y: 82 }))
      .toBe("/streamer/overlay?layout=ticker&x=50&y=82&scale=1&animate=1");
    expect(buildOverlayPath("streamer", { x: 25.55, y: 70, scale: 1.25 }))
      .toBe("/streamer/overlay?layout=card&x=25.6&y=70&scale=1.25&animate=1");
  });

  it("encodes Animation OFF as animate=0 in the copied OBS link and the preview", () => {
    expect(buildOverlayPath("streamer", { animate: false })).toContain("&animate=0");
    expect(previewPath("streamer", { animate: false }, { plan: "team" })).toBe("/streamer/overlay?layout=card&x=50&y=50&scale=1&animate=0");
    expect(previewPath("streamer", { animate: false }, { plan: "free" })).toBe("/demo/overlay?layout=card&x=50&y=50&scale=1&animate=0");
  });

  it("falls back to the demo overlay for free plans and keeps real sites otherwise", () => {
    expect(previewPath("streamer", { x: 30, y: 40 }, { plan: "free" })).toContain("/demo/overlay?");
    expect(previewPath("streamer", { x: 30, y: 40 }, { plan: "pro" })).toContain("/streamer/overlay?");
    expect(previewPath("streamer", { x: 30, y: 40 }, {})).toContain("/streamer/overlay?");
  });
});

describe("overlay canvas mode", () => {
  it("renders a full-canvas page that positions the widget at the composed spot", () => {
    const html = overlayPage(DATA, { slug: "streamer", canvas: true, x: 22, y: 78, scale: 1.25 });
    expect(html).toContain("width:100vw;height:100vh;");
    expect(html).toContain("left:22%;top:78%;");
    expect(html).toContain("scale(1.25)");
  });

  it("pins the ticker bar vertically and leaves non-canvas pages unchanged", () => {
    const ticker = overlayPage(DATA, { slug: "streamer", layout: "ticker", canvas: true, y: 15 });
    expect(ticker).toContain(".ov-ticker-bar{position:fixed;left:0;top:15%;transform:translateY(-50%);}");
    const plain = overlayPage(DATA, { slug: "streamer" });
    expect(plain).not.toContain("width:100vw");
    expect(plain).toContain("width:320px");
  });

  it("survives hostile param values via clamping", () => {
    const html = overlayPage(DATA, { slug: "streamer", canvas: true, x: "</style>", y: 1e9, scale: -3 });
    expect(html).toContain("left:50%;top:100%;");
    expect(html).not.toContain("</style><script");
  });
});

describe("overlay animation setting", () => {
  const runtime = readFileSync(new URL("../assets/overlay.js", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../index.js", import.meta.url), "utf8");

  it("defaults to animated and passes animate=0 through the ov-config element", () => {
    expect(overlayPage(DATA, { slug: "streamer" })).toContain('data-animate="1"');
    expect(overlayPage(DATA, { slug: "streamer" })).toContain("<body>");
    const off = overlayPage(DATA, { slug: "streamer", animate: false });
    expect(off).toContain('data-animate="0"');
    expect(off).toContain('<body class="ov-static">');
    expect(off).toContain("body.ov-static .ov-row,body.ov-static .ov-ticker-item{transition:none !important;animation:none !important}");
    expect(worker).toContain('animate: url.searchParams.get("animate") !== "0"');
  });

  it("skips FLIP, entry, and score-flash motion when animation is off", () => {
    expect(runtime).toContain('const ANIMATE = (_cfg?.dataset?.animate ?? "1") !== "0";');
    expect(runtime).toContain('ANIMATE && movedUp ? "ov-moved-up" : ANIMATE && movedDown ? "ov-moved-down" : ""');
    expect(runtime).toContain('ANIMATE && scoreChanged ? "ov-score-flash" : ""');
    expect(runtime).toContain('ANIMATE && isNew ? "ov-enter" : ""');
    // Both FLIP passes (First, and Last+Invert+Play) are gated.
    expect(runtime.match(/if \(ANIMATE\) container\.querySelectorAll\("\.ov-row"\)/g)).toHaveLength(2);
    // ON keeps the existing engine untouched.
    expect(runtime).toContain("const TRANSITION_MS = 600;");
    expect(runtime).toContain("transform ${TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)");
  });
});

describe("designer surface wiring", () => {
  const jsx = readFileSync(new URL("../pages/dashboard.jsx", import.meta.url), "utf8");

  it("is the one Leaderboard overlay section in the Share tab with a single Copy OBS link", () => {
    const designerIndex = jsx.indexOf('id="overlayDesignerCard"');
    expect(designerIndex).toBeGreaterThan(-1);
    expect(jsx.indexOf('data-egroup="share"', designerIndex - 400)).toBeGreaterThan(-1);
    expect(jsx).toContain("<h3>Leaderboard overlay</h3>");
    expect(jsx).toContain('<option value="card">Podium card</option>');
    expect(jsx).toContain('<option value="ticker">Ticker bar</option>');
    expect(jsx).toContain('<label for="odAnimate">Animation</label>');
    expect(jsx).toContain('id="odAnimate" type="checkbox" role="switch" checked');
    // One canonical OBS copy action; the standalone HUD/alerts/ticker cards are gone.
    expect(jsx.match(/Copy OBS link/gi)).toHaveLength(1);
    for (const gone of ["OBS_TOOLS", "Live Betting Overlay", "Stream Alerts", "Leaderboard Bar", "ov-btn-copy-ticker", "ov-btn-copy-pred-hud", "ov-btn-copy-alerts", 'id="embedObsCopy"']) {
      expect(jsx.includes(gone), gone).toBe(false);
    }
    // The public-site link keeps its own copy action because it serves a different purpose.
    expect(jsx).toContain('id="embedPublicCopy"');
  });

  it("keeps drag, keyboard, and numeric input paths wired to the same state", () => {
    const src = readFileSync(
      new URL("../assets/dashboard/overlay-designer.js", import.meta.url),
      "utf8",
    );
    expect(src).toContain("pointerdown");
    expect(src).toContain('e.key === "ArrowLeft"');
    expect(src).toContain("odX");
    expect(src).toContain("buildOverlayPath(slug(), design)");
    expect(src).toContain("design.animate = animateCb.checked;");
    expect(src).toContain('if (animateCb) animateCb.checked = design.animate;');
  });
});

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
    expect(normalizeOverlayDesign({ x: -20, y: 480, scale: 9 })).toEqual({ layout: "card", x: 5, y: 95, scale: 2 });
    expect(normalizeOverlayDesign({ x: 12.4, y: 88.6, scale: 0.4 })).toEqual({ layout: "card", x: 12.4, y: 88.6, scale: 0.5 });
  });

  it("centers the ticker bar horizontally because it spans the canvas", () => {
    expect(normalizeOverlayDesign({ layout: "ticker", x: 10, y: 90 }).x).toBe(50);
    expect(normalizeOverlayDesign({ layout: "ticker", y: 90 }).y).toBe(90);
  });
});

describe("overlay URL composition", () => {
  it("encodes the whole design in the public overlay path", () => {
    expect(buildOverlayPath("streamer", { layout: "ticker", y: 82 }))
      .toBe("/streamer/overlay?layout=ticker&x=50&y=82&scale=1");
    expect(buildOverlayPath("streamer", { x: 25.55, y: 70, scale: 1.25 }))
      .toBe("/streamer/overlay?layout=card&x=25.6&y=70&scale=1.25");
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

describe("designer surface wiring", () => {
  const jsx = readFileSync(new URL("../pages/dashboard.jsx", import.meta.url), "utf8");

  it("mounts the designer inside the Share tab next to the OBS tools", () => {
    const obsIndex = jsx.indexOf("OBS_TOOLS }}");
    const designerIndex = jsx.indexOf('id="overlayDesignerCard"');
    expect(designerIndex).toBeGreaterThan(-1);
    expect(designerIndex).toBeGreaterThan(obsIndex);
    expect(jsx.indexOf('data-egroup="share"', designerIndex - 400)).toBeGreaterThan(-1);
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
  });
});

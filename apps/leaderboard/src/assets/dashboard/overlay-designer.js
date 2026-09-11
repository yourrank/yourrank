// P4-2: Live visual overlay designer. A 16:9 stream canvas in the Share tab:
// drag the overlay (or use arrow keys / numeric inputs) to position it, pick
// widget and scale, and copy the composed OBS browser-source URL. The preview
// frame renders the real overlay page, so what you arrange is what streams.
// Position/scale travel in the URL (x/y/scale params), so nothing has to be
// persisted server-side — the copied link is the whole configuration.
import { $, copyToClipboard, showToast } from "./utils.js";
import { state } from "./state.js";

const STORAGE_KEY = "yr-overlay-designer";

export const OVERLAY_DESIGN_DEFAULT = { layout: "card", x: 50, y: 50, scale: 1 };
export const OVERLAY_SCALE_STEPS = [0.75, 1, 1.25, 1.5];

/** Validate/clamp a stored or user-provided design object. */
export function normalizeOverlayDesign(input) {
  const src = input && typeof input === "object" ? input : {};
  const layout = src.layout === "ticker" ? "ticker" : "card";
  const safeNumber = (v, dflt) => (Number.isFinite(v) ? v : dflt);
  const scale = safeNumber(clamp(src.scale, 0.5, 2, 1), 1);
  const x = safeNumber(clamp(src.x, 5, 95, 50), 50);
  const y = safeNumber(clamp(src.y, 5, 95, 50), 50);
  return {
    layout,
    // The ticker bar spans the full canvas width; only the height applies.
    x: layout === "ticker" ? 50 : x,
    y,
    scale,
  };
}

function clamp(n, min, max, dflt) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : dflt;
}

/** Public overlay path with the designer's canvas params encoded. */
export function buildOverlayPath(slug, design) {
  const d = normalizeOverlayDesign(design);
  const params = new URLSearchParams();
  params.set("layout", d.layout);
  params.set("x", String(Math.round(d.x * 10) / 10));
  params.set("y", String(Math.round(d.y * 10) / 10));
  params.set("scale", String(d.scale));
  return `/${encodeURIComponent(slug || "demo")}/overlay?${params.toString()}`;
}

/** What the preview frame shows: real site when the plan allows it, demo otherwise. */
export function previewPath(slug, design, { plan } = {}) {
  const paid = plan !== undefined ? plan !== "free" : true;
  if (paid) return buildOverlayPath(slug, design);
  return buildOverlayPath("demo", design);
}

function loadDesign() {
  try {
    return normalizeOverlayDesign(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null"));
  } catch {
    return { ...OVERLAY_DESIGN_DEFAULT };
  }
}

function saveDesign(design) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(design));
  } catch {
    /* private mode — the designer still works, it just forgets */
  }
}

/** Init the designer inside the Share tab. Safe to call repeatedly. */
export function initOverlayDesigner() {
  const root = $("overlayDesigner");
  if (!root || root._designerWired) return;
  root._designerWired = true;

  const canvas = $("odCanvas");
  const frame = $("odFrame");
  const handle = $("odHandle");
  const layoutSel = $("odLayout");
  const scaleSel = $("odScale");
  const xInput = $("odX");
  const yInput = $("odY");
  const copyBtn = $("odCopy");
  const resetBtn = $("odReset");
  const hint = $("odHint");
  if (!canvas || !frame || !handle) return;

  let design = loadDesign();
  let frameTimer = null;

  const slug = () => state.SLUG || "";

  function syncFrame() {
    clearTimeout(frameTimer);
    frameTimer = setTimeout(() => {
      const next = previewPath(slug(), design, { plan: state.ME?.plan });
      if (frame.getAttribute("src") !== next) frame.setAttribute("src", next);
    }, 350);
  }

  function positionHandle() {
    handle.style.left = `${design.x}%`;
    handle.style.top = `${design.y}%`;
    handle.setAttribute("aria-valuetext", `${Math.round(design.x)}%, ${Math.round(design.y)}%`);
  }

  function render({ save = true } = {}) {
    design = normalizeOverlayDesign(design);
    if (layoutSel) layoutSel.value = design.layout;
    if (scaleSel) scaleSel.value = String(design.scale);
    if (xInput) xInput.value = String(Math.round(design.x));
    if (yInput) yInput.value = String(Math.round(design.y));
    handle.classList.toggle("is-ticker", design.layout === "ticker");
    positionHandle();
    syncFrame();
    if (save) saveDesign(design);
  }

  function moveBy(dx, dy) {
    design.x = clamp(design.x + dx, 5, 95, 50);
    design.y = clamp(design.y + dy, 5, 95, 50);
    render();
  }

  // Pointer drag: the handle captures the pointer so moves stay smooth even
  // when the cursor races over the preview frame.
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const apply = (event) => {
      design.x = clamp(((event.clientX - rect.left) / rect.width) * 100, 5, 95);
      design.y = clamp(((event.clientY - rect.top) / rect.height) * 100, 5, 95);
      render();
    };
    const onMove = (event) => apply(event);
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    apply(e);
  });

  handle.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 5 : 1;
    let handled = true;
    if (e.key === "ArrowLeft") moveBy(-step, 0);
    else if (e.key === "ArrowRight") moveBy(step, 0);
    else if (e.key === "ArrowUp") moveBy(0, -step);
    else if (e.key === "ArrowDown") moveBy(0, step);
    else handled = false;
    if (handled) e.preventDefault();
  });

  layoutSel?.addEventListener("change", () => {
    design.layout = layoutSel.value === "ticker" ? "ticker" : "card";
    render();
  });
  scaleSel?.addEventListener("change", () => {
    design.scale = Number(scaleSel.value) || 1;
    render();
  });
  xInput?.addEventListener("change", () => {
    design.x = Number(xInput.value);
    render();
  });
  yInput?.addEventListener("change", () => {
    design.y = Number(yInput.value);
    render();
  });
  resetBtn?.addEventListener("click", () => {
    design = { ...OVERLAY_DESIGN_DEFAULT };
    render();
  });
  copyBtn?.addEventListener("click", async () => {
    try {
      await copyToClipboard(location.origin + buildOverlayPath(slug(), design));
      showToast("Composed OBS overlay URL copied to clipboard!", "info");
    } catch {
      showToast("Could not copy the URL. Select it from the share box instead.", "error");
    }
  });

  // Honest preview for free plans: the demo overlay renders sample data and
  // the live route itself upsells, so say so here rather than faking it.
  if (hint && state.ME?.plan === "free") {
    hint.innerHTML = `This preview uses sample data — live overlays are a Pro feature. <a href="/dashboard/settings/billing?from=overlay">View plans</a> to stream your real leaderboard.`;
  }

  render({ save: false });
}

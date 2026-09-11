// P4-1: Interactive creator onboarding tour — a lightweight, non-blocking
// walkthrough of the Home surface: launch checklist, players/scoring, OBS
// overlays and the Kick connection. Runs once per account per browser
// (localStorage), is skippable at every step, and can be replayed from the
// command palette or the help drawer. Navigation uses requestDashboardRoute
// so every destination stays manifest-backed — no route literals live here.
// Pure data and persistence live in tour-steps.js (unit-testable).
import { $ } from "./utils.js";
import { state } from "./state.js";
import { currentRoute, requestDashboardRoute } from "./shell.js";
import { NO_TARGET, TOUR_STEPS, hasSeenTour, markTourSeen } from "./tour-steps.js";

export { MAX_TOUR_STEPS, NO_TARGET, hasSeenTour, markTourSeen, tourSeenKey } from "./tour-steps.js";

function tourUserId() {
  return state.ME?.id || state.ME?.email || "";
}

function isSpotlightable(el) {
  return Boolean(el && el.getClientRects().length && !el.closest("[hidden]"));
}

function activeSteps() {
  return TOUR_STEPS.filter((step) => step.target === NO_TARGET || isSpotlightable($(step.target)));
}

let running = false;
let teardown = null;

/**
 * Run the tour. `force` replays it even if it was seen (command palette,
 * help drawer). Returns true when the tour actually started.
 */
export function startTour({ force = false } = {}) {
  if (running || typeof document === "undefined") return false;
  const steps = activeSteps();
  if (!steps.length) return false;
  if (!force && hasSeenTour(tourUserId())) return false;
  running = true;
  markTourSeen(tourUserId());

  const root = document.createElement("div");
  root.className = "yr-tour";
  root.innerHTML = `
    <div class="yr-tour-spot" aria-hidden="true"></div>
    <div class="yr-tour-bubble" role="dialog" aria-modal="false" aria-labelledby="yr-tour-title" aria-describedby="yr-tour-body">
      <p class="yr-tour-progress" aria-hidden="true"></p>
      <h2 id="yr-tour-title"></h2>
      <p id="yr-tour-body"></p>
      <div class="yr-tour-actions">
        <button type="button" class="yr-tour-skip">Skip tour</button>
        <span class="yr-tour-nav">
          <button type="button" class="yr-tour-back">Back</button>
          <button type="button" class="btn btn--sm btn--accent yr-tour-next"></button>
        </span>
      </div>
    </div>`;
  document.body.appendChild(root);

  const spot = root.querySelector(".yr-tour-spot");
  const bubble = root.querySelector(".yr-tour-bubble");
  const progressEl = root.querySelector(".yr-tour-progress");
  const titleEl = root.querySelector("#yr-tour-title");
  const bodyEl = root.querySelector("#yr-tour-body");
  const skipBtn = root.querySelector(".yr-tour-skip");
  const backBtn = root.querySelector(".yr-tour-back");
  const nextBtn = root.querySelector(".yr-tour-next");
  let index = 0;

  // The tour never blocks the UI: navigating anywhere (any link click)
  // ends it, with the completion already recorded above.
  const onLinkClick = (e) => {
    if (e.target.closest("a[href]")) close();
  };
  const close = () => {
    running = false;
    window.removeEventListener("resize", position);
    window.removeEventListener("scroll", position, true);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("click", onLinkClick, true);
    root.remove();
  };
  teardown = close;

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowRight" && !nextBtn.hidden) {
      nextBtn.click();
    } else if (e.key === "ArrowLeft" && !backBtn.hidden) {
      backBtn.click();
    }
  }

  function position() {
    const step = steps[index];
    if (!step.target) {
      spot.style.opacity = "0";
      centerBubble();
      return;
    }
    const el = $(step.target);
    if (!isSpotlightable(el)) return;
    spot.style.opacity = "1";
    const pad = 6;
    const rect = el.getBoundingClientRect();
    Object.assign(spot.style, {
      left: `${rect.left - pad}px`,
      top: `${rect.top - pad}px`,
      width: `${rect.width + pad * 2}px`,
      height: `${rect.height + pad * 2}px`,
    });
    const bw = bubble.offsetWidth;
    const bh = bubble.offsetHeight;
    const margin = 12;
    let left = rect.left + rect.width / 2 - bw / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - bw - margin));
    let top = rect.bottom + margin;
    if (top + bh > window.innerHeight - margin) top = rect.top - bh - margin;
    top = Math.max(margin, Math.min(top, window.innerHeight - bh - margin));
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
  }

  function centerBubble() {
    const left = (window.innerWidth - bubble.offsetWidth) / 2;
    const top = (window.innerHeight - bubble.offsetHeight) / 2;
    bubble.style.left = `${Math.max(12, left)}px`;
    bubble.style.top = `${Math.max(12, top)}px`;
  }

  function render() {
    const step = steps[index];
    const stepNumber = TOUR_STEPS.indexOf(step) + 1;
    progressEl.textContent = `Step ${stepNumber} of ${TOUR_STEPS.length}`;
    titleEl.textContent = step.title;
    bodyEl.textContent = step.body;
    const last = index === steps.length - 1;
    const hasCta = Boolean(step.ctaRoute);
    nextBtn.textContent = last && !hasCta ? "Finish" : "Next";
    nextBtn.hidden = hasCta;
    backBtn.hidden = index === 0;
    let cta = bubble.querySelector(".yr-tour-cta");
    if (hasCta && !cta) {
      cta = document.createElement("button");
      cta.type = "button";
      cta.className = "btn btn--sm btn--accent yr-tour-cta";
      bubble.querySelector(".yr-tour-nav").prepend(cta);
    }
    if (hasCta) {
      cta.textContent = step.ctaLabel || "Continue";
      cta.onclick = () => {
        close();
        requestDashboardRoute(step.ctaRoute[0], step.ctaRoute[1], { query: "" });
      };
    } else if (cta) {
      cta.remove();
    }
    if (step.target) {
      const el = $(step.target);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    requestAnimationFrame(position);
    nextBtn.focus({ preventScroll: true });
  }

  skipBtn.addEventListener("click", close);
  backBtn.addEventListener("click", () => {
    if (index > 0) {
      index -= 1;
      render();
    }
  });
  nextBtn.addEventListener("click", () => {
    if (index < steps.length - 1) {
      index += 1;
      render();
    } else {
      close();
    }
  });
  window.addEventListener("resize", position);
  window.addEventListener("scroll", position, true);
  document.addEventListener("keydown", onKey);
  document.addEventListener("click", onLinkClick, true);
  render();
  return true;
}

/** Close the tour if it is open (route changes and replay entry points). */
export function stopTour() {
  if (teardown) teardown();
}

/** Auto-start on Home for accounts that have not seen it in this browser. */
export function maybeAutoStartTour() {
  if (currentRoute().page !== "home") return false;
  return startTour({ force: false });
}

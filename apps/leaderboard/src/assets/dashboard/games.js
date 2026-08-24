import { $, getCsrf, guardAuth, logError, showToast } from "./utils.js";
import { setState, state, subscribe } from "./state.js";
import { renderError, setBlockLoading, setBlockReady } from "./states.js";
// Public page-section toggles live in Site settings → Sections now; the Games
// page only reads the flags to decide whether the public Games page exists.
import { siteSections } from "./site-sections.js";

const GAME_ROWS = [
  { key: "plinko", label: "Plinko", description: "A pachinko-style game with multiplier rewards." },
  { key: "mines", label: "Mines", description: "Reveal safe tiles and avoid the mines." },
  { key: "dice", label: "Dice", description: "Roll the dice and predict the outcome." },
  { key: "limbo", label: "Limbo", description: "", disabled: true },
];

export function setGamesPreviewState(previewBtn, enabled, liveUrl) {
  if (!previewBtn) return;
  if (enabled && liveUrl) {
    previewBtn.href = liveUrl;
    previewBtn.setAttribute("target", "_blank");
    previewBtn.setAttribute("rel", "noopener noreferrer");
    previewBtn.textContent = "Open on Public Site ↗";
    previewBtn.removeAttribute("aria-disabled");
    previewBtn.removeAttribute("role");
    previewBtn.removeAttribute("tabindex");
    previewBtn.removeAttribute("title");
    return;
  }
  previewBtn.removeAttribute("href");
  previewBtn.removeAttribute("target");
  previewBtn.removeAttribute("rel");
  previewBtn.setAttribute("role", "button");
  previewBtn.setAttribute("aria-disabled", "true");
  previewBtn.setAttribute("tabindex", "0");
  previewBtn.setAttribute("title", "Enable the Games section below to open the public Games page.");
  previewBtn.textContent = "Enable Games to open the public page";
}

function setInlineSave(input, message, isError = false) {
  const status = input.closest("[data-game]")?.querySelector("[data-game-status]");
  if (!status) return;
  status.textContent = message;
  status.dataset.state = isError ? "error" : message === "Saving…" ? "saving" : "saved";
}

function gamePayload(game, values) {
  return {
    siteId: state.ACTIVE_SITE_ID,
    game,
    enabled: !!values.enabled,
    minBet: Number(values.minBet) || 1,
    maxBet: Number(values.maxBet) || 1,
    houseEdgeBps: Number.isInteger(Number(values.houseEdgeBps)) ? Number(values.houseEdgeBps) : 100,
    dailyLossCap: values.dailyLossCap == null ? null : Number(values.dailyLossCap),
  };
}

async function saveGame(game, values, changedInput = null, previousValue = null, retryValues = values) {
  if (!state.ACTIVE_SITE_ID) return false;
  try {
    const res = await fetch("/api/site/games/settings", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", "x-csrf-token": getCsrf() },
      body: JSON.stringify(gamePayload(game, values)),
    }).then(guardAuth);
    const body = await res.json();
    if (!res.ok || !body.ok) throw new Error(body.error || "Could not save game settings.");
    if (changedInput) {
      changedInput.dataset.previous = changedInput.type === "checkbox" ? String(changedInput.checked) : changedInput.value;
      changedInput.dataset.saveError = "";
      setInlineSave(changedInput, "Saved");
      changedInput.closest("[data-game]")?.querySelector(".v3-inline-error")?.remove();
    }
    showToast("Game settings saved.", "success");
    return true;
  } catch (err) {
    logError("save-game-settings", err);
    if (changedInput) {
      const prior = previousValue ?? changedInput.dataset.previous ?? (changedInput.type === "checkbox" ? "false" : "");
      if (changedInput.type === "checkbox") changedInput.checked = prior === "true";
      else changedInput.value = prior;
      changedInput.dataset.saveError = err.message || "Could not save game settings.";
      setInlineSave(changedInput, "Couldn't save", true);
      const row = changedInput.closest("[data-game]");
      let error = row?.querySelector(".v3-inline-error");
      if (!error && row) {
        error = document.createElement("span");
        error.className = "v3-inline-error";
        row.querySelector(".v3-game-details")?.appendChild(error);
      }
      if (error) {
        error.textContent = err.message || "Could not save game settings.";
        error.setAttribute("role", "alert");
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "btn btn--xs btn--ghost";
        retry.textContent = "Retry";
        retry.addEventListener("click", () => {
          if (changedInput.type === "checkbox") changedInput.checked = !!retryValues.enabled;
          else changedInput.value = String(retryValues.maxBet ?? "");
          error.textContent = "Retrying…";
          saveGame(game, retryValues, changedInput, prior, retryValues);
        });
        error.append(" ", retry);
      }
    }
    showToast(err.message || "Could not save game settings.");
    return false;
  }
}

function renderGames(settings) {
  const list = $("gameSettingRows");
  if (!list) return;
  const byGame = new Map((settings || []).map((row) => [row.game, row]));
  list.innerHTML = GAME_ROWS.map((game) => {
    const row = byGame.get(game.key) || { enabled: false, minBet: 1, maxBet: "" , houseEdgeBps: 100, dailyLossCap: null };
    const disabled = game.disabled ? "disabled" : "";
    const details = game.disabled
      ? `<span class="v3-game-coming">Coming soon</span>`
      : `<div class="v3-game-controls" ${row.enabled ? "" : "hidden"}>
          <span class="v3-game-max"><label for="gameMax-${game.key}">Max Bet</label><input id="gameMax-${game.key}" class="v3-number-input" type="number" min="1" step="1" inputmode="numeric" placeholder="100" value="${row.maxBet || ""}" data-game-max="${game.key}" /><span>cr</span></span>
          <button type="button" class="btn btn--xs btn--ghost v3-game-test-btn" data-test-game="${game.key}">Test in preview 🎮</button>
        </div>`;
    return `<div class="v3-game-row ${game.disabled ? "is-disabled" : ""}" data-game="${game.key}">
      <div class="v3-game-main"><div><strong>${game.label}</strong><span>${game.description}</span><small class="v3-inline-save" data-game-status="${game.key}" role="status" aria-live="polite"></small></div><input class="v3-toggle" type="checkbox" data-game-toggle="${game.key}" ${row.enabled ? "checked" : ""} ${disabled} aria-label="Enable ${game.label}"></div>
      <div class="v3-game-details">${details}</div>
    </div>`;
  }).join("");
  list.querySelectorAll("[data-game-toggle]").forEach((input) => {
    input.addEventListener("change", () => {
      const game = input.dataset.gameToggle;
      const row = byGame.get(game) || { minBet: 1, maxBet: 1, houseEdgeBps: 100, dailyLossCap: null };
      const details = input.closest("[data-game]")?.querySelector(".v3-game-controls");
      if (details) details.hidden = !input.checked;
      setInlineSave(input, "Saving…");
      const previousValue = input.checked ? "false" : "true";
      saveGame(game, { ...row, enabled: input.checked }, input, previousValue);
    });
  });
  list.querySelectorAll("[data-game-max]").forEach((input) => {
    let timer;
    input.dataset.previous = input.value;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const game = input.dataset.gameMax;
        const row = byGame.get(game) || { enabled: false, minBet: 1, houseEdgeBps: 100, dailyLossCap: null };
        const maxBet = Number(input.value);
        if (!Number.isInteger(maxBet) || maxBet <= 0) {
          input.setCustomValidity("Enter a positive whole number.");
          return;
        }
        input.setCustomValidity("");
        setInlineSave(input, "Saving…");
        const previousValue = input.dataset.previous ?? input.value;
        saveGame(game, { ...row, maxBet }, input, previousValue, { ...row, maxBet });
      }, 350);
    });
  });
}

async function loadGames() {
  if (!state.ACTIVE_SITE_ID) return;
  setState({ GAMES_STATUS: "loading" });
  setBlockLoading($("gameSettingRows"), { lines: GAME_ROWS.length });
  try {
    const res = await fetch(`/api/site/games/settings?siteId=${encodeURIComponent(state.ACTIVE_SITE_ID)}`, { credentials: "include" }).then(guardAuth);
    const body = await res.json();
    if (!res.ok || !body.ok) throw new Error(body.error || "Could not load game settings.");
    setState({ GAMES_STATUS: "ready" });
    const settings = body.settings || [];
    const list = $("gameSettingRows");
    setBlockReady(list);
    renderGames(settings);
    updateSimulator();
  } catch (err) {
    setState({ GAMES_STATUS: "error" });
    logError("load-game-settings", err);
    renderError($("gameSettingRows"), { title: "Couldn't load game settings", body: "Your game settings could not be loaded.", retry: loadGames });
  }
}

let activeSimulatorGame = "mines";

/**
 * Point the simulator frame at `url` without touching the browser history:
 * assigning `src` appends an entry to the joint session history, which pollutes
 * Back and truncates the forward stack, so navigate the frame in place.
 */
function loadSimulatorFrame(iframe, url) {
  const frameWindow = iframe.contentWindow;
  if (frameWindow && typeof frameWindow.location?.replace === "function") {
    frameWindow.location.replace(url);
    return;
  }
  iframe.setAttribute("src", url);
}

function setSimulatorGame(gameId) {
  activeSimulatorGame = gameId || "mines";
  const siteId = state.ACTIVE_SITE_ID || "";
  const slug = state.SLUG || state.EXTRA?.slug || "";
  const iframe = $("gamesSimulatorIframe");
  const popout = $("gamesPopoutLink");
  const previewBtn = $("gamesPreviewBtn");

  const embedUrl = siteId
    ? `/dashboard/preview?board=${encodeURIComponent(siteId)}&section=games&embed=1&game=${encodeURIComponent(activeSimulatorGame)}`
    : (slug ? `/${encodeURIComponent(slug)}/games?embed=1&game=${encodeURIComponent(activeSimulatorGame)}` : "");
  const liveUrl = slug ? `/${encodeURIComponent(slug)}/games` : "#";

  if (iframe && embedUrl) {
    if (iframe.dataset.currentSrc !== embedUrl) {
      iframe.dataset.currentSrc = embedUrl;
      loadSimulatorFrame(iframe, embedUrl);
    }
  }
  if (popout && embedUrl) popout.href = embedUrl;
  setGamesPreviewState(previewBtn, siteSections().games && Boolean(slug), liveUrl);

  document.querySelectorAll("[data-preview-game]").forEach((tab) => {
    const isCurrent = tab.dataset.previewGame === activeSimulatorGame;
    tab.classList.toggle("is-active", isCurrent);
    tab.setAttribute("aria-selected", String(isCurrent));
  });
}

function updateSimulator() {
  setSimulatorGame(activeSimulatorGame);
}

function setupSimulator() {
  if (setupSimulator._wired) return;
  setupSimulator._wired = true;

  subscribe((keys) => {
    if (keys.includes("SLUG") || keys.includes("ACTIVE_SITE_ID") || keys.includes("GAMES_STATUS")) {
      updateSimulator();
    }
  });

  document.querySelectorAll("[data-preview-game]").forEach((tab) => {
    tab.addEventListener("click", () => {
      setSimulatorGame(tab.dataset.previewGame);
    });
  });

  const reloadBtn = $("gamesReloadPreview");
  reloadBtn?.addEventListener("click", () => {
    const iframe = $("gamesSimulatorIframe");
    if (iframe && iframe.dataset.currentSrc) {
      loadSimulatorFrame(iframe, iframe.dataset.currentSrc + "&_t=" + Date.now());
      showToast("Preview reloaded", "success");
    }
  });

  document.addEventListener("click", (e) => {
    const testBtn = e.target.closest("[data-test-game]");
    if (!testBtn) return;
    const game = testBtn.getAttribute("data-test-game");
    if (game) {
      setSimulatorGame(game);
      $("gamesSimulatorIframe")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  });
}

// Called on every visit to the Games section, so the rendering and data load
// re-run to keep the section fresh. The one-time wiring (simulator listeners)
// guards itself. This replaces the old `yr-games-visible` event, which existed
// only because the section could not be re-initialized directly.
export function initGames() {
  if (!initGames._loaded) setBlockLoading($("gameSettingRows"), { lines: GAME_ROWS.length });
  initGames._loaded = true;
  loadGames();
  setupSimulator();
  updateSimulator();
}

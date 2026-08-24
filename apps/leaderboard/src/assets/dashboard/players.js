// Player table, CSV/paste import, and row management.
import { $, esc, logError, parseAmount, showConfirmModal } from "./utils.js";
import { state, markDirty, subscribe, clearDirty } from "./state.js";

export const PLAYER_NAME_LIMIT = 80;
const SCORE_MAX = 9_999_999_999_999.99;
const WIN_RATE_MAX = 999.99;
const INT32_MAX = 2_147_483_647;

function normalizePlayerIdentity(value) {
  return String(value || "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function playerNameSegments(value) {
  const text = String(value || "");
  if (typeof Intl?.Segmenter === "function") {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), ({ segment }) => segment);
  }
  return Array.from(text);
}

export function truncatePlayerName(value, max = PLAYER_NAME_LIMIT) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  return playerNameSegments(text).slice(0, max).join("");
}
const PLAYER_DRAFT_PREFIX = "yourrank:players-draft:";
const PLAYER_NUMBER_FIELDS = [
  { key: "wagered", selector: ".p-wager", label: "Amount", money: true },
  { key: "prize", selector: ".p-prize", label: "Prize", money: true },
  { key: "score", selector: ".p-score", label: "Score", max: SCORE_MAX },
  { key: "hands", selector: ".p-hands", label: "Hands played", integer: true, max: INT32_MAX },
  { key: "netProfit", selector: ".p-net-profit", label: "Net profit", signed: true, max: SCORE_MAX },
  { key: "winRate", selector: ".p-win-rate", label: "Win rate", signed: true, max: WIN_RATE_MAX },
  { key: "change", selector: ".p-change", label: "Change", signed: true, integer: true, max: INT32_MAX },
];

/**
 * Commit a change to the in-memory draft through one path. markDirty() keeps
 * the save bar and preview in sync; the status region is the existing live
 * announcement surface for the result.
 */
export function commitDraftMutation(mutation, message = "Changes made. Save to publish.") {
  const result = typeof mutation === "function" ? mutation() : undefined;
  markDirty();
  if (message) {
    const status = $("status");
    if (status) {
      status.textContent = typeof message === "function" ? message(result) : message;
      status.hidden = false;
      status.setAttribute("aria-live", "polite");
    }
  }
  return result;
}

function currencySymbol() {
  return String($("f_currency")?.value || "$").trim().slice(0, 6) || "$";
}

function formatMoney(value) {
  const amount = parseAmount(value);
  return `${currencySymbol()}${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function parsePlayerNumber(value, { signed = false, integer = false, max = SCORE_MAX } = {}) {
  const raw = String(value ?? "");
  if (!raw.trim()) return { ok: true, empty: true, value: 0 };
  const normalized = raw.replace(/[$,\s]/g, "");
  const pattern = signed ? /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/ : /^(?:\d+(?:\.\d*)?|\.\d+)$/;
  const range = signed ? `between -${max.toLocaleString("en-US")} and ${max.toLocaleString("en-US")}` : `from 0 to ${max.toLocaleString("en-US")}`;
  if (!pattern.test(normalized)) return { ok: false, message: `Enter a number ${range}.` };
  const number = Number(normalized);
  if (!Number.isFinite(number) || (!signed && number < 0) || Math.abs(number) > max) return { ok: false, message: `Enter a number ${range}.` };
  if (integer && !Number.isInteger(number)) return { ok: false, message: "Enter a whole number." };
  return { ok: true, empty: false, value: number };
}

function errorElement(input) {
  return input?.closest("td")?.querySelector(`[data-field-error="${input.dataset.field || input.id || input.className}"]`)
    || input?.closest("td")?.querySelector(".field-err");
}

function warningElement(input) {
  return input?.closest("td")?.querySelector(`[data-field-warning="${input.dataset.field || input.id || input.className}"]`)
    || input?.closest("td")?.querySelector(".field-warn");
}

export function setPlayerFieldError(input, message) {
  if (!input) return;
  const error = errorElement(input);
  if (message) input.setAttribute("aria-invalid", "true");
  else input.removeAttribute("aria-invalid");
  if (error) {
    error.textContent = message || "";
    error.hidden = !message;
  }
}

function setPlayerFieldWarning(input, message) {
  const warning = warningElement(input);
  if (warning) {
    warning.textContent = message || "";
    warning.hidden = !message;
  }
}

function clearPlayerFieldError(input) {
  setPlayerFieldError(input, "");
}

function showMoneyValue(input) {
  const raw = input.value.trim();
  const parsed = parsePlayerNumber(raw);
  if (!parsed.ok) {
    setPlayerFieldError(input, parsed.message);
    return false;
  }
  clearPlayerFieldError(input);
  if (raw) input.value = formatMoney(parsed.value);
  return true;
}

function showMoneyEditor(input, rules = {}) {
  if (!input.value.trim()) return;
  const parsed = parsePlayerNumber(input.value, rules);
  if (!parsed.ok) return;
  input.value = String(parsed.value);
  input.select();
}

function validatePlayerNumberInput(input, { money = false, ...rules } = {}) {
  const parsed = parsePlayerNumber(input?.value, rules);
  if (!parsed.ok) {
    setPlayerFieldError(input, parsed.message);
    return false;
  }
  clearPlayerFieldError(input);
  if (money && !parsed.empty) input.value = formatMoney(parsed.value);
  return true;
}

// `rules` carries the field's own signed/integer/max contract (see
// PLAYER_NUMBER_FIELDS) so live validation matches what the server accepts.
function wireNumberInput(input, { money = false, ...rules } = {}) {
  if (!input) return;
  input.addEventListener("focus", () => showMoneyEditor(input, rules));
  input.addEventListener("blur", () => validatePlayerNumberInput(input, { money, ...rules }));
  validatePlayerNumberInput(input, { money, ...rules });
}

function updateNameCounter(input) {
  if (!input) return;
  const counter = input.closest(".player-name")?.querySelector(".player-name-counter");
  if (!counter) return;
  const length = playerNameSegments(input.value).length;
  counter.textContent = `${length}/${PLAYER_NAME_LIMIT}`;
  counter.hidden = length < PLAYER_NAME_LIMIT - 20;
}

export function updateDuplicateWarnings() {
  const rows = $("rows");
  const names = new Map();
  if (rows) {
    for (const row of rows.children) {
      const input = row.querySelector(".p-name");
      const key = normalizePlayerIdentity(input?.value);
      if (key) names.set(key, (names.get(key) || 0) + 1);
    }
    for (const row of rows.children) {
      const input = row.querySelector(".p-name");
      const key = normalizePlayerIdentity(input?.value);
      const duplicate = key && names.get(key) > 1;
      setPlayerFieldWarning(input, duplicate ? `Duplicate name: “${input.value.trim()}”. Use a unique player name.` : "");
      if (duplicate) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
  }
  const quickName = $("qa_name");
  const quickKey = normalizePlayerIdentity(quickName?.value);
  const duplicate = quickKey && names.get(quickKey);
  setPlayerFieldWarning(quickName, duplicate ? `Duplicate name: “${quickName.value.trim()}”. Use the existing row instead.` : "");
}

function setPlayerMessage(id, message, { error = false } = {}) {
  const el = $(id);
  if (!el) return;
  el.textContent = message || "";
  el.hidden = !message;
  el.classList.toggle("field-err", error);
  el.classList.toggle("field-warn", !error);
  if (message) el.setAttribute("role", error ? "alert" : "status");
}

export function playerLimitMessage() {
  const limit = state.ME?.limits?.players ?? 25;
  const plan = state.ME?.plan;
  const planLabel = plan === "pro" || plan === "agency" ? "Your plan" : (plan ? `${plan[0].toUpperCase()}${plan.slice(1)}` : "Your plan");
  return `${planLabel} allows up to ${limit} players. Upgrade to add more.`;
}

export function validateQuickAddValues({ name = "", wagered = "", prize = "" } = {}) {
  const errors = [];
  if (!String(name).trim()) errors.push({ field: "name", message: "Enter a player name." });
  else {
    const key = normalizePlayerIdentity(name);
    const rows = $("rows");
    if (rows) {
      const exists = [...rows.children].some((row) => normalizePlayerIdentity(row.querySelector(".p-name")?.value) === key);
      if (exists) errors.push({ field: "name", message: `“${name.trim()}” is already on the leaderboard. Use the existing row instead.` });
    }
  }
  const wager = parsePlayerNumber(wagered);
  if (!wager.ok) errors.push({ field: "wagered", message: wager.message });
  const prizeValue = parsePlayerNumber(prize);
  if (!prizeValue.ok) errors.push({ field: "prize", message: prizeValue.message });
  return { ok: errors.length === 0, errors, wagered: wager.value, prize: prizeValue.value };
}

function playerDraftStorageKey() {
  return state.ACTIVE_SITE_ID ? `${PLAYER_DRAFT_PREFIX}${state.ACTIVE_SITE_ID}` : "";
}

function playerDraftStorage() {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function rawPlayerRows() {
  const rows = $("rows");
  if (!rows) return [];
  return [...rows.children].map((tr) => Object.fromEntries([
    ["name", tr.querySelector(".p-name")?.value || ""],
    ...PLAYER_NUMBER_FIELDS.map(({ key, selector }) => [key, tr.querySelector(selector)?.value || ""]),
  ]));
}

function rawQuickAdd() {
  return {
    name: $("qa_name")?.value || "",
    wagered: $("qa_wager")?.value || "",
    prize: $("qa_prize")?.value || "",
  };
}

export function persistPlayersDraft() {
  const key = playerDraftStorageKey();
  const storage = playerDraftStorage();
  if (!key || !storage) return;
  try {
    storage.setItem(key, JSON.stringify({ players: rawPlayerRows(), quickAdd: rawQuickAdd() }));
  } catch (err) {
    logError("players-draft-save", err);
  }
}

export function clearPlayersDraft() {
  const key = playerDraftStorageKey();
  const storage = playerDraftStorage();
  if (!key || !storage) return;
  try {
    storage.removeItem(key);
  } catch (err) {
    logError("players-draft-clear", err);
  }
}

function readPlayersDraft() {
  const key = playerDraftStorageKey();
  const storage = playerDraftStorage();
  if (!key || !storage) return null;
  try {
    const value = JSON.parse(storage.getItem(key) || "null");
    if (!value || !Array.isArray(value.players)) return null;
    return value;
  } catch (err) {
    logError("players-draft-read", err);
    return null;
  }
}

export function loadPlayersDraft() {
  return readPlayersDraft();
}

function showPlayersDraftNotice(show) {
  const notice = $("playersDraftNotice");
  if (notice) notice.hidden = !show;
}

function restoreQuickAdd(values = {}) {
  if ($("qa_name")) $("qa_name").value = values.name || "";
  if ($("qa_wager")) $("qa_wager").value = values.wagered || "";
  if ($("qa_prize")) $("qa_prize").value = values.prize || "";
  updateNameCounter($("qa_name"));
  updateDuplicateWarnings();
}

export function discardPlayersDraft({ render = renderPlayers } = {}) {
  const saved = Array.isArray(state.SAVED_PLAYERS) ? state.SAVED_PLAYERS : [];
  render(saved);
  restoreQuickAdd();
  clearPlayersDraft();
  showPlayersDraftNotice(false);
  clearDirty();
}

export function collectPlayers({ focusInvalid = false, reportErrors = true } = {}) {
  const rows = $("rows");
  const invalid = [];
  const players = rows ? [...rows.children].map((tr) => {
    const nameInput = tr.querySelector(".p-name");
    const name = nameInput?.value.trim() || "";
    const duplicateName = name && [...rows.children].filter((row) => normalizePlayerIdentity(row.querySelector(".p-name")?.value) === normalizePlayerIdentity(name)).length > 1;
    if (!name) {
      if (reportErrors) setPlayerFieldError(nameInput, "Enter a player name.");
      invalid.push({ input: nameInput, label: "Player name" });
    } else if (duplicateName) {
      if (reportErrors) setPlayerFieldError(nameInput, "Use a unique player name.");
      invalid.push({ input: nameInput, label: "Player name" });
    } else if (reportErrors) {
      setPlayerFieldError(nameInput, "");
    }
    const player = { name };
    for (const field of PLAYER_NUMBER_FIELDS) {
      const input = tr.querySelector(field.selector);
      const parsed = parsePlayerNumber(input?.value, field);
      if (!parsed.ok) {
        if (reportErrors) setPlayerFieldError(input, parsed.message);
        invalid.push({ input, label: field.label });
      } else if (reportErrors) {
        clearPlayerFieldError(input);
      }
      if (parsed.ok) {
        if (field.key === "wagered" || field.key === "prize" || !parsed.empty) player[field.key] = parsed.value;
      }
    }
    return player;
  }).filter((player) => player.name) : [];
  if (focusInvalid && invalid[0]?.input) invalid[0].input.focus();
  return { players, invalid };
}

export function validatePlayersForSave() {
  return collectPlayers({ focusInvalid: true }).invalid;
}

subscribe((keys) => {
  if (keys.includes("draft") && state.ACTIVE_SITE_ID && $("rows")) persistPlayersDraft();
});

export function playerRow(p = { name: "", wagered: "", prize: "", score: "", hands: "", netProfit: "", winRate: "", change: "" }) {
  const tr = document.createElement("tr");
  const rowId = `player-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  tr.innerHTML = `<td class="sel"><input type="checkbox" class="row-sel" title="Select" aria-label="Select player" /></td>
    <td class="rank"></td>
    <td class="player-name"><input class="p-name" placeholder="Player name" aria-label="Player name" title="${esc(p.name)}" maxlength="160" value="${esc(p.name)}" aria-describedby="${rowId}-name-counter ${rowId}-name-warning"><span class="player-name-counter" id="${rowId}-name-counter" hidden aria-live="polite"></span><span class="field-err" data-field-error="p-name" hidden role="alert" aria-live="polite"></span><span class="field-warn" data-field-warning="p-name" id="${rowId}-name-warning" hidden role="status" aria-live="polite"></span></td>
    <td class="num"><input class="p-wager" data-field="p-wager" aria-label="Amount for ${esc(p.name || "player")}" inputmode="decimal" placeholder="0" value="${esc(p.wagered)}" aria-describedby="${rowId}-wager-error"><span class="field-err" data-field-error="p-wager" id="${rowId}-wager-error" hidden role="alert" aria-live="polite"></span></td>
    <td class="num"><input class="p-prize" data-field="p-prize" aria-label="Prize for ${esc(p.name || "player")}" inputmode="decimal" placeholder="0" value="${esc(p.prize)}" aria-describedby="${rowId}-prize-error"><span class="field-err" data-field-error="p-prize" id="${rowId}-prize-error" hidden role="alert" aria-live="polite"></span></td>
    <td class="num col-score" hidden><input class="p-score" data-field="p-score" aria-label="Score for ${esc(p.name || "player")}" inputmode="decimal" placeholder="0" value="${esc(p.score ?? p.wagered ?? "")}" aria-describedby="${rowId}-score-error"><span class="field-err" data-field-error="p-score" id="${rowId}-score-error" hidden role="alert" aria-live="polite"></span></td>
    <td class="num col-hands" hidden><input class="p-hands" data-field="p-hands" aria-label="Hands played for ${esc(p.name || "player")}" inputmode="decimal" placeholder="0" value="${esc(p.hands)}" aria-describedby="${rowId}-hands-error"><span class="field-err" data-field-error="p-hands" id="${rowId}-hands-error" hidden role="alert" aria-live="polite"></span></td>
    <td class="num col-net" hidden><input class="p-net-profit" data-field="p-net-profit" aria-label="Net profit for ${esc(p.name || "player")}" inputmode="decimal" placeholder="0" value="${esc(p.netProfit)}" aria-describedby="${rowId}-net-error"><span class="field-err" data-field-error="p-net-profit" id="${rowId}-net-error" hidden role="alert" aria-live="polite"></span></td>
    <td class="num col-win" hidden><input class="p-win-rate" data-field="p-win-rate" aria-label="Win rate for ${esc(p.name || "player")}" inputmode="decimal" placeholder="0" value="${esc(p.winRate)}" aria-describedby="${rowId}-win-error"><span class="field-err" data-field-error="p-win-rate" id="${rowId}-win-error" hidden role="alert" aria-live="polite"></span></td>
    <td class="num col-change" hidden><input class="p-change" data-field="p-change" aria-label="Rank change for ${esc(p.name || "player")}" inputmode="decimal" placeholder="0" value="${esc(p.change)}" aria-describedby="${rowId}-change-error"><span class="field-err" data-field-error="p-change" id="${rowId}-change-error" hidden role="alert" aria-live="polite"></span></td>
    <td class="act"><button class="row-edit" title="Edit player" aria-label="Edit player" type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button><button class="row-x" title="Remove" aria-label="Remove ${esc(p.name || "player")}" type="button">×</button></td>`;
  tr.querySelector(".row-edit").addEventListener("click", () => {
    const name = tr.querySelector(".p-name");
    name?.focus();
    name?.select();
  });
  tr.querySelector(".p-name")?.addEventListener("input", (event) => {
    const currentName = event.currentTarget.value.trim() || "player";
    event.currentTarget.title = event.currentTarget.value;
    tr.querySelector(".p-wager")?.setAttribute("aria-label", `Amount for ${currentName}`);
    tr.querySelector(".p-prize")?.setAttribute("aria-label", `Prize for ${currentName}`);
    tr.querySelector(".p-score")?.setAttribute("aria-label", `Score for ${currentName}`);
    tr.querySelector(".p-hands")?.setAttribute("aria-label", `Hands played for ${currentName}`);
    tr.querySelector(".p-net-profit")?.setAttribute("aria-label", `Net profit for ${currentName}`);
    tr.querySelector(".p-win-rate")?.setAttribute("aria-label", `Win rate for ${currentName}`);
    tr.querySelector(".p-change")?.setAttribute("aria-label", `Rank change for ${currentName}`);
    tr.querySelector(".row-x")?.setAttribute("aria-label", `Remove ${currentName}`);
    updateNameCounter(event.currentTarget);
    updateDuplicateWarnings();
  });
  tr.querySelector(".row-x").addEventListener("click", async () => {
    const name = tr.querySelector(".p-name")?.value.trim() || "this player";
    if (!await showConfirmModal("Remove player", `Remove ${name}? You can restore it only by re-adding it before saving.`, "Remove", true)) return;
    commitDraftMutation(() => {
      tr.remove();
      renumber();
      toggleEmpty();
      syncSelectAll();
    }, `${name} removed. Save to publish.`);
  });
  // Wire spreadsheet-style keyboard navigation (ArrowDown, ArrowUp, Enter)
  tr.querySelectorAll("input").forEach((inp) => {
    inp.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey)) {
        const nextTr = tr.nextElementSibling;
        if (nextTr) {
          const className = Array.from(inp.classList).find((c) => c.startsWith("p-"));
          if (className) {
            e.preventDefault();
            nextTr.querySelector(`.${className}`)?.focus();
          }
        }
      } else if (e.key === "ArrowUp") {
        const prevTr = tr.previousElementSibling;
        if (prevTr) {
          const className = Array.from(inp.classList).find((c) => c.startsWith("p-"));
          if (className) {
            e.preventDefault();
            prevTr.querySelector(`.${className}`)?.focus();
          }
        }
      }
    });
  });

  wireNumberInput(tr.querySelector(".p-wager"), { money: true });
  wireNumberInput(tr.querySelector(".p-prize"), { money: true });
  PLAYER_NUMBER_FIELDS.slice(2).forEach((field) => wireNumberInput(tr.querySelector(field.selector), field));
  updateNameCounter(tr.querySelector(".p-name"));
  return tr;
}

const FIELD_COLS = {
  score: "col-score",
  hands: "col-hands",
  netProfit: "col-net",
  winRate: "col-win",
  change: "col-change",
};
const PLAYER_TABLE_BASE_WIDTH = 44 + 56 + 200 + 112 + 112 + 96;
const PLAYER_OPTIONAL_COLUMN_WIDTH = 112;
function syncColumnDropdown(fields) {
  const merged = { ...state.EXTRA?.playerFields, ...(fields || {}) };
  $("colMenu")?.querySelectorAll("[data-col]").forEach((cb) => {
    cb.checked = merged[cb.dataset.col] !== false;
  });
}

export function applyPlayerFieldVisibility(fields) {
  const table = $("rows")?.closest("table");
  const merged = { ...state.EXTRA?.playerFields, ...(fields || {}) };
  const visibleOptionalCount = Object.keys(FIELD_COLS).reduce((count, key) => count + (merged[key] !== false ? 1 : 0), 0);
  table?.style.setProperty(
    "--v3-players-table-min-width",
    `${PLAYER_TABLE_BASE_WIDTH + visibleOptionalCount * PLAYER_OPTIONAL_COLUMN_WIDTH}px`
  );
  for (const [key, cls] of Object.entries(FIELD_COLS)) {
    const shown = merged[key] !== false;
    table?.querySelectorAll(`.${cls}`).forEach((el) => { el.hidden = !shown; });
  }
  syncColumnDropdown(merged);
}

/**
 * Stable comparison key for a set of player rows. Stored drafts hold raw input
 * strings while the server holds numbers, so both sides are normalized before
 * comparison.
 */
function playersFingerprint(rows) {
  return JSON.stringify((Array.isArray(rows) ? rows : []).map((row) => [
    String(row?.name ?? "").trim(),
    ...PLAYER_NUMBER_FIELDS.map(({ key }) => {
      const raw = row?.[key];
      if (raw === undefined || raw === null || String(raw).trim() === "") return null;
      const number = Number(String(raw).replace(/,/g, ""));
      return Number.isFinite(number) ? number : String(raw).trim();
    }),
  ]));
}

/**
 * A stored draft only means "unpublished changes" when it differs from what the
 * server holds. A draft that matches the saved rows (the state left behind by a
 * save or a publish) must not resurrect the "Draft changes" state on the next
 * render of this page.
 */
export function draftHasChanges(stored, saved) {
  if (!stored) return false;
  if (Object.values(stored.quickAdd || {}).some((value) => String(value ?? "").trim())) return true;
  return playersFingerprint(stored.players) !== playersFingerprint(saved);
}

export function renderPlayers(list, { restoreDraft = false } = {}) {
  const persisted = restoreDraft ? readPlayersDraft() : null;
  const stored = draftHasChanges(persisted, list) ? persisted : null;
  // A stale draft identical to the saved rows is dropped rather than restored.
  if (persisted && !stored) clearPlayersDraft();
  const source = stored ? stored.players : list;
  const b = $("rows");
  b.innerHTML = "";
  currentPage = 1;
  const frag = document.createDocumentFragment();
  source.forEach((p) => frag.appendChild(playerRow(p)));
  b.appendChild(frag);
  renumber();
  toggleEmpty();
  applyPlayerFieldVisibility();
  syncSelectAll();
  updateDuplicateWarnings();
  const notice = $("playersSampleNotice");
  if (notice) notice.hidden = !state.SAMPLE_PLAYERS;
  showPlayersDraftNotice(Boolean(stored));
  if (stored) {
    restoreQuickAdd(stored.quickAdd);
    markDirty();
  }
}

export function renumber() {
  const rows = [...$("rows").children];
  const rankSelector = state.RANK_BY === "score" ? ".p-score" : ".p-wager";
  const ranked = rows.slice().sort((a, b) => {
    const metric = parseAmount(b.querySelector(rankSelector)?.value) - parseAmount(a.querySelector(rankSelector)?.value);
    return metric || a.querySelector(".p-name").value.localeCompare(b.querySelector(".p-name").value, undefined, { sensitivity: "base" });
  });
  const rankMap = new Map();
  let previousValue = null;
  let competitionRank = 0;
  ranked.forEach((row, index) => {
    const value = parseAmount(row.querySelector(rankSelector)?.value);
    if (previousValue === null || value !== previousValue) competitionRank = index + 1;
    previousValue = value;
    rankMap.set(row, competitionRank);
  });
  rows.forEach((row) => { row.querySelector(".rank").textContent = String(rankMap.get(row)); });
  const n = rows.length;
  const limit = state.ME?.limits?.players ?? 25;
  const pCount = $("pCount");
  if (pCount) pCount.textContent = String(n);
  const pLimit = $("pLimit");
  if (pLimit) pLimit.textContent = String(limit);
  const hint = $("limitHint");
  if (hint) hint.textContent = n >= limit ? "Limit reached" : (n >= Math.floor(limit * 0.8) ? "Approaching limit" : "");
  const upgrade = $("playerLimitUpgrade");
  if (upgrade) upgrade.hidden = n < Math.max(1, Math.floor(limit * 0.8));
  const atLimit = limit < 999 && n >= limit;
  const limitMessage = atLimit
    ? playerLimitMessage()
    : "";
  const limitEl = $("limitMsg");
  if (limitEl) {
    limitEl.textContent = limitMessage;
    limitEl.hidden = !limitMessage;
  }
  const quickLimitEl = $("quickLimitMsg");
  if (quickLimitEl) {
    quickLimitEl.textContent = limitMessage;
    quickLimitEl.hidden = !limitMessage;
  }
  for (const id of ["addRow", "qa_add"]) {
    const button = $(id);
    if (!button) continue;
    button.disabled = atLimit;
    if (atLimit) {
      button.title = limitMessage;
      button.setAttribute("aria-label", limitMessage);
      button.setAttribute("aria-describedby", "limitMsg");
    } else {
      button.removeAttribute("title");
      button.removeAttribute("aria-label");
      button.removeAttribute("aria-describedby");
    }
  }
  applyRowVisibility();
}

export function toggleEmpty() {
  const empty = $("rows").children.length === 0;
  const controls = document.querySelector(".v3-players-bar");
  if (controls) controls.hidden = empty;
  const archiveForm = document.querySelector(".arch-form");
  if (archiveForm) archiveForm.hidden = empty;
  if ($("playersEmpty")) $("playersEmpty").hidden = !empty;
  if ($("playersTableWrap")) $("playersTableWrap").hidden = empty;
  if ($("playersFoot")) $("playersFoot").hidden = empty;
  if ($("playerSort")) $("playerSort").hidden = empty;
  if (empty) $("selectAll") && ($("selectAll").checked = false);
}

// Live re-sort the player table as wagered numbers change, with a tiny
// FLIP-style translate animation so the operator sees the row move.
let sortTimer;
let currentPage = 1;
const PAGE_SIZE = 10;

function sortRows() {
  const rowsEl = $("rows");
  if (!rowsEl) return;
  const before = new Map();
  for (const row of rowsEl.children) before.set(row, row.getBoundingClientRect().top);
  const rowsArr = [...rowsEl.children];
  const sort = $("playerSort")?.value || "wagered";
  rowsArr.sort((a, b) => {
    if (sort === "name") {
      return a.querySelector(".p-name").value.localeCompare(b.querySelector(".p-name").value, undefined, { sensitivity: "base" });
    }
    const selector = sort === "prize" ? ".p-prize" : sort === "score" ? ".p-score" : ".p-wager";
    const av = parseAmount(a.querySelector(selector).value);
    const bv = parseAmount(b.querySelector(selector).value);
    if (bv !== av) return bv - av;
    return a.querySelector(".p-name").value.localeCompare(b.querySelector(".p-name").value, undefined, { sensitivity: "base" });
  });
  
  let isSorted = true;
  for (let i = 0; i < rowsArr.length; i++) {
    if (rowsArr[i] !== rowsEl.children[i]) { isSorted = false; break; }
  }
  if (isSorted) return;

  const activeEl = document.activeElement;
  let activeData = null;
  if (activeEl && rowsEl.contains(activeEl)) {
    const tr = activeEl.closest("tr");
    activeData = { tr, cls: activeEl.className.split(" ")[0] };
  }

  rowsArr.forEach((row) => rowsEl.appendChild(row));
  renumber();

  if (activeData && activeData.tr) {
    const input = activeData.tr.querySelector("." + activeData.cls);
    if (input) {
      input.focus();
      // Restore cursor position if it's an input
      if (typeof input.selectionStart === "number") {
        const len = input.value.length;
        input.setSelectionRange(len, len);
      }
    }
  }
  const after = new Map();
  for (const row of rowsArr) after.set(row, row.getBoundingClientRect().top);
  for (const row of rowsArr) {
    const dy = (before.get(row) || after.get(row) || 0) - (after.get(row) || before.get(row) || 0);
    if (dy) { row.style.transform = `translateY(${dy}px)`; row.style.transition = "none"; }
  }
  requestAnimationFrame(() => {
    for (const row of rowsArr) { row.style.transition = "transform 0.2s ease"; row.style.transform = ""; }
  });
  applyRowVisibility();
}

function onSortableInput() {
  if (($("playerSort")?.value || "wagered") !== state.RANK_BY) return;
  clearTimeout(sortTimer);
  sortTimer = setTimeout(sortRows, 200);
}

$("rows")?.addEventListener("input", (e) => {
  if (!e.target?.classList) return;
  if (e.target.classList.contains("p-wager") || e.target.classList.contains("p-score") || e.target.classList.contains("p-prize")) onSortableInput();
  if (e.target.classList.contains("p-name")) {
    if (playerNameSegments(e.target.value).length > PLAYER_NAME_LIMIT) e.target.value = playerNameSegments(e.target.value).slice(0, PLAYER_NAME_LIMIT).join("");
    updateNameCounter(e.target);
    updateDuplicateWarnings();
    clearPlayerFieldError(e.target);
  } else if (e.target.matches(".p-wager, .p-prize, .p-score, .p-hands, .p-net-profit, .p-win-rate, .p-change")) {
    clearPlayerFieldError(e.target);
  }
});

$("addRow")?.addEventListener("click", () => {
  if ($("addRow").disabled) return;
  commitDraftMutation(() => {
    $("rows").appendChild(playerRow());
    renumber();
    toggleEmpty();
    applyPlayerFieldVisibility();
  }, "Player added. Save to publish.");
});

function addQuickRow() {
  const nameInput = $("qa_name");
  const name = nameInput.value.trim();
  const wagerInput = $("qa_wager");
  const prizeInput = $("qa_prize");
  const quickValidation = validateQuickAddValues({ name, wagered: wagerInput.value, prize: prizeInput.value });
  if (!quickValidation.ok) {
    const firstError = quickValidation.errors[0];
    const input = firstError.field === "name" ? nameInput : firstError.field === "wagered" ? wagerInput : prizeInput;
    setPlayerFieldError(input, firstError.message);
    quickValidation.errors.slice(1).forEach((error) => {
      const target = error.field === "wagered" ? wagerInput : prizeInput;
      setPlayerFieldError(target, error.message);
    });
    input.focus();
    return;
  }
  if ($("qa_add").disabled) {
    setPlayerMessage("limitMsg", playerLimitMessage());
    setPlayerMessage("quickLimitMsg", playerLimitMessage());
    return;
  }
  clearPlayerFieldError(nameInput);
  clearPlayerFieldError(wagerInput);
  clearPlayerFieldError(prizeInput);
  updateDuplicateWarnings();
  commitDraftMutation(() => {
    $("rows").appendChild(playerRow({ name, wagered: quickValidation.wagered, prize: quickValidation.prize }));
    $("qa_name").value = "";
    $("qa_wager").value = "";
    $("qa_prize").value = "";
    renumber();
    toggleEmpty();
    applyPlayerFieldVisibility();
    updateDuplicateWarnings();
  }, `${name} added. Save to publish.`);
}

$("qa_add")?.addEventListener("click", addQuickRow);
$("qa_name")?.addEventListener("input", (e) => {
  if (playerNameSegments(e.currentTarget.value).length > PLAYER_NAME_LIMIT) e.currentTarget.value = playerNameSegments(e.currentTarget.value).slice(0, PLAYER_NAME_LIMIT).join("");
  updateNameCounter(e.currentTarget);
  clearPlayerFieldError(e.currentTarget);
  updateDuplicateWarnings();
});
$("playersDraftNoticeDismiss")?.addEventListener("click", () => showPlayersDraftNotice(false));
$("qa_wager") && wireNumberInput($("qa_wager"), { money: true });
$("qa_prize") && wireNumberInput($("qa_prize"), { money: true });
$("qa_name")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("qa_wager")?.focus(); } });
$("qa_wager")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("qa_prize")?.focus(); } });
$("qa_prize")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addQuickRow(); $("qa_name")?.focus(); } });

export function sanitizeImportName(s) {
  // eslint-disable-next-line no-control-regex -- deliberately strip ASCII control characters from imported names.
  let n = String(s || "").replace(/[\x00-\x1f\x7f]/g, "").trim();
  n = n.replace(/^"+/, "").replace(/"+$/, "");
  n = n.replace(/[^\p{L}\p{N}\p{P}\p{S}\s]/gu, "").trim();
  return truncatePlayerName(n);
}

export function parseImportAmount(s) {
  const raw = String(s || "").replace(/[$,\s]/g, "");
  if (raw === "") return 0;
  const n = parseFloat(raw);
  if (Number.isNaN(n) || !Number.isFinite(n) || n < 0) return null;
  return n;
}

function parseImportNumber(s) {
  const raw = String(s || "").replace(/[$,\s]/g, "");
  if (raw === "") return undefined;
  const n = parseFloat(raw);
  if (Number.isNaN(n) || !Number.isFinite(n)) return undefined;
  return n;
}

// Accepted header aliases → canonical field. Lets people paste a sheet with
// columns in ANY order (or extra columns) without silently corrupting data.
const HEADER_ALIASES = {
  name: "name", player: "name", username: "name", user: "name", handle: "name",
  wagered: "wagered", wager: "wagered", wagers: "wagered", "total wagered": "wagered", volume: "wagered", bet: "wagered", "bet amount": "wagered",
  prize: "prize", reward: "prize", payout: "prize", winnings: "prize",
  score: "score", points: "score", pts: "score",
  hands: "hands", rounds: "hands", games: "hands",
  netprofit: "netProfit", "net profit": "netProfit", net: "netProfit", profit: "netProfit", pnl: "netProfit",
  winrate: "winRate", "win rate": "winRate", "win %": "winRate", winpct: "winRate",
  change: "change", delta: "change", movement: "change",
};
// Positional order used when there is no recognizable header row.
const POSITIONAL = ["name", "wagered", "prize", "score", "hands", "netProfit", "winRate", "change"];
const NUMERIC_FIELDS = ["score", "hands", "netProfit", "winRate", "change"];

function normalizeHeader(h) {
  return String(h || "").trim().toLowerCase().replace(/^"+|"+$/g, "").replace(/\s+/g, " ");
}

function delimiterFor(text) {
  const firstLine = String(text || "").split(/\r?\n/).find((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("//");
  }) || "";
  let quoted = false;
  const counts = { "\t": 0, ",": 0, ";": 0 };
  for (let i = 0; i < firstLine.length; i += 1) {
    if (firstLine[i] === '"') {
      if (quoted && firstLine[i + 1] === '"') i += 1;
      else quoted = !quoted;
    } else if (!quoted && Object.hasOwn(counts, firstLine[i])) counts[firstLine[i]] += 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : "\t";
}

export function parseDelimitedRows(text, delimiter = delimiterFor(text)) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const input = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell); cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

export function parseImportText(text, source = "text") {
  const parsedRows = parseDelimitedRows(text)
    .filter((parts) => {
      const first = String(parts[0] || "").trim();
      return first && !first.startsWith("#") && !first.startsWith("//");
    });
  if (!parsedRows.length) return { rows: [], errors: ["No data found."], source };
  const headerParts = parsedRows[0].map(normalizeHeader);
  const mapped = headerParts.map((header) => HEADER_ALIASES[header]);
  const hasHeader = mapped[0] === "name" && mapped.slice(1).some((field) => field);
  const colOf = {};
  if (hasHeader) mapped.forEach((field, index) => { if (field && colOf[field] === undefined) colOf[field] = index; });
  else POSITIONAL.forEach((field, index) => { colOf[field] = index; });

  const dataRows = hasHeader ? parsedRows.slice(1) : parsedRows;
  const rows = [];
  const errors = [];
  const seen = new Set();
  const cell = (parts, field) => (colOf[field] === undefined ? "" : String(parts[colOf[field]] || "").trim());
  dataRows.forEach((parts, index) => {
    const rawName = cell(parts, "name");
    if (!rawName) return;
    const name = sanitizeImportName(rawName);
    if (!name) { errors.push(`Row ${index + 1}: missing name`); return; }
    const key = normalizePlayerIdentity(name);
    if (seen.has(key)) { errors.push(`Row ${index + 1}: duplicate "${name}"`); return; }
    seen.add(key);
    const wagered = parseImportAmount(cell(parts, "wagered"));
    if (wagered === null || wagered > SCORE_MAX) { errors.push(`Row ${index + 1}: invalid amount for "${name}"`); return; }
    const prize = parseImportAmount(cell(parts, "prize"));
    if (prize === null || prize > SCORE_MAX) { errors.push(`Row ${index + 1}: invalid prize for "${name}"`); return; }
    const imported = { name, wagered, prize };
    for (const field of NUMERIC_FIELDS) {
      const value = parseImportNumber(cell(parts, field));
      if (value !== undefined) imported[field] = value;
    }
    rows.push(imported);
  });
  return { rows, errors, source };
}

export function formatImportSummary(result, imported, skipped, capped) {
  const parts = [];
  if (imported) parts.push(`${imported} imported`);
  if (capped) parts.push(`${capped} cut by plan limit`);
  if (skipped) parts.push(`${skipped} skipped`);
  let msg = parts.join(" · ");
  if (result.errors.length) msg += (msg ? " — " : "") + result.errors.slice(0, 3).join("; ");
  return msg || "Nothing to import";
}

$("importPasteBtn")?.addEventListener("click", () => {
  closeMenus(false);
  const p = $("importPanel");
  p.hidden = !p.hidden;
  $("gsheetPanel").hidden = true;
  if (!p.hidden) $("importText").focus();
});

$("importText")?.addEventListener("input", () => {
  const result = parseImportText($("importText").value, "paste");
  const n = result.rows.length;
  const err = result.errors.length ? ` (${result.errors.length} problem${result.errors.length === 1 ? "" : "s"})` : "";
  $("importPreview").textContent = n + (n === 1 ? " player" : " players") + " detected" + err;
  $("importApply").disabled = n === 0;
});

$("importApply")?.addEventListener("click", () => {
  const result = parseImportText($("importText").value, "paste");
  if (!result.rows.length) {
    $("status").textContent = result.errors.length ? result.errors[0] : "No players to import.";
    return;
  }
  const replace = $("importReplace").checked;
  const existing = replace ? [] : [...$("rows").children].map((tr) => {
    const p = {
      name: tr.querySelector(".p-name").value.trim(),
      wagered: parseAmount(tr.querySelector(".p-wager").value),
      prize: parseAmount(tr.querySelector(".p-prize").value),
    };
    const score = tr.querySelector(".p-score").value.trim();
    const hands = tr.querySelector(".p-hands").value.trim();
    const netProfit = tr.querySelector(".p-net-profit").value.trim();
    const winRate = tr.querySelector(".p-win-rate").value.trim();
    const change = tr.querySelector(".p-change").value.trim();
    if (score) p.score = parseFloat(score);
    if (hands) p.hands = parseFloat(hands);
    if (netProfit) p.netProfit = parseFloat(netProfit);
    if (winRate) p.winRate = parseFloat(winRate);
    if (change) p.change = parseFloat(change);
    return p;
  }).filter((p) => p.name);
  const limit = state.ME?.limits?.players || 9999;
  const remaining = Math.max(0, limit - existing.length);
  const parsed = result.rows.slice(0, remaining);
  const all = existing.concat(parsed);
  const cut = result.rows.length - parsed.length;
  commitDraftMutation(() => renderPlayers(all), `${parsed.length} player${parsed.length === 1 ? "" : "s"} imported. Save to publish.`);
  $("importText").value = "";
  $("importPreview").textContent = "0 players detected";
  $("importApply").disabled = true;
  $("importPanel").hidden = true;
  $("status").textContent = formatImportSummary(result, parsed.length, result.rows.length - parsed.length + (result.errors.length ? `${result.errors.length} invalid` : ""), cut) + " — hit Save to publish.";
});

$("csvImportBtn")?.addEventListener("click", () => { closeMenus(false); $("csvFileInput").click(); });

$("csvFileInput")?.addEventListener("change", () => {
  const f = $("csvFileInput").files[0];
  if (!f) return;
  if (f.size > 2 * 1024 * 1024) { $("status").textContent = "CSV too large. Keep it under 2 MB."; $("csvFileInput").value = ""; return; }
  const reader = new FileReader();
  reader.onload = () => {
    const result = parseImportText(reader.result, "csv");
    if (!result.rows.length) { $("status").textContent = "No players found. Expected: name, wagered, prize and optional score, hands, net profit, win rate, change."; return; }
    $("importPanel").hidden = false;
    $("importText").value = result.rows.map((p) => [p.name, p.wagered, p.prize, p.score ?? "", p.hands ?? "", p.netProfit ?? "", p.winRate ?? "", p.change ?? ""].join("\t")).join("\n");
    $("importText").dispatchEvent(new Event("input"));
    $("status").textContent = `CSV loaded: ${result.rows.length} valid player${result.rows.length === 1 ? "" : "s"}${result.errors.length ? `, ${result.errors.length} problem${result.errors.length === 1 ? "" : "s"}` : ""}. Review and click "Add to table".`;
  };
  reader.onerror = () => { $("status").textContent = "Couldn't read that file."; };
  reader.readAsText(f);
  $("csvFileInput").value = "";
});

$("csvTemplateBtn")?.addEventListener("click", () => {
  closeMenus(false);
  const csv = "name,wagered,prize\nCryptoKing,152000,1500\nLuckyStar,98000,700\nDiceHero,61250,500\nSlotMaster,45000,250\nBetPro,32000,0\n";
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "yourrank-players-template.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

$("csvExportBtn")?.addEventListener("click", async () => {
  try {
    const apiUrl = state.ACTIVE_SITE_ID ? `/api/site/players/export?siteId=${encodeURIComponent(state.ACTIVE_SITE_ID)}` : "/api/site/players/export";
    const res = await fetch(apiUrl, { credentials: "include" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      $("status").textContent = d.error || "Could not export players.";
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const slug = (state.SLUG || "board").replace(/[^a-z0-9-]/gi, "-");
    a.download = `yourrank-players-${slug}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    $("status").textContent = "Players exported.";
  } catch (err) {
    logError("csvExport", err);
    $("status").textContent = "Network error.";
  }
});

function parseGSheetUrl(raw) {
  try {
    const url = new URL(raw.trim());
    const pub = url.pathname.match(/\/spreadsheets\/d\/e\/([a-zA-Z0-9_-]+)\//);
    if (pub) return `https://docs.google.com/spreadsheets/d/e/${pub[1]}/pub?output=csv&single=true`;
    const m = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)\//);
    if (!m) return null;
    const id = m[1];
    const gid = url.searchParams.get("gid") || "0";
    return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&id=${id}&gid=${gid}`;
  } catch { return null; }
}

$("gsheetBtn")?.addEventListener("click", () => {
  closeMenus(false);
  const p = $("gsheetPanel");
  p.hidden = !p.hidden;
  if (!p.hidden) $("importPanel").hidden = true;
});

$("gsheetFetch")?.addEventListener("click", async () => {
  const raw = $("gsheetUrl").value.trim();
  const status = $("gsheetStatus");
  const csvUrl = parseGSheetUrl(raw);
  if (!csvUrl) { status.textContent = "Paste a valid Google Sheets URL."; return; }
  status.textContent = "Fetching…";
  try {
    const res = await fetch(csvUrl, { credentials: "omit", mode: "cors" });
    if (!res.ok) { status.textContent = `Google returned ${res.status}. Make the sheet public or use CSV import.`; return; }
    const text = await res.text();
    const result = parseImportText(text, "gsheet");
    if (!result.rows.length) { status.textContent = result.errors.length ? result.errors[0] : "No players found. Expected: name, wagered, prize, ..."; return; }
    $("gsheetPanel").hidden = true;
    $("importPanel").hidden = false;
    $("importText").value = result.rows.map((p) => [p.name, p.wagered, p.prize, p.score ?? "", p.hands ?? "", p.netProfit ?? "", p.winRate ?? "", p.change ?? ""].join("\t")).join("\n");
    $("importText").dispatchEvent(new Event("input"));
    status.textContent = `Loaded ${result.rows.length} player${result.rows.length === 1 ? "" : "s"} from Google Sheets. Review and click “Add to table”.`;
  } catch (err) {
    logError("gsheetFetch", err);
    status.textContent = "Could not fetch the sheet. Try File → Share → Publish to web, or download as CSV.";
  }
});

// --- Search, pagination, bulk selection, and column visibility ---
function filteredRows() {
  const rows = $("rows");
  if (!rows) return [];
  const q = $("playerSearch")?.value.trim().toLowerCase() || "";
  return [...rows.children].filter((row) => !q || row.querySelector(".p-name")?.value.toLowerCase().includes(q));
}

function applyRowVisibility() {
  const rowsEl = $("rows");
  if (!rowsEl) return;
  const rows = [...rowsEl.children];
  const matches = filteredRows();
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(1, currentPage), pages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = new Set(matches.slice(start, start + PAGE_SIZE));
  rows.forEach((row) => {
    const visible = pageRows.has(row);
    row.hidden = !visible;
    row.classList.toggle("is-sel", !!row.querySelector(".row-sel")?.checked);
  });
  const showing = $("playersShowing");
  if (showing) {
    showing.textContent = matches.length
      ? `Showing ${start + 1}-${Math.min(start + PAGE_SIZE, matches.length)} of ${matches.length} players`
      : "No players";
  }
  const prev = $("playersPrev");
  const next = $("playersNext");
  if (prev) prev.disabled = currentPage <= 1;
  if (next) next.disabled = currentPage >= pages;
  syncSelectAll();
}

function getVisibleRows() {
  return [...$("rows").children].filter((tr) => !tr.hidden);
}

export function syncSelectAll() {
  const visible = getVisibleRows();
  const checked = visible.filter((tr) => tr.querySelector(".row-sel")?.checked).length;
  const selectAll = $("selectAll");
  if (selectAll) selectAll.checked = checked > 0 && checked === visible.length;
  const selected = [...$("rows").children].filter((tr) => tr.querySelector(".row-sel")?.checked);
  const bar = $("bulkActions");
  if (bar) bar.hidden = selected.length === 0;
  const count = $("bulkCount");
  if (count) count.textContent = `${selected.length} player${selected.length === 1 ? "" : "s"} selected`;
  [...$("rows").children].forEach((row) => row.classList.toggle("is-sel", !!row.querySelector(".row-sel")?.checked));
}

$("selectAll")?.addEventListener("change", () => {
  const checked = $("selectAll").checked;
  for (const row of getVisibleRows()) {
    const cb = row.querySelector(".row-sel");
    if (cb) cb.checked = checked;
  }
  syncSelectAll();
});

$("rows")?.addEventListener("change", (e) => {
  if (e.target?.classList?.contains("row-sel")) syncSelectAll();
});

$("bulkDelete")?.addEventListener("click", async () => {
  const selected = [...$("rows").children].filter((row) => row.querySelector(".row-sel")?.checked);
  if (!selected.length) return;
  const count = selected.length;
  if (!await showConfirmModal("Remove selected players", `Remove ${count} selected player${count === 1 ? "" : "s"}? You can restore them only by re-adding them before saving.`, "Remove", true)) return;
  commitDraftMutation(() => {
    selected.forEach((row) => row.remove());
    renumber();
    toggleEmpty();
    syncSelectAll();
  }, `${count} player${count === 1 ? "" : "s"} removed. Save to publish.`);
});

$("bulkClearWager")?.addEventListener("click", () => {
  let cleared = 0;
  for (const row of $("rows").children) {
    if (row.querySelector(".row-sel")?.checked) {
      const input = row.querySelector(".p-wager");
      if (input && parseAmount(input.value) !== 0) { input.value = "0"; showMoneyValue(input); cleared++; }
    }
  }
  if (cleared) {
    commitDraftMutation(() => sortRows(), `${cleared} wager${cleared === 1 ? "" : "s"} cleared. Save to publish.`);
  }
});

$("playerSearch")?.addEventListener("input", () => {
  currentPage = 1;
  const matches = new Set(filteredRows());
  for (const row of $("rows").children) {
    if (!matches.has(row)) {
      const checkbox = row.querySelector(".row-sel");
      if (checkbox) checkbox.checked = false;
    }
  }
  applyRowVisibility();
});

$("playerSort")?.addEventListener("change", () => {
  currentPage = 1;
  sortRows();
  applyRowVisibility();
});

$("playersPrev")?.addEventListener("click", () => {
  currentPage--;
  applyRowVisibility();
});

$("playersNext")?.addEventListener("click", () => {
  currentPage++;
  applyRowVisibility();
});

function setMenuState(trigger, menu, open, { focusFirst = false } = {}) {
  if (!trigger || !menu) return;
  menu.hidden = !open;
  trigger.setAttribute("aria-expanded", String(open));
  if (open && focusFirst) {
    menu.querySelector("button:not([disabled]), input:not([disabled]), [href]:not([aria-disabled='true'])")?.focus();
  }
}

function closeMenus(returnFocus = false) {
  const active = document.activeElement;
  const importMenu = $("importMenu");
  const colMenu = $("colMenu");
  const importOpen = importMenu && !importMenu.hidden;
  const colOpen = colMenu && !colMenu.hidden;
  if (importMenu) importMenu.hidden = true;
  if (colMenu) colMenu.hidden = true;
  $("importMenuBtn")?.setAttribute("aria-expanded", "false");
  $("colDropdownBtn")?.setAttribute("aria-expanded", "false");
  if (returnFocus) {
    const trigger = importOpen ? $("importMenuBtn") : colOpen ? $("colDropdownBtn") : null;
    if (trigger && (active === importMenu || importMenu?.contains(active) || active === colMenu || colMenu?.contains(active))) trigger.focus();
  }
}

function wireMenuA11y(triggerId, menuId) {
  const trigger = $(triggerId);
  const menu = $(menuId);
  if (!trigger || !menu) return;
  trigger.setAttribute("aria-controls", menuId);
  trigger.setAttribute("aria-expanded", String(!menu.hidden));
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    closeMenus(false);
    setMenuState(trigger, menu, open, { focusFirst: open });
  });
  menu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenus(true);
    }
  });
}

wireMenuA11y("colDropdownBtn", "colMenu");

$("colMenu")?.addEventListener("change", (e) => {
  if (e.target && e.target.dataset && e.target.dataset.col) {
    const fields = { ...(state.EXTRA?.playerFields || {}) };
    fields[e.target.dataset.col] = e.target.checked;
    state.EXTRA.playerFields = fields;
    applyPlayerFieldVisibility(fields);
    markDirty();
  }
});

// Close dropdowns when clicking outside
document.addEventListener("click", (e) => {
  if (!e.target.closest("#importMenu, #importMenuBtn, #colMenu, #colDropdownBtn")) closeMenus();
});

// Initialize the active column state and the first page once the DOM is ready.
document.addEventListener("DOMContentLoaded", () => {
  if (!$("rows")) return;
  applyPlayerFieldVisibility();
  applyRowVisibility();
});

// The new toolbar keeps the existing import actions and panel wiring.
$("emptyImportBtn")?.addEventListener("click", () => {
  $("importPanel").hidden = false;
  $("gsheetPanel").hidden = true;
  $("importText").focus();
});

$("emptyPasteBtn")?.addEventListener("click", async () => {
  $("importPanel").hidden = false;
  $("gsheetPanel").hidden = true;
  const input = $("importText");
  try {
    if (!navigator.clipboard?.readText) throw new Error("Clipboard API unavailable");
    input.value = await navigator.clipboard.readText();
    input.dispatchEvent(new Event("input"));
  } catch (err) {
    logError("clipboardRead", err);
    $("status").textContent = "Couldn't read your clipboard — paste the players in below.";
  }
  input.focus();
});

wireMenuA11y("importMenuBtn", "importMenu");

["importPasteBtn", "csvImportBtn", "gsheetBtn", "csvTemplateBtn", "csvExportBtn"].forEach((id) => {
  $(id)?.addEventListener("click", () => closeMenus(false));
});

// Initialize column dropdown state once the DOM is ready.

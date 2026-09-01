import { beforeAll, describe, expect, it } from "bun:test";

class FakeClassList {
  constructor(value = "") {
    this.values = new Set(String(value).split(/\s+/).filter(Boolean));
  }
  add(...values) { values.forEach((value) => this.values.add(value)); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    const next = force === undefined ? !this.contains(value) : force;
    if (next) this.add(value); else this.remove(value);
    return next;
  }
  toString() { return [...this.values].join(" "); }
}

class FakeElement {
  constructor(tag = "div", className = "") {
    this.tagName = tag.toUpperCase();
    this.classList = new FakeClassList(className);
    this.children = [];
    this.parentNode = null;
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.value = "";
    this.textContent = "";
    this.hidden = false;
    this.style = {};
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  removeChild(child) { this.children = this.children.filter((entry) => entry !== child); child.parentNode = null; return child; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatchEvent(event) { for (const fn of this.listeners[event.type] || []) fn.call(this, { ...event, currentTarget: this, target: event.target || this }); }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === "id") this.id = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  toggleAttribute(name, force) { if (force) this.setAttribute(name, ""); else this.removeAttribute(name); }
  focus() { globalThis.document.activeElement = this; }
  select() {}
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  matches(selector) {
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector.includes("[")) {
      const match = selector.match(/^\[([^=]+)="([^"]*)"\]$/);
      return Boolean(match && this.getAttribute(match[1]) === match[2]);
    }
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }
  closest(selector) {
    let node = this;
    while (node) {
      if (selector === "td" ? node.tagName === "TD" : node.matches(selector)) return node;
      node = node.parentNode;
    }
    return null;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  querySelectorAll(selector) {
    const result = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) result.push(child);
        visit(child);
      }
    };
    visit(this);
    return result;
  }
}

class FakeStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const elements = new Map();
const fakeDocument = {
  activeElement: null,
  body: new FakeElement("body"),
  head: new FakeElement("head"),
  getElementById(id) { return elements.get(id) || null; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {},
  createElement(tag) { return new FakeElement(tag); },
  createDocumentFragment() { return new FakeElement("fragment"); },
};

const storage = new FakeStorage();
let players;
let dashboardState;

function register(id, element) {
  element.id = id;
  elements.set(id, element);
  return element;
}

function field(row, className, value, errorId = className) {
  const cell = row.appendChild(new FakeElement("td"));
  const input = cell.appendChild(new FakeElement("input", className));
  input.value = value;
  input.dataset.field = className;
  const error = cell.appendChild(new FakeElement("span", "field-err"));
  error.setAttribute("data-field-error", className);
  error.setAttribute("id", errorId);
  error.hidden = true;
  return input;
}

function row(values = {}) {
  const tr = new FakeElement("tr");
  const rank = tr.appendChild(new FakeElement("td", "rank"));
  rank.textContent = "";
  const nameCell = tr.appendChild(new FakeElement("td", "player-name"));
  const name = nameCell.appendChild(new FakeElement("input", "p-name"));
  name.value = values.name || "";
  const warning = nameCell.appendChild(new FakeElement("span", "field-warn"));
  warning.setAttribute("data-field-warning", "p-name");
  for (const [className, key] of [["p-wager", "wagered"], ["p-prize", "prize"], ["p-score", "score"], ["p-hands", "hands"], ["p-net-profit", "netProfit"], ["p-win-rate", "winRate"], ["p-change", "change"]]) {
    field(tr, className, values[key] || "");
  }
  return tr;
}

function setupRows(values) {
  const rows = register("rows", new FakeElement("tbody"));
  rows.appendChild(row(values));
  return rows;
}

beforeAll(async () => {
  globalThis.document = fakeDocument;
  globalThis.window = { sessionStorage: storage, addEventListener() {}, removeEventListener() {} };
  globalThis.navigator = {};
  globalThis.location = { href: "http://localhost/dashboard/leaderboard/players" };
  globalThis.requestAnimationFrame = (fn) => fn();
  players = await import("../assets/dashboard/players.js");
  dashboardState = (await import("../assets/dashboard/state.js")).state;
  dashboardState.ACTIVE_SITE_ID = "site-test";
});

describe("Players CRUD validation", () => {
  it("preserves invalid numeric input and marks the offending cell", () => {
    const rows = setupRows({ name: "Alice", wagered: "abc", prize: "-500" });
    const result = players.collectPlayers({ focusInvalid: true });
    expect(rows.querySelector(".p-wager").value).toBe("abc");
    expect(rows.querySelector(".p-wager").getAttribute("aria-invalid")).toBe("true");
    expect(rows.querySelector(".p-wager").closest("td").querySelector(".field-err").textContent).toContain("Enter a number from 0 to");
    expect(result.invalid.map(({ label }) => label)).toEqual(["Amount", "Prize"]);
    expect(fakeDocument.activeElement).toBe(rows.querySelector(".p-wager"));
  });

  it("keeps empty numbers distinct from invalid numbers in collection", () => {
    setupRows({ name: "Alice", wagered: "", prize: "abc", score: "" });
    const result = players.collectPlayers();
    expect(result.players[0].wagered).toBe(0);
    expect(result.players[0]).not.toHaveProperty("score");
    expect(result.players[0]).not.toHaveProperty("prize");
    expect(result.invalid).toHaveLength(1);
  });

  it("does not report validation errors during preview collection", () => {
    const rows = setupRows({ name: "Alice", wagered: "abc" });
    const result = players.collectPlayers({ reportErrors: false });
    const input = rows.querySelector(".p-wager");
    const error = input.closest("td").querySelector(".field-err");
    expect(result.invalid).toHaveLength(1);
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(error.hidden).toBe(true);
    expect(error.textContent).toBe("");
  });

  it("returns visible quick-add validation errors for blank names and bad numbers", () => {
    const blank = players.validateQuickAddValues({ name: "   ", wagered: "", prize: "" });
    expect(blank.ok).toBe(false);
    expect(blank.errors[0]).toEqual({ field: "name", message: "Enter a player name." });
    const invalid = players.validateQuickAddValues({ name: "Zoe", wagered: "abc", prize: "-5" });
    expect(invalid.ok).toBe(false);
    expect(invalid.errors.map(({ field }) => field)).toEqual(["wagered", "prize"]);
  });

  it("explains a reached player limit at the add control", () => {
    dashboardState.ME = { plan: "free", limits: { players: 10 } };
    expect(players.playerLimitMessage()).toBe("Free allows up to 10 players. Upgrade to add more.");
  });

  it("warns and blocks duplicate names as a validation failure", () => {
    const rows = register("rows", new FakeElement("tbody"));
    rows.appendChild(row({ name: "Alice", wagered: "1", prize: "0" }));
    rows.appendChild(row({ name: "alice", wagered: "2", prize: "0" }));
    players.updateDuplicateWarnings();
    expect(rows.children[0].querySelector(".field-warn").textContent).toContain("Duplicate name");
    expect(players.collectPlayers().invalid).toHaveLength(2);
  });

  it("round-trips staged rows through per-site session storage and clears them", () => {
    setupRows({ name: "Draft", wagered: "abc", prize: "" });
    register("qa_name", Object.assign(new FakeElement("input"), { value: "Quick" }));
    register("qa_score", Object.assign(new FakeElement("input"), { value: "" }));
    register("qa_wager", Object.assign(new FakeElement("input"), { value: "12" }));
    register("qa_prize", Object.assign(new FakeElement("input"), { value: "" }));
    players.persistPlayersDraft();
    expect(players.loadPlayersDraft()).toEqual({
      players: [{ name: "Draft", wagered: "abc", prize: "", score: "", hands: "", netProfit: "", winRate: "", change: "" }],
      quickAdd: { name: "Quick", score: "", wagered: "12", prize: "" },
    });
    players.clearPlayersDraft();
    expect(players.loadPlayersDraft()).toBeNull();
  });

  // A staged draft identical to the saved rows used to be restored and marked
  // dirty on the next render, so "Draft changes" reappeared with no user edit.
  it("only treats a staged draft as changes when it differs from the saved rows", () => {
    const saved = [{ name: "Alice", wagered: 1000, prize: 0 }];
    const identical = { players: [{ name: "Alice", wagered: "1,000", prize: "0" }], quickAdd: { name: "", wagered: "", prize: "" } };
    expect(players.draftHasChanges(identical, saved)).toBe(false);
    expect(players.draftHasChanges({ ...identical, quickAdd: { name: "Zoe" } }, saved)).toBe(true);
    expect(players.draftHasChanges({ players: [{ name: "Alice", wagered: "2000" }] }, saved)).toBe(true);
    expect(players.draftHasChanges({ players: [] }, saved)).toBe(true);
    expect(players.draftHasChanges(null, saved)).toBe(false);
  });

  // Formatting-only redraws must not create an unsaved change. Score is an
  // independent metric, so an empty saved score remains empty after redraw.
  it("does not read a redrawn table's formatting as a change", () => {
    const saved = [{ name: "Alice", wagered: 1000, prize: 0 }];
    const redrawn = {
      players: [{ name: "Alice", wagered: "$1,000.00", prize: "$0.00", score: "", hands: "", netProfit: "", winRate: "", change: "" }],
      quickAdd: { name: "", score: "", wagered: "", prize: "" },
    };
    expect(players.draftHasChanges(redrawn, saved)).toBe(false);
    expect(players.draftHasChanges({ players: [{ ...redrawn.players[0], score: "5" }] }, saved)).toBe(true);
  });

  it("discard restores the saved snapshot and clears dirty state", () => {
    dashboardState.SAVED_PLAYERS = [{ name: "Saved", wagered: 1, prize: 0 }];
    dashboardState._dirty = true;
    let rendered;
    players.discardPlayersDraft({ render: (value) => { rendered = value; } });
    expect(rendered).toEqual([{ name: "Saved", wagered: 1, prize: 0 }]);
    expect(dashboardState._dirty).toBe(false);
  });
});

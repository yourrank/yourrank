// Confirmations, prompts and the broadcast preview each shipped their own
// dialog: three focus traps, three sets of ARIA wiring. There is one now, in
// /assets/dialog.js, and both Workers load it.
import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const assetsDir = path.resolve(import.meta.dir, "../assets");
const dialog = fs.readFileSync(path.join(assetsDir, "dialog.js"), "utf8");
const utils = fs.readFileSync(path.join(assetsDir, "dashboard/utils.js"), "utf8");
const botClient = fs.readFileSync(path.resolve(import.meta.dir, "../../../bot/src/dashboard-views/client-script.ts"), "utf8");
const botShell = fs.readFileSync(path.resolve(import.meta.dir, "../../../../packages/shared/src/page-shell.ts"), "utf8");

describe("the dialog primitive", () => {
  it("traps Tab, closes on Escape and restores focus", () => {
    expect(dialog).toContain('e.key === "Escape"');
    expect(dialog).toContain('e.key !== "Tab"');
    expect(dialog).toContain("trigger.focus()");
    // A trap that only watches its own edges lets focus out the moment the user
    // clicks the page behind it; this pulls it back.
    expect(dialog).toContain("if (!el.contains(document.activeElement))");
  });

  it("labels itself for a screen reader", () => {
    expect(dialog).toContain('setAttribute("role", "dialog")');
    expect(dialog).toContain('setAttribute("aria-modal", "true")');
    expect(dialog).toContain('setAttribute("aria-labelledby", titleId)');
  });

  it("is the only implementation", () => {
    // Both Workers delegate; neither builds an overlay of its own any more.
    expect(utils).toContain("window.YRDialog");
    expect(utils).not.toContain('className = "modal"');
    expect(botClient).toContain("window.YRDialog.confirm");
    expect(botClient).not.toContain("position:fixed;inset:0;background:rgba(17,17,20,.45)");
    // The broadcast preview keeps its own markup but shares the trap.
    expect(botClient).toContain("window.YRDialog.trap");
    expect(botClient.match(/e\.key === 'Tab'/g)).toBeNull();
  });

  it("is loaded by the bot dashboard", () => {
    expect(botShell).toContain('<script src="/assets/dialog.js" defer></script>');
  });
});

// A trap that only redirects Tab still leaves the page behind the dialog
// clickable and readable by a screen reader. These run the shipped file.
describe("the dialog primitive's background", () => {
  function element(tagName, attrs) {
    const el = {
      tagName,
      children: [],
      parentElement: null,
      inert: false,
      attrs: attrs || {},
      hasAttribute: (name) => Object.prototype.hasOwnProperty.call(el.attrs, name),
      getAttribute: (name) => (Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null),
      contains: (other) => other === el,
      querySelectorAll: () => [],
      focus: () => { doc.activeElement = el; },
    };
    return el;
  }

  function append(parent, child) {
    parent.children.push(child);
    child.parentElement = parent;
    return child;
  }

  let doc;

  function loadDialog() {
    doc = {
      activeElement: null,
      listeners: [],
      addEventListener(type, handler, capture) { doc.listeners.push({ type, handler, capture }); },
      removeEventListener(type, handler) {
        doc.listeners = doc.listeners.filter((entry) => entry.handler !== handler);
      },
      createElement: (tag) => element(tag.toUpperCase()),
      body: element("BODY"),
      documentElement: element("HTML"),
    };
    const win = {};
    const load = new Function("window", "document", dialog + "\nreturn window.YRDialog;");
    return load(win, doc);
  }

  function scene() {
    const api = loadDialog();
    const html = element("HTML");
    const head = append(html, element("HEAD"));
    const body = append(html, element("BODY"));
    const shell = append(body, element("DIV"));
    const toast = append(body, element("DIV", { "aria-live": "polite" }));
    const main = append(shell, element("MAIN"));
    const side = append(shell, element("ASIDE"));
    const modal = append(main, element("DIV"));
    const opener = append(main, element("BUTTON"));
    const field = element("INPUT");
    modal.querySelectorAll = () => [field];
    modal.contains = (other) => other === modal || other === field;
    doc.activeElement = opener;
    return { api, head, body, shell, main, side, modal, opener, toast };
  }

  it("makes everything outside the dialog inert and gives it back on release", () => {
    const s = scene();
    const release = s.api.trap(s.modal, () => {});

    expect(s.opener.inert).toBe(true);
    expect(s.side.inert).toBe(true);
    expect(s.body.children.find((c) => c === s.shell).inert).toBe(false);
    expect(s.modal.inert).toBe(false);
    // A toast raised by the dialog still has to be announced.
    expect(s.toast.inert).toBe(false);
    // Non-rendered siblings are left alone.
    expect(s.head.inert).toBe(false);

    release();
    expect(s.opener.inert).toBe(false);
    expect(s.side.inert).toBe(false);
    expect(doc.activeElement).toBe(s.opener);
    expect(doc.listeners.length).toBe(0);
  });

  it("does not clear inert that the page set for its own reasons", () => {
    const s = scene();
    s.side.inert = true;
    const release = s.api.trap(s.modal, () => {});
    release();
    expect(s.side.inert).toBe(true);
  });
});

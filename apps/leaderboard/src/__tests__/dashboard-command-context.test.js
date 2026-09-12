import { describe, expect, it } from "bun:test";
import { commandAvailable, PRIMARY_COMMANDS } from "../assets/dashboard/command-context.js";

describe("contextual workspace commands", () => {
  it("never offers blocked publication or hidden saves through search", () => {
    expect(commandAvailable("act-publish", { canPublish: false })).toBe(false);
    expect(commandAvailable("act-save", { canSave: false })).toBe(false);
    expect(commandAvailable("act-publish", { canPublish: true })).toBe(true);
  });
  it("keeps public and overlay actions tied to actual live site state", () => {
    expect(commandAvailable("act-public", { live: false })).toBe(false);
    expect(commandAvailable("act-obs-ticker", { live: true, sharePage: false })).toBe(false);
    expect(commandAvailable("act-obs-ticker", { live: true, sharePage: true })).toBe(true);
  });
  it("keeps initial navigation compact without limiting searchable destinations", () => {
    expect(PRIMARY_COMMANDS.size).toBe(7);
    expect(commandAvailable("nav-history", {})).toBe(true);
    expect(PRIMARY_COMMANDS.has("nav-history")).toBe(false);
  });
  it("gates site tasks on a selected site and link copy on a live site", () => {
    expect(commandAvailable("task-site-add-player", { siteSelected: false })).toBe(false);
    expect(commandAvailable("task-site-add-player", { siteSelected: true })).toBe(true);
    expect(commandAvailable("task-site-invite", { siteSelected: false })).toBe(false);
    expect(commandAvailable("task-copy-link", { live: false })).toBe(false);
    expect(commandAvailable("task-copy-link", { live: true })).toBe(true);
    expect(commandAvailable("task-new-site", {})).toBe(true);
  });
});

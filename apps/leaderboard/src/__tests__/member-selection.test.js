import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { MemberSelection, exportRows } from "../assets/member-selection.js";
const audiencePage = readFileSync(new URL("../react/pages/audience/page.tsx", import.meta.url), "utf8");

const alice = { id: "m-alice", balance: 10, identities: [{ provider: "kick", username: "alice" }] };
const bob = { id: "m-bob", balance: 20, identities: [{ provider: "discord", username: "bob" }] };
const carol = { id: "m-carol", balance: 30 };

describe("MemberSelection across pages and searches", () => {
  it("exports every selected member even when a later search no longer loads them", () => {
    const selection = new MemberSelection();
    // Search/page A loads Alice only.
    let loaded = [alice];
    selection.add(loaded[0]);
    // Search/page B replaces the loaded array with Bob only.
    loaded = [bob];
    selection.add(loaded[0]);

    expect(selection.size).toBe(2);
    expect(selection.ids()).toEqual(["m-alice", "m-bob"]);
    const rows = exportRows(selection, loaded);
    expect(rows.map((r) => r.id).sort()).toEqual(["m-alice", "m-bob"]);
  });

  it("falls back to the loaded rows when nothing is selected", () => {
    const selection = new MemberSelection();
    expect(exportRows(selection, [alice, carol]).map((r) => r.id)).toEqual(["m-alice", "m-carol"]);
    expect(exportRows(selection, undefined)).toEqual([]);
  });

  it("deselecting removes a member regardless of which page it came from", () => {
    const selection = new MemberSelection();
    selection.add(alice);
    selection.add(bob);
    selection.delete("m-alice");
    expect(selection.has("m-alice")).toBe(false);
    expect(exportRows(selection, []).map((r) => r.id)).toEqual(["m-bob"]);
  });

  it("refresh replaces snapshots with fresher rows of selected members only", () => {
    const selection = new MemberSelection();
    selection.add(alice);
    selection.refresh([{ ...alice, balance: 99 }, carol]);
    expect(selection.size).toBe(1);
    expect(selection.rows()[0].balance).toBe(99);
  });

  it("retain keeps only the retry targets after a partial bulk award", () => {
    const selection = new MemberSelection();
    [alice, bob, carol].forEach((row) => selection.add(row));
    selection.retain(["m-bob", "m-carol"]);
    expect(selection.ids()).toEqual(["m-bob", "m-carol"]);
    selection.clear();
    expect(selection.size).toBe(0);
  });

  it("ignores rows without an id and matches ids as strings", () => {
    const selection = new MemberSelection();
    selection.add(null);
    selection.add({ balance: 1 });
    selection.add({ id: 7 });
    expect(selection.size).toBe(1);
    expect(selection.has("7")).toBe(true);
    expect(selection.has(7)).toBe(true);
  });
});

describe("Audience React member-selection wiring", () => {
  it("exports from the selection model, not from the loaded page", () => {
    expect(audiencePage).toContain("const rows = exportRows(memberSelectionRef.current, members);");
    expect(audiencePage).not.toMatch(/\(members \|\| \[\]\)\.filter\(\(member\) => memberSelectionRef\.current\.has\(member\.id\)\)/);
  });

  it("never iterates MemberSelection directly; bulk award reads ids() from the model", () => {
    expect(new MemberSelection()[Symbol.iterator]).toBeUndefined();
    expect(() => [...new MemberSelection()]).toThrow(TypeError);
    expect(audiencePage).toContain("const ids = selection.ids();");
    expect(audiencePage).not.toMatch(/\[\.\.\.memberSelectionRef\.current\]|for \(const \w+ of memberSelectionRef\.current\)|Array\.from\(memberSelectionRef\.current\)/);
  });

  it("captures the row snapshot at selection time and refreshes it on every members fetch", () => {
    expect(audiencePage).toContain("if (checked && row) selection.add(row);");
    expect(audiencePage).toContain("memberSelectionRef.current.refresh(nextMembers);");
  });
});

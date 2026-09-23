import { describe, expect, it } from "bun:test";
import { isDeployed, pickLatestVersion } from "../../../../scripts/ensure-worker-deployed.mjs";

describe("pickLatestVersion", () => {
  it("picks the max version number even when created_on order disagrees", () => {
    const id = pickLatestVersion([
      { id: "old", number: 3, metadata: { created_on: "2026-01-05T00:00:00Z" } },
      { id: "new", number: 4, metadata: { created_on: "2026-01-01T00:00:00Z" } },
    ]);
    expect(id).toBe("new");
  });

  it("falls back to metadata.created_on when number is absent", () => {
    const id = pickLatestVersion([
      { id: "old", metadata: { created_on: "2026-01-01T00:00:00Z" } },
      { id: "new", metadata: { created_on: "2026-01-05T00:00:00Z" } },
    ]);
    expect(id).toBe("new");
  });

  it("returns null for an empty or malformed list", () => {
    expect(pickLatestVersion([])).toBeNull();
    expect(pickLatestVersion(undefined)).toBeNull();
    expect(pickLatestVersion([{ number: 2 }])).toBeNull();
  });
});

describe("isDeployed", () => {
  it("is true when the current deployment serves the version", () => {
    expect(
      isDeployed("v1", { versions: [{ version_id: "v1", percentage: 100 }] }),
    ).toBe(true);
  });

  it("is false when the deployment only serves other versions", () => {
    expect(
      isDeployed("v2", { versions: [{ version_id: "v1", percentage: 100 }] }),
    ).toBe(false);
    expect(isDeployed("v2", { versions: [] })).toBe(false);
    expect(isDeployed("v2", null)).toBe(false);
  });
});

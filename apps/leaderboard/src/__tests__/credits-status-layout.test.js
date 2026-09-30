import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../react/pages/rewards/page.tsx", import.meta.url), "utf8");

describe("shop dialog status placement", () => {
  it("renders save feedback before the dialog actions", () => {
    const formStart = source.indexOf("const shopForm =");
    const statusIndex = source.indexOf("<StatusText error={statusError}>{status}</StatusText>", formStart);
    const actionsIndex = source.indexOf("<DialogFooter", formStart);

    expect(formStart).toBeGreaterThan(-1);
    expect(statusIndex).toBeGreaterThan(formStart);
    expect(actionsIndex).toBeGreaterThan(-1);
    expect(statusIndex).toBeLessThan(actionsIndex);
    expect(source).toContain('role={error ? "alert" : "status"}');
  });
});

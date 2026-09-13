// Regression tests for normalizeEndsAt and validateScheduleDates (site.js).
//
// normalizeEndsAt: the dashboard always sends `endsAt`, using an empty string
// when no countdown date is set. Passing that "" straight into the ends_at
// timestamptz column made Postgres reject the whole save with 22007 ("invalid
// input syntax for type timestamp with time zone"), surfacing as a generic 500
// on "Save changes".
//
// validateScheduleDates: the server twin of the editor's schedule guardrails.
// It must reject only genuinely unusable values and must never fail a save for
// a field the client did not send (an omitted field keeps its stored value).
//
// Run: bun test src/__tests__/normalize-ends-at.test.js

import { describe, it, expect } from "bun:test";
import { normalizeEndsAt, validateScheduleDates } from "../site.js";

describe("normalizeEndsAt", () => {
  it("maps an empty string to null (blank countdown from the dashboard)", () => {
    expect(normalizeEndsAt("", "2026-01-01T00:00:00.000Z")).toBeNull();
  });

  it("maps a whitespace-only string to null", () => {
    expect(normalizeEndsAt("   ", null)).toBeNull();
  });

  it("maps explicit null to null", () => {
    expect(normalizeEndsAt(null, "2026-01-01T00:00:00.000Z")).toBeNull();
  });

  it("keeps a provided ISO timestamp", () => {
    const iso = "2026-08-01T12:30:00.000Z";
    expect(normalizeEndsAt(iso, null)).toBe(iso);
  });

  it("trims surrounding whitespace on a provided value", () => {
    const iso = "2026-08-01T12:30:00.000Z";
    expect(normalizeEndsAt(`  ${iso}  `, null)).toBe(iso);
  });

  it("keeps the existing value when the field is omitted (undefined)", () => {
    const existing = "2026-05-05T05:05:00.000Z";
    expect(normalizeEndsAt(undefined, existing)).toBe(existing);
  });

  it("returns null when omitted and there is no existing value", () => {
    expect(normalizeEndsAt(undefined, null)).toBeNull();
  });
});

describe("validateScheduleDates", () => {
  const now = Date.parse("2026-09-13T00:00:00.000Z");
  const inRange = "2027-01-01T00:00:00.000Z";

  it("accepts a blank schedule (no countdown configured)", () => {
    expect(validateScheduleDates({ startsAt: null, endsAt: null, now })).toEqual({
      startsAt: null,
      endsAt: null,
    });
  });

  it("accepts an in-range pair in the correct order", () => {
    const result = validateScheduleDates({
      startsAt: "2026-10-01T00:00:00.000Z",
      endsAt: inRange,
      sentStartsAt: true,
      sentEndsAt: true,
      now,
    });
    expect(result.error).toBeUndefined();
    expect(result.endsAt).toBe(inRange);
  });

  it("reports an unparseable start date as invalid, never as out of range", () => {
    const result = validateScheduleDates({
      startsAt: "not-a-date",
      endsAt: inRange,
      sentStartsAt: true,
      sentEndsAt: true,
      now,
    });
    expect(result.code).toBe("invalid_starts_at");
    expect(result.error).toBe("Start date must be a valid date and time.");
  });

  it("reports an unparseable end date as invalid, never as out of range", () => {
    const result = validateScheduleDates({
      startsAt: null,
      endsAt: "2026-13-45",
      sentStartsAt: false,
      sentEndsAt: true,
      now,
    });
    expect(result.code).toBe("invalid_ends_at");
    expect(result.error).toBe("End date must be a valid date and time.");
  });

  it("rejects a value outside the 10-year window when the client sent it", () => {
    const result = validateScheduleDates({
      startsAt: "2222-01-01T00:00:00.000Z",
      endsAt: null,
      sentStartsAt: true,
      sentEndsAt: false,
      now,
    });
    expect(result.code).toBe("invalid_starts_at");
    expect(result.error).toBe("Start date must be within 10 years of today.");
  });

  it("keeps a stored value that is out of range when the client omitted the field", () => {
    // An omitted field round-trips the stored row. A legacy out-of-range value
    // must not make an unrelated save fail.
    const result = validateScheduleDates({
      startsAt: "2222-01-01T00:00:00.000Z",
      endsAt: null,
      sentStartsAt: false,
      sentEndsAt: false,
      now,
    });
    expect(result.error).toBeUndefined();
    expect(result.startsAt).toBe("2222-01-01T00:00:00.000Z");
  });

  it("never fabricates a range error from an unusable reference clock", () => {
    for (const badNow of ["bad", NaN, Infinity]) {
      const result = validateScheduleDates({
        startsAt: "2222-01-01T00:00:00.000Z",
        endsAt: null,
        sentStartsAt: true,
        sentEndsAt: false,
        now: badNow,
      });
      expect(result.error).toBeUndefined();
    }
  });

  it("requires the end date to be strictly after the start date", () => {
    const equal = validateScheduleDates({
      startsAt: inRange,
      endsAt: inRange,
      sentStartsAt: true,
      sentEndsAt: true,
      now,
    });
    expect(equal.code).toBe("invalid_schedule");
    expect(equal.error).toBe("End date must be after the start date.");

    const reversed = validateScheduleDates({
      startsAt: "2027-06-01T00:00:00.000Z",
      endsAt: "2027-01-01T00:00:00.000Z",
      sentStartsAt: true,
      sentEndsAt: true,
      now,
    });
    expect(reversed.code).toBe("invalid_schedule");
  });

  it("compares ordering only between two usable instants", () => {
    const result = validateScheduleDates({
      startsAt: "not-a-date",
      endsAt: inRange,
      sentStartsAt: true,
      sentEndsAt: true,
      now,
    });
    // The syntactic error wins; no ordering error is layered on top.
    expect(result.code).toBe("invalid_starts_at");
  });
});

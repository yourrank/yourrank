import { describe, expect, it, beforeAll } from "bun:test";

let timeZoneOffsetLabel, timeZoneLabel, toLocalInput, fromLocalInput, validateScheduleValues;

beforeAll(async () => {
  globalThis.document = { querySelector: () => null };
  ({ timeZoneOffsetLabel, timeZoneLabel, toLocalInput, fromLocalInput, validateScheduleValues } = await import(
    "../assets/dashboard/utils.js"
  ));
});

describe("timezone labels and datetime-local conversion", () => {
  for (const timeZone of ["Europe/Paris", "America/New_York", "UTC"]) {
    it(`round-trips wall-clock input in ${timeZone}`, () => {
      for (const value of ["2026-07-15T20:00", "2026-01-15T20:00"]) {
        const iso = fromLocalInput(value, timeZone);
        expect(toLocalInput(iso, timeZone)).toBe(value);
      }
    });
  }

  it("round-trips instants on either side of the Paris DST switch", () => {
    for (const iso of ["2026-03-29T00:30:00.000Z", "2026-03-29T02:30:00.000Z"]) {
      expect(fromLocalInput(toLocalInput(iso, "Europe/Paris"), "Europe/Paris")).toBe(iso);
    }
  });

  it("derives the offset from the displayed instant", () => {
    expect(timeZoneOffsetLabel("2026-07-15T12:00:00.000Z", "Europe/Paris")).toBe("UTC+02:00");
    expect(timeZoneOffsetLabel("2026-01-15T12:00:00.000Z", "Europe/Paris")).toBe("UTC+01:00");
    expect(timeZoneLabel("2026-07-15T12:00:00.000Z", "Europe/Paris")).toBe("Europe/Paris (UTC+02:00)");
  });

  it("does not fabricate timezone values for invalid or unavailable inputs", () => {
    expect(timeZoneOffsetLabel("not-a-date", "Europe/Paris")).toBe("");
    expect(timeZoneOffsetLabel("", "Europe/Paris")).toBe("");
    expect(timeZoneLabel("not-a-date", "")).toBe("");
    expect(toLocalInput("", "Europe/Paris")).toBe("");
    expect(fromLocalInput("", "Europe/Paris")).toBe("");
  });

  it("preserves ambient-local conversion when the timezone is unavailable", () => {
    const value = "2026-07-15T20:00";
    const iso = new Date(value).toISOString();
    expect(fromLocalInput(value, "")).toBe(iso);
    expect(toLocalInput(iso, "")).toBe(value);
  });

  it("rejects schedules whose end does not follow the start", () => {
    const result = validateScheduleValues({
      startsValue: "2026-08-28T20:00",
      endsValue: "2026-08-28T19:00",
      timeZone: "Europe/Paris",
      now: "2026-08-28T12:00:00.000Z",
    });

    expect(result.startsAt).toBe("2026-08-28T18:00:00.000Z");
    expect(result.endsAt).toBe("2026-08-28T17:00:00.000Z");
    expect(result.invalid).toContainEqual({
      field: "ends",
      label: "Period end",
      message: "Choose an end time after the start time.",
    });
  });

  it("rejects implausibly distant schedule dates", () => {
    const result = validateScheduleValues({
      startsValue: "2040-08-28T20:00",
      endsValue: "",
      timeZone: "Europe/Paris",
      now: "2026-08-28T12:00:00.000Z",
    });

    expect(result.invalid).toContainEqual({
      field: "starts",
      label: "Period start",
      message: "Choose a date within 10 years of today.",
    });
    expect(result.invalid.some(({ field }) => field === "ends")).toBe(false);
  });
});

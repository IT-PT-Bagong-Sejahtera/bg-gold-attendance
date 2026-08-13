import {
  addCalendarDays,
  calendarDateInTimeZone,
  instantDateKey,
  startOfCalendarWeek,
  zonedDateTimeToUtc,
} from "./timezone";

describe("organization timezone helpers", () => {
  it("derives different organization dates from the same instant", () => {
    const instant = new Date("2026-08-10T16:30:00Z");
    expect(instantDateKey(instant, "Asia/Jakarta")).toBe("2026-08-10");
    expect(instantDateKey(instant, "Asia/Makassar")).toBe("2026-08-11");
  });

  it("converts organization midnight to the correct UTC boundary", () => {
    const date = { year: 2026, month: 8, day: 11 };
    expect(zonedDateTimeToUtc(date, "Asia/Jakarta").toISOString()).toBe(
      "2026-08-10T17:00:00.000Z",
    );
    expect(zonedDateTimeToUtc(date, "Asia/Makassar").toISOString()).toBe(
      "2026-08-10T16:00:00.000Z",
    );
  });

  it("handles daylight-saving offsets without a fixed-hour assumption", () => {
    const winter = zonedDateTimeToUtc(
      { year: 2026, month: 1, day: 15 },
      "America/New_York",
    );
    const summer = zonedDateTimeToUtc(
      { year: 2026, month: 7, day: 15 },
      "America/New_York",
    );
    expect(winter.toISOString()).toBe("2026-01-15T05:00:00.000Z");
    expect(summer.toISOString()).toBe("2026-07-15T04:00:00.000Z");
  });

  it("uses calendar arithmetic independent of the device timezone", () => {
    const date = calendarDateInTimeZone(
      new Date("2026-08-11T03:00:00Z"),
      "Asia/Jakarta",
    );
    expect(startOfCalendarWeek(date)).toEqual({ year: 2026, month: 8, day: 10 });
    expect(addCalendarDays(date, 21)).toEqual({ year: 2026, month: 9, day: 1 });
  });
});

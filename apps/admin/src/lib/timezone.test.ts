import {
  calendarDateInTimeZone,
  instantDateKey,
  instantToOrganizationLocalInput,
  organizationLocalInputToUtc,
} from "./timezone";
import { describe, expect, it } from "vitest";

describe("admin organization timezone", () => {
  it("groups instants by the organization date", () => {
    const instant = new Date("2026-08-10T16:30:00Z");
    expect(instantDateKey(instant, "Asia/Jakarta")).toBe("2026-08-10");
    expect(instantDateKey(instant, "Asia/Makassar")).toBe("2026-08-11");
    expect(calendarDateInTimeZone(instant, "Asia/Makassar")).toEqual({
      year: 2026,
      month: 8,
      day: 11,
    });
  });

  it("round-trips a datetime-local field in organization time", () => {
    const value = "2026-08-11T09:15";
    const instant = organizationLocalInputToUtc(value, "Asia/Jakarta");
    expect(instant.toISOString()).toBe("2026-08-11T02:15:00.000Z");
    expect(instantToOrganizationLocalInput(instant, "Asia/Jakarta")).toBe(value);
  });

  it("uses the correct daylight-saving offset", () => {
    expect(
      organizationLocalInputToUtc("2026-01-15T09:00", "America/New_York").toISOString(),
    ).toBe("2026-01-15T14:00:00.000Z");
    expect(
      organizationLocalInputToUtc("2026-07-15T09:00", "America/New_York").toISOString(),
    ).toBe("2026-07-15T13:00:00.000Z");
  });
});

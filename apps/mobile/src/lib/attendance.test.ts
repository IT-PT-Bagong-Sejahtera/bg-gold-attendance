import { actionLabel, primaryAttendanceAction } from "./attendance";

describe("attendance action mapping", () => {
  it("offers clock-in before work", () => expect(primaryAttendanceAction("NOT_STARTED")).toBe("CLOCK_IN"));
  it("offers clock-out while working", () => expect(primaryAttendanceAction("WORKING")).toBe("CLOCK_OUT"));
  it("blocks the main action while pending", () => expect(primaryAttendanceAction("PENDING")).toBeNull());
  it("does not allow another clock-in after the day is completed", () =>
    expect(primaryAttendanceAction("COMPLETED")).toBeNull());
  it("uses human action labels", () => expect(actionLabel("START_BREAK")).toBe("Mulai istirahat"));
});

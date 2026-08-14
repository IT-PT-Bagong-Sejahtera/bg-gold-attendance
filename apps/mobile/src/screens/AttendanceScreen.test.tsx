import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { api } from "../lib/api";
import {
  flushAttendanceOutbox,
  submitAttendanceResilient,
} from "../lib/offlineOutbox";
import { AttendanceScreen, scheduledBreakWindow } from "./AttendanceScreen";

jest.mock("../lib/auth", () => ({
  useAuth: () => ({ session: { accessToken: "test-access-token" } }),
}));

jest.mock("../lib/api", () => ({
  api: {
    me: jest.fn(),
    history: jest.fn(),
    today: jest.fn(),
    shifts: jest.fn(),
    policy: jest.fn(),
    action: jest.fn(),
    myAttendanceEvidence: jest.fn(),
  },
}));

jest.mock("../lib/offlineOutbox", () => ({
  flushAttendanceOutbox: jest.fn(),
  submitAttendanceResilient: jest.fn(),
}));
jest.mock("../lib/pushRegistration", () => ({
  registerPushDevice: jest.fn(async () => "device-1"),
}));

jest.mock("../lib/attendanceReconnect", () => ({
  subscribeAttendanceReconnect: jest.fn(() => jest.fn()),
}));

jest.mock("expo-location", () => ({
  Accuracy: { High: 4 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({
    status: "granted",
    granted: true,
  })),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: { latitude: -6.2, longitude: 106.8, accuracy: 9 },
    timestamp: Date.parse("2026-08-11T04:30:00Z"),
  })),
}));

jest.mock("expo-crypto", () => ({
  randomUUID: jest.fn(() => "scheduled-break-test-key"),
}));

const shift = {
  id: "shift-1",
  title: "Shift pagi",
  startsAt: "2026-08-11T01:00:00Z",
  endsAt: "2026-08-11T09:00:00Z",
  section: { id: "section-1", name: "HQ" },
};

const policy = {
  id: "policy-1",
  name: "HQ scheduled break",
  modes: ["ANYWHERE"],
  selfieRequired: false,
  earlyClockInMinutes: 0,
  lateClockInMinutes: 0,
  earlyClockOutMinutes: 0,
  lateClockOutMinutes: 0,
  preventEarlyClockIn: false,
  preventLateClockIn: false,
  preventEarlyClockOut: false,
  preventLateClockOut: false,
  scheduledBreakStartOffsetMinutes: 180,
  scheduledBreakEndOffsetMinutes: 240,
};

describe("scheduled break employee flow", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-11T03:00:00Z"));
    jest.clearAllMocks();
    (api.me as jest.Mock).mockResolvedValue({
      id: "user-1",
      email: "ayu@bggold.local",
      fullName: "Ayu Pratama",
      membershipId: "membership-1",
      organizationId: "organization-1",
      employeeNumber: "BG-017",
      roles: ["EMPLOYEE"],
    });
    (api.history as jest.Mock).mockResolvedValue([]);
    (api.today as jest.Mock).mockResolvedValue({
      state: "WORKING",
      activeShiftId: "shift-1",
      latestEvents: [],
    });
    (api.shifts as jest.Mock).mockResolvedValue([shift]);
    (api.action as jest.Mock).mockResolvedValue({
      decision: "APPROVED",
      attendanceState: "ON_BREAK",
    });
    (api.myAttendanceEvidence as jest.Mock).mockResolvedValue({
      eventId: "event-detail",
      actionType: "CLOCK_IN",
      decision: "APPROVED",
      source: "MOBILE",
      recordedAt: "2026-08-11T01:00:00Z",
      section: { id: "section-1", name: "BG GOLD Flagship" },
      location: { latitude: -6.2, longitude: 106.8, accuracyM: 7 },
      device: { id: "device-1", platform: "ANDROID", label: "Samsung Demo" },
    });
    (flushAttendanceOutbox as jest.Mock).mockResolvedValue({
      sent: 0,
      pending: 0,
      needsReview: 0,
    });
    (submitAttendanceResilient as jest.Mock).mockResolvedValue({
      queued: false,
    });
  });

  afterEach(() => jest.useRealTimers());

  it("shows the window and blocks a guarded early break", async () => {
    (api.policy as jest.Mock).mockResolvedValue({
      ...policy,
      preventUnscheduledBreak: true,
    });

    await render(<AttendanceScreen />);

    expect(
      await screen.findByText(
        "Tindakan akan aktif saat jadwal istirahat dimulai.",
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByText("Mulai istirahat"));
    expect(submitAttendanceResilient).not.toHaveBeenCalled();
  });

  it("opens an employee's own attendance evidence from the history row", async () => {
    jest.useRealTimers();
    const event = {
      id: "event-detail",
      actionType: "CLOCK_IN",
      decision: "APPROVED",
      recordedAt: "2026-08-11T01:00:00Z",
    };
    (api.history as jest.Mock).mockResolvedValue([event]);
    (api.policy as jest.Mock).mockResolvedValue(policy);

    await render(<AttendanceScreen />);
    await fireEvent.press(
      await screen.findByRole("button", {
        name: "Lihat detail absensi Clock in",
      }),
    );

    expect(await screen.findByText("DETAIL ABSENSI ANDA")).toBeTruthy();
    expect(screen.getByText("BG GOLD Flagship")).toBeTruthy();
    expect(screen.getByText("Samsung Demo")).toBeTruthy();
    expect(api.myAttendanceEvidence).toHaveBeenCalledWith(
      "test-access-token",
      "event-detail",
    );
  });

  it("submits an in-window scheduled break without approval copy", async () => {
    jest.setSystemTime(new Date("2026-08-11T04:30:00Z"));
    (api.policy as jest.Mock).mockResolvedValue({
      ...policy,
      preventUnscheduledBreak: true,
    });

    await render(<AttendanceScreen />);

    expect(
      await screen.findByText("Jadwal istirahat sedang berlangsung."),
    ).toBeTruthy();
    await fireEvent.press(screen.getByText("Mulai istirahat"));
    await waitFor(() => {
      expect(submitAttendanceResilient).toHaveBeenCalledWith(
        "test-access-token",
        {
          organizationId: "organization-1",
          membershipId: "membership-1",
        },
        "scheduled-break-test-key",
        expect.objectContaining({ type: "START_BREAK" }),
      );
    });
    await waitFor(() => expect(api.today).toHaveBeenCalledTimes(2));
  });

  it("shows an optimistic pending event when the connection is unavailable", async () => {
    jest.setSystemTime(new Date("2026-08-11T04:30:00Z"));
    (api.policy as jest.Mock).mockResolvedValue({
      ...policy,
      preventUnscheduledBreak: true,
    });
    (submitAttendanceResilient as jest.Mock).mockResolvedValue({ queued: true });

    await render(<AttendanceScreen />);
    await fireEvent.press(await screen.findByText("Mulai istirahat"));

    expect(
      await screen.findByText(/Tindakan tersimpan di perangkat/),
    ).toBeTruthy();
    expect(screen.getByText("Menunggu")).toBeTruthy();
    expect(api.today).toHaveBeenCalledTimes(1);
  });

  it("submits a reasoned work-more request and renders its pending result", async () => {
    jest.useRealTimers();
    const pendingEvent = {
      id: "work-more-event",
      actionType: "WORK_MORE",
      decision: "PENDING",
      recordedAt: "2026-08-11T10:30:00Z",
      reason: "Menuntaskan rekonsiliasi stok emas",
    };
    (api.today as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce({ state: "COMPLETED", latestEvents: [] })
      .mockResolvedValue({ state: "PENDING", latestEvents: [pendingEvent] });
    (api.history as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValue([pendingEvent]);
    (api.shifts as jest.Mock).mockResolvedValue([]);
    (api.policy as jest.Mock).mockResolvedValue({
      ...policy,
      preventUnscheduledBreak: false,
      workMoreRequiresApproval: true,
    });

    await render(<AttendanceScreen />);
    fireEvent.changeText(
      await screen.findByLabelText("Alasan kerja tambahan"),
      "Menuntaskan rekonsiliasi stok emas",
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Kerja tambahan" }).props
          .accessibilityState.disabled,
      ).toBe(false),
    );
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Kerja tambahan" }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(submitAttendanceResilient).toHaveBeenCalledWith(
        "test-access-token",
        {
          organizationId: "organization-1",
          membershipId: "membership-1",
        },
        "scheduled-break-test-key",
        expect.objectContaining({
          type: "WORK_MORE",
          reason: "Menuntaskan rekonsiliasi stok emas",
        }),
      ),
    );
    await waitFor(() => expect(api.history).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Menunggu")).toBeTruthy();
  });

  it("explains and renders an approved-path request for an unscheduled break", async () => {
    jest.useRealTimers();
    const pendingEvent = {
      id: "break-request-event",
      actionType: "START_BREAK",
      decision: "PENDING",
      recordedAt: new Date().toISOString(),
    };
    (api.today as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce({
        state: "WORKING",
        activeShiftId: "shift-1",
        latestEvents: [],
      })
      .mockResolvedValue({ state: "PENDING", latestEvents: [pendingEvent] });
    (api.history as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValue([pendingEvent]);
    (api.policy as jest.Mock).mockResolvedValue({
      ...policy,
      preventUnscheduledBreak: false,
      unscheduledBreakRequiresApproval: true,
      scheduledBreakStartOffsetMinutes: 1_000,
      scheduledBreakEndOffsetMinutes: 1_060,
    });

    await render(<AttendanceScreen />);
    expect(
      await screen.findByText(
        "Di luar jadwal, permintaan akan menunggu persetujuan.",
      ),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Mulai istirahat" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(api.history).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Menunggu")).toBeTruthy();
  });
});

describe("scheduledBreakWindow", () => {
  it("uses an inclusive opening and exclusive closing boundary", () => {
    expect(
      scheduledBreakWindow(policy, shift, new Date("2026-08-11T04:00:00Z"))
        ?.status,
    ).toBe("OPEN");
    expect(
      scheduledBreakWindow(policy, shift, new Date("2026-08-11T05:00:00Z"))
        ?.status,
    ).toBe("AFTER");
  });
});

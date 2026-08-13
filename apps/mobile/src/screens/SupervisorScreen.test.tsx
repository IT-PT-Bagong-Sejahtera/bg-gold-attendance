import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { api } from "../lib/api";
import { SupervisorScreen } from "./SupervisorScreen";

jest.mock("../lib/auth", () => ({
  useAuth: () => ({ session: { accessToken: "supervisor-token" } }),
}));

jest.mock("../lib/api", () => ({
  api: {
    me: jest.fn(async () => ({ timezone: "Asia/Jakarta" })),
    supervisorAttendanceRequests: jest.fn(),
    supervisorLeaveRequests: jest.fn(async () => []),
    supervisorClaims: jest.fn(async () => []),
    supervisorShiftRequests: jest.fn(async () => []),
    supervisorAttendanceReport: jest.fn(async () => ({
      date: "2026-08-12",
      generatedAt: "2026-08-13T02:00:00Z",
      organizationName: "BG GOLD · Ruang Demo",
      rows: [
        {
          membershipId: "employee-1",
          employeeName: "Ayu Demo",
          employeeNumber: "BG-DEMO-01",
          sectionName: "BG GOLD Flagship",
          shiftTitle: "Shift Galeri Utama",
          shiftStartsAt: "2026-08-12T02:00:00Z",
          shiftEndsAt: "2026-08-12T10:00:00Z",
          clockInAt: "2026-08-12T01:55:00Z",
          clockOutAt: "2026-08-12T10:05:00Z",
          workMinutes: 490,
          status: "ON_TIME",
        },
      ],
    })),
    decideAttendanceRequest: jest.fn(async () => ({
      id: "attendance-request-1",
      status: "APPROVED",
    })),
    decideLeaveRequest: jest.fn(),
    decideClaim: jest.fn(),
    decideShiftRequest: jest.fn(),
  },
}));

it("loads and approves a supervisor attendance request", async () => {
  (api.supervisorAttendanceRequests as jest.Mock)
    .mockResolvedValueOnce([
      {
        id: "attendance-request-1",
        eventId: "event-1",
        membershipId: "employee-1",
        employeeName: "Dimas Pratama",
        employeeNumber: "BG-0214",
        actionType: "CLOCK_IN",
        status: "PENDING",
        requestedAt: "2026-08-13T02:00:00Z",
        recordedAt: "2026-08-13T01:55:00Z",
        reason: "GPS sempat tidak stabil.",
      },
    ])
    .mockResolvedValue([]);

  await render(<SupervisorScreen />);

  expect(await screen.findByText("Dimas Pratama")).toBeTruthy();
  await fireEvent.press(
    screen.getByRole("button", {
      name: "Setujui permintaan Dimas Pratama",
    }),
  );

  await waitFor(() =>
    expect(api.decideAttendanceRequest).toHaveBeenCalledWith(
      "supervisor-token",
      "attendance-request-1",
      "APPROVED",
      "",
    ),
  );
  expect(
    await screen.findByText("Permintaan disetujui dan antrean diperbarui."),
  ).toBeTruthy();
});

it("opens the all-employee attendance result", async () => {
  (api.supervisorAttendanceRequests as jest.Mock).mockResolvedValue([]);

  await render(<SupervisorScreen />);
  await fireEvent.press(
    screen.getByRole("tab", { name: "Hasil absensi" }),
  );

  expect(await screen.findByText("Ayu Demo")).toBeTruthy();
  expect(screen.getByText("Semua karyawan")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Export Excel semua karyawan" }),
  ).toBeTruthy();
  expect(api.supervisorAttendanceReport).toHaveBeenCalledWith(
    "supervisor-token",
  );
  await fireEvent.press(screen.getByRole("button", { name: "Lihat detail absensi Ayu Demo" }));
  expect(await screen.findByText("DETAIL ABSENSI")).toBeTruthy();
  expect(screen.getAllByText("Shift Galeri Utama").length).toBeGreaterThan(1);
});

it("keeps approved items visible and opens attendance evidence", async () => {
  (api.supervisorAttendanceRequests as jest.Mock).mockImplementation(
    async (_token: string, status?: string) =>
      status === "APPROVED"
        ? [{
            id: "approved-1", eventId: "event-approved", membershipId: "employee-2",
            employeeName: "Raka Wijaya", employeeNumber: "BG-0261", actionType: "CLOCK_OUT",
            status: "APPROVED", requestedAt: "2026-08-12T10:10:00Z", recordedAt: "2026-08-12T10:05:00Z",
            source: "MOBILE", latitude: -6.2, longitude: 106.8, accuracyM: 9,
            attachmentId: "private-photo", decisionReason: "Bukti sesuai.",
          }]
        : [],
  );
  await render(<SupervisorScreen />);
  await fireEvent.press(screen.getByRole("tab", { name: "Disetujui" }));
  expect(await screen.findByText("Raka Wijaya")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Lihat detail absensi Raka Wijaya" }));
  expect(await screen.findByText("Tersimpan sebagai bukti privat")).toBeTruthy();
  expect(screen.getByText("-6.200000, 106.800000")).toBeTruthy();
});

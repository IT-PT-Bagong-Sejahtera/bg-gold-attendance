import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { api } from "../lib/api";
import { ScheduleScreen } from "./ScheduleScreen";

jest.mock("../lib/auth", () => ({
  useAuth: () => ({ session: { accessToken: "schedule-test-token" } }),
}));

jest.mock("../lib/api", () => ({
  api: {
    me: jest.fn(),
    shifts: jest.fn(),
    openShifts: jest.fn(),
    requestShift: jest.fn(),
  },
}));

describe("ScheduleScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.me as jest.Mock).mockReset();
    (api.shifts as jest.Mock).mockReset();
    (api.openShifts as jest.Mock).mockReset();
    (api.requestShift as jest.Mock).mockReset();
    (api.me as jest.Mock).mockResolvedValue({
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  it("reserves list space while the schedule is loading", async () => {
    (api.shifts as jest.Mock).mockReturnValue(new Promise(() => undefined));
    (api.openShifts as jest.Mock).mockReturnValue(new Promise(() => undefined));
    const view = await render(<ScheduleScreen />);
    expect(
      screen.getByLabelText("Memuat jadwal kerja"),
    ).toBeTruthy();
    view.unmount();
  });

  it("offers an inline retry after a loading error", async () => {
    (api.shifts as jest.Mock)
      .mockRejectedValueOnce(new Error("Jaringan belum tersambung."))
      .mockResolvedValueOnce([
        {
          id: "shift-retry",
          title: "Shift setelah tersambung",
          startsAt: "2026-08-12T02:00:00Z",
          endsAt: "2026-08-12T10:00:00Z",
          section: { id: "section-1", name: "BG GOLD HQ" },
        },
      ]);
    (api.openShifts as jest.Mock).mockResolvedValue([]);
    await render(<ScheduleScreen />);
    expect(await screen.findByText("Jaringan belum tersambung.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByText("Shift setelah tersambung")).toBeTruthy();
  });

  it("retries organization timezone bootstrap before loading a period", async () => {
    (api.me as jest.Mock)
      .mockRejectedValueOnce(new Error("Identitas organisasi belum tersedia."))
      .mockResolvedValueOnce({ timezone: "Asia/Jakarta" });
    (api.shifts as jest.Mock).mockResolvedValue([
      {
        id: "shift-timezone-retry",
        title: "Shift setelah identitas siap",
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        section: { id: "section-1", name: "BG GOLD HQ" },
      },
    ]);
    (api.openShifts as jest.Mock).mockResolvedValue([]);

    await render(<ScheduleScreen />);
    expect(
      await screen.findByText("Identitas organisasi belum tersedia."),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByText("Shift setelah identitas siap")).toBeTruthy();
    expect(api.me).toHaveBeenCalledTimes(2);
  });

  it("renders the employee's published schedule from the API", async () => {
    (api.shifts as jest.Mock).mockResolvedValue([
      {
        id: "shift-1",
        title: "Shift Operasional",
        roleName: "Gold Operations",
        startsAt: "2026-08-12T02:00:00Z",
        endsAt: "2026-08-12T10:00:00Z",
        section: { id: "section-1", name: "BG GOLD Head Office" },
      },
    ]);
    (api.openShifts as jest.Mock).mockResolvedValue([]);

    await render(<ScheduleScreen />);

    expect(await screen.findByText("Shift Operasional")).toBeTruthy();
    expect(screen.getByText("BG GOLD Head Office")).toBeTruthy();
    expect(screen.getByText("Gold Operations")).toBeTruthy();
    expect(api.shifts).toHaveBeenCalledWith(
      "schedule-test-token",
      expect.any(String),
      expect.any(String),
    );
  });

  it("requests an available open shift and shows its pending state", async () => {
    (api.shifts as jest.Mock).mockResolvedValue([]);
    (api.openShifts as jest.Mock).mockResolvedValue([{ id: "open-1", title: "Shift Weekend", startsAt: "2026-08-15T02:00:00Z", endsAt: "2026-08-15T10:00:00Z", section: { id: "section-1", name: "BG GOLD HQ" } }]);
    (api.requestShift as jest.Mock).mockResolvedValue({ id: "request-1", status: "PENDING" });
    await render(<ScheduleScreen />);
    const requestButton = await screen.findByText("Minta shift");
    await act(async () => {
      fireEvent.press(requestButton);
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(api.requestShift).toHaveBeenCalledWith("schedule-test-token", "open-1"));
    expect(await screen.findByText("Menunggu")).toBeTruthy();
    expect(screen.getByText("Permintaan shift dikirim untuk ditinjau supervisor.")).toBeTruthy();
  });

  it("provides distinct day, week, and calendar schedule views", async () => {
    const today = new Date();
    today.setHours(9, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setHours(17, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowEnd = new Date(tomorrow);
    tomorrowEnd.setHours(17, 0, 0, 0);
    (api.shifts as jest.Mock).mockResolvedValue([
      {
        id: "today-shift",
        title: "Shift Hari Ini",
        startsAt: today.toISOString(),
        endsAt: todayEnd.toISOString(),
        section: { id: "section-1", name: "BG GOLD HQ" },
      },
      {
        id: "tomorrow-shift",
        title: "Shift Besok",
        startsAt: tomorrow.toISOString(),
        endsAt: tomorrowEnd.toISOString(),
        section: { id: "section-1", name: "BG GOLD HQ" },
      },
    ]);
    (api.openShifts as jest.Mock).mockResolvedValue([]);

    await render(<ScheduleScreen />);

    const weekTab = screen.getByRole("tab", {
      name: "Tampilan jadwal mingguan",
    });
    expect(weekTab.props.accessibilityState).toEqual({ selected: true });
    expect(await screen.findByText("Shift Hari Ini")).toBeTruthy();
    expect(screen.getByText("Shift Besok")).toBeTruthy();

    await act(async () => {
      fireEvent.press(
        screen.getByRole("tab", { name: "Tampilan jadwal harian" }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(
        screen.getByRole("tab", { name: "Tampilan jadwal harian" }).props
          .accessibilityState,
      ).toEqual({ selected: true }),
    );
    expect(screen.getByText("Shift Hari Ini")).toBeTruthy();
    expect(screen.queryByText("Shift Besok")).toBeNull();

    await act(async () => {
      fireEvent.press(
        screen.getByRole("tab", { name: "Tampilan jadwal kalender" }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      await screen.findByRole("tab", { name: "Tampilan jadwal kalender" }),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: /Pilih .+, \d+ shift/ }).length,
    ).toBeGreaterThan(27);
    expect(screen.getByText("Shift Hari Ini")).toBeTruthy();
  });

  it("loads a new API range when the employee changes week", async () => {
    (api.shifts as jest.Mock).mockResolvedValue([]);
    (api.openShifts as jest.Mock).mockResolvedValue([]);
    await render(<ScheduleScreen />);
    await waitFor(() => expect(api.shifts).toHaveBeenCalledTimes(1));
    const firstFrom = new Date((api.shifts as jest.Mock).mock.calls[0][1]);

    await act(async () => {
      fireEvent.press(
        screen.getByRole("button", { name: "Minggu berikutnya" }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(api.shifts).toHaveBeenCalledTimes(2));
    const secondFrom = new Date((api.shifts as jest.Mock).mock.calls[1][1]);
    expect(secondFrom.getTime() - firstFrom.getTime()).toBe(
      7 * 24 * 60 * 60 * 1000,
    );
    expect(
      screen.getByRole("button", { name: "Kembali ke hari ini" }),
    ).toBeTruthy();
  });
});

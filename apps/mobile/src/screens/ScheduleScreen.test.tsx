import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { api } from "../lib/api";
import { ScheduleScreen } from "./ScheduleScreen";

jest.mock("@react-navigation/native", () => {
  const React = require("react");
  return {
    useFocusEffect: (callback: () => void) => React.useEffect(callback, [callback]),
  };
});

jest.mock("../lib/auth", () => ({
  useAuth: () => ({ session: { accessToken: "schedule-test-token" } }),
}));

jest.mock("../lib/api", () => ({
  api: {
    me: jest.fn(),
    shifts: jest.fn(),
    openShifts: jest.fn(),
    requestShift: jest.fn(),
    supervisorShifts: jest.fn(),
    employees: jest.fn(),
    sections: jest.fn(),
    createShift: jest.fn(),
    updateShiftParticipants: jest.fn(),
  },
}));

describe("ScheduleScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (api.me as jest.Mock).mockReset();
    (api.shifts as jest.Mock).mockReset();
    (api.openShifts as jest.Mock).mockReset();
    (api.requestShift as jest.Mock).mockReset();
    (api.supervisorShifts as jest.Mock).mockReset();
    (api.employees as jest.Mock).mockReset();
    (api.sections as jest.Mock).mockReset();
    (api.createShift as jest.Mock).mockReset();
    (api.updateShiftParticipants as jest.Mock).mockReset();
    (api.me as jest.Mock).mockResolvedValue({
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      roles: ["EMPLOYEE"],
    });
    (api.supervisorShifts as jest.Mock).mockResolvedValue([]);
    (api.employees as jest.Mock).mockResolvedValue([]);
    (api.sections as jest.Mock).mockResolvedValue([]);
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

  it("opens a shift and shows the coworkers assigned with the employee", async () => {
    const startsAt = new Date();
    startsAt.setHours(9, 0, 0, 0);
    const endsAt = new Date(startsAt);
    endsAt.setHours(17, 0, 0, 0);
    (api.shifts as jest.Mock).mockResolvedValue([
      {
        id: "shift-detail",
        title: "Shift Galeri Utama",
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        section: { id: "section-1", name: "BG GOLD Flagship" },
        participants: [
          {
            membershipId: "employee-2",
            employeeName: "Dimas Pratama",
            employeeNumber: "BG-0214",
          },
        ],
      },
    ]);
    (api.openShifts as jest.Mock).mockResolvedValue([]);

    await render(<ScheduleScreen />);
    await fireEvent.press(
      await screen.findByRole("button", {
        name: "Lihat detail jadwal Shift Galeri Utama",
      }),
    );

    expect(await screen.findByText("KARYAWAN BERTUGAS")).toBeTruthy();
    expect(screen.getByText("Dimas Pratama")).toBeTruthy();
    expect(screen.getByText("BG-0214")).toBeTruthy();
  });

  it("lets a supervisor choose and save the employees on a shift", async () => {
    const startsAt = new Date();
    startsAt.setHours(9, 0, 0, 0);
    const endsAt = new Date(startsAt);
    endsAt.setHours(17, 0, 0, 0);
    (api.me as jest.Mock).mockResolvedValue({
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      roles: ["SUPERVISOR"],
    });
    (api.supervisorShifts as jest.Mock).mockResolvedValue([
      {
        id: "team-shift",
        title: "Layanan Pelanggan",
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        status: "PUBLISHED",
        section: { id: "section-1", name: "BG GOLD Flagship" },
        participants: [],
      },
    ]);
    (api.employees as jest.Mock).mockResolvedValue([
      {
        id: "employee-dimas",
        fullName: "Dimas Pratama",
        email: "dimas@bggold.test",
        employeeNumber: "BG-0214",
        jobTitle: "Retail Associate",
        status: "ACTIVE",
        roles: ["EMPLOYEE"],
      },
    ]);
    (api.openShifts as jest.Mock).mockResolvedValue([]);
    (api.updateShiftParticipants as jest.Mock).mockResolvedValue({
      id: "team-shift",
      membershipIds: ["employee-dimas"],
    });

    await render(<ScheduleScreen />);
    await fireEvent.press(
      await screen.findByRole("button", {
        name: "Lihat detail jadwal Layanan Pelanggan",
      }),
    );
    await fireEvent.press(
      screen.getByRole("checkbox", {
        name: "Tambahkan Dimas Pratama dari shift",
      }),
    );
    await fireEvent.press(screen.getByText("Simpan peserta jadwal"));

    await waitFor(() =>
      expect(api.updateShiftParticipants).toHaveBeenCalledWith(
        "schedule-test-token",
        "team-shift",
        ["employee-dimas"],
      ),
    );
    expect(await screen.findByText("Peserta shift berhasil diperbarui.")).toBeTruthy();
  });

  it("creates a custom calendar event with a supervisor-entered showroom", async () => {
    (api.me as jest.Mock).mockResolvedValue({
      timezone: "Asia/Jakarta",
      roles: ["SUPERVISOR"],
    });
    (api.supervisorShifts as jest.Mock).mockResolvedValue([]);
    (api.openShifts as jest.Mock).mockResolvedValue([]);
    (api.employees as jest.Mock).mockResolvedValue([
      {
        id: "employee-ayu",
        fullName: "Ayu Pratama",
        email: "ayu@bggold.test",
        employeeNumber: "BG-017",
        status: "ACTIVE",
        roles: ["EMPLOYEE"],
      },
    ]);
    (api.sections as jest.Mock).mockResolvedValue([
      {
        id: "section-jakarta",
        code: "JKT",
        name: "Area Jakarta",
        status: "ACTIVE",
      },
    ]);
    (api.createShift as jest.Mock).mockResolvedValue({ id: "event-custom-1" });

    await render(<ScheduleScreen />);
    const addButton = await screen.findByRole("button", {
      name: /Tambah event pada/,
    });
    await fireEvent.press(addButton);
    await fireEvent.changeText(
      screen.getByLabelText("Nama event custom"),
      "Private Preview Aurum",
    );
    await fireEvent.changeText(
      screen.getByLabelText("Nama showroom event"),
      "Showroom BG GOLD Senayan",
    );
    await fireEvent.press(
      screen.getByRole("checkbox", {
        name: "Pilih Ayu Pratama untuk event",
      }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Terbitkan event custom" }),
    );

    await waitFor(() =>
      expect(api.createShift).toHaveBeenCalledWith(
        "schedule-test-token",
        expect.objectContaining({
          sectionId: "section-jakarta",
          title: "Private Preview Aurum",
          scheduleType: "EVENT",
          showroomName: "Showroom BG GOLD Senayan",
          publish: true,
          open: false,
          membershipIds: ["employee-ayu"],
        }),
      ),
    );
    expect(
      await screen.findByText(
        "Private Preview Aurum ditambahkan di Showroom BG GOLD Senayan untuk 1 karyawan.",
      ),
    ).toBeTruthy();
  });

  it("guides a supervisor through the schedule and custom-event flow", async () => {
    (api.me as jest.Mock).mockResolvedValue({
      timezone: "Asia/Jakarta",
      roles: ["SUPERVISOR"],
    });
    (api.supervisorShifts as jest.Mock).mockResolvedValue([]);
    (api.openShifts as jest.Mock).mockResolvedValue([]);
    (api.employees as jest.Mock).mockResolvedValue([]);
    (api.sections as jest.Mock).mockResolvedValue([]);

    await render(<ScheduleScreen />);
    await fireEvent.press(
      await screen.findByRole("button", { name: "Buka tutorial jadwal" }),
    );

    expect(screen.getByText("LANGKAH 1 / 4")).toBeTruthy();
    expect(screen.getByText("Pilih cara melihat jadwal")).toBeTruthy();

    await fireEvent.press(
      screen.getByRole("button", { name: "Lanjutkan tutorial" }),
    );
    expect(screen.getByText("Berpindah tanggal dan periode")).toBeTruthy();

    await fireEvent.press(
      screen.getByRole("button", { name: "Lanjutkan tutorial" }),
    );
    expect(screen.getByText("Tambahkan event custom")).toBeTruthy();
    expect(
      screen.getByText(/mengisi nama event, showroom, jam, dan karyawan/),
    ).toBeTruthy();

    await fireEvent.press(
      screen.getByRole("button", { name: "Lanjutkan tutorial" }),
    );
    expect(screen.getByText("Buka dan atur peserta")).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", { name: "Selesaikan tutorial" }),
    );
    expect(screen.queryByText("Buka dan atur peserta")).toBeNull();
  });

  it("lets an employee skip the schedule tutorial", async () => {
    (api.shifts as jest.Mock).mockResolvedValue([]);
    (api.openShifts as jest.Mock).mockResolvedValue([]);

    await render(<ScheduleScreen />);
    await fireEvent.press(
      await screen.findByRole("button", { name: "Buka tutorial jadwal" }),
    );
    expect(screen.getByText("LANGKAH 1 / 3")).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", { name: "Lewati tutorial" }),
    );
    expect(screen.queryByText("Pilih cara melihat jadwal")).toBeNull();
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

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
import { AuthProvider } from "./lib/auth";
import { App } from "./App";

async function expectNoSeriousAccessibilityViolations() {
  const results = await axe.run(document.body, {
    // jsdom has no canvas implementation, so contrast is verified separately
    // against the design tokens instead of relying on axe's pixel sampler.
    rules: { "color-contrast": { enabled: false } },
  });
  expect(
    results.violations.filter(
      (violation) =>
        violation.impact === "critical" || violation.impact === "serious",
    ),
  ).toEqual([]);
}

describe("App", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("shows the BG GOLD login when there is no session", async () => {
    localStorage.clear();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole("heading", { name: "Masuk ke ruang kerja" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /masuk/i })).toBeInTheDocument();
    await expectNoSeriousAccessibilityViolations();
  });

  it("lets a manager approve a pending attendance request", async () => {
    localStorage.setItem(
      "bg-gold.session",
      JSON.stringify({
        accessToken: "access-token",
        accessExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        refreshToken: "refresh-token",
        refreshExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    );
    let decided = false;
    let geofencePolicy: Record<string, unknown> | undefined;
    let correctionCreated = false;
    let shiftRequestDecided = false;
    let leaveRequestDecided = false;
    let leaveTypeCreated = false;
    let leaveBalanceSet = false;
    let claimRequestDecided = false;
    let claimTypeCreated = false;
    let announcementCreated = false;
    const response = (data: unknown, status = 200) =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => ({ data, requestId: "test-request" }),
      }) as Response;
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/audit-logs?")) {
          return response([{ id: "audit-1", action: "policy.create", resourceType: "attendance_policy", resourceId: "policy-1", actorUserId: "user-1", actorName: "Admin BG GOLD", actorEmail: "admin@bggold.local", requestId: "request-audit-1", createdAt: "2026-08-11T01:00:00Z" }]);
        }
        if (url.endsWith("/announcements") && init?.method === "POST") {
          announcementCreated = true;
          return response({ id: "announcement-1", status: "PUBLISHED" }, 201);
        }
        if (url.endsWith("/claims/claim-1/decision") && init?.method === "POST") {
          claimRequestDecided = true;
          return response({ id: "claim-1", status: "APPROVED" });
        }
        if (url.includes("/claims?status=PENDING")) {
          return response(claimRequestDecided ? [] : [{ id: "claim-1", membershipId: "membership-2", employeeName: "Dimas Saputra", employeeNumber: "BG-021", claimTypeId: "travel", claimTypeName: "Perjalanan Dinas", title: "Taksi ke outlet", amount: 175000, currency: "IDR", incurredOn: "2026-08-11", notes: "Transportasi outlet", status: "PENDING", ocrStatus: "NOT_CONFIGURED", requestedAt: "2026-08-11T01:00:00Z" }]);
        }
        if (url.endsWith("/claim-types") && init?.method === "POST") {
          claimTypeCreated = true;
          return response({ id: "meals" }, 201);
        }
        if (url.endsWith("/claim-types")) {
          return response([{ id: "travel", code: "TRAVEL", name: "Perjalanan Dinas", receiptRequired: true, status: "ACTIVE" }, ...(claimTypeCreated ? [{ id: "meals", code: "MEALS", name: "Konsumsi", receiptRequired: true, status: "ACTIVE" }] : [])]);
        }
        if (url.endsWith("/leave-requests/leave-request-1/decision") && init?.method === "POST") {
          leaveRequestDecided = true;
          return response({ id: "leave-request-1", status: "APPROVED" });
        }
        if (url.includes("/leave-requests?status=PENDING")) {
          return response(leaveRequestDecided ? [] : [{ id: "leave-request-1", membershipId: "membership-2", employeeName: "Dimas Saputra", employeeNumber: "BG-021", leaveTypeId: "annual", leaveTypeName: "Cuti Tahunan", startsOn: "2026-09-14", endsOn: "2026-09-16", totalDays: 3, reason: "Keperluan keluarga", status: "PENDING", requestedAt: "2026-08-11T01:00:00Z" }]);
        }
        if (url.endsWith("/leave-types") && init?.method === "POST") {
          leaveTypeCreated = true;
          return response({ id: "medical" }, 201);
        }
        if (url.endsWith("/leave-types")) {
          return response([{ id: "annual", code: "ANNUAL", name: "Cuti Tahunan", paid: true, status: "ACTIVE" }, ...(leaveTypeCreated ? [{ id: "medical", code: "MEDICAL", name: "Cuti Sakit", paid: true, status: "ACTIVE" }] : [])]);
        }
        if (url.endsWith("/leave-balances") && init?.method === "POST") {
          leaveBalanceSet = true;
          return response({ id: "balance-1", entitlementDays: 12 });
        }
        if (
          url.endsWith("/attendance/requests/request-1/decision") &&
          init?.method === "POST"
        ) {
          decided = true;
          return response({ id: "request-1", status: "APPROVED" });
        }
        if (url.endsWith("/shift-requests/shift-request-1/decision") && init?.method === "POST") {
          shiftRequestDecided = true;
          return response({ id: "shift-request-1", status: "APPROVED" });
        }
        if (url.includes("/shift-requests?status=PENDING")) {
          return response(shiftRequestDecided ? [] : [{ id: "shift-request-1", shiftId: "open-1", shiftTitle: "Open Shift Weekend", membershipId: "membership-2", employeeName: "Dimas Saputra", employeeNumber: "BG-021", status: "PENDING", requestedAt: "2026-08-11T01:00:00Z", reason: "Saya tersedia" }]);
        }
        if (url.endsWith("/attendance/corrections") && init?.method === "POST") {
          correctionCreated = true;
          return response({ id: "correction-1" }, 201);
        }
        if (url.includes("/attendance/records?")) {
          return response([
            {
              id: "attendance-record-1",
              membershipId: "membership-1",
              employeeName: "Dimas Saputra",
              employeeNumber: "BG-021",
              actionType: "CLOCK_IN",
              decision: "APPROVED",
              recordedAt: "2026-08-11T01:00:00Z",
              latestCorrection: correctionCreated
                ? {
                    eventId: "correction-1",
                    correctedActionType: "CLOCK_OUT",
                    correctedRecordedAt: "2026-08-11T09:00:00Z",
                    reason: "Perbaikan catatan supervisor",
                    createdAt: "2026-08-11T10:00:00Z",
                  }
                : undefined,
            },
          ]);
        }
        if (
          url.endsWith("/sections/section-1/dynamic-qr") &&
          init?.method === "POST"
        ) {
          return response(
            {
              token: "signed-dynamic-qr-token",
              sectionId: "section-1",
              expiresAt: new Date(Date.now() + 45_000).toISOString(),
            },
            201,
          );
        }
        if (url.endsWith("/policies/policy-geofence") && init?.method === "PATCH") {
          geofencePolicy = { ...(geofencePolicy ?? {}), ...(JSON.parse(String(init.body)) as Record<string, unknown>) };
          return response({ id: "policy-geofence", version: 2 });
        }
        if (url.endsWith("/policies/policy-geofence/archive") && init?.method === "POST") {
          geofencePolicy = geofencePolicy ? { ...geofencePolicy, status: "ARCHIVED" } : undefined;
          return response({ id: "policy-geofence", status: "ARCHIVED" });
        }
        if (url.endsWith("/policies") && init?.method === "POST") {
          const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
          geofencePolicy = {
            id: "policy-geofence",
            ...payload,
            status: "ACTIVE",
          };
          return response({ id: "policy-geofence" }, 201);
        }
        if (url.endsWith("/policies")) {
          return response(geofencePolicy ? [geofencePolicy] : []);
        }
        if (url.endsWith("/sections")) {
          return response([
            {
              id: "section-1",
              code: "HQ",
              name: "BG GOLD HQ",
              address: "Surabaya",
              timezone: "Asia/Jakarta",
              status: "ACTIVE",
            },
          ]);
        }
        if (url.endsWith("/employees")) {
          return response([{ id: "membership-2", fullName: "Dimas Saputra", email: "dimas@bggold.local", employeeNumber: "BG-021", status: "ACTIVE", roles: ["EMPLOYEE"] }]);
        }
        if (url.includes("/attendance/requests?status=PENDING")) {
          return response(
            decided
              ? []
              : [
                  {
                    id: "request-1",
                    eventId: "event-1",
                    membershipId: "membership-1",
                    employeeName: "Ayu Pratama",
                    employeeNumber: "BG-017",
                    actionType: "CLOCK_IN",
                    status: "PENDING",
                    requestedAt: "2026-08-11T01:00:00Z",
                    recordedAt: "2026-08-11T01:00:00Z",
                    reason: "Shift belum diterbitkan",
                  },
                ],
          );
        }
        if (url.includes("/attendance/timesheets?")) {
          return response([
            {
              membershipId: "membership-2",
              employeeName: "Dimas Saputra",
              employeeNumber: "BG-021",
              date: "2026-08-11",
              firstClockIn: "2026-08-11T02:00:00Z",
              lastClockOut: "2026-08-11T10:00:00Z",
              grossMinutes: 480,
              actualBreakMinutes: 22,
              roundedBreakMinutes: 15,
              netMinutes: 465,
            },
          ]);
        }
        if (url.endsWith("/me")) {
          return response({
            id: "user-1",
            fullName: "Admin BG GOLD",
            email: "admin@bggold.local",
            membershipId: "membership-admin",
            organizationId: "org-1",
            timezone: "Asia/Jakarta",
            employeeNumber: "ADMIN-01",
            roles: ["OWNER"],
          });
        }
        if (url.endsWith("/me/attendance/today")) {
          return response({ state: "NOT_STARTED", latestEvents: [] });
        }
        return response([]);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Ayu Pratama")).toBeInTheDocument();
    await expectNoSeriousAccessibilityViolations();
    expect(
      screen.getByRole("heading", { name: "Jadwal tim per minggu" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("7j 45m")).toBeInTheDocument();
    expect(await screen.findByText("Kebijakan dibuat")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Setujui cuti" }));
    expect(await screen.findByText("Semua cuti sudah ditinjau")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Kode jenis cuti"), { target: { value: "MEDICAL" } });
    fireEvent.change(screen.getByLabelText("Nama jenis cuti"), { target: { value: "Cuti Sakit" } });
    fireEvent.click(screen.getByRole("button", { name: "Tambah jenis" }));
    expect(await screen.findByText("Jenis cuti berhasil ditambahkan.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Karyawan untuk jatah cuti"), { target: { value: "membership-2" } });
    fireEvent.change(screen.getByLabelText("Jenis untuk jatah cuti"), { target: { value: "annual" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan jatah" }));
    expect(await screen.findByText("Jatah cuti berhasil disimpan.")).toBeInTheDocument();
    expect(leaveBalanceSet).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Setujui klaim" }));
    expect(await screen.findByText("Semua klaim sudah ditinjau")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Kode jenis klaim"), { target: { value: "MEALS" } });
    fireEvent.change(screen.getByLabelText("Nama jenis klaim"), { target: { value: "Konsumsi" } });
    fireEvent.click(screen.getByRole("button", { name: "Tambah jenis klaim" }));
    expect(await screen.findByText("Jenis klaim berhasil ditambahkan.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Judul pengumuman"), { target: { value: "Perubahan jadwal toko" } });
    fireEvent.change(screen.getByLabelText("Isi pengumuman"), { target: { value: "Briefing dimulai 15 menit lebih awal." } });
    fireEvent.change(screen.getByLabelText("Audiens pengumuman"), { target: { value: "EMPLOYEE" } });
    fireEvent.click(screen.getByText("Wajib dikonfirmasi oleh penerima"));
    fireEvent.click(screen.getByRole("button", { name: "Terbitkan sekarang" }));
    expect(await screen.findByText("Pengumuman sudah diterbitkan dan masuk ke antrean notifikasi.")).toBeInTheDocument();
    expect(announcementCreated).toBe(true);
    expect(
      screen.getByRole("button", { name: "Unduh timesheet CSV" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Unduh attendance CSV" }),
    ).toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole("button", { name: "Tampilkan QR outlet" }),
    );
    expect(
      await screen.findByTitle("QR dinamis BG GOLD HQ"),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/sections/section-1/dynamic-qr"),
      expect.objectContaining({ method: "POST" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "+ Buat kebijakan" }));
    fireEvent.change(screen.getByLabelText("Nama kebijakan"), {
      target: { value: "Radius HQ" },
    });
    fireEvent.change(screen.getByLabelText("Mode utama"), {
      target: { value: "GEOFENCE" },
    });
    fireEvent.change(screen.getByLabelText("Radius lokasi (meter)"), {
      target: { value: "125" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Aktifkan kebijakan" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/policies"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"geofenceRadiusMeters":125'),
        }),
      ),
    );
    expect((await screen.findAllByText("Radius HQ")).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Kebijakan yang diubah"), { target: { value: "policy-geofence" } });
    fireEvent.change(screen.getByLabelText("Nama kebijakan edit"), { target: { value: "Radius HQ Revisi" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan perubahan kebijakan" }));
    expect(await screen.findByText("Kebijakan berhasil diperbarui.")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/policies/policy-geofence"), expect.objectContaining({ method: "PATCH", body: expect.stringContaining('"name":"Radius HQ Revisi"') })));
    fireEvent.click(screen.getByRole("button", { name: "Arsipkan kebijakan" }));
    expect(await screen.findByText("Kebijakan dipindahkan ke arsip.")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/policies/policy-geofence/archive"), expect.objectContaining({ method: "POST" })));
    fireEvent.click(screen.getByRole("button", { name: "+ Buat kebijakan" }));
    fireEvent.change(screen.getByLabelText("Nama kebijakan"), { target: { value: "Wi-Fi Outlet" } });
    fireEvent.change(screen.getByLabelText("Mode utama"), { target: { value: "WIFI" } });
    fireEvent.change(screen.getByLabelText("Nama Wi-Fi"), { target: { value: "BG GOLD HQ" } });
    fireEvent.change(screen.getByLabelText("BSSID Wi-Fi"), { target: { value: "AA:BB:CC:DD:EE:FF" } });
    fireEvent.click(screen.getByRole("button", { name: "Aktifkan kebijakan" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/policies"), expect.objectContaining({ method:"POST", body:expect.stringContaining('"wifiNetworks":[{"ssid":"BG GOLD HQ","bssid":"AA:BB:CC:DD:EE:FF"}]') })));
    fireEvent.click(screen.getByRole("button", { name: "Koreksi" }));
    fireEvent.change(screen.getByLabelText("Tindakan"), {
      target: { value: "CLOCK_OUT" },
    });
    fireEvent.change(screen.getByLabelText("Alasan koreksi"), {
      target: { value: "Perbaikan catatan supervisor" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Simpan koreksi" }));
    expect(await screen.findByText("Sudah dikoreksi")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Setujui shift" }));
    expect(await screen.findByText("Tidak ada permintaan shift")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Setujui" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/attendance/requests/request-1/decision"),
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(await screen.findByText("Semua sudah ditinjau")).toBeInTheDocument();
  });

  it("creates and deactivates an employee from the directory", async () => {
    localStorage.setItem(
      "bg-gold.session",
      JSON.stringify({
        accessToken: "access-token",
        accessExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        refreshToken: "refresh-token",
        refreshExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    );
    let employee: Record<string, unknown> | undefined;
    let employeeFetches = 0;
    const response = (data: unknown, status = 200) =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => ({ data, requestId: "test-request" }),
      }) as Response;
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/employees") && init?.method === "POST") {
          const payload = JSON.parse(String(init.body)) as Record<
            string,
            unknown
          >;
          employee = {
            id: "employee-2",
            fullName: payload.fullName,
            email: payload.email,
            employeeNumber: payload.employeeNumber,
            jobTitle: payload.jobTitle,
            roles: ["EMPLOYEE"],
            status: "ACTIVE",
          };
          return response(
            { id: "employee-2", invitationStatus: "SENT" },
            201,
          );
        }
        if (
          url.endsWith("/employees/employee-2/deactivate") &&
          init?.method === "POST"
        ) {
          employee = { ...employee, status: "INACTIVE" };
          return response({ id: "employee-2", status: "INACTIVE" });
        }
        if (
          url.endsWith("/employees/employee-2") &&
          init?.method === "PATCH"
        ) {
          const payload = JSON.parse(String(init.body)) as Record<
            string,
            unknown
          >;
          employee = { ...employee, ...payload };
          return response(employee);
        }
        if (url.endsWith("/employees")) {
          employeeFetches += 1;
          if (employeeFetches === 1) return response([], 503);
          return response(employee ? [employee] : []);
        }
        if (url.endsWith("/me")) {
          return response({
            id: "user-1",
            fullName: "Admin BG GOLD",
            email: "admin@bggold.local",
            membershipId: "membership-admin",
            organizationId: "org-1",
            timezone: "Asia/Jakarta",
            employeeNumber: "ADMIN-01",
            roles: ["OWNER"],
          });
        }
        if (url.endsWith("/me/attendance/today")) {
          return response({ state: "NOT_STARTED", latestEvents: [] });
        }
        return response([]);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "1 bagian data terbaru belum dapat dimuat",
    );
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());

    fireEvent.click(
      await screen.findByRole("button", { name: "+ Tambah karyawan" }),
    );
    fireEvent.change(screen.getByLabelText("Nama lengkap"), {
      target: { value: "Ayu Pratama" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "ayu@bggold.local" },
    });
    fireEvent.change(screen.getByLabelText("Nomor karyawan"), {
      target: { value: "BG-017" },
    });
    fireEvent.change(screen.getByLabelText("Jabatan"), {
      target: { value: "Gold Operations" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Kirim undangan" }));

    expect(await screen.findByText("Ayu Pratama")).toBeInTheDocument();
    expect(
      await screen.findByText("Undangan akun telah dikirim ke email karyawan."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit profil & peran" }),
    );
    fireEvent.change(screen.getByLabelText("Nama lengkap untuk diedit"), {
      target: { value: "Ayu Lestari" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Simpan perubahan" }));
    expect(await screen.findByText("Ayu Lestari")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nonaktifkan" }));
    expect(
      await screen.findByRole("button", { name: "Aktifkan" }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/employees/employee-2/deactivate"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});

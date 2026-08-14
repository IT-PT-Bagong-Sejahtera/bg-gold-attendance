import AsyncStorage from "@react-native-async-storage/async-storage";
import { demoRequest, demoUploadAttachment } from "./demoApi";
import {
  createDemoSession,
  DEMO_DEVICE_ACCESS_TOKEN,
  DEMO_SUPERVISOR_ACCESS_TOKEN,
} from "./demoSession";
import type {
  AttendanceEvent,
  AttendanceEvidenceDetail,
  Me,
  SupervisorAttendanceRequest,
  SupervisorAttendanceReport,
  Today,
} from "./api";

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

let stored: string | null;

beforeEach(() => {
  stored = null;
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async () => stored);
  (AsyncStorage.setItem as jest.Mock).mockImplementation(
    async (_key: string, value: string) => {
      stored = value;
    },
  );
});

it("creates a long-lived local-only session", () => {
  const session = createDemoSession();
  expect(session.accessToken).toBe("bg-gold-local-demo-access");
  expect(new Date(session.accessExpiresAt).getUTCFullYear()).toBe(2099);
});

it("creates an isolated supervisor identity and persistent approval queue", async () => {
  const session = createDemoSession("supervisor");
  expect(session.accessToken).toBe(DEMO_SUPERVISOR_ACCESS_TOKEN);

  const identity = await demoRequest<Me>(
    "/me",
    {},
    DEMO_SUPERVISOR_ACCESS_TOKEN,
  );
  expect(identity.roles).toContain("SUPERVISOR");

  const queue = await demoRequest<SupervisorAttendanceRequest[]>(
    "/attendance/requests?status=PENDING",
    {},
    DEMO_SUPERVISOR_ACCESS_TOKEN,
  );
  expect(queue).toHaveLength(1);

  await demoRequest(
    `/attendance/requests/${queue[0]!.id}/decision`,
    {
      method: "POST",
      body: JSON.stringify({ decision: "APPROVED" }),
    },
    DEMO_SUPERVISOR_ACCESS_TOKEN,
  );
  expect(
    await demoRequest<SupervisorAttendanceRequest[]>(
      "/attendance/requests?status=PENDING",
      {},
      DEMO_SUPERVISOR_ACCESS_TOKEN,
    ),
  ).toHaveLength(0);
  const approved = await demoRequest<SupervisorAttendanceRequest[]>(
    "/attendance/requests?status=APPROVED",
    {},
    DEMO_SUPERVISOR_ACCESS_TOKEN,
  );
  expect(approved.map((item) => item.employeeName)).toEqual(
    expect.arrayContaining(["Dimas Pratama", "Raka Wijaya"]),
  );
  expect(
    approved.find((item) => item.employeeName === "Raka Wijaya"),
  ).toMatchObject({
    attachmentId: "demo-attendance-selfie-raka",
    source: "MOBILE",
  });
});

it("lets the demo supervisor create only an employee account", async () => {
  await expect(
    demoRequest(
      "/employees",
      {
        method: "POST",
        body: JSON.stringify({
          email: "new@bggold.local",
          password: "AmanSekali-2026!",
          roles: ["EMPLOYEE"],
        }),
      },
      DEMO_SUPERVISOR_ACCESS_TOKEN,
    ),
  ).resolves.toMatchObject({ invitationStatus: "NOT_REQUIRED" });

  await expect(
    demoRequest(
      "/employees",
      {
        method: "POST",
        body: JSON.stringify({ roles: ["SUPERVISOR"] }),
      },
      DEMO_SUPERVISOR_ACCESS_TOKEN,
    ),
  ).rejects.toThrow("Supervisor hanya dapat membuat akun karyawan");
});

it("provides an all-employee attendance report for supervisor export", async () => {
  const report = await demoRequest<SupervisorAttendanceReport>(
    "/attendance/report",
    {},
    DEMO_SUPERVISOR_ACCESS_TOKEN,
  );

  expect(report.organizationName).toContain("BG GOLD");
  expect(report.rows).toHaveLength(6);
  expect(report.rows.map((row) => row.status)).toEqual(
    expect.arrayContaining(["ON_TIME", "LATE", "LEAVE", "ABSENT"]),
  );
  expect(report.rows[0]?.clockInEventId).toBe("demo-report-ayu-in");

  const evidence = await demoRequest<AttendanceEvidenceDetail>(
    `/attendance/events/${report.rows[0]!.clockInEventId}/evidence`,
    {},
    DEMO_SUPERVISOR_ACCESS_TOKEN,
  );
  expect(evidence.attachment?.url).toBe("demo-selfie-ayu");
  expect(evidence.section?.name).toBe("BG GOLD Flagship");
  expect(evidence.faceVerification).toMatchObject({
    verified: true,
    livenessPassed: true,
  });
});

it("returns own attendance evidence and persists supervisor shift participants", async () => {
  const ownEvidence = await demoRequest<AttendanceEvidenceDetail>(
    "/me/attendance/events/demo-ayu-in/evidence",
  );
  expect(ownEvidence.eventId).toBe("demo-ayu-in");
  expect(ownEvidence.section?.name).toBe("BG GOLD Flagship");

  const shifts = await demoRequest<
    Array<{ id: string; participants: Array<{ membershipId: string }> }>
  >("/shifts", {}, DEMO_SUPERVISOR_ACCESS_TOKEN);
  const shiftId = shifts[0]!.id;
  await demoRequest(
    `/shifts/${shiftId}/participants`,
    {
      method: "PATCH",
      body: JSON.stringify({ membershipIds: ["demo-team-raka"] }),
    },
    DEMO_SUPERVISOR_ACCESS_TOKEN,
  );
  const updated = await demoRequest<
    Array<{ id: string; participants: Array<{ membershipId: string }> }>
  >("/shifts", {}, DEMO_SUPERVISOR_ACCESS_TOKEN);
  expect(updated.find((item) => item.id === shiftId)?.participants).toEqual([
    expect.objectContaining({ membershipId: "demo-team-raka" }),
  ]);
});

it("persists a custom event with its supervisor-entered showroom name", async () => {
  await demoRequest(
    "/shifts",
    {
      method: "POST",
      body: JSON.stringify({
        sectionId: "demo-section-hq",
        title: "Private Preview Senayan",
        scheduleType: "EVENT",
        showroomName: "Showroom BG GOLD Senayan",
        startsAt: "2026-08-20T02:00:00.000Z",
        endsAt: "2026-08-20T06:00:00.000Z",
        publish: true,
        membershipIds: ["demo-membership-local"],
      }),
    },
    DEMO_SUPERVISOR_ACCESS_TOKEN,
  );

  const shifts = await demoRequest<
    Array<{
      title: string;
      scheduleType?: string;
      showroomName?: string;
      participants: Array<{ membershipId: string }>;
    }>
  >("/shifts", {}, DEMO_SUPERVISOR_ACCESS_TOKEN);
  expect(shifts[0]).toMatchObject({
    title: "Private Preview Senayan",
    scheduleType: "EVENT",
    showroomName: "Showroom BG GOLD Senayan",
    participants: [{ membershipId: "demo-membership-local" }],
  });
});

it("binds Demo 2 to one device and completes clock-in then clock-out", async () => {
  const session = createDemoSession("device");
  expect(session.accessToken).toBe(DEMO_DEVICE_ACCESS_TOKEN);

  await expect(
    demoRequest(
      "/attendance/actions",
      {
        method: "POST",
        body: JSON.stringify({
          type: "CLOCK_IN",
          evidence: {
            employeeName: "Ayu Perangkat",
            attachmentId: "demo-photo-1",
            deviceId: "phone-installation-1",
          },
        }),
      },
      DEMO_DEVICE_ACCESS_TOKEN,
    ),
  ).resolves.toMatchObject({ attendanceState: "WORKING" });

  const identity = await demoRequest<Me>("/me", {}, DEMO_DEVICE_ACCESS_TOKEN);
  const attendance = await demoRequest<Today>(
    "/me/attendance/today",
    {},
    DEMO_DEVICE_ACCESS_TOKEN,
  );
  expect(identity.fullName).toBe("Ayu Perangkat");
  expect(attendance.state).toBe("WORKING");
  expect(attendance.latestEvents).toHaveLength(1);

  await expect(
    demoRequest(
      "/attendance/actions",
      {
        method: "POST",
        body: JSON.stringify({
          type: "CLOCK_OUT",
          evidence: {
            employeeName: "Ayu Perangkat",
            attachmentId: "demo-photo-out",
            deviceId: "phone-installation-1",
          },
        }),
      },
      DEMO_DEVICE_ACCESS_TOKEN,
    ),
  ).resolves.toMatchObject({ attendanceState: "COMPLETED" });
  expect(
    (
      await demoRequest<Today>(
        "/me/attendance/today",
        {},
        DEMO_DEVICE_ACCESS_TOKEN,
      )
    ).latestEvents.map((item) => item.actionType),
  ).toEqual(["CLOCK_OUT", "CLOCK_IN"]);

  await expect(
    demoRequest(
      "/attendance/actions",
      {
        method: "POST",
        body: JSON.stringify({
          type: "CLOCK_IN",
          evidence: {
            employeeName: "Ayu Perangkat",
            attachmentId: "demo-photo-2",
            deviceId: "phone-installation-1",
          },
        }),
      },
      DEMO_DEVICE_ACCESS_TOKEN,
    ),
  ).rejects.toThrow("hanya dapat clock-in satu kali per hari");

  const persisted = JSON.parse(stored!) as {
    deviceAttendanceState: string;
    deviceAttendanceEvents: unknown[];
  };
  persisted.deviceAttendanceState = "NOT_STARTED";
  persisted.deviceAttendanceEvents = [];
  stored = JSON.stringify(persisted);

  await expect(
    demoRequest(
      "/attendance/actions",
      {
        method: "POST",
        body: JSON.stringify({
          type: "CLOCK_IN",
          evidence: {
            employeeName: "Ayu Perangkat",
            attachmentId: "demo-photo-other-phone",
            deviceId: "phone-installation-2",
          },
        }),
      },
      DEMO_DEVICE_ACCESS_TOKEN,
    ),
  ).rejects.toThrow("sudah terikat ke HP lain");

  await expect(
    demoRequest(
      "/attendance/actions",
      {
        method: "POST",
        body: JSON.stringify({
          type: "CLOCK_IN",
          evidence: {
            employeeName: "Nama Berbeda",
            attachmentId: "demo-photo-3",
            deviceId: "phone-installation-1",
          },
        }),
      },
      DEMO_DEVICE_ACCESS_TOKEN,
    ),
  ).rejects.toThrow("HP ini sudah terikat kepada Ayu Perangkat");
});

it("shows one-HP showroom evidence in the supervisor report", async () => {
  const attachment = await demoUploadAttachment(
    "image/jpeg",
    "file:///demo/showroom-selfie.jpg",
  );
  const result = await demoRequest<{ actionId: string }>(
    "/attendance/actions",
    {
      method: "POST",
      body: JSON.stringify({
        type: "CLOCK_IN",
        sectionId: "demo-section-hq",
        evidence: {
          employeeName: "Sinta Showroom",
          selectedLocationName: "BG GOLD Flagship",
          attachmentId: attachment.id,
          deviceId: "showroom-phone-1",
        },
      }),
    },
    DEMO_DEVICE_ACCESS_TOKEN,
  );

  const report = await demoRequest<SupervisorAttendanceReport>(
    "/attendance/report",
    {},
    DEMO_SUPERVISOR_ACCESS_TOKEN,
  );
  expect(report.rows[0]).toMatchObject({
    employeeName: "Sinta Showroom",
    shiftTitle: "Mode Showroom · 1 HP",
    clockInEventId: result.actionId,
  });

  const evidence = await demoRequest<AttendanceEvidenceDetail>(
    `/attendance/events/${result.actionId}/evidence`,
    {},
    DEMO_SUPERVISOR_ACCESS_TOKEN,
  );
  expect(evidence).toMatchObject({
    source: "KIOSK",
    attachment: { url: "file:///demo/showroom-selfie.jpg" },
    section: { name: "BG GOLD Flagship" },
    device: { label: "HP Kiosk · BG GOLD Showroom" },
  });
});

it("persists a complete clock-in and clock-out journey locally", async () => {
  const initial = await demoRequest<Today>("/me/attendance/today");
  expect(initial.state).toBe("NOT_STARTED");

  await demoRequest("/attendance/actions", {
    method: "POST",
    body: JSON.stringify({ type: "CLOCK_IN", evidence: { location: null } }),
  });
  expect((await demoRequest<Today>("/me/attendance/today")).state).toBe(
    "WORKING",
  );

  await demoRequest("/attendance/actions", {
    method: "POST",
    body: JSON.stringify({ type: "CLOCK_OUT", evidence: { location: null } }),
  });
  const completed = await demoRequest<Today>("/me/attendance/today");
  const history = await demoRequest<AttendanceEvent[]>(
    "/me/attendance/history",
  );

  expect(completed.state).toBe("COMPLETED");
  expect(history.map((item) => item.actionType)).toEqual([
    "CLOCK_OUT",
    "CLOCK_IN",
  ]);
  await expect(
    demoRequest("/attendance/actions", {
      method: "POST",
      body: JSON.stringify({ type: "CLOCK_IN", evidence: { location: null } }),
    }),
  ).rejects.toThrow("hanya dapat clock-in satu kali per hari");
  expect(AsyncStorage.setItem).toHaveBeenCalled();
});

it("keeps leave and open-shift trial changes after reload", async () => {
  await demoRequest("/me/leave-requests", {
    method: "POST",
    body: JSON.stringify({
      leaveTypeId: "demo-annual",
      startsOn: "2026-09-14",
      endsOn: "2026-09-16",
      reason: "Keperluan keluarga",
    }),
  });
  await demoRequest("/shifts/demo-open-weekend/requests", {
    method: "POST",
    body: "{}",
  });

  const leaves =
    await demoRequest<Array<{ status: string; totalDays: number }>>(
      "/me/leave-requests",
    );
  const shifts = await demoRequest<Array<{ requestStatus?: string }>>(
    "/me/open-shifts?from=now&to=later",
  );

  expect(leaves[0]).toMatchObject({ status: "PENDING", totalDays: 3 });
  expect(shifts[0]?.requestStatus).toBe("PENDING");
});

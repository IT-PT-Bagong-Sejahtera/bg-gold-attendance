import AsyncStorage from "@react-native-async-storage/async-storage";
import { demoRequest } from "./demoApi";
import {
  createDemoSession,
  DEMO_DEVICE_ACCESS_TOKEN,
  DEMO_SUPERVISOR_ACCESS_TOKEN,
} from "./demoSession";
import type {
  AttendanceEvent,
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
  expect(approved.find((item) => item.employeeName === "Raka Wijaya")).toMatchObject({
    attachmentId: "demo-attendance-selfie-raka",
    source: "MOBILE",
  });
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

  const identity = await demoRequest<Me>(
    "/me",
    {},
    DEMO_DEVICE_ACCESS_TOKEN,
  );
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
  expect((await demoRequest<Today>("/me/attendance/today", {}, DEMO_DEVICE_ACCESS_TOKEN)).latestEvents.map((item) => item.actionType)).toEqual(["CLOCK_OUT", "CLOCK_IN"]);

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

  const leaves = await demoRequest<Array<{ status: string; totalDays: number }>>(
    "/me/leave-requests",
  );
  const shifts = await demoRequest<Array<{ requestStatus?: string }>>(
    "/me/open-shifts?from=now&to=later",
  );

  expect(leaves[0]).toMatchObject({ status: "PENDING", totalDays: 3 });
  expect(shifts[0]?.requestStatus).toBe("PENDING");
});

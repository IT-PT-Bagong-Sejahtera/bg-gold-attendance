import AsyncStorage from "@react-native-async-storage/async-storage";
import { createDemoSession, demoRoleFromToken } from "./demoSession";
import { APIError } from "./api";
import type {
  Announcement,
  AttendanceAction,
  AttendanceEvent,
  AttendanceEvidenceDetail,
  AttendanceRequest,
  AttendanceState,
  Claim,
  ClaimType,
  Employee,
  LeaveBalance,
  LeaveRequest,
  LeaveType,
  Me,
  Notification,
  OpenShift,
  Organization,
  Policy,
  Section,
  Shift,
  SupervisorAttendanceRequest,
  SupervisorAttendanceReport,
  SupervisorClaim,
  SupervisorLeaveRequest,
  SupervisorShiftRequest,
  SupervisorShift,
  Today,
  KioskContext,
  KioskEmployeeStatus,
} from "./api";
const STORAGE_KEY = "bg-gold.attendance.demo.v4";

type DemoState = {
  seedDate: string;
  nextEmployeeSequence: number;
  sections: Section[];
  attendanceState: AttendanceState;
  attendanceEvents: AttendanceEvent[];
  deviceAttendanceState: AttendanceState;
  deviceAttendanceEvents: AttendanceEvent[];
  deviceEmployeeName?: string;
  deviceId?: string;
  deviceBoundAt?: string;
  demoAttachments: Record<
    string,
    { uri: string; contentType: string; sizeBytes: number }
  >;
  deviceEvidence: Record<
    string,
    {
      employeeName: string;
      employeeNumber: string;
      detail: AttendanceEvidenceDetail;
    }
  >;
  leaveRequests: LeaveRequest[];
  claims: Claim[];
  openShiftRequested: boolean;
  announcementAcknowledged: boolean;
  notifications: Notification[];
  supervisorAttendanceRequests: SupervisorAttendanceRequest[];
  supervisorLeaveRequests: SupervisorLeaveRequest[];
  supervisorClaims: SupervisorClaim[];
  supervisorShiftRequests: SupervisorShiftRequest[];
  supervisorShifts: SupervisorShift[];
  kiosk?: { id: string; token: string; sectionId: string; deviceLabel: string; installationId: string };
  kioskAttendance: Record<string, { state: AttendanceState; events: AttendanceEvent[] }>;
};

export async function demoUploadAttachment(contentType: string, uri: string) {
  const state = await readState();
  const id = `demo-attachment-${Date.now()}`;
  state.demoAttachments[id] = { uri, contentType, sizeBytes: 128_000 };
  await writeState(state);
  return {
    id,
    contentType,
    sizeBytes: 128_000,
  };
}

export async function demoKioskUploadAttachment(
  kioskToken: string,
  employeeNumber: string,
  pin: string,
  contentType: string,
  uri: string,
) {
  const state = await readState();
  requireDemoKiosk(state, kioskToken);
  requireDemoKioskEmployee(employeeNumber, pin);
  return demoUploadAttachment(contentType, uri);
}

export async function demoKioskRequest<T>(
  path: string,
  init: RequestInit = {},
  kioskToken: string,
): Promise<T> {
  const state = await readState();
  const kiosk = requireDemoKiosk(state, kioskToken);
  const input = parseBody(init.body);
  const method = (init.method ?? "GET").toUpperCase();
  const section = state.sections.find((item) => item.id === kiosk.sectionId);
  if (!section || section.status !== "ACTIVE") throw new APIError(401, "KIOSK_UNAUTHENTICATED", "Mode kiosk tidak aktif atau showroom dinonaktifkan.");

  if (path === "/kiosk/context" && method === "GET") {
    const result: KioskContext = {
      kiosk: { id: kiosk.id, deviceLabel: kiosk.deviceLabel },
      showroom: { id: section.id, code: section.code, name: section.name, address: section.address },
      employees: DEMO_EMPLOYEES.filter((item) => item.status === "ACTIVE" && item.roles.includes("EMPLOYEE")).map((item) => ({
        id: item.id, fullName: item.fullName, employeeNumber: item.employeeNumber, jobTitle: item.jobTitle, pinConfigured: true,
      })),
    };
    return clone(result) as T;
  }

  const employee = requireDemoKioskEmployee(String(input.employeeNumber ?? ""), String(input.pin ?? ""));
  const record = state.kioskAttendance[employee.employeeNumber] ?? { state: "NOT_STARTED" as AttendanceState, events: [] };
  state.kioskAttendance[employee.employeeNumber] = record;
  if (path === "/kiosk/employee-status" && method === "POST") {
    const result: KioskEmployeeStatus = {
      employee: { id: employee.id, fullName: employee.fullName, employeeNumber: employee.employeeNumber, jobTitle: employee.jobTitle },
      attendance: { state: record.state, activeShiftId: "demo-shift-today", latestEvents: clone(record.events.slice(0, 5)) },
    };
    await writeState(state);
    return clone(result) as T;
  }
  if (path === "/kiosk/attendance/actions" && method === "POST") {
    const action = String(input.type ?? "") as AttendanceAction;
    const allowed = (record.state === "NOT_STARTED" && action === "CLOCK_IN") || (record.state === "WORKING" && action === "CLOCK_OUT") || (record.state === "ON_BREAK" && action === "END_BREAK");
    if (!allowed) throw new APIError(422, "INVALID_ATTENDANCE_STATE", "Tindakan ini tidak sesuai dengan status absensi saat ini.");
    const evidence = (input.evidence ?? {}) as Record<string, any>;
    if (!evidence.attachmentId) throw new APIError(422, "SELFIE_REQUIRED", "Foto selfie diperlukan untuk absensi ini.");
    const nextState: AttendanceState = action === "CLOCK_IN" || action === "END_BREAK" ? "WORKING" : "COMPLETED";
    const recordedAt = new Date().toISOString();
    const event: AttendanceEvent = { id: `demo-kiosk-attendance-${Date.now()}`, actionType: action, decision: "APPROVED", recordedAt };
    record.state = nextState;
    record.events.unshift(event);
    const attachment = state.demoAttachments[String(evidence.attachmentId)];
    state.deviceEvidence[event.id] = {
      employeeName: employee.fullName,
      employeeNumber: employee.employeeNumber,
      detail: {
        eventId: event.id, actionType: action, decision: "APPROVED", source: "KIOSK", recordedAt,
        section: { id: section.id, name: section.name, address: section.address },
        location: evidence.location ? { latitude: Number(evidence.location.latitude), longitude: Number(evidence.location.longitude), accuracyM: Number(evidence.location.accuracyMeters), capturedAt: String(evidence.location.capturedAt) } : undefined,
        attachment: attachment ? { id: String(evidence.attachmentId), contentType: attachment.contentType, sizeBytes: attachment.sizeBytes, url: attachment.uri } : undefined,
        device: { id: kiosk.id, platform: "ANDROID", label: kiosk.deviceLabel }, evidenceSavedAt: recordedAt,
      },
    };
    await writeState(state);
    return { actionId: event.id, decision: "APPROVED", attendanceState: nextState, recordedAt, message: `${action === "CLOCK_IN" ? "Clock-in" : "Clock-out"} berhasil dicatat.` } as T;
  }
  throw new APIError(404, "DEMO_ROUTE_NOT_FOUND", "Fitur kiosk demo belum tersedia untuk permintaan ini.");
}

function requireDemoKiosk(state: DemoState, token: string) {
  if (!state.kiosk || state.kiosk.token !== token) throw new APIError(401, "KIOSK_UNAUTHENTICATED", "Mode kiosk tidak aktif atau sudah dicabut.");
  return state.kiosk;
}

function requireDemoKioskEmployee(employeeNumber: string, pin: string) {
  const employee = DEMO_EMPLOYEES.find((item) => item.employeeNumber === employeeNumber && item.status === "ACTIVE" && item.roles.includes("EMPLOYEE"));
  if (!employee || pin !== "123456") throw new APIError(401, "KIOSK_EMPLOYEE_INVALID", "Nomor karyawan atau PIN absensi tidak sesuai.");
  return employee;
}

export async function resetDemoData() {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export async function demoRequest<T>(
  rawPath: string,
  init: RequestInit = {},
  accessToken?: string,
): Promise<T> {
  const path = rawPath.split("?")[0] ?? rawPath;
  const query = new URLSearchParams(rawPath.split("?")[1] ?? "");
  const method = (init.method ?? "GET").toUpperCase();
  const input = parseBody(init.body);
  const state = await readState();

  if (path === "/auth/logout" && method === "POST") return undefined as T;
  const demoRole = demoRoleFromToken(accessToken) ?? "employee";

  if (path === "/me") {
    return clone(
      demoRole === "supervisor"
        ? DEMO_SUPERVISOR_ME
        : demoRole === "device"
          ? deviceDemoMe(state)
          : DEMO_EMPLOYEE_ME,
    ) as T;
  }
  if (path === "/me/organizations") return clone(DEMO_ORGANIZATIONS) as T;
  if (path === "/employees" && method === "POST") {
    const requestedRoles = Array.isArray(input.roles) ? input.roles : [];
    if (
      demoRole !== "supervisor" ||
      requestedRoles.some((role) => role !== "EMPLOYEE")
    ) {
      throw new APIError(
        403,
        "ROLE_ASSIGNMENT_FORBIDDEN",
        "Supervisor hanya dapat membuat akun karyawan.",
      );
    }
    const employeeNumber = `BG-${String(state.nextEmployeeSequence).padStart(4, "0")}`;
    state.nextEmployeeSequence += 1;
    await writeState(state);
    return {
      id: `demo-employee-${Date.now()}`,
      employeeNumber,
      invitationStatus: "NOT_REQUIRED",
    } as T;
  }
  if (path === "/kiosk-devices" && method === "POST") {
    ensureDemoSectionManager(demoRole);
    const section = state.sections.find((item) => item.id === input.sectionId && item.status === "ACTIVE");
    if (!section) throw new APIError(404, "SHOWROOM_NOT_FOUND", "Showroom aktif tidak ditemukan.");
    state.kiosk = {
      id: state.kiosk?.id ?? "demo-kiosk-device",
      token: `demo-kiosk-${Date.now()}`,
      sectionId: section.id,
      deviceLabel: String(input.deviceLabel || "HP Kiosk Demo"),
      installationId: String(input.installationId || "demo-installation"),
    };
    await writeState(state);
    return clone({ id: state.kiosk.id, token: state.kiosk.token, sectionId: section.id, deviceLabel: state.kiosk.deviceLabel }) as T;
  }
  if (path.startsWith("/kiosk-devices/") && method === "DELETE") {
    ensureDemoSectionManager(demoRole);
    state.kiosk = undefined;
    await writeState(state);
    return undefined as T;
  }
  if (path.includes("/kiosk-pin") && method === "PATCH") return undefined as T;
  if (path === "/me/active-organization" && method === "POST") {
    return createDemoSession(demoRole) as T;
  }
  if (path === "/me/attendance/today") return today(state, demoRole) as T;
  if (path === "/me/attendance/history") {
    return clone(
      demoRole === "device"
        ? state.deviceAttendanceEvents
        : state.attendanceEvents,
    ) as T;
  }
  if (
    path.startsWith("/me/attendance/events/") &&
    path.endsWith("/evidence") &&
    method === "GET"
  ) {
    const eventId = path.split("/")[4] ?? "";
    return clone(
      state.deviceEvidence[eventId]?.detail ?? demoAttendanceEvidence(eventId),
    ) as T;
  }
  if (path === "/me/requests") return [] as T;
  if (path === "/me/shifts") return assignedShifts(state, demoRole) as T;
  if (path === "/me/open-shifts") {
    return openShifts(state.openShiftRequested) as T;
  }
  if (
    path.startsWith("/shifts/") &&
    path.endsWith("/requests") &&
    method === "POST"
  ) {
    state.openShiftRequested = true;
    await writeState(state);
    return { id: `demo-shift-request-${Date.now()}`, status: "PENDING" } as T;
  }
  if (path === "/me/attendance-policy") {
    return clone(demoRole === "device" ? DEMO_DEVICE_POLICY : DEMO_POLICY) as T;
  }
  if (path === "/attendance/actions" && method === "POST") {
    return (await attendanceAction(state, input, demoRole)) as T;
  }
  if (path === "/leave-types") return clone(DEMO_LEAVE_TYPES) as T;
  if (path === "/me/leave-balances") return leaveBalances(state) as T;
  if (path === "/me/leave-requests" && method === "GET") {
    return clone(state.leaveRequests) as T;
  }
  if (path === "/me/leave-requests" && method === "POST") {
    return (await createLeave(state, input)) as T;
  }
  if (path.startsWith("/me/leave-requests/") && path.endsWith("/withdraw")) {
    const id = path.split("/")[4];
    const item = state.leaveRequests.find((request) => request.id === id);
    if (item) item.status = "WITHDRAWN";
    await writeState(state);
    return { id, status: "WITHDRAWN" } as T;
  }
  if (path === "/claim-types") return clone(DEMO_CLAIM_TYPES) as T;
  if (path === "/me/claims" && method === "GET")
    return clone(state.claims) as T;
  if (path === "/me/claims" && method === "POST") {
    return (await createClaim(state, input)) as T;
  }
  if (path.startsWith("/me/claims/") && path.endsWith("/withdraw")) {
    const id = path.split("/")[3];
    const item = state.claims.find((claim) => claim.id === id);
    if (item) item.status = "WITHDRAWN";
    await writeState(state);
    return { id, status: "WITHDRAWN" } as T;
  }
  if (path === "/me/announcements") return announcements(state) as T;
  if (path.startsWith("/me/announcements/") && path.endsWith("/receipt")) {
    state.announcementAcknowledged = true;
    state.notifications = state.notifications.map((item) => ({
      ...item,
      read: true,
    }));
    await writeState(state);
    return {
      id: path.split("/")[3],
      action: input.action ?? "ACKNOWLEDGE",
    } as T;
  }
  if (path === "/me/notifications") return clone(state.notifications) as T;
  if (path === "/me/notifications/unread-count") {
    return {
      count: state.notifications.filter((item) => !item.read).length,
    } as T;
  }
  if (path.includes("/me/notifications/") && path.endsWith("/read")) {
    const id = path.split("/")[3];
    state.notifications = state.notifications.map((item) =>
      item.id === id ? { ...item, read: true } : item,
    );
    await writeState(state);
    return { id, read: true } as T;
  }
  if (path === "/me/devices" && method === "POST") {
    return { id: "demo-device-local", status: "ACTIVE" } as T;
  }
  if (path === "/me/face/enroll" && method === "POST") {
    return { id: "demo-face-enrollment", status: "ACTIVE" } as T;
  }
  if (path === "/me/face/verify" && method === "POST") {
    return {
      id: "demo-face-verification",
      verified: true,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    } as T;
  }
  if (path === "/attendance/requests" && method === "GET") {
    const status = query.get("status")?.toUpperCase() || "PENDING";
    return clone(
      state.supervisorAttendanceRequests.filter(
        (item) => item.status === status,
      ),
    ) as T;
  }
  if (path === "/attendance/report" && method === "GET") {
    return supervisorAttendanceReport(state) as T;
  }
  if (
    path.startsWith("/attendance/events/") &&
    path.endsWith("/evidence") &&
    method === "GET"
  ) {
    const eventId = path.split("/")[3] ?? "";
    return clone(
      state.deviceEvidence[eventId]?.detail ?? demoAttendanceEvidence(eventId),
    ) as T;
  }
  if (
    path.startsWith("/attendance/requests/") &&
    path.endsWith("/decision") &&
    method === "POST"
  ) {
    const id = path.split("/")[3];
    decideItem(state.supervisorAttendanceRequests, id, input);
    await writeState(state);
    return { id, status: input.decision } as T;
  }
  if (path === "/leave-requests" && method === "GET") {
    const status = query.get("status")?.toUpperCase() || "PENDING";
    return clone(
      state.supervisorLeaveRequests.filter((item) => item.status === status),
    ) as T;
  }
  if (
    path.startsWith("/leave-requests/") &&
    path.endsWith("/decision") &&
    method === "POST"
  ) {
    const id = path.split("/")[2];
    decideItem(state.supervisorLeaveRequests, id, input);
    await writeState(state);
    return { id, status: input.decision } as T;
  }
  if (path === "/claims" && method === "GET") {
    const status = query.get("status")?.toUpperCase() || "PENDING";
    return clone(
      state.supervisorClaims.filter((item) => item.status === status),
    ) as T;
  }
  if (
    path.startsWith("/claims/") &&
    path.endsWith("/decision") &&
    method === "POST"
  ) {
    const id = path.split("/")[2];
    decideItem(state.supervisorClaims, id, input);
    await writeState(state);
    return { id, status: input.decision } as T;
  }
  if (path === "/shift-requests" && method === "GET") {
    const status = query.get("status")?.toUpperCase() || "PENDING";
    return clone(
      state.supervisorShiftRequests.filter((item) => item.status === status),
    ) as T;
  }
  if (
    path.startsWith("/shift-requests/") &&
    path.endsWith("/decision") &&
    method === "POST"
  ) {
    const id = path.split("/")[2];
    decideItem(state.supervisorShiftRequests, id, input);
    await writeState(state);
    return { id, status: input.decision } as T;
  }
  if (path === "/employees" && method === "GET") {
    return clone(DEMO_EMPLOYEES) as T;
  }
  if (path === "/sections" && method === "GET") {
    return clone(state.sections) as T;
  }
  if (path === "/sections" && method === "POST") {
    ensureDemoSectionManager(demoRole);
    const code = String(input.code ?? "").trim().toUpperCase();
    const name = String(input.name ?? "").trim();
    if (!code || !name) {
      throw new APIError(422, "VALIDATION_ERROR", "Kode dan nama showroom wajib diisi.");
    }
    if (state.sections.some((item) => item.code.toUpperCase() === code)) {
      throw new APIError(409, "SECTION_CODE_EXISTS", "Kode showroom sudah digunakan.");
    }
    const section: Section = {
      id: `demo-section-${Date.now()}`,
      code,
      name,
      address: String(input.address ?? "").trim() || undefined,
      timezone: String(input.timezone ?? "").trim() || "Asia/Jakarta",
      status: "ACTIVE",
    };
    state.sections.unshift(section);
    await writeState(state);
    return { id: section.id } as T;
  }
  if (/^\/sections\/[^/]+$/.test(path) && method === "PATCH") {
    ensureDemoSectionManager(demoRole);
    const sectionId = path.split("/")[2] ?? "";
    const section = state.sections.find((item) => item.id === sectionId);
    if (!section) throw new APIError(404, "SECTION_NOT_FOUND", "Showroom tidak ditemukan.");
    const code = String(input.code ?? "").trim().toUpperCase();
    const name = String(input.name ?? "").trim();
    if (!code || !name) {
      throw new APIError(422, "VALIDATION_ERROR", "Kode dan nama showroom wajib diisi.");
    }
    if (state.sections.some((item) => item.id !== sectionId && item.code.toUpperCase() === code)) {
      throw new APIError(409, "SECTION_CODE_EXISTS", "Kode showroom sudah digunakan.");
    }
    Object.assign(section, {
      code,
      name,
      address: String(input.address ?? "").trim() || undefined,
      timezone: String(input.timezone ?? "").trim() || "Asia/Jakarta",
    });
    await writeState(state);
    return clone(section) as T;
  }
  if (/^\/sections\/[^/]+\/(activate|deactivate)$/.test(path) && method === "POST") {
    ensureDemoSectionManager(demoRole);
    const sectionId = path.split("/")[2] ?? "";
    const section = state.sections.find((item) => item.id === sectionId);
    if (!section) throw new APIError(404, "SECTION_NOT_FOUND", "Showroom tidak ditemukan.");
    section.status = path.endsWith("/activate") ? "ACTIVE" : "INACTIVE";
    await writeState(state);
    return { id: section.id, status: section.status } as T;
  }
  if (path === "/shifts" && method === "GET") {
    return clone(state.supervisorShifts) as T;
  }
  if (path === "/shifts" && method === "POST") {
    const section = state.sections.find((item) => item.id === input.sectionId);
    const participants = DEMO_EMPLOYEES.filter(
      (item) =>
        Array.isArray(input.membershipIds) &&
        input.membershipIds.includes(item.id),
    ).map((item) => ({
      membershipId: item.id,
      employeeName: item.fullName,
      employeeNumber: item.employeeNumber,
    }));
    const shift: SupervisorShift = {
      id: `demo-supervisor-shift-${Date.now()}`,
      title: String(input.title),
      scheduleType: input.scheduleType === "EVENT" ? "EVENT" : "SHIFT",
      roleName: input.roleName ? String(input.roleName) : undefined,
      showroomName: input.showroomName ? String(input.showroomName) : undefined,
      startsAt: String(input.startsAt),
      endsAt: String(input.endsAt),
      status: input.publish === false ? "DRAFT" : "PUBLISHED",
      section: {
        id: section?.id ?? String(input.sectionId),
        name: section?.name ?? "Lokasi event",
      },
      participants,
    };
    state.supervisorShifts.unshift(shift);
    await writeState(state);
    return { id: shift.id } as T;
  }
  if (
    path.startsWith("/shifts/") &&
    path.endsWith("/participants") &&
    method === "PATCH"
  ) {
    const shiftId = path.split("/")[2] ?? "";
    const shift = state.supervisorShifts.find((item) => item.id === shiftId);
    if (!shift) {
      throw new APIError(404, "SHIFT_NOT_FOUND", "Shift tidak ditemukan.");
    }
    const membershipIds = Array.isArray(input.membershipIds)
      ? [...new Set(input.membershipIds.map(String))]
      : [];
    shift.participants = DEMO_EMPLOYEES.filter((item) =>
      membershipIds.includes(item.id),
    ).map((item) => ({
      membershipId: item.id,
      employeeName: item.fullName,
      employeeNumber: item.employeeNumber,
    }));
    await writeState(state);
    return { id: shift.id, membershipIds } as T;
  }

  throw new Error(`Fitur demo lokal belum tersedia untuk ${method} ${path}.`);
}

const DEMO_EMPLOYEE_ME: Me = {
  id: "demo-user-local",
  email: "demo@bggold.local",
  fullName: "Ayu Demo",
  membershipId: "demo-membership-local",
  organizationId: "demo-organization-local",
  timezone: "Asia/Jakarta",
  employeeNumber: "BG-DEMO-01",
  roles: ["EMPLOYEE"],
};

const DEMO_SUPERVISOR_ME: Me = {
  id: "demo-supervisor-user-local",
  email: "supervisor.demo@bggold.local",
  fullName: "Sari Supervisor",
  membershipId: "demo-supervisor-membership-local",
  organizationId: "demo-organization-local",
  timezone: "Asia/Jakarta",
  employeeNumber: "BG-SPV-DEMO-01",
  roles: ["SUPERVISOR"],
};

function deviceDemoMe(state: DemoState): Me {
  return {
    id: "demo-device-user-local",
    email: "device.demo@bggold.local",
    fullName: state.deviceEmployeeName ?? "Karyawan Demo 2",
    membershipId: "demo-device-membership-local",
    organizationId: "demo-organization-local",
    timezone: "Asia/Jakarta",
    employeeNumber: "BG-HP-01",
    roles: ["EMPLOYEE"],
  };
}

const DEMO_ORGANIZATIONS: Organization[] = [
  {
    id: "demo-organization-local",
    code: "BG-GOLD-DEMO",
    name: "BG GOLD · Ruang Demo",
    timezone: "Asia/Jakarta",
  },
];

const DEMO_POLICY: Policy = {
  id: "demo-policy-anywhere",
  name: "Anywhere · Demo lokal",
  modes: ["ANYWHERE"],
  selfieRequired: false,
  minimumLocationAccuracyMeters: 100,
  earlyClockInMinutes: 60,
  lateClockInMinutes: 240,
  earlyClockOutMinutes: 240,
  lateClockOutMinutes: 60,
  preventEarlyClockIn: false,
  preventLateClockIn: false,
  preventEarlyClockOut: false,
  preventLateClockOut: false,
  workMoreRequiresApproval: false,
  unscheduledBreakRequiresApproval: false,
  preventUnscheduledBreak: false,
  scheduledBreakStartOffsetMinutes: 180,
  scheduledBreakEndOffsetMinutes: 300,
  breakRoundingMinutes: 15,
};

const DEMO_DEVICE_POLICY: Policy = {
  ...DEMO_POLICY,
  id: "demo-policy-one-device",
  name: "Satu HP · Foto & nama",
  modes: ["SELFIE", "DEVICE_LOCK"],
  selfieRequired: true,
};

const DEMO_LEAVE_TYPES: LeaveType[] = [
  {
    id: "demo-annual",
    code: "ANNUAL",
    name: "Cuti Tahunan",
    paid: true,
    status: "ACTIVE",
  },
  {
    id: "demo-sick",
    code: "SICK",
    name: "Cuti Sakit",
    paid: true,
    status: "ACTIVE",
  },
];

const DEMO_CLAIM_TYPES: ClaimType[] = [
  {
    id: "demo-transport",
    code: "TRANSPORT",
    name: "Transportasi",
    receiptRequired: false,
    status: "ACTIVE",
  },
  {
    id: "demo-meal",
    code: "MEAL",
    name: "Konsumsi",
    receiptRequired: true,
    status: "ACTIVE",
  },
];

const DEMO_EMPLOYEES: Employee[] = [
  {
    id: "demo-membership-local",
    fullName: "Ayu Demo",
    email: "ayu@bggold.local",
    employeeNumber: "BG-DEMO-01",
    jobTitle: "Retail Associate",
    status: "ACTIVE",
    roles: ["EMPLOYEE"],
  },
  {
    id: "demo-team-dimas",
    fullName: "Dimas Pratama",
    email: "dimas@bggold.local",
    employeeNumber: "BG-0214",
    jobTitle: "Retail Associate",
    status: "ACTIVE",
    roles: ["EMPLOYEE"],
  },
  {
    id: "demo-team-intan",
    fullName: "Intan Maharani",
    email: "intan@bggold.local",
    employeeNumber: "BG-0187",
    jobTitle: "Customer Service",
    status: "ACTIVE",
    roles: ["EMPLOYEE"],
  },
  {
    id: "demo-team-raka",
    fullName: "Raka Wijaya",
    email: "raka@bggold.local",
    employeeNumber: "BG-0261",
    jobTitle: "Inventory",
    status: "ACTIVE",
    roles: ["EMPLOYEE"],
  },
  {
    id: "demo-team-nia",
    fullName: "Nia Kusuma",
    email: "nia@bggold.local",
    employeeNumber: "BG-0239",
    jobTitle: "Retail Associate",
    status: "ACTIVE",
    roles: ["EMPLOYEE"],
  },
];

const DEMO_SECTIONS: Section[] = [
  {
    id: "demo-section-hq",
    code: "FLAGSHIP",
    name: "BG GOLD Flagship",
    address: "Jakarta",
    timezone: "Asia/Jakarta",
    status: "ACTIVE",
  },
  {
    id: "demo-section-warehouse",
    code: "WAREHOUSE",
    name: "BG GOLD Warehouse",
    address: "Jakarta",
    timezone: "Asia/Jakarta",
    status: "ACTIVE",
  },
  {
    id: "demo-section-event",
    code: "EVENT",
    name: "Lokasi event",
    address: "Penugasan luar outlet",
    timezone: "Asia/Jakarta",
    status: "ACTIVE",
  },
];

function initialState(): DemoState {
  const now = new Date();
  const tomorrow = localDate(addDays(now, 1));
  const dayAfterTomorrow = localDate(addDays(now, 2));
  return {
    seedDate: localDate(now),
    nextEmployeeSequence: 295,
    sections: clone(DEMO_SECTIONS),
    attendanceState: "NOT_STARTED",
    attendanceEvents: [],
    deviceAttendanceState: "NOT_STARTED",
    deviceAttendanceEvents: [],
    demoAttachments: {},
    deviceEvidence: {},
    leaveRequests: [],
    claims: [],
    openShiftRequested: false,
    announcementAcknowledged: false,
    notifications: [
      {
        id: "demo-notification-welcome",
        kind: "ANNOUNCEMENT",
        title: "Selamat datang di ruang demo",
        body: "Semua perubahan hanya tersimpan di perangkat ini.",
        resourceType: "announcement",
        resourceId: "demo-announcement-welcome",
        read: false,
        createdAt: now.toISOString(),
      },
    ],
    supervisorAttendanceRequests: [
      {
        id: "demo-supervisor-attendance-1",
        eventId: "demo-team-event-1",
        membershipId: "demo-team-dimas",
        employeeName: "Dimas Pratama",
        employeeNumber: "BG-0214",
        actionType: "CLOCK_IN",
        status: "PENDING",
        requestedAt: now.toISOString(),
        recordedAt: new Date(now.getTime() - 45 * 60_000).toISOString(),
        reason: "GPS sempat tidak stabil saat tiba di outlet.",
        source: "MOBILE",
        sectionId: "demo-section-hq",
        attachmentId: "demo-attendance-selfie-dimas",
        latitude: -6.2001,
        longitude: 106.8168,
        accuracyM: 12,
      },
      {
        id: "demo-supervisor-attendance-approved",
        eventId: "demo-team-event-approved",
        membershipId: "demo-team-raka",
        employeeName: "Raka Wijaya",
        employeeNumber: "BG-0261",
        actionType: "CLOCK_OUT",
        status: "APPROVED",
        requestedAt: new Date(now.getTime() - 20 * 60 * 60_000).toISOString(),
        recordedAt: new Date(now.getTime() - 18 * 60 * 60_000).toISOString(),
        decidedAt: new Date(now.getTime() - 17 * 60 * 60_000).toISOString(),
        decisionReason: "Bukti waktu dan lokasi sesuai.",
        source: "MOBILE",
        sectionId: "demo-section-warehouse",
        attachmentId: "demo-attendance-selfie-raka",
        latitude: -6.205,
        longitude: 106.82,
        accuracyM: 9,
      },
    ],
    supervisorLeaveRequests: [
      {
        id: "demo-supervisor-leave-1",
        membershipId: "demo-team-intan",
        employeeName: "Intan Maharani",
        employeeNumber: "BG-0187",
        leaveTypeId: "demo-annual",
        leaveTypeName: "Cuti Tahunan",
        startsOn: tomorrow,
        endsOn: dayAfterTomorrow,
        totalDays: 2,
        reason: "Keperluan keluarga di luar kota.",
        status: "PENDING",
        requestedAt: now.toISOString(),
      },
    ],
    supervisorClaims: [
      {
        id: "demo-supervisor-claim-1",
        membershipId: "demo-team-raka",
        employeeName: "Raka Wijaya",
        employeeNumber: "BG-0261",
        claimTypeId: "demo-transport",
        claimTypeName: "Transportasi",
        title: "Taksi antar-outlet",
        amount: 185000,
        currency: "IDR",
        incurredOn: localDate(now),
        notes: "Perjalanan mendadak untuk pengiriman stok.",
        status: "PENDING",
        ocrStatus: "COMPLETE",
        ocrProvider: "demo-local",
        ocrResult: {
          merchant: "Blue Bird",
          total: 185000,
          currency: "IDR",
          confidence: 0.96,
        },
        requestedAt: now.toISOString(),
      },
    ],
    supervisorShiftRequests: [
      {
        id: "demo-supervisor-shift-1",
        shiftId: "demo-open-weekend",
        shiftTitle: "Bantuan Akhir Pekan",
        membershipId: "demo-team-nia",
        employeeName: "Nia Kusuma",
        employeeNumber: "BG-0239",
        status: "PENDING",
        reason: "Bersedia membantu tim akhir pekan.",
        requestedAt: now.toISOString(),
      },
    ],
    kioskAttendance: {},
    supervisorShifts: [
      {
        id: "demo-event-showroom",
        title: "Private Preview Koleksi Aurum",
        scheduleType: "EVENT",
        showroomName: "Showroom BG GOLD Plaza Indonesia",
        roleName: "Event & hospitality",
        startsAt: shiftForDay("seed", 1, "seed", 18, 22).startsAt,
        endsAt: shiftForDay("seed", 1, "seed", 18, 22).endsAt,
        status: "PUBLISHED",
        section: { id: "demo-section-event", name: "Lokasi event" },
        participants: [
          {
            membershipId: "demo-membership-local",
            employeeName: "Ayu Demo",
            employeeNumber: "BG-DEMO-01",
          },
          {
            membershipId: "demo-team-dimas",
            employeeName: "Dimas Pratama",
            employeeNumber: "BG-0214",
          },
          {
            membershipId: "demo-team-nia",
            employeeName: "Nia Kusuma",
            employeeNumber: "BG-0239",
          },
        ],
      },
      {
        id: "demo-event-warehouse",
        title: "Stock Opname Bulanan",
        scheduleType: "EVENT",
        showroomName: "Showroom BG GOLD Warehouse",
        roleName: "Inventory",
        startsAt: shiftForDay("seed", 2, "seed", 8, 14).startsAt,
        endsAt: shiftForDay("seed", 2, "seed", 8, 14).endsAt,
        status: "PUBLISHED",
        section: { id: "demo-section-warehouse", name: "BG GOLD Warehouse" },
        participants: [
          {
            membershipId: "demo-team-raka",
            employeeName: "Raka Wijaya",
            employeeNumber: "BG-0261",
          },
          {
            membershipId: "demo-team-intan",
            employeeName: "Intan Maharani",
            employeeNumber: "BG-0187",
          },
        ],
      },
    ],
  };
}

async function readState() {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const stored = JSON.parse(raw) as DemoState;
      if (stored.seedDate === localDate(new Date())) {
        stored.nextEmployeeSequence ??= 295;
        stored.sections ??= clone(DEMO_SECTIONS);
        stored.demoAttachments ??= {};
        stored.deviceEvidence ??= {};
        stored.kioskAttendance ??= {};
        return stored;
      }
    } catch {
      // A corrupt demo is replaced with a fresh, isolated sample.
    }
  }
  const seeded = initialState();
  await writeState(seeded);
  return seeded;
}

function ensureDemoSectionManager(role: "employee" | "device" | "supervisor") {
  if (role !== "supervisor") {
    throw new APIError(403, "FORBIDDEN", "Hanya supervisor yang dapat mengelola showroom.");
  }
}

async function writeState(state: DemoState) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function today(
  state: DemoState,
  role: "employee" | "device" | "supervisor",
): Today {
  const device = role === "device";
  return {
    state: device ? state.deviceAttendanceState : state.attendanceState,
    activeShiftId: "demo-shift-today",
    latestEvents: clone(
      (device ? state.deviceAttendanceEvents : state.attendanceEvents).slice(
        0,
        5,
      ),
    ),
  };
}

function assignedShifts(
  state: DemoState,
  role: "employee" | "device" | "supervisor",
): Shift[] {
  const participants = DEMO_EMPLOYEES.slice(0, 3).map((item) => ({
    membershipId: item.id,
    employeeName: item.fullName,
    employeeNumber: item.employeeNumber,
  }));
  const shifts: Shift[] = [
    { ...shiftForDay("demo-shift-today", 0, "Shift Galeri Utama", 9, 17), participants },
    { ...shiftForDay("demo-shift-tomorrow", 1, "Layanan Pelanggan", 10, 18), participants: participants.slice(0, 2) },
    { ...shiftForDay("demo-shift-next", 3, "Display & Inventory", 9, 17), participants: participants.slice(1) },
  ];
  if (role === "employee") {
    shifts.push(
      ...state.supervisorShifts.filter((item) =>
        item.participants.some(
          (participant) => participant.membershipId === "demo-membership-local",
        ),
      ),
    );
  }
  return shifts;
}

function openShifts(requested: boolean): OpenShift[] {
  return [
    {
      ...shiftForDay("demo-open-weekend", 2, "Bantuan Akhir Pekan", 11, 19),
      requestStatus: requested ? "PENDING" : undefined,
    },
  ];
}

function supervisorAttendanceReport(
  state: DemoState,
): SupervisorAttendanceReport {
  const reportDay = addDays(new Date(), -1);
  reportDay.setHours(0, 0, 0, 0);
  const instant = (hour: number, minute: number) => {
    const value = new Date(reportDay);
    value.setHours(hour, minute, 0, 0);
    return value.toISOString();
  };
  const shiftStartsAt = instant(9, 0);
  const shiftEndsAt = instant(17, 0);

  const rows: SupervisorAttendanceReport["rows"] = [
    {
      membershipId: "demo-membership-local",
      employeeName: "Ayu Demo",
      employeeNumber: "BG-DEMO-01",
      sectionName: "BG GOLD Flagship",
      shiftTitle: "Shift Galeri Utama",
      shiftStartsAt,
      shiftEndsAt,
      clockInAt: instant(8, 53),
      clockOutAt: instant(17, 4),
      clockInEventId: "demo-report-ayu-in",
      clockOutEventId: "demo-report-ayu-out",
      workMinutes: 491,
      status: "ON_TIME",
    },
    {
      membershipId: "demo-team-dimas",
      employeeName: "Dimas Pratama",
      employeeNumber: "BG-0214",
      sectionName: "BG GOLD Flagship",
      shiftTitle: "Shift Galeri Utama",
      shiftStartsAt,
      shiftEndsAt,
      clockInAt: instant(9, 18),
      clockOutAt: instant(17, 7),
      clockInEventId: "demo-team-event-1",
      clockOutEventId: "demo-report-dimas-out",
      workMinutes: 469,
      status: "LATE",
    },
    {
      membershipId: "demo-team-intan",
      employeeName: "Intan Maharani",
      employeeNumber: "BG-0187",
      sectionName: "BG GOLD Flagship",
      shiftTitle: "Layanan Pelanggan",
      shiftStartsAt,
      shiftEndsAt,
      workMinutes: 0,
      status: "LEAVE",
    },
    {
      membershipId: "demo-team-raka",
      employeeName: "Raka Wijaya",
      employeeNumber: "BG-0261",
      sectionName: "BG GOLD Warehouse",
      shiftTitle: "Display & Inventory",
      shiftStartsAt,
      shiftEndsAt,
      clockInAt: instant(8, 47),
      clockOutAt: instant(17, 1),
      clockInEventId: "demo-report-raka-in",
      clockOutEventId: "demo-team-event-approved",
      workMinutes: 494,
      status: "ON_TIME",
    },
    {
      membershipId: "demo-team-nia",
      employeeName: "Nia Kusuma",
      employeeNumber: "BG-0239",
      sectionName: "BG GOLD Flagship",
      shiftTitle: "Shift Galeri Utama",
      shiftStartsAt,
      shiftEndsAt,
      workMinutes: 0,
      status: "ABSENT",
    },
    {
      membershipId: "demo-team-bima",
      employeeName: "Bima Saputra",
      employeeNumber: "BG-0294",
      sectionName: "BG GOLD Warehouse",
      shiftTitle: "Display & Inventory",
      shiftStartsAt,
      shiftEndsAt,
      clockInAt: instant(8, 56),
      clockOutAt: instant(17, 12),
      clockInEventId: "demo-report-bima-in",
      clockOutEventId: "demo-report-bima-out",
      workMinutes: 496,
      status: "ON_TIME",
    },
  ];
  const deviceClockIn = state.deviceAttendanceEvents.find(
    (event) => event.actionType === "CLOCK_IN",
  );
  const deviceClockOut = state.deviceAttendanceEvents.find(
    (event) => event.actionType === "CLOCK_OUT",
  );
  const deviceRecord = deviceClockIn
    ? state.deviceEvidence[deviceClockIn.id]
    : deviceClockOut
      ? state.deviceEvidence[deviceClockOut.id]
      : undefined;
  if (deviceRecord) {
    const clockInAt = deviceClockIn?.recordedAt;
    const clockOutAt = deviceClockOut?.recordedAt;
    rows.unshift({
      membershipId: "demo-device-membership-local",
      employeeName: deviceRecord.employeeName,
      employeeNumber: deviceRecord.employeeNumber,
      sectionName: deviceRecord.detail.section?.name ?? "BG GOLD Flagship",
      shiftTitle: "Mode Showroom · 1 HP",
      shiftStartsAt,
      shiftEndsAt,
      clockInAt,
      clockOutAt,
      clockInEventId: deviceClockIn?.id,
      clockOutEventId: deviceClockOut?.id,
      workMinutes:
        clockInAt && clockOutAt
          ? Math.max(
              0,
              Math.round(
                (new Date(clockOutAt).getTime() -
                  new Date(clockInAt).getTime()) /
                  60_000,
              ),
            )
          : 0,
      status: clockOutAt ? "ON_TIME" : "WORKING",
    });
  }
  const kioskSection = state.sections.find((item) => item.id === state.kiosk?.sectionId);
  for (const [employeeNumber, record] of Object.entries(state.kioskAttendance)) {
    const employee = DEMO_EMPLOYEES.find((item) => item.employeeNumber === employeeNumber);
    if (!employee || record.events.length === 0) continue;
    const clockIn = record.events.find((event) => event.actionType === "CLOCK_IN");
    const clockOut = record.events.find((event) => event.actionType === "CLOCK_OUT");
    const existing = rows.find((row) => row.employeeNumber === employeeNumber);
    const kioskRow: SupervisorAttendanceReport["rows"][number] = {
      membershipId: employee.id,
      employeeName: employee.fullName,
      employeeNumber,
      sectionName: kioskSection?.name ?? "BG GOLD Flagship",
      shiftTitle: "Kiosk Showroom · 1 HP",
      shiftStartsAt,
      shiftEndsAt,
      clockInAt: clockIn?.recordedAt,
      clockOutAt: clockOut?.recordedAt,
      clockInEventId: clockIn?.id,
      clockOutEventId: clockOut?.id,
      workMinutes: clockIn && clockOut ? Math.max(0, Math.round((new Date(clockOut.recordedAt).getTime() - new Date(clockIn.recordedAt).getTime()) / 60_000)) : 0,
      status: clockOut ? "ON_TIME" : "WORKING",
    };
    if (existing) Object.assign(existing, kioskRow);
    else rows.unshift(kioskRow);
  }
  return {
    date: localDate(reportDay),
    generatedAt: new Date().toISOString(),
    organizationName: "BG GOLD · Ruang Demo",
    rows,
  };
}

function demoAttendanceEvidence(eventId: string): AttendanceEvidenceDetail {
  const now = new Date();
  const warehouse =
    eventId.includes("raka") ||
    eventId.includes("bima") ||
    eventId === "demo-team-event-approved";
  const ayu = eventId.includes("ayu");
  const employeeImage = ayu ? "ayu" : warehouse ? "raka" : "dimas";
  const clockOut =
    eventId.includes("out") || eventId === "demo-team-event-approved";
  const recordedAt = new Date(now);
  recordedAt.setHours(
    clockOut ? 17 : ayu ? 8 : warehouse ? 8 : 9,
    clockOut ? 4 : ayu ? 53 : warehouse ? 47 : 18,
    0,
    0,
  );
  return {
    eventId,
    actionType: clockOut ? "CLOCK_OUT" : "CLOCK_IN",
    decision: eventId === "demo-team-event-1" ? "PENDING" : "APPROVED",
    source: "MOBILE",
    recordedAt: recordedAt.toISOString(),
    reason:
      eventId === "demo-team-event-1"
        ? "GPS sempat tidak stabil saat tiba di outlet."
        : undefined,
    section: warehouse
      ? {
          id: "demo-section-warehouse",
          name: "BG GOLD Warehouse",
          address: "Jl. Gatot Subroto, Jakarta Selatan",
        }
      : {
          id: "demo-section-hq",
          name: "BG GOLD Flagship",
          address: "Jl. M.H. Thamrin, Jakarta Pusat",
        },
    location: {
      latitude: warehouse ? -6.205 : -6.2001,
      longitude: warehouse ? 106.82 : 106.8168,
      accuracyM: warehouse ? 9 : 12,
      capturedAt: new Date(recordedAt.getTime() - 8_000).toISOString(),
    },
    attachment: {
      id: `demo-attendance-selfie-${employeeImage}`,
      contentType: "image/png",
      sizeBytes: 2060000,
      url: `demo-selfie-${employeeImage}`,
      expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    },
    device: {
      id: `demo-device-${employeeImage}`,
      platform: "ANDROID",
      label: ayu
        ? "Samsung Galaxy A55"
        : warehouse
          ? "OPPO Reno 11"
          : "Xiaomi Redmi Note 13",
    },
    wifiSSID: warehouse ? "BGGOLD-WAREHOUSE" : "BGGOLD-STAFF",
    integrityVerdict: {
      providerAvailable: true,
      tokenProvided: true,
      riskScore: 0,
      maxRiskScore: 35,
    },
    faceVerification: {
      verified: true,
      livenessPassed: true,
      similarityScore: ayu ? 0.974 : warehouse ? 0.961 : 0.952,
      provider: "BG GOLD Face Check · Demo",
    },
    evidenceSavedAt: new Date(recordedAt.getTime() + 1_000).toISOString(),
  };
}

function shiftForDay(
  id: string,
  offset: number,
  title: string,
  start: number,
  end: number,
): Shift {
  const startsAt = new Date();
  startsAt.setDate(startsAt.getDate() + offset);
  startsAt.setHours(start, 0, 0, 0);
  const endsAt = new Date(startsAt);
  endsAt.setHours(end, 0, 0, 0);
  return {
    id,
    title,
    roleName: "Retail Associate",
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    section: { id: "demo-section-hq", name: "BG GOLD Flagship" },
  };
}

async function attendanceAction(
  state: DemoState,
  input: Record<string, any>,
  role: "employee" | "device" | "supervisor",
) {
  const action = input.type as AttendanceAction;
  const device = role === "device";
  const events = device ? state.deviceAttendanceEvents : state.attendanceEvents;
  const alreadyClockedInToday = events.some(
    (event) =>
      event.actionType === "CLOCK_IN" &&
      localDate(new Date(event.recordedAt)) === localDate(new Date()),
  );
  if (action === "CLOCK_IN" && alreadyClockedInToday) {
    throw new APIError(
      409,
      "ALREADY_CLOCKED_IN_TODAY",
      "Absensi hari ini sudah tercatat. Setiap karyawan hanya dapat clock-in satu kali per hari.",
    );
  }
  if (device) {
    const evidence = (input.evidence ?? {}) as Record<string, any>;
    const employeeName = String(evidence.employeeName ?? "").trim();
    const deviceId = String(evidence.deviceId ?? "").trim();
    if (employeeName.length < 2) {
      throw new APIError(
        422,
        "EMPLOYEE_NAME_REQUIRED",
        "Tuliskan nama karyawan sebelum mengirim absensi.",
      );
    }
    if (!evidence.attachmentId) {
      throw new APIError(
        422,
        "SELFIE_REQUIRED",
        "Foto wajah wajib diambil untuk Demo 2.",
      );
    }
    if (!deviceId) {
      throw new APIError(
        422,
        "DEVICE_REQUIRED",
        "Identitas HP belum tersedia. Coba buka ulang aplikasi.",
      );
    }
    if (state.deviceId && state.deviceId !== deviceId) {
      throw new APIError(
        409,
        "DEVICE_ALREADY_BOUND",
        "Karyawan ini sudah terikat ke HP lain.",
      );
    }
    if (
      state.deviceEmployeeName &&
      state.deviceEmployeeName.toLocaleLowerCase("id-ID") !==
        employeeName.toLocaleLowerCase("id-ID")
    ) {
      throw new APIError(
        409,
        "DEVICE_BOUND_TO_ANOTHER_EMPLOYEE",
        `HP ini sudah terikat kepada ${state.deviceEmployeeName}.`,
      );
    }
    state.deviceEmployeeName = employeeName;
    state.deviceId = deviceId;
    state.deviceBoundAt ??= new Date().toISOString();
  }
  const next: Record<AttendanceAction, AttendanceState> = {
    CLOCK_IN: "WORKING",
    CLOCK_OUT: "COMPLETED",
    START_BREAK: "ON_BREAK",
    END_BREAK: "WORKING",
    WORK_MORE: "WORKING",
  };
  const recordedAt = new Date().toISOString();
  const event: AttendanceEvent = {
    id: `demo-attendance-${Date.now()}`,
    actionType: action,
    decision: "APPROVED",
    recordedAt,
    reason: typeof input.reason === "string" ? input.reason : undefined,
  };
  if (device) {
    const inputEvidence = (input.evidence ?? {}) as Record<string, any>;
    const section = demoEvidenceSection(String(input.sectionId ?? ""));
    const attachmentId = String(inputEvidence.attachmentId ?? "");
    const attachment = state.demoAttachments[attachmentId];
    const selectedLocation = inputEvidence.selectedLocationName
      ? String(inputEvidence.selectedLocationName)
      : section.name;
    const location = demoEvidenceLocation(section.id);
    state.deviceEvidence[event.id] = {
      employeeName: state.deviceEmployeeName ?? "Karyawan Showroom",
      employeeNumber: "BG-1HP-01",
      detail: {
        eventId: event.id,
        actionType: action,
        decision: "APPROVED",
        source: "KIOSK",
        recordedAt,
        section: { ...section, name: selectedLocation },
        location: {
          ...location,
          capturedAt: recordedAt,
        },
        attachment: attachment
          ? {
              id: attachmentId,
              contentType: attachment.contentType,
              sizeBytes: attachment.sizeBytes,
              url: attachment.uri,
            }
          : undefined,
        device: {
          id: state.deviceId ?? "demo-showroom-device",
          platform: "ANDROID",
          label: "HP Kiosk · BG GOLD Showroom",
        },
        wifiSSID: "BGGOLD-SHOWROOM",
        integrityVerdict: {
          providerAvailable: true,
          tokenProvided: true,
          riskScore: 0,
          maxRiskScore: 35,
        },
        faceVerification: {
          verified: true,
          livenessPassed: true,
          similarityScore: 0.958,
          provider: "BG GOLD Kiosk Face Check · Demo",
        },
        evidenceSavedAt: recordedAt,
      },
    };
    state.deviceAttendanceState = next[action];
    state.deviceAttendanceEvents.unshift(event);
  } else {
    state.attendanceState = next[action];
    state.attendanceEvents.unshift(event);
  }
  await writeState(state);
  return {
    actionId: event.id,
    decision: "APPROVED",
    attendanceState: device
      ? state.deviceAttendanceState
      : state.attendanceState,
    recordedAt,
    message: "Tindakan demo tersimpan di perangkat ini.",
  };
}

function demoEvidenceSection(sectionId: string) {
  if (sectionId === "demo-section-warehouse") {
    return {
      id: sectionId,
      name: "BG GOLD Warehouse",
      address: "Jl. Gatot Subroto, Jakarta Selatan",
    };
  }
  if (sectionId === "demo-section-event") {
    return {
      id: sectionId,
      name: "Lokasi event",
      address: "Penugasan luar outlet",
    };
  }
  return {
    id: "demo-section-hq",
    name: "BG GOLD Flagship",
    address: "Jl. M.H. Thamrin, Jakarta Pusat",
  };
}

function demoEvidenceLocation(sectionId: string) {
  return sectionId === "demo-section-warehouse"
    ? { latitude: -6.205, longitude: 106.82, accuracyM: 4 }
    : sectionId === "demo-section-event"
      ? { latitude: -6.2146, longitude: 106.8451, accuracyM: 6 }
      : { latitude: -6.2001, longitude: 106.8168, accuracyM: 3 };
}

function leaveBalances(state: DemoState): LeaveBalance[] {
  const pending = state.leaveRequests
    .filter((item) => item.status === "PENDING")
    .reduce((total, item) => total + item.totalDays, 0);
  return [
    {
      id: "demo-leave-balance",
      leaveTypeId: "demo-annual",
      leaveTypeName: "Cuti Tahunan",
      year: new Date().getFullYear(),
      entitlementDays: 12,
      usedDays: 2,
      pendingDays: pending,
      availableDays: Math.max(0, 10 - pending),
    },
  ];
}

async function createLeave(state: DemoState, input: Record<string, any>) {
  const type =
    DEMO_LEAVE_TYPES.find((item) => item.id === input.leaveTypeId) ??
    DEMO_LEAVE_TYPES[0]!;
  const totalDays = inclusiveDays(String(input.startsOn), String(input.endsOn));
  const item: LeaveRequest = {
    id: `demo-leave-${Date.now()}`,
    leaveTypeId: type.id,
    leaveTypeName: type.name,
    startsOn: String(input.startsOn),
    endsOn: String(input.endsOn),
    totalDays,
    reason: String(input.reason),
    status: "PENDING",
    requestedAt: new Date().toISOString(),
  };
  state.leaveRequests.unshift(item);
  await writeState(state);
  return { id: item.id, status: item.status, totalDays };
}

async function createClaim(state: DemoState, input: Record<string, any>) {
  const type =
    DEMO_CLAIM_TYPES.find((item) => item.id === input.claimTypeId) ??
    DEMO_CLAIM_TYPES[0]!;
  const item: Claim = {
    id: `demo-claim-${Date.now()}`,
    claimTypeId: type.id,
    claimTypeName: type.name,
    title: String(input.title),
    amount: Number(input.amount),
    currency: String(input.currency ?? "IDR"),
    incurredOn: String(input.incurredOn),
    notes: input.notes ? String(input.notes) : undefined,
    attachmentId: input.attachmentId ? String(input.attachmentId) : undefined,
    status: "PENDING",
    ocrStatus: "NOT_CONFIGURED",
    requestedAt: new Date().toISOString(),
  };
  state.claims.unshift(item);
  await writeState(state);
  return { id: item.id, status: item.status };
}

function announcements(state: DemoState): Announcement[] {
  return [
    {
      id: "demo-announcement-welcome",
      title: "Ruang demo siap dicoba",
      body: "Clock-in, istirahat, jadwal, cuti, dan klaim di sini hanya tersimpan lokal. Data operasional BG GOLD tidak tersentuh.",
      priority: "IMPORTANT",
      requiresAcknowledgment: true,
      publishedAt: new Date().toISOString(),
      read: state.announcementAcknowledged,
      acknowledged: state.announcementAcknowledged,
    },
  ];
}

function parseBody(body: BodyInit | null | undefined): Record<string, any> {
  if (typeof body !== "string" || !body) return {};
  try {
    return JSON.parse(body) as Record<string, any>;
  } catch {
    return {};
  }
}

function inclusiveDays(startsOn: string, endsOn: string) {
  const start = new Date(`${startsOn}T00:00:00Z`).getTime();
  const end = new Date(`${endsOn}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 1;
  return Math.floor((end - start) / 86_400_000) + 1;
}

function localDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function decideItem<
  T extends { id: string; status: string; decisionReason?: string },
>(items: T[], id: string | undefined, input: Record<string, any>) {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) return;
  item.status = input.decision === "REJECTED" ? "REJECTED" : "APPROVED";
  item.decisionReason = input.reason ? String(input.reason) : undefined;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

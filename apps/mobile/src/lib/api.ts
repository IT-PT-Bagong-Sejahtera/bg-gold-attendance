import { isDemoAccessToken } from "./demoSession";

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  "https://attendanceapi.bggold.cloud/api/v1";

export type TokenPair = {
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
};
export type Me = {
  id: string;
  email: string;
  fullName: string;
  membershipId: string;
  organizationId: string;
  timezone: string;
  employeeNumber: string;
  roles: string[];
};
export type Organization = {
  id: string;
  code: string;
  name: string;
  timezone: string;
};
export type AttendanceState =
  "NOT_STARTED" | "WORKING" | "ON_BREAK" | "COMPLETED" | "PENDING";
export type AttendanceAction =
  "CLOCK_IN" | "CLOCK_OUT" | "START_BREAK" | "END_BREAK" | "WORK_MORE";
export type AttendanceEventAction =
  AttendanceAction | "AUTO_CLOCK_OUT" | "CORRECTION";
export type AttendanceEvent = {
  id: string;
  actionType: AttendanceEventAction;
  decision: "APPROVED" | "PENDING" | "REJECTED";
  recordedAt: string;
  reason?: string;
};
export type Today = {
  state: AttendanceState;
  activeShiftId?: string;
  latestEvents: AttendanceEvent[];
};
export type Shift = {
  id: string;
  title: string;
  scheduleType?: "SHIFT" | "EVENT";
  roleName?: string;
  showroomName?: string;
  startsAt: string;
  endsAt: string;
  section: { id: string; name: string };
  participants?: ShiftParticipant[];
  status?: "DRAFT" | "PUBLISHED";
};
export type Employee = {
  id: string;
  fullName: string;
  email: string;
  employeeNumber: string;
  jobTitle?: string;
  status: string;
  roles: string[];
};
export type CreateEmployeePayload = {
  fullName: string;
  email: string;
  employeeNumber: string;
  jobTitle: string;
  password: string;
  roles: Array<"EMPLOYEE" | "SUPERVISOR">;
};
export type Section = {
  id: string;
  code: string;
  name: string;
  address?: string;
  timezone?: string;
  status: string;
};
export type ShiftParticipant = {
  membershipId: string;
  employeeName: string;
  employeeNumber: string;
};
export type SupervisorShift = Shift & {
  status: "DRAFT" | "PUBLISHED";
  participants: ShiftParticipant[];
};
export type OpenShift = Shift & {
  requestStatus?: "PENDING" | "APPROVED" | "REJECTED";
};
export type Policy = {
  id: string;
  name: string;
  modes: string[];
  selfieRequired: boolean;
  minimumLocationAccuracyMeters?: number;
  earlyClockInMinutes: number;
  lateClockInMinutes: number;
  earlyClockOutMinutes: number;
  lateClockOutMinutes: number;
  preventEarlyClockIn: boolean;
  preventLateClockIn: boolean;
  preventEarlyClockOut: boolean;
  preventLateClockOut: boolean;
  workMoreRequiresApproval?: boolean;
  unscheduledBreakRequiresApproval?: boolean;
  preventUnscheduledBreak?: boolean;
  scheduledBreakStartOffsetMinutes?: number;
  scheduledBreakEndOffsetMinutes?: number;
  breakRoundingMinutes?: number;
};
export type Attachment = { id: string; contentType: string; sizeBytes: number };
export type AttendanceRequest = {
  id: string;
  eventId: string;
  actionType: AttendanceAction;
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  requestedAt: string;
  recordedAt: string;
  reason?: string;
  decidedAt?: string;
  decisionReason?: string;
  source?: string;
  sectionId?: string;
  attachmentId?: string;
  latitude?: number;
  longitude?: number;
  accuracyM?: number;
};
export type PasswordResetRequested = {
  message: string;
  developmentResetToken?: string;
};
export type LeaveType = {
  id: string;
  code: string;
  name: string;
  paid: boolean;
  status: string;
};
export type LeaveBalance = {
  id: string;
  leaveTypeId: string;
  leaveTypeName: string;
  year: number;
  entitlementDays: number;
  usedDays: number;
  pendingDays: number;
  availableDays: number;
};
export type LeaveRequest = {
  id: string;
  leaveTypeId: string;
  leaveTypeName: string;
  startsOn: string;
  endsOn: string;
  totalDays: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  requestedAt: string;
  decisionReason?: string;
};
export type ClaimType = {
  id: string;
  code: string;
  name: string;
  receiptRequired: boolean;
  status: string;
};
export type Claim = {
  id: string;
  claimTypeId: string;
  claimTypeName: string;
  title: string;
  amount: number;
  currency: string;
  incurredOn: string;
  notes?: string;
  attachmentId?: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  ocrStatus: "NOT_CONFIGURED" | "PENDING" | "COMPLETE" | "FAILED";
  ocrProvider?: string;
  ocrResult?: {
    merchant?: string;
    total?: number;
    currency?: string;
    transactionDate?: string;
    confidence: number;
    reference?: string;
  };
  requestedAt: string;
  decisionReason?: string;
};
export type Announcement = {
  id: string;
  title: string;
  body: string;
  priority: "NORMAL" | "IMPORTANT" | "URGENT";
  requiresAcknowledgment: boolean;
  publishedAt: string;
  expiresAt?: string;
  read: boolean;
  acknowledged: boolean;
};
export type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  resourceType?: string;
  resourceId?: string;
  read: boolean;
  createdAt: string;
};
export type SupervisorAttendanceRequest = AttendanceRequest & {
  membershipId: string;
  employeeName: string;
  employeeNumber: string;
};
export type AttendanceEvidenceDetail = {
  eventId: string;
  actionType: AttendanceEventAction;
  decision: "APPROVED" | "PENDING" | "REJECTED";
  source: string;
  recordedAt: string;
  reason?: string;
  section?: { id: string; name: string; address?: string };
  location?: {
    latitude: number;
    longitude: number;
    accuracyM?: number;
    capturedAt?: string;
  };
  attachment?: {
    id: string;
    contentType: string;
    sizeBytes: number;
    url?: string;
    expiresAt?: string;
  };
  device?: { id: string; platform: string; label?: string };
  wifiSSID?: string;
  integrityVerdict?: {
    providerAvailable?: boolean;
    tokenProvided?: boolean;
    failOpen?: boolean;
    riskScore?: number;
    maxRiskScore?: number;
  };
  faceVerification?: {
    verified: boolean;
    livenessPassed: boolean;
    similarityScore: number;
    provider: string;
  };
  evidenceSavedAt?: string;
};
export type SupervisorLeaveRequest = LeaveRequest & {
  membershipId: string;
  employeeName: string;
  employeeNumber: string;
};
export type SupervisorClaim = Claim & {
  membershipId: string;
  employeeName: string;
  employeeNumber: string;
};
export type SupervisorShiftRequest = {
  id: string;
  shiftId: string;
  shiftTitle: string;
  membershipId: string;
  employeeName: string;
  employeeNumber: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reason?: string;
  decisionReason?: string;
  requestedAt: string;
};
export type SupervisorAttendanceReportStatus =
  "ON_TIME" | "LATE" | "ABSENT" | "LEAVE" | "WORKING";
export type SupervisorAttendanceReportRow = {
  membershipId: string;
  employeeName: string;
  employeeNumber: string;
  sectionName: string;
  shiftTitle: string;
  shiftStartsAt: string;
  shiftEndsAt: string;
  clockInAt?: string;
  clockOutAt?: string;
  clockInEventId?: string;
  clockOutEventId?: string;
  workMinutes: number;
  status: SupervisorAttendanceReportStatus;
};
export type SupervisorAttendanceReport = {
  date: string;
  generatedAt: string;
  organizationName: string;
  rows: SupervisorAttendanceReportRow[];
};
export type ApprovalDecision = "APPROVED" | "REJECTED";

type ErrorEnvelope = { error?: { code?: string; message?: string } };
type Envelope<T> = { data: T };
type AccessTokenRenewalHandler = (
  failedAccessToken: string,
) => Promise<string | null>;

let accessTokenRenewalHandler: AccessTokenRenewalHandler | null = null;
let accessTokenRenewalInFlight: Promise<string | null> | null = null;

export class APIError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function setAccessTokenRenewalHandler(
  handler: AccessTokenRenewalHandler | null,
) {
  accessTokenRenewalHandler = handler;
  accessTokenRenewalInFlight = null;
}

async function renewAccessToken(failedAccessToken: string) {
  if (!accessTokenRenewalHandler) return null;
  if (!accessTokenRenewalInFlight) {
    accessTokenRenewalInFlight = accessTokenRenewalHandler(failedAccessToken)
      .catch(() => null)
      .finally(() => {
        accessTokenRenewalInFlight = null;
      });
  }
  return accessTokenRenewalInFlight;
}

async function fetchAPI(
  path: string,
  init: RequestInit,
  accessToken?: string,
  json = true,
  canRenew = true,
): Promise<Response> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });
  if (
    response.status === 401 &&
    accessToken &&
    canRenew &&
    accessTokenRenewalHandler
  ) {
    const renewedToken = await renewAccessToken(accessToken);
    if (renewedToken) {
      return fetchAPI(path, init, renewedToken, json, false);
    }
  }
  return response;
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
  accessToken?: string,
): Promise<T> {
  if (isDemoAccessToken(accessToken)) {
    const { demoRequest } = await import("./demoApi");
    return demoRequest<T>(path, init, accessToken);
  }
  const response = await fetchAPI(path, init, accessToken);
  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as ErrorEnvelope | null;
    throw new APIError(
      response.status,
      payload?.error?.code ?? "REQUEST_FAILED",
      payload?.error?.message ?? "Permintaan gagal diproses.",
    );
  }
  if (response.status === 204) return undefined as T;
  return ((await response.json()) as Envelope<T>).data;
}

async function uploadAttachment(
  token: string,
  path: string,
  uri: string,
  name: string,
  mimeType: string,
  fallbackMessage: string,
) {
  if (isDemoAccessToken(token)) {
    const { demoUploadAttachment } = await import("./demoApi");
    return demoUploadAttachment(mimeType, uri);
  }
  const body = new FormData();
  body.append("file", { uri, name, type: mimeType } as unknown as Blob);
  const response = await fetchAPI(path, { method: "POST", body }, token, false);
  if (!response.ok) {
    const payload = (await response
      .json()
      .catch(() => null)) as ErrorEnvelope | null;
    throw new APIError(
      response.status,
      payload?.error?.code ?? "UPLOAD_FAILED",
      payload?.error?.message ?? fallbackMessage,
    );
  }
  return ((await response.json()) as Envelope<Attachment>).data;
}

export const api = {
  login: (email: string, password: string) =>
    request<TokenPair>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  refresh: (refreshToken: string) =>
    request<TokenPair>("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    }),
  logout: (token: string) =>
    request<void>("/auth/logout", { method: "POST" }, token),
  forgotPassword: (email: string) =>
    request<PasswordResetRequested>("/auth/password/forgot", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  resetPassword: (token: string, newPassword: string) =>
    request<{ message: string }>("/auth/password/reset", {
      method: "POST",
      body: JSON.stringify({ token, newPassword }),
    }),
  me: (token: string) => request<Me>("/me", {}, token),
  organizations: (token: string) =>
    request<Organization[]>("/me/organizations", {}, token),
  createEmployee: (token: string, payload: CreateEmployeePayload) =>
    request<{ id: string; invitationStatus: string }>(
      "/employees",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  switchOrganization: (token: string, organizationId: string) =>
    request<TokenPair>(
      "/me/active-organization",
      { method: "POST", body: JSON.stringify({ organizationId }) },
      token,
    ),
  today: (token: string) => request<Today>("/me/attendance/today", {}, token),
  history: (token: string) =>
    request<AttendanceEvent[]>("/me/attendance/history", {}, token),
  requests: (token: string) =>
    request<AttendanceRequest[]>("/me/requests", {}, token),
  leaveTypes: (token: string) =>
    request<LeaveType[]>("/leave-types", {}, token),
  leaveBalances: (token: string, year = new Date().getFullYear()) =>
    request<LeaveBalance[]>(`/me/leave-balances?year=${year}`, {}, token),
  leaveRequests: (token: string) =>
    request<LeaveRequest[]>("/me/leave-requests", {}, token),
  createLeaveRequest: (
    token: string,
    payload: {
      leaveTypeId: string;
      startsOn: string;
      endsOn: string;
      reason: string;
    },
  ) =>
    request<{ id: string; status: string; totalDays: number }>(
      "/me/leave-requests",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  withdrawLeaveRequest: (token: string, requestId: string) =>
    request<{ id: string; status: string }>(
      `/me/leave-requests/${encodeURIComponent(requestId)}/withdraw`,
      { method: "POST", body: "{}" },
      token,
    ),
  claimTypes: (token: string) =>
    request<ClaimType[]>("/claim-types", {}, token),
  claims: (token: string) => request<Claim[]>("/me/claims", {}, token),
  createClaim: (
    token: string,
    payload: {
      claimTypeId: string;
      title: string;
      amount: number;
      currency: string;
      incurredOn: string;
      notes: string;
      attachmentId?: string;
    },
  ) =>
    request<{ id: string; status: string }>(
      "/me/claims",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  withdrawClaim: (token: string, claimId: string) =>
    request<{ id: string; status: string }>(
      `/me/claims/${encodeURIComponent(claimId)}/withdraw`,
      { method: "POST", body: "{}" },
      token,
    ),
  announcements: (token: string) =>
    request<Announcement[]>("/me/announcements", {}, token),
  announcementReceipt: (
    token: string,
    announcementId: string,
    action: "READ" | "ACKNOWLEDGE",
  ) =>
    request<{ id: string; action: string }>(
      `/me/announcements/${encodeURIComponent(announcementId)}/receipt`,
      { method: "POST", body: JSON.stringify({ action }) },
      token,
    ),
  notifications: (token: string) =>
    request<Notification[]>("/me/notifications", {}, token),
  notificationUnreadCount: (token: string) =>
    request<{ count: number }>("/me/notifications/unread-count", {}, token),
  readNotification: (token: string, notificationId: string) =>
    request<{ id: string; read: boolean }>(
      `/me/notifications/${encodeURIComponent(notificationId)}/read`,
      { method: "POST", body: "{}" },
      token,
    ),
  registerDevice: (
    token: string,
    payload: {
      platform: "ANDROID" | "IOS";
      installationId: string;
      pushToken?: string;
      deviceLabel?: string;
    },
  ) =>
    request<{ id: string; status: string }>(
      "/me/devices",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  enrollFace: (token: string, attachmentId: string) =>
    request<{ id: string; status: string }>(
      "/me/face/enroll",
      { method: "POST", body: JSON.stringify({ attachmentId }) },
      token,
    ),
  verifyFace: (token: string, attachmentId: string) =>
    request<{ id: string; verified: boolean; expiresAt: string }>(
      "/me/face/verify",
      { method: "POST", body: JSON.stringify({ attachmentId }) },
      token,
    ),
  shifts: (token: string, from: string, to: string) =>
    request<Shift[]>(
      `/me/shifts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      {},
      token,
    ),
  openShifts: (token: string, from: string, to: string) =>
    request<OpenShift[]>(
      `/me/open-shifts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      {},
      token,
    ),
  requestShift: (token: string, shiftId: string, reason = "") =>
    request<{ id: string; status: string }>(
      `/shifts/${encodeURIComponent(shiftId)}/requests`,
      { method: "POST", body: JSON.stringify({ reason }) },
      token,
    ),
  supervisorAttendanceRequests: (token: string, status = "PENDING") =>
    request<SupervisorAttendanceRequest[]>(
      `/attendance/requests?status=${encodeURIComponent(status)}`,
      {},
      token,
    ),
  supervisorAttendanceReport: (token: string, date?: string) =>
    request<SupervisorAttendanceReport>(
      `/attendance/report${date ? `?date=${encodeURIComponent(date)}` : ""}`,
      {},
      token,
    ),
  attendanceEvidence: (token: string, eventId: string) =>
    request<AttendanceEvidenceDetail>(
      `/attendance/events/${encodeURIComponent(eventId)}/evidence`,
      {},
      token,
    ),
  myAttendanceEvidence: (token: string, eventId: string) =>
    request<AttendanceEvidenceDetail>(
      `/me/attendance/events/${encodeURIComponent(eventId)}/evidence`,
      {},
      token,
    ),
  decideAttendanceRequest: (
    token: string,
    requestId: string,
    decision: ApprovalDecision,
    reason = "",
  ) =>
    request<{ id: string; status: ApprovalDecision }>(
      `/attendance/requests/${encodeURIComponent(requestId)}/decision`,
      { method: "POST", body: JSON.stringify({ decision, reason }) },
      token,
    ),
  supervisorLeaveRequests: (token: string, status = "PENDING") =>
    request<SupervisorLeaveRequest[]>(
      `/leave-requests?status=${encodeURIComponent(status)}`,
      {},
      token,
    ),
  decideLeaveRequest: (
    token: string,
    requestId: string,
    decision: ApprovalDecision,
    reason = "",
  ) =>
    request<{ id: string; status: ApprovalDecision }>(
      `/leave-requests/${encodeURIComponent(requestId)}/decision`,
      { method: "POST", body: JSON.stringify({ decision, reason }) },
      token,
    ),
  supervisorClaims: (token: string, status = "PENDING") =>
    request<SupervisorClaim[]>(
      `/claims?status=${encodeURIComponent(status)}`,
      {},
      token,
    ),
  decideClaim: (
    token: string,
    claimId: string,
    decision: ApprovalDecision,
    reason = "",
  ) =>
    request<{ id: string; status: ApprovalDecision }>(
      `/claims/${encodeURIComponent(claimId)}/decision`,
      { method: "POST", body: JSON.stringify({ decision, reason }) },
      token,
    ),
  supervisorShiftRequests: (token: string, status = "PENDING") =>
    request<SupervisorShiftRequest[]>(
      `/shift-requests?status=${encodeURIComponent(status)}`,
      {},
      token,
    ),
  decideShiftRequest: (
    token: string,
    requestId: string,
    decision: ApprovalDecision,
    reason = "",
  ) =>
    request<{ id: string; status: ApprovalDecision }>(
      `/shift-requests/${encodeURIComponent(requestId)}/decision`,
      { method: "POST", body: JSON.stringify({ decision, reason }) },
      token,
    ),
  employees: (token: string) => request<Employee[]>("/employees", {}, token),
  sections: (token: string) => request<Section[]>("/sections", {}, token),
  supervisorShifts: (token: string, from: string, to: string) =>
    request<SupervisorShift[]>(
      `/shifts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      {},
      token,
    ),
  createShift: (
    token: string,
    payload: {
      sectionId: string;
      title: string;
      scheduleType?: "SHIFT" | "EVENT";
      roleName?: string;
      showroomName?: string;
      startsAt: string;
      endsAt: string;
      publish: boolean;
      open: boolean;
      membershipIds: string[];
    },
  ) =>
    request<{ id: string }>(
      "/shifts",
      { method: "POST", body: JSON.stringify(payload) },
      token,
    ),
  updateShiftParticipants: (
    token: string,
    shiftId: string,
    membershipIds: string[],
  ) =>
    request<{ id: string; membershipIds: string[] }>(
      `/shifts/${encodeURIComponent(shiftId)}/participants`,
      { method: "PATCH", body: JSON.stringify({ membershipIds }) },
      token,
    ),
  policy: (token: string, sectionId?: string) =>
    request<Policy>(
      `/me/attendance-policy${sectionId ? `?sectionId=${encodeURIComponent(sectionId)}` : ""}`,
      {},
      token,
    ),
  selfie: (token: string, uri: string, mimeType = "image/jpeg") =>
    uploadAttachment(
      token,
      "/attachments/attendance-selfie",
      uri,
      `attendance-${Date.now()}.jpg`,
      mimeType,
      "Foto gagal diunggah.",
    ),
  claimReceipt: (token: string, uri: string, mimeType = "image/jpeg") =>
    uploadAttachment(
      token,
      "/attachments/claim-receipt",
      uri,
      `claim-${Date.now()}.jpg`,
      mimeType,
      "Foto struk gagal diunggah.",
    ),
  faceImage: (token: string, uri: string, mimeType = "image/jpeg") =>
    uploadAttachment(
      token,
      "/attachments/face-image",
      uri,
      `face-${Date.now()}.jpg`,
      mimeType,
      "Foto wajah gagal diunggah.",
    ),
  action: (token: string, idempotencyKey: string, payload: unknown) =>
    request<{
      actionId: string;
      decision: string;
      attendanceState: AttendanceState;
      recordedAt: string;
      message: string;
    }>(
      "/attendance/actions",
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(payload),
      },
      token,
    ),
};

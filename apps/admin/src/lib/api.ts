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

export type AttendanceEvent = {
  id: string;
  actionType:
    | "CLOCK_IN"
    | "CLOCK_OUT"
    | "START_BREAK"
    | "END_BREAK"
    | "WORK_MORE"
    | "AUTO_CLOCK_OUT"
    | "CORRECTION";
  decision: "APPROVED" | "PENDING" | "REJECTED";
  recordedAt: string;
  reason?: string;
};

export type Today = {
  state: "NOT_STARTED" | "WORKING" | "ON_BREAK" | "COMPLETED" | "PENDING";
  activeShiftId?: string;
  latestEvents: AttendanceEvent[];
};

type Envelope<T> = { data: T; requestId: string };
const API_URL =
  import.meta.env.VITE_API_URL ??
  "https://attendanceapi.bggold.cloud/api/v1";

export class APIError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
  accessToken?: string,
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new APIError(
      response.status,
      payload?.error?.code ?? "REQUEST_FAILED",
      payload?.error?.message ?? "Permintaan gagal diproses.",
    );
  }
  if (response.status === 204) return undefined as T;
  const envelope = (await response.json()) as Envelope<T>;
  return envelope.data;
}

export async function downloadFile(
  path: string,
  accessToken: string,
): Promise<Blob> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new APIError(
      response.status,
      payload?.error?.code ?? "DOWNLOAD_FAILED",
      payload?.error?.message ?? "Laporan gagal diunduh.",
    );
  }
  return response.blob();
}

export function login(email: string, password: string): Promise<TokenPair> {
  return request<TokenPair>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function refresh(refreshToken: string): Promise<TokenPair> {
  return request<TokenPair>("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  });
}

export function logout(accessToken: string): Promise<void> {
  return request<void>("/auth/logout", { method: "POST" }, accessToken);
}

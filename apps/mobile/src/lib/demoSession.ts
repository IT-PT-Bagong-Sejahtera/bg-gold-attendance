import type { TokenPair } from "./api";

export const DEMO_ACCESS_TOKEN = "bg-gold-local-demo-access";
export const DEMO_SUPERVISOR_ACCESS_TOKEN =
  "bg-gold-local-demo-supervisor-access";
export const DEMO_DEVICE_ACCESS_TOKEN =
  "bg-gold-local-demo-device-access";
const DEMO_REFRESH_TOKEN = "bg-gold-local-demo-refresh";
const DEMO_SUPERVISOR_REFRESH_TOKEN =
  "bg-gold-local-demo-supervisor-refresh";
const DEMO_DEVICE_REFRESH_TOKEN = "bg-gold-local-demo-device-refresh";

export type DemoRole = "employee" | "device" | "supervisor";

export function isDemoAccessToken(token?: string) {
  return (
    token === DEMO_ACCESS_TOKEN ||
    token === DEMO_DEVICE_ACCESS_TOKEN ||
    token === DEMO_SUPERVISOR_ACCESS_TOKEN
  );
}

export function demoRoleFromToken(token?: string): DemoRole | null {
  if (token === DEMO_ACCESS_TOKEN) return "employee";
  if (token === DEMO_DEVICE_ACCESS_TOKEN) return "device";
  if (token === DEMO_SUPERVISOR_ACCESS_TOKEN) return "supervisor";
  return null;
}

export function createDemoSession(role: DemoRole = "employee"): TokenPair {
  const supervisor = role === "supervisor";
  const device = role === "device";
  return {
    accessToken: supervisor
      ? DEMO_SUPERVISOR_ACCESS_TOKEN
      : device
        ? DEMO_DEVICE_ACCESS_TOKEN
        : DEMO_ACCESS_TOKEN,
    accessExpiresAt: "2099-12-31T23:59:59.000Z",
    refreshToken: supervisor
      ? DEMO_SUPERVISOR_REFRESH_TOKEN
      : device
        ? DEMO_DEVICE_REFRESH_TOKEN
        : DEMO_REFRESH_TOKEN,
    refreshExpiresAt: "2099-12-31T23:59:59.000Z",
  };
}

import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { api } from "../lib/api";
import { KioskScreen } from "./KioskScreen";

const mockClear = jest.fn(async () => undefined);
jest.mock("../lib/auth", () => ({ useAuth: () => ({ session: { accessToken: "supervisor-token" }, logout: jest.fn(async () => undefined) }) }));
jest.mock("../lib/kioskMode", () => ({ useKioskMode: () => ({ kiosk: { id: "kiosk-1", token: "demo-kiosk-token", deviceLabel: "Kiosk Flagship", showroom: { id: "section-1", code: "FLAGSHIP", name: "BG GOLD Flagship" } }, clear: mockClear }) }));
jest.mock("../lib/api", () => ({ api: { kioskContext: jest.fn(), kioskEmployeeStatus: jest.fn(), kioskAttendanceSelfie: jest.fn(), kioskAttendanceAction: jest.fn(), revokeKiosk: jest.fn() } }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "idempotency-kiosk-1" }));
jest.mock("expo-image-picker", () => ({
  CameraType: { front: "front" },
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: "file:///kiosk-selfie.jpg", mimeType: "image/jpeg" }] })),
}));
jest.mock("expo-location", () => ({
  Accuracy: { High: 4 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: -6.2, longitude: 106.8, accuracy: 8 }, timestamp: Date.now() })),
}));

const employees = [
  { id: "ayu", fullName: "Ayu Demo", employeeNumber: "BG-DEMO-01", jobTitle: "Retail Associate", pinConfigured: true },
  { id: "dimas", fullName: "Dimas Pratama", employeeNumber: "BG-0214", jobTitle: "Retail Associate", pinConfigured: true },
];

beforeEach(() => {
  jest.clearAllMocks();
  (api.kioskContext as jest.Mock).mockResolvedValue({ kiosk: { id: "kiosk-1", deviceLabel: "Kiosk Flagship" }, showroom: { id: "section-1", code: "FLAGSHIP", name: "BG GOLD Flagship", address: "Jakarta" }, employees });
  (api.kioskEmployeeStatus as jest.Mock).mockImplementation(async (_token, employeeNumber) => ({ employee: employees.find((item) => item.employeeNumber === employeeNumber), attendance: { state: "NOT_STARTED", latestEvents: [] } }));
  (api.kioskAttendanceSelfie as jest.Mock).mockResolvedValue({ id: "attachment-1", contentType: "image/jpeg", sizeBytes: 100 });
  (api.kioskAttendanceAction as jest.Mock).mockResolvedValue({ actionId: "event-1", decision: "APPROVED", attendanceState: "WORKING", recordedAt: new Date().toISOString(), message: "Clock-in berhasil dicatat." });
});

it("returns to employee selection so another employee can use the same kiosk", async () => {
  await render(<KioskScreen />);
  await fireEvent.press(await screen.findByRole("button", { name: /Ayu Demo/ }));
  await fireEvent.changeText(screen.getByLabelText("PIN absensi pribadi"), "123456");
  await fireEvent.press(screen.getByRole("button", { name: "Lanjutkan" }));
  await waitFor(() => expect(api.kioskEmployeeStatus).toHaveBeenCalledWith("demo-kiosk-token", "BG-DEMO-01", "123456"));
  await fireEvent.press(await screen.findByRole("button", { name: "Ambil foto & clock-in" }));
  await waitFor(() => expect(api.kioskAttendanceAction).toHaveBeenCalledWith(
    "demo-kiosk-token",
    expect.objectContaining({ employeeNumber: "BG-DEMO-01", pin: "123456", type: "CLOCK_IN" }),
    "idempotency-kiosk-1",
  ));
  await fireEvent.press(await screen.findByRole("button", { name: "Kembali sekarang" }));

  await fireEvent.press(await screen.findByRole("button", { name: /Dimas Pratama/ }));
  await fireEvent.changeText(screen.getByLabelText("PIN absensi pribadi"), "123456");
  await fireEvent.press(screen.getByRole("button", { name: "Lanjutkan" }));
  await waitFor(() => expect(api.kioskEmployeeStatus).toHaveBeenCalledWith("demo-kiosk-token", "BG-0214", "123456"));
});

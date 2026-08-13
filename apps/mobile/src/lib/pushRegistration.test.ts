import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { api } from "./api";
import { registerPushDevice } from "./pushRegistration";

jest.mock("./api", () => ({
  api: {
    registerDevice: jest.fn(async () => ({ id: "device-1", status: "ACTIVE" })),
  },
}));
jest.mock("expo-crypto", () => ({ randomUUID: jest.fn(() => "installation-uuid") }));
jest.mock("expo-device", () => ({ isDevice: false, modelName: "Pixel Test" }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));
jest.mock("expo-notifications", () => ({
  AndroidImportance: { HIGH: 4 },
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestPermissionsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getDevicePushTokenAsync: jest.fn(async () => ({
    type: "fcm",
    data: "native-fcm-token",
  })),
}));

beforeAll(() => {
  Object.defineProperty(Platform, "OS", {
    configurable: true,
    get: () => "android",
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  (api.registerDevice as jest.Mock).mockResolvedValue({
    id: "device-1",
    status: "ACTIVE",
  });
});

it("registers an Android Studio emulator installation once without requiring FCM", async () => {
  Object.defineProperty(Device, "isDevice", { configurable: true, value: false });

  const first = await registerPushDevice("access-token", "org-emulator");
  const second = await registerPushDevice("access-token", "org-emulator");

  expect(first).toBe("device-1");
  expect(second).toBe("device-1");
  expect(api.registerDevice).toHaveBeenCalledTimes(1);
  expect(api.registerDevice).toHaveBeenCalledWith("access-token", {
    platform: "ANDROID",
    installationId: "installation-uuid",
    pushToken: undefined,
    deviceLabel: "Pixel Test",
  });
  expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    "bg-gold.attendance.device-id.v1.org-emulator",
    "device-1",
  );
});

it("still registers a physical installation when notification permission is denied", async () => {
  Object.defineProperty(Device, "isDevice", { configurable: true, value: true });
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({
    granted: false,
  });

  await registerPushDevice("access-token", "org-no-notifications");

  expect(api.registerDevice).toHaveBeenCalledWith(
    "access-token",
    expect.objectContaining({
      installationId: "installation-uuid",
      pushToken: undefined,
    }),
  );
  expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled();
});

it("uses the encrypted cached server device id while offline", async () => {
  Object.defineProperty(Device, "isDevice", { configurable: true, value: false });
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) =>
    key.includes("device-id.v1.org-offline") ? "cached-device-id" : "installation-uuid",
  );
  (api.registerDevice as jest.Mock).mockRejectedValue(new Error("offline"));

  await expect(registerPushDevice("access-token", "org-offline")).resolves.toBe(
    "cached-device-id",
  );
});

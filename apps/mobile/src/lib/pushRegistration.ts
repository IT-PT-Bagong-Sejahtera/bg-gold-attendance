import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { api } from "./api";
import { isDemoAccessToken } from "./demoSession";
import { installationIdentifier } from "./installationIdentifier";

const DEVICE_KEY_PREFIX = "bg-gold.attendance.device-id.v1";

const registeredDevices = new Map<string, string>();
const registrations = new Map<string, Promise<string | undefined>>();

export async function registerPushDevice(
  accessToken: string,
  organizationId: string,
): Promise<string | undefined> {
  if (isDemoAccessToken(accessToken)) {
    return `demo-device-${await installationIdentifier()}`;
  }
  if (Platform.OS !== "android" && Platform.OS !== "ios") return undefined;

  const existing = registeredDevices.get(organizationId);
  if (existing) return existing;

  const pending = registrations.get(organizationId);
  if (pending) return pending;

  const registration = registerInstallation(accessToken, organizationId).finally(
    () => registrations.delete(organizationId),
  );
  registrations.set(organizationId, registration);
  return registration;
}

async function registerInstallation(
  accessToken: string,
  organizationId: string,
): Promise<string | undefined> {
  const installationId = await installationIdentifier();
  const cachedDeviceId = await SecureStore.getItemAsync(deviceKey(organizationId));

  try {
    const pushToken = await optionalNativePushToken();
    const registered = await api.registerDevice(accessToken, {
      platform: Platform.OS === "ios" ? "IOS" : "ANDROID",
      installationId,
      pushToken,
      deviceLabel: Device.modelName ?? undefined,
    });
    registeredDevices.set(organizationId, registered.id);
    await SecureStore.setItemAsync(deviceKey(organizationId), registered.id);
    return registered.id;
  } catch (reason) {
    // An already registered installation can keep stamping offline attendance.
    // The server still checks organization and user ownership when it reconnects.
    if (cachedDeviceId) {
      registeredDevices.set(organizationId, cachedDeviceId);
      return cachedDeviceId;
    }
    throw reason;
  }
}

async function optionalNativePushToken() {
  if (!Device.isDevice) return undefined;
  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted
    ? current
    : await Notifications.requestPermissionsAsync();
  if (!permission.granted) return undefined;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("team-updates", {
      name: "Informasi tim",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const nativeToken = await Notifications.getDevicePushTokenAsync();
  return String(nativeToken.data);
}

function deviceKey(organizationId: string) {
  return `${DEVICE_KEY_PREFIX}.${organizationId}`;
}

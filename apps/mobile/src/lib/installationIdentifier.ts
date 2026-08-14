import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const INSTALLATION_KEY = "bg-gold.attendance.installation-id.v1";

export async function installationIdentifier() {
  const current = await SecureStore.getItemAsync(INSTALLATION_KEY);
  if (current) return current;
  const created = Crypto.randomUUID();
  await SecureStore.setItemAsync(INSTALLATION_KEY, created);
  return created;
}

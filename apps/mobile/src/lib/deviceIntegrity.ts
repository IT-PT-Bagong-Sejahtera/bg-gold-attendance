import * as Crypto from "expo-crypto";
import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";
import type { AttendanceAction } from "./api";

type BGGoldIntegrityModule = {
  requestToken(requestHash: string): Promise<string>;
};

export async function getAttendanceIntegrityToken(input: {
  organizationId: string;
  userId: string;
  membershipId: string;
  idempotencyKey: string;
  action: AttendanceAction;
}) {
  if (Platform.OS !== "android") {
    throw new Error("Pemeriksaan keamanan perangkat saat ini hanya tersedia di Android.");
  }
  const provider = requireOptionalNativeModule<BGGoldIntegrityModule>("BGGoldIntegrity");
  if (!provider?.requestToken) {
    throw new Error("Modul keamanan BG GOLD belum tersedia pada build aplikasi ini.");
  }
  const requestHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    [input.organizationId, input.userId, input.membershipId, input.idempotencyKey, input.action].join(":"),
  );
  const token = await provider.requestToken(requestHash);
  if (!token?.trim()) {
    throw new Error("Pemeriksaan keamanan perangkat tidak menghasilkan bukti yang valid.");
  }
  return token;
}

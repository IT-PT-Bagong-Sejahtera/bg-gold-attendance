import NetInfo from "@react-native-community/netinfo";
import {
  flushAttendanceOutbox,
  type AttendanceScope,
} from "./offlineOutbox";

export type AttendanceSyncResult = {
  sent: number;
  pending: number;
  needsReview: number;
};

export function subscribeAttendanceReconnect(
  token: string,
  scope: AttendanceScope,
  onSync: (result: AttendanceSyncResult) => void,
) {
  let wasOffline = false;
  let synchronizing = false;

  return NetInfo.addEventListener((state) => {
    const online =
      state.isConnected === true && state.isInternetReachable !== false;
    if (!online) {
      wasOffline = true;
      return;
    }
    if (!wasOffline || synchronizing) return;

    wasOffline = false;
    synchronizing = true;
    void flushAttendanceOutbox(token, scope)
      .then(onSync)
      .finally(() => {
        synchronizing = false;
      });
  });
}

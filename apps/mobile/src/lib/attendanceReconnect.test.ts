import NetInfo from "@react-native-community/netinfo";
import { flushAttendanceOutbox } from "./offlineOutbox";
import { subscribeAttendanceReconnect } from "./attendanceReconnect";

jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { addEventListener: jest.fn() },
}));

jest.mock("./offlineOutbox", () => ({
  flushAttendanceOutbox: jest.fn(),
}));

describe("attendance reconnect synchronization", () => {
  it("flushes only after an offline-to-online transition", async () => {
    let listener: ((state: {
      isConnected: boolean;
      isInternetReachable: boolean | null;
    }) => void) | undefined;
    (NetInfo.addEventListener as jest.Mock).mockImplementation((next) => {
      listener = next;
      return jest.fn();
    });
    (flushAttendanceOutbox as jest.Mock).mockResolvedValue({
      sent: 1,
      pending: 0,
      needsReview: 0,
    });
    const onSync = jest.fn();

    subscribeAttendanceReconnect(
      "token",
      { organizationId: "org-1", membershipId: "member-1" },
      onSync,
    );
    listener?.({ isConnected: true, isInternetReachable: true });
    expect(flushAttendanceOutbox).not.toHaveBeenCalled();

    listener?.({ isConnected: false, isInternetReachable: false });
    listener?.({ isConnected: true, isInternetReachable: true });

    await Promise.resolve();
    await Promise.resolve();
    expect(flushAttendanceOutbox).toHaveBeenCalledWith("token", {
      organizationId: "org-1",
      membershipId: "member-1",
    });
    expect(onSync).toHaveBeenCalledWith({
      sent: 1,
      pending: 0,
      needsReview: 0,
    });
  });
});

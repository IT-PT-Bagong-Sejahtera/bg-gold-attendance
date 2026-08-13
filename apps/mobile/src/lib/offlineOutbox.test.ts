import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, APIError } from "./api";
import {
  attendanceOutbox,
  flushAttendanceOutbox,
  submitAttendanceResilient,
} from "./offlineOutbox";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

jest.mock("./api", () => {
  class TestAPIError extends Error {
    status: number;
    code: string;

    constructor(mockStatus: number, mockCode: string, mockMessage: string) {
      super(mockMessage);
      this.status = mockStatus;
      this.code = mockCode;
    }
  }
  return {
    APIError: TestAPIError,
    api: { action: jest.fn(), selfie: jest.fn() },
  };
});

const scope = { organizationId: "org-1", membershipId: "member-1" };
const payload = {
  type: "CLOCK_IN" as const,
  evidence: { location: { latitude: -6.2, longitude: 106.8 } },
};

describe("attendance offline outbox", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it("persists a network failure and retries with the same idempotency key", async () => {
    (api.action as jest.Mock)
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce({ attendanceState: "WORKING" });

    const result = await submitAttendanceResilient(
      "token",
      scope,
      "offline-key-1",
      payload,
    );
    expect(result.queued).toBe(true);
    expect(await attendanceOutbox(scope)).toHaveLength(1);

    const flushed = await flushAttendanceOutbox("token", scope);
    expect(flushed).toEqual({ sent: 1, pending: 0, needsReview: 0 });
    expect(api.action).toHaveBeenLastCalledWith(
      "token",
      "offline-key-1",
      payload,
    );
    expect(await attendanceOutbox(scope)).toHaveLength(0);
  });

  it("keeps a server-rejected retry for human review", async () => {
    (api.action as jest.Mock)
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockRejectedValueOnce(
        new APIError(422, "INVALID_ATTENDANCE_STATE", "Status sudah berubah."),
      );
    await submitAttendanceResilient(
      "token",
      scope,
      "offline-key-review",
      payload,
    );

    const flushed = await flushAttendanceOutbox("token", scope);
    expect(flushed).toEqual({ sent: 0, pending: 0, needsReview: 1 });
    expect((await attendanceOutbox(scope))[0]).toEqual(
      expect.objectContaining({
        idempotencyKey: "offline-key-review",
        status: "NEEDS_REVIEW",
        attempts: 1,
      }),
    );
  });

  it("keeps organization outboxes isolated", async () => {
    (api.action as jest.Mock).mockRejectedValue(
      new TypeError("Network request failed"),
    );
    await submitAttendanceResilient("token", scope, "main-key", payload);
    await submitAttendanceResilient(
      "token",
      { organizationId: "org-2", membershipId: "member-2" },
      "other-key",
      payload,
    );
    (api.action as jest.Mock).mockResolvedValue({ attendanceState: "WORKING" });

    const flushed = await flushAttendanceOutbox("token", scope);
    expect(flushed.sent).toBe(1);
    expect(
      await attendanceOutbox({
        organizationId: "org-2",
        membershipId: "member-2",
      }),
    ).toHaveLength(1);
  });
});

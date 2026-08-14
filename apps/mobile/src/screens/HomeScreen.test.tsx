import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { api } from "../lib/api";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import {
  flushAttendanceOutbox,
  submitAttendanceResilient,
} from "../lib/offlineOutbox";
import { HomeScreen } from "./HomeScreen";
import { captureCurrentWiFi } from "../lib/wifiEvidence";
import { getAttendanceIntegrityToken } from "../lib/deviceIntegrity";

let mockFocusCallback: (() => void) | undefined;
jest.mock("@react-navigation/native", () => {
  const React = require("react");
  return {
    useFocusEffect: (callback: () => void) => {
      mockFocusCallback = callback;
      React.useEffect(callback, [callback]);
    },
  };
});

const mockAuthState = {
  session: { accessToken: "test-access-token" },
  isDemo: false,
  demoRole: null as null | "employee" | "device" | "supervisor",
};
jest.mock("../lib/auth", () => ({
  useAuth: () => mockAuthState,
}));

jest.mock("../lib/api", () => ({
  api: {
    me: jest.fn(),
    today: jest.fn(),
    shifts: jest.fn(),
    supervisorShifts: jest.fn(),
    policy: jest.fn(),
    announcements: jest.fn(),
    notificationUnreadCount: jest.fn(),
    announcementReceipt: jest.fn(),
    faceImage: jest.fn(),
    verifyFace: jest.fn(),
    selfie: jest.fn(),
    action: jest.fn(),
    myAttendanceEvidence: jest.fn(),
  },
}));

jest.mock("expo-camera", () => {
  const React = require("react");
  const { Pressable, Text } = require("react-native");
  return {
    CameraView: (props: { onBarcodeScanned: (value: { data: string }) => void }) =>
      React.createElement(
        Pressable,
        {
          accessibilityLabel: "Simulasi pemindaian QR",
          onPress: () => props.onBarcodeScanned({ data: "signed-dynamic-qr" }),
        },
        React.createElement(Text, null, "Kamera QR aktif"),
      ),
    useCameraPermissions: () => [{ granted: true }, jest.fn()],
  };
});

jest.mock("../lib/offlineOutbox", () => ({
  flushAttendanceOutbox: jest.fn(),
  submitAttendanceResilient: jest.fn(),
}));

jest.mock("../lib/attendanceReconnect", () => ({
  subscribeAttendanceReconnect: jest.fn(() => jest.fn()),
}));

jest.mock("../lib/pushRegistration", () => ({
  registerPushDevice: jest.fn(async () => "device-1"),
}));
jest.mock("../lib/wifiEvidence", () => ({ captureCurrentWiFi: jest.fn(async () => ({ ssid: "BG GOLD HQ", bssid: "AA:BB:CC:DD:EE:FF" })) }));
jest.mock("../lib/deviceIntegrity", () => ({ getAttendanceIntegrityToken: jest.fn(async () => "signed-integrity-token") }));

jest.mock("expo-location", () => ({
  Accuracy: { High: 4 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({
    status: "granted",
  })),
  getCurrentPositionAsync: jest.fn(async () => ({
    coords: {
      latitude: -6.2,
      longitude: 106.8,
      accuracy: 12,
    },
    timestamp: Date.parse("2026-08-11T01:15:00Z"),
  })),
}));

jest.mock("expo-crypto", () => ({
  randomUUID: jest.fn(() => "ui-test-idempotency-key"),
}));
jest.mock("expo-image-picker",()=>({CameraType:{front:"front"},requestCameraPermissionsAsync:jest.fn(async()=>({granted:true})),launchCameraAsync:jest.fn(async()=>({canceled:false,assets:[{uri:"file:///face.jpg",mimeType:"image/jpeg"}]}))}));

describe("HomeScreen attendance flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthState.session.accessToken = "test-access-token";
    mockAuthState.isDemo = false;
    mockAuthState.demoRole = null;
    (api.me as jest.Mock).mockResolvedValue({
      id: "user-1",
      email: "ayu@bggold.local",
      fullName: "Ayu Pratama",
      membershipId: "membership-1",
      organizationId: "organization-1",
      timezone: "Asia/Jakarta",
      employeeNumber: "BG-017",
      roles: ["EMPLOYEE"],
    });
    (api.policy as jest.Mock).mockResolvedValue({
      id: "policy-1",
      name: "Anywhere Default",
      modes: ["ANYWHERE"],
      selfieRequired: false,
    });
    (api.shifts as jest.Mock).mockResolvedValue([]);
    (api.supervisorShifts as jest.Mock).mockResolvedValue([]);
    (api.announcements as jest.Mock).mockResolvedValue([]);
    (api.notificationUnreadCount as jest.Mock).mockResolvedValue({ count: 0 });
    (api.announcementReceipt as jest.Mock).mockResolvedValue({ id: "announcement-1", action: "ACKNOWLEDGE" });
    (api.faceImage as jest.Mock).mockResolvedValue({id:"face-image-1"});
    (api.verifyFace as jest.Mock).mockResolvedValue({id:"verification-1",verified:true,expiresAt:"2026-08-11T01:05:00Z"});
    (api.today as jest.Mock)
      .mockResolvedValueOnce({ state: "NOT_STARTED", latestEvents: [] })
      .mockResolvedValue({
        state: "WORKING",
        latestEvents: [
          {
            id: "event-1",
            actionType: "CLOCK_IN",
            decision: "APPROVED",
            recordedAt: "2026-08-11T01:15:04Z",
          },
        ],
      });
    (api.action as jest.Mock).mockResolvedValue({
      actionId: "event-1",
      decision: "APPROVED",
      attendanceState: "WORKING",
      recordedAt: "2026-08-11T01:15:04Z",
      message: "Clock-in berhasil dicatat.",
    });
    (api.myAttendanceEvidence as jest.Mock).mockResolvedValue({
      eventId: "event-home-detail",
      actionType: "CLOCK_IN",
      decision: "APPROVED",
      source: "MOBILE",
      recordedAt: "2026-08-11T01:15:04Z",
      section: { id: "section-1", name: "BG GOLD Head Office" },
      location: { latitude: -6.2, longitude: 106.8, accuracyM: 8 },
    });
    (flushAttendanceOutbox as jest.Mock).mockResolvedValue({
      sent: 0,
      pending: 0,
      needsReview: 0,
    });
    (submitAttendanceResilient as jest.Mock).mockResolvedValue({
      queued: false,
    });
  });

  it("shows today's shift, outlet, role, and attendance mode", async () => {
    (api.shifts as jest.Mock).mockResolvedValue([
      {
        id: "shift-today",
        title: "Shift Galeri Pagi",
        roleName: "Gold Advisor",
        startsAt: "2026-08-11T02:00:00Z",
        endsAt: "2026-08-11T10:00:00Z",
        section: { id: "section-1", name: "BG GOLD Head Office" },
      },
    ]);

    await render(<HomeScreen />);

    expect(await screen.findByText("Shift Galeri Pagi")).toBeTruthy();
    expect(screen.getByText("BG GOLD Head Office · Gold Advisor")).toBeTruthy();
    expect(screen.getByText("09.00 – 17.00")).toBeTruthy();
    expect(screen.getByText("Anywhere Default · Di mana saja")).toBeTruthy();
  });

  it("opens the employee's own attendance detail from latest activity", async () => {
    (api.today as jest.Mock).mockReset().mockResolvedValue({
      state: "WORKING",
      latestEvents: [
        {
          id: "event-home-detail",
          actionType: "CLOCK_IN",
          decision: "APPROVED",
          recordedAt: "2026-08-11T01:15:04Z",
        },
      ],
    });

    await render(<HomeScreen />);
    await fireEvent.press(
      await screen.findByRole("button", {
        name: "Lihat detail absensi Clock in",
      }),
    );

    expect(await screen.findByText("DETAIL ABSENSI ANDA")).toBeTruthy();
    expect(screen.getByText("BG GOLD Head Office")).toBeTruthy();
    expect(api.myAttendanceEvidence).toHaveBeenCalledWith(
      "test-access-token",
      "event-home-detail",
    );
  });

  it("previews location, submits once, and advances to clock out", async () => {
    await render(<HomeScreen />);

    const clockIn = await screen.findByRole("button", { name: "Clock in" });
    expect(clockIn.props.accessibilityState).toEqual({
      disabled: false,
      busy: false,
    });
    await fireEvent.press(clockIn);
    expect(
      await screen.findByText("GPS ditemukan · akurasi ±12 m"),
    ).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "Kirim absensi" }));

    await waitFor(() => {
      expect(submitAttendanceResilient).toHaveBeenCalledWith(
        "test-access-token",
        {
          organizationId: "organization-1",
          membershipId: "membership-1",
        },
        "ui-test-idempotency-key",
        expect.objectContaining({
          type: "CLOCK_IN",
          evidence: expect.objectContaining({
            location: {
              latitude: -6.2,
              longitude: 106.8,
              accuracyMeters: 12,
              capturedAt: "2026-08-11T01:15:00.000Z",
            },
          }),
        }),
        undefined,
      );
    });
    const productionPayload = (submitAttendanceResilient as jest.Mock).mock.calls.at(-1)?.[3];
    expect(productionPayload.evidence).not.toHaveProperty("employeeName");
    expect(productionPayload.evidence).not.toHaveProperty("selectedLocationName");
    expect(await screen.findByText("Clock out")).toBeTruthy();
    expect(screen.getByText("Tercatat")).toBeTruthy();
  });

  it("requires and scans a dynamic outlet QR before submitting", async () => {
    (api.shifts as jest.Mock).mockResolvedValue([
      {
        id: "shift-qr",
        title: "Shift outlet",
        startsAt: "2026-08-11T01:00:00Z",
        endsAt: "2026-08-11T09:00:00Z",
        section: { id: "section-qr", name: "BG GOLD HQ" },
      },
    ]);
    (api.policy as jest.Mock).mockResolvedValue({
      id: "policy-qr",
      name: "Dynamic QR outlet",
      modes: ["DYNAMIC_QR"],
      selfieRequired: false,
    });

    await render(<HomeScreen />);
    await fireEvent.press(await screen.findByText("Clock in"));

    expect(await screen.findByText("QR LOKASI WAJIB")).toBeTruthy();
    await fireEvent.press(screen.getByText("QR LOKASI WAJIB"));
    await fireEvent.press(
      await screen.findByLabelText("Simulasi pemindaian QR"),
    );
    expect(await screen.findByText("QR siap diverifikasi")).toBeTruthy();
    await fireEvent.press(screen.getByText("Kirim absensi"));

    await waitFor(() =>
      expect(submitAttendanceResilient).toHaveBeenCalledWith(
        "test-access-token",
        {
          organizationId: "organization-1",
          membershipId: "membership-1",
        },
        "ui-test-idempotency-key",
        expect.objectContaining({
          type: "CLOCK_IN",
          shiftId: "shift-qr",
          sectionId: "section-qr",
          evidence: expect.objectContaining({
            dynamicQrToken: "signed-dynamic-qr",
          }),
        }),
        undefined,
      ),
    );
  });

  it("shows truthful fallback evidence when location permission is denied", async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      status: "denied",
      granted: false,
    });

    await render(<HomeScreen />);
    await fireEvent.press(await screen.findByText("Clock in"));

    expect(
      await screen.findByText(
        "GPS tidak tersedia",
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByText("Kirim absensi"));
    await waitFor(() =>
      expect(submitAttendanceResilient).toHaveBeenCalledWith(
        "test-access-token",
        expect.any(Object),
        "ui-test-idempotency-key",
        expect.objectContaining({
          evidence: expect.objectContaining({ location: null }),
        }),
        undefined,
      ),
    );
  });

  it("blocks the home flow until a required announcement is acknowledged", async () => {
    const announcement = { id: "announcement-1", title: "Perubahan jadwal toko", body: "Briefing dimulai 15 menit lebih awal.", priority: "IMPORTANT", requiresAcknowledgment: true, publishedAt: "2026-08-11T01:00:00Z", read: false, acknowledged: false };
    (api.announcements as jest.Mock).mockResolvedValueOnce([announcement]).mockResolvedValue([{ ...announcement, read: true, acknowledged: true }]);
    (api.notificationUnreadCount as jest.Mock).mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 });

    await render(<HomeScreen />);
    expect((await screen.findAllByText("Briefing dimulai 15 menit lebih awal.")).length).toBe(2);
    await fireEvent.press(screen.getByRole("button", { name: "Saya sudah membaca" }));
    await waitFor(() => expect(api.announcementReceipt).toHaveBeenCalledWith("test-access-token", "announcement-1", "ACKNOWLEDGE"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Saya sudah membaca" })).toBeNull());
  });

  it("captures SSID and BSSID evidence for a Wi-Fi policy", async () => {
    (api.policy as jest.Mock).mockResolvedValue({ id:"policy-wifi", name:"Wi-Fi outlet", modes:["WIFI"], selfieRequired:false });
    await render(<HomeScreen />);
    await fireEvent.press(await screen.findByText("Clock in"));
    expect(captureCurrentWiFi).toHaveBeenCalled();
    expect(await screen.findByText("BG GOLD HQ · access point dikenali")).toBeTruthy();
    await fireEvent.press(screen.getByText("Kirim absensi"));
    await waitFor(() => expect(submitAttendanceResilient).toHaveBeenCalledWith("test-access-token", expect.any(Object), "ui-test-idempotency-key", expect.objectContaining({ evidence: expect.objectContaining({ wifi: { ssid:"BG GOLD HQ", bssid:"AA:BB:CC:DD:EE:FF" } }) }), undefined));
  });

  it("verifies face and liveness before a fail-closed attendance action",async()=>{
    (api.policy as jest.Mock).mockResolvedValue({id:"policy-face",name:"Face outlet",modes:["FACE_VERIFICATION"],selfieRequired:false});await render(<HomeScreen/>);await fireEvent.press(await screen.findByText("Clock in"));await fireEvent.press(await screen.findByText("Ambil foto bukti"));expect(await screen.findByText("Foto siap dikirim")).toBeTruthy();await fireEvent.press(screen.getByText("Kirim absensi"));
    await waitFor(()=>expect(api.verifyFace).toHaveBeenCalledWith("test-access-token","face-image-1"));await waitFor(()=>expect(submitAttendanceResilient).toHaveBeenCalledWith("test-access-token",expect.any(Object),"ui-test-idempotency-key",expect.objectContaining({evidence:expect.objectContaining({faceVerificationId:"verification-1"})}),expect.any(Object)));
  });

  it("binds a device-integrity token to the attendance request", async () => {
    (api.policy as jest.Mock).mockResolvedValue({ id: "policy-integrity", name: "Perangkat aman", modes: ["DEVICE_INTEGRITY"], selfieRequired: false });
    await render(<HomeScreen />);
    await fireEvent.press(await screen.findByText("Clock in"));
    await fireEvent.press(await screen.findByText("Kirim absensi"));
    await waitFor(() => expect(getAttendanceIntegrityToken).toHaveBeenCalledWith({ organizationId: "organization-1", userId: "user-1", membershipId: "membership-1", idempotencyKey: "ui-test-idempotency-key", action: "CLOCK_IN" }));
    await waitFor(() => expect(submitAttendanceResilient).toHaveBeenCalledWith("test-access-token", expect.any(Object), "ui-test-idempotency-key", expect.objectContaining({ evidence: expect.objectContaining({ integrityToken: "signed-integrity-token" }) }), undefined));
  });

  it("runs Demo 2 with name, required photo, chosen location, then exposes clock-out", async () => {
    mockAuthState.session.accessToken = "bg-gold-local-demo-device-access";
    mockAuthState.isDemo = true;
    mockAuthState.demoRole = "device";
    (api.me as jest.Mock).mockResolvedValue({
      id: "demo-device-user-local",
      email: "device.demo@bggold.local",
      fullName: "Karyawan Demo 2",
      membershipId: "demo-device-membership-local",
      organizationId: "demo-organization-local",
      timezone: "Asia/Jakarta",
      employeeNumber: "BG-HP-01",
      roles: ["EMPLOYEE"],
    });
    (api.policy as jest.Mock).mockResolvedValue({
      id: "demo-policy-one-device",
      name: "Satu HP · Foto & nama",
      modes: ["SELFIE", "DEVICE_LOCK"],
      selfieRequired: true,
    });
    (api.today as jest.Mock).mockReset()
      .mockResolvedValueOnce({ state: "NOT_STARTED", latestEvents: [] })
      .mockResolvedValue({
        state: "WORKING",
        latestEvents: [
          {
            id: "demo-device-event",
            actionType: "CLOCK_IN",
            decision: "APPROVED",
            recordedAt: "2026-08-13T01:00:00Z",
          },
        ],
      });

    await render(<HomeScreen />);
    await fireEvent.press(await screen.findByRole("button", { name: "Clock in" }));

    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(await screen.findByText("Foto siap dikirim")).toBeTruthy();
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalledWith(
      expect.objectContaining({ cameraType: "front" }),
    );
    expect(screen.getAllByText(/Asia\/Jakarta/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("BG GOLD Flagship").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Kirim absensi" }).props
        .accessibilityState.disabled,
    ).toBe(true);

    await fireEvent.changeText(
      screen.getByLabelText("Nama karyawan untuk absensi"),
      "Ayu Perangkat",
    );
    await fireEvent.press(screen.getByRole("radio", { name: /BG GOLD Warehouse/ }));
    await fireEvent.press(screen.getByRole("button", { name: "Kirim absensi" }));

    await waitFor(() =>
      expect(submitAttendanceResilient).toHaveBeenCalledWith(
        "bg-gold-local-demo-device-access",
        expect.objectContaining({ membershipId: "demo-device-membership-local" }),
        "ui-test-idempotency-key",
        expect.objectContaining({
          type: "CLOCK_IN",
          sectionId: "demo-section-warehouse",
          evidence: expect.objectContaining({
            employeeName: "Ayu Perangkat",
            selectedLocationName: "BG GOLD Warehouse",
          }),
        }),
        { uri: "file:///face.jpg", mimeType: "image/jpeg" },
      ),
    );
    expect(
      await screen.findByRole("button", { name: "Clock out" }),
    ).toBeTruthy();
  });

  it("reloads and shows a newly created demo event when Home regains focus", async () => {
    mockAuthState.session.accessToken = "bg-gold-local-demo-supervisor-access";
    mockAuthState.isDemo = true;
    mockAuthState.demoRole = "supervisor";
    (api.today as jest.Mock).mockReset().mockResolvedValue({
      state: "NOT_STARTED",
      latestEvents: [],
    });
    (api.me as jest.Mock).mockResolvedValue({
      id: "demo-supervisor-user-local",
      email: "supervisor.demo@bggold.local",
      fullName: "Sari Supervisor",
      membershipId: "demo-supervisor-membership-local",
      organizationId: "demo-organization-local",
      timezone: "Asia/Jakarta",
      employeeNumber: "BG-SPV-01",
      roles: ["SUPERVISOR"],
    });
    const startsAt = new Date();
    startsAt.setHours(9, 0, 0, 0);
    const endsAt = new Date(startsAt);
    endsAt.setHours(18, 0, 0, 0);
    const event = {
      id: "demo-custom-event-new",
      title: "Private Preview",
      scheduleType: "EVENT",
      showroomName: "BG GOLD Kemang",
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      status: "PUBLISHED",
      section: { id: "demo-section-event", name: "Lokasi event" },
      participants: [],
    };
    (api.supervisorShifts as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValue([event]);

    await render(<HomeScreen />);
    const clockIn = await screen.findByRole("button", { name: "Clock in" });
    await act(async () => {
      mockFocusCallback?.();
    });
    await waitFor(() =>
      expect(api.supervisorShifts).toHaveBeenCalledTimes(2),
    );
    await fireEvent.press(clockIn);

    const eventLocation = await screen.findByRole("radio", {
      name: /BG GOLD Kemang, Private Preview · Event custom hari ini/,
    });
    await fireEvent.press(eventLocation);
    await fireEvent.press(screen.getByRole("button", { name: "Kirim absensi" }));

    await waitFor(() =>
      expect(submitAttendanceResilient).toHaveBeenCalledWith(
        "bg-gold-local-demo-supervisor-access",
        expect.any(Object),
        "ui-test-idempotency-key",
        expect.objectContaining({
          type: "CLOCK_IN",
          shiftId: "demo-custom-event-new",
          sectionId: "demo-section-event",
          evidence: expect.objectContaining({
            selectedLocationName: "BG GOLD Kemang",
          }),
        }),
        undefined,
      ),
    );
  });
});

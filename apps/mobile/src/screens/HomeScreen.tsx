import * as Crypto from "expo-crypto";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { Screen } from "../components/Screen";
import { LoadingRows } from "../components/LoadingRows";
import {
  actionLabel,
  optimisticAttendanceState,
  primaryAttendanceAction,
} from "../lib/attendance";
import {
  api,
  type Announcement,
  type AttendanceAction,
  type Me,
  type Policy,
  type Shift,
  type Today,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { subscribeAttendanceReconnect } from "../lib/attendanceReconnect";
import { registerPushDevice } from "../lib/pushRegistration";
import { captureCurrentWiFi } from "../lib/wifiEvidence";
import { getAttendanceIntegrityToken } from "../lib/deviceIntegrity";
import { useReducedMotion } from "../lib/useReducedMotion";
import { formatInstant } from "../lib/timezone";
import {
  flushAttendanceOutbox,
  submitAttendanceResilient,
} from "../lib/offlineOutbox";
import { colors, radius, spacing } from "../theme";

type EvidencePreview = {
  action: AttendanceAction;
  organizationRecordedAt: string;
  sectionId?: string;
  locationName?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  capturedAt?: string;
  selfieUri?: string;
  selfieMimeType?: string;
  wifi?: { ssid: string; bssid: string };
};
type AttendanceLocationChoice = {
  id: string;
  name: string;
  detail: string;
};
const DEMO_LOCATIONS: AttendanceLocationChoice[] = [
  {
    id: "demo-section-hq",
    name: "BG GOLD Flagship",
    detail: "Galeri utama · Jakarta",
  },
  {
    id: "demo-section-warehouse",
    name: "BG GOLD Warehouse",
    detail: "Gudang & inventory",
  },
  {
    id: "demo-section-event",
    name: "Lokasi event",
    detail: "Penugasan luar outlet",
  },
];
const stateLabels: Record<Today["state"], string> = {
  NOT_STARTED: "Belum mulai",
  WORKING: "Sedang bekerja",
  ON_BREAK: "Sedang istirahat",
  COMPLETED: "Selesai",
  PENDING: "Menunggu persetujuan",
};

export function HomeScreen() {
  const auth = useAuth();
  const token = auth.session!.accessToken;
  const reducedMotion = useReducedMotion();
  const insets = useContext(SafeAreaInsetsContext) ?? {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  const [me, setMe] = useState<Me | null>(null);
  const [today, setToday] = useState<Today | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<EvidencePreview | null>(null);
  const [dynamicQRToken, setDynamicQRToken] = useState("");
  const [scanningQR, setScanningQR] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [attendanceName, setAttendanceName] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [autoSelfiePending, setAutoSelfiePending] = useState(false);
  const isDeviceDemo = auth.demoRole === "device";
  const organizationTimezone = me?.timezone?.trim() || "Asia/Jakarta";
  const load = useCallback(async () => {
    setError("");
    try {
      const rangeStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const rangeEnd = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const [meData, todayData, shifts, announcementItems, unread] = await Promise.all([
        api.me(token),
        api.today(token),
        api.shifts(token, rangeStart.toISOString(), rangeEnd.toISOString()),
        api.announcements(token),
        api.notificationUnreadCount(token),
      ]);
      const shift =
        shifts.find((item) => item.id === todayData.activeShiftId) ??
        shifts[0] ??
        null;
      const policyData = await api.policy(token, shift?.section.id);
      setMe(meData);
      if (
        auth.demoRole === "device" &&
        meData.fullName !== "Karyawan Demo 2"
      ) {
        setAttendanceName(meData.fullName);
      }
      setToday(todayData);
      setPolicy(policyData);
      setActiveShift(shift);
      setAnnouncements(announcementItems);
      setUnreadNotifications(unread.count);
      void registerPushDevice(token, meData.organizationId).catch(() => undefined);
      const synchronized = await flushAttendanceOutbox(token, {
        organizationId: meData.organizationId,
        membershipId: meData.membershipId,
      });
      if (synchronized.sent > 0) {
        setToday(await api.today(token));
        setNotice(`${synchronized.sent} absensi offline berhasil disinkronkan.`);
      } else if (synchronized.needsReview > 0) {
        setNotice("Ada absensi offline yang perlu ditinjau sebelum dikirim ulang.");
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Data belum dapat dimuat.",
      );
    } finally {
      setLoading(false);
    }
  }, [auth.demoRole, token]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!me) return;
    return subscribeAttendanceReconnect(
      token,
      { organizationId: me.organizationId, membershipId: me.membershipId },
      (result) => {
        if (result.sent > 0) {
          setNotice(`${result.sent} absensi offline berhasil disinkronkan.`);
          void load();
        } else if (result.needsReview > 0) {
          setNotice("Ada absensi offline yang perlu ditinjau sebelum dikirim ulang.");
        }
      },
    );
  }, [load, me, token]);
  const action = useMemo(
    () => (today ? primaryAttendanceAction(today.state) : null),
    [today],
  );
  const locationChoices = useMemo<AttendanceLocationChoice[]>(() => {
    if (auth.isDemo) return DEMO_LOCATIONS;
    if (!activeShift) return [];
    return [
      {
        id: activeShift.section.id,
        name: activeShift.section.name,
        detail: activeShift.roleName ?? "Lokasi shift hari ini",
      },
    ];
  }, [activeShift, auth.isDemo]);
  const selectedLocation =
    locationChoices.find((item) => item.id === selectedLocationId) ??
    locationChoices[0];

  useEffect(() => {
    if (!selectedLocationId && locationChoices[0]) {
      setSelectedLocationId(locationChoices[0].id);
    }
  }, [locationChoices, selectedLocationId]);

  async function prepare(nextAction: AttendanceAction) {
    setSubmitting(true);
    setError("");
    setDynamicQRToken("");
    const organizationRecordedAt = new Date().toISOString();
    const basePreview: EvidencePreview = {
      action: nextAction,
      organizationRecordedAt,
      sectionId: selectedLocation?.id,
      locationName: selectedLocation?.name,
    };
    try {
      if (isDeviceDemo) {
        setPreview(basePreview);
        setAutoSelfiePending(true);
        return;
      }
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setPreview(basePreview);
        return;
      }
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const wifi = policy?.modes.includes("WIFI")
        ? await captureCurrentWiFi().catch(() => undefined)
        : undefined;
      setPreview({
        ...basePreview,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracy: location.coords.accuracy ?? undefined,
        capturedAt: new Date(location.timestamp).toISOString(),
        wifi,
      });
    } catch {
      setPreview(basePreview);
    } finally {
      setSubmitting(false);
    }
  }
  async function scanDynamicQR() {
    let granted = cameraPermission?.granted ?? false;
    if (!granted) {
      granted = (await requestCameraPermission()).granted;
    }
    if (!granted) {
      setError("Izin kamera diperlukan untuk memindai QR lokasi.");
      return;
    }
    setScanningQR(true);
  }
  async function takeSelfie() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError("Izin kamera diperlukan untuk mengambil bukti selfie.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      cameraType: ImagePicker.CameraType.front,
      quality: 0.72,
      allowsEditing: true,
      aspect: [3, 4],
    });
    if (!result.canceled) {
      const asset = result.assets[0];
      if (asset)
        setPreview((current) =>
          current
            ? {
                ...current,
                selfieUri: asset.uri,
                selfieMimeType: asset.mimeType ?? "image/jpeg",
              }
            : current,
        );
    }
  }
  useEffect(() => {
    if (!isDeviceDemo || !preview || !autoSelfiePending) return;
    setAutoSelfiePending(false);
    void takeSelfie();
  }, [autoSelfiePending, isDeviceDemo, preview?.action]);

  async function submit() {
    if (!preview) return;
    if (!me) {
      setError("Identitas akun belum siap. Muat ulang lalu coba kembali.");
      return;
    }
    if (isDeviceDemo && attendanceName.trim().length < 2) {
      setError("Tuliskan nama karyawan sebelum mengirim absensi.");
      return;
    }
    if ((policy?.selfieRequired || policy?.modes.includes("FACE_VERIFICATION")) && !preview.selfieUri) {
      setError("Kebijakan ini mewajibkan selfie sebelum absensi dikirim.");
      return;
    }
    if (policy?.modes.includes("DYNAMIC_QR") && !dynamicQRToken) {
      setError("Pindai QR dinamis di lokasi sebelum mengirim absensi.");
      return;
    }
    if (policy?.modes.includes("WIFI") && !preview.wifi) {
      setError("Sambungkan perangkat ke Wi-Fi outlet yang diizinkan lalu coba kembali.");
      return;
    }
    setSubmitting(true);
    try {
      const idempotencyKey = Crypto.randomUUID();
      const deviceId = await registerPushDevice(token, me.organizationId).catch(
        () => undefined,
      );
      let faceVerificationId: string | undefined;
      let integrityToken: string | undefined;
      if (policy?.modes.includes("DEVICE_INTEGRITY")) {
        integrityToken = await getAttendanceIntegrityToken({
          organizationId: me.organizationId,
          userId: me.id,
          membershipId: me.membershipId,
          idempotencyKey,
          action: preview.action,
        });
      }
      if (policy?.modes.includes("FACE_VERIFICATION") && preview.selfieUri) {
        const faceImage = await api.faceImage(token, preview.selfieUri, preview.selfieMimeType);
        const verification = await api.verifyFace(token, faceImage.id);
        faceVerificationId = verification.id;
      }
      const payload = {
        type: preview.action,
        shiftId: activeShift?.id,
        sectionId: preview.sectionId ?? activeShift?.section.id,
        evidence: {
          employeeName: isDeviceDemo ? attendanceName.trim() : undefined,
          selectedLocationName: preview.locationName,
          location:
            preview.latitude === undefined
              ? null
              : {
                  latitude: preview.latitude,
                  longitude: preview.longitude,
                  accuracyMeters: preview.accuracy ?? 0,
                  capturedAt: preview.capturedAt,
                },
          attachmentId: "",
          dynamicQrToken: dynamicQRToken || undefined,
          wifi: preview.wifi,
          faceVerificationId,
          integrityToken,
          deviceId,
        },
      };
      const result = await submitAttendanceResilient(
        token,
        { organizationId: me.organizationId, membershipId: me.membershipId },
        idempotencyKey,
        payload,
        preview.selfieUri
          ? { uri: preview.selfieUri, mimeType: preview.selfieMimeType }
          : undefined,
      );
      setPreview(null);
      setDynamicQRToken("");
      if (result.queued) {
        setToday((current) =>
          current
            ? {
                ...current,
                state: optimisticAttendanceState(preview.action),
                latestEvents: [
                  {
                    id: idempotencyKey,
                    actionType: preview.action,
                    decision: "PENDING",
                    recordedAt: new Date().toISOString(),
                  },
                  ...current.latestEvents,
                ],
              }
            : current,
        );
        setNotice(
          "Koneksi belum tersedia. Absensi tersimpan aman di perangkat dan akan dikirim ulang dengan kunci yang sama.",
        );
      } else {
        await load();
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Absensi gagal diproses.",
      );
    } finally {
      setSubmitting(false);
    }
  }
  async function acknowledgeAnnouncement(id: string) {
    setSubmitting(true);
    setError("");
    try {
      await api.announcementReceipt(token, id, "ACKNOWLEDGE");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Konfirmasi pengumuman belum tersimpan.");
    } finally {
      setSubmitting(false);
    }
  }
  const firstName = me?.fullName.split(" ")[0] ?? "Tim";
  const requiredAnnouncement = announcements.find(
    (item) => item.requiresAcknowledgment && !item.acknowledged,
  );
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => {
              setLoading(true);
              void load();
            }}
            tintColor={colors.gold}
          />
        }
      >
        {auth.isDemo ? (
          <View accessibilityRole="summary" style={styles.demoNotice}>
            <Ionicons name="phone-portrait-outline" size={18} color={colors.espresso} />
            <View style={styles.demoNoticeCopy}>
              <Text style={styles.demoNoticeTitle}>
                {me?.roles.includes("SUPERVISOR")
                  ? "MODE DEMO SUPERVISOR"
                  : isDeviceDemo
                    ? "MODE DEMO 2 · SATU HP"
                  : "MODE DEMO KARYAWAN"}
              </Text>
              <Text style={styles.demoNoticeText}>
                {isDeviceDemo
                  ? "HP terikat setelah clock-in · gunakan HP dan nama yang sama untuk clock-out."
                  : "Bebas dicoba. Perubahan hanya tersimpan di perangkat ini."}
              </Text>
            </View>
          </View>
        ) : null}
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>HARI INI</Text>
            <Text style={styles.greeting}>Selamat datang, {firstName}.</Text>
            <Text style={styles.date}>
              {formatInstant(new Date(), me?.timezone ?? "UTC", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </Text>
          </View>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.avatar}
          >
            <Text style={styles.avatarText}>
              {me?.fullName.slice(0, 1).toUpperCase() ?? "B"}
            </Text>
          </View>
        </View>
        {error ? (
          <View
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            style={styles.error}
          >
            <Ionicons
              name="alert-circle-outline"
              size={20}
              color={colors.ruby}
            />
            <Text style={styles.feedbackCopy}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setLoading(true);
                void load();
              }}
              style={styles.retryButton}
            >
              <Text style={styles.retryText}>Coba lagi</Text>
            </Pressable>
          </View>
        ) : null}
        {notice ? (
          <View
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={styles.notice}
          >
            <Ionicons name="cloud-done-outline" size={20} color={colors.emerald} />
            <Text>{notice}</Text>
          </View>
        ) : null}
        <View style={styles.hero}>
          <Text style={styles.heroEyebrow}>STATUS KEHADIRAN</Text>
          <Text style={styles.heroState}>
            {today ? stateLabels[today.state] : "Memuat…"}
          </Text>
          <Text style={styles.heroTime}>
            {formatInstant(new Date(), organizationTimezone, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
          <Text style={styles.heroNote}>
            {isDeviceDemo
              ? `Waktu organisasi · ${organizationTimezone}`
              : auth.isDemo
                ? `Waktu organisasi · ${organizationTimezone}`
              : "Waktu resmi mengikuti server BG GOLD"}
          </Text>
          {action ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={actionLabel(action)}
              accessibilityState={{ disabled: submitting, busy: submitting }}
              disabled={submitting}
              onPress={() => void prepare(action)}
              style={({ pressed }) => [
                styles.actionButton,
                pressed && styles.pressed,
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={colors.espresso} />
              ) : (
                <>
                  <Ionicons
                    name={
                      action === "CLOCK_IN"
                        ? "log-in-outline"
                        : "log-out-outline"
                    }
                    size={22}
                    color={colors.espresso}
                  />
                  <Text>{actionLabel(action)}</Text>
                </>
              )}
            </Pressable>
          ) : (
            <View style={styles.pending}>
              <Text style={styles.pendingText}>
                {today?.state === "ON_BREAK"
                  ? "Selesaikan istirahat melalui menu Attendance."
                  : today?.state === "COMPLETED"
                    ? "Absensi hari ini sudah tercatat. Clock-in berikutnya tersedia besok."
                  : "Tidak ada tindakan utama saat ini."}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.shiftSummary}>
          <View style={styles.shiftSummaryHeading}>
            <View style={styles.shiftSummaryCopy}>
              <Text style={styles.eyebrow}>SHIFT HARI INI</Text>
              <Text style={styles.shiftSummaryTitle}>
                {activeShift?.title ?? "Tanpa shift terjadwal"}
              </Text>
            </View>
            <Ionicons name="calendar-outline" size={22} color={colors.gold} />
          </View>
          {activeShift ? (
            <>
              <Text style={styles.shiftSummaryTime}>
                {formatInstant(
                  new Date(activeShift.startsAt),
                  me?.timezone ?? "UTC",
                  { hour: "2-digit", minute: "2-digit" },
                )}
                {" – "}
                {formatInstant(
                  new Date(activeShift.endsAt),
                  me?.timezone ?? "UTC",
                  { hour: "2-digit", minute: "2-digit" },
                )}
              </Text>
              <View style={styles.shiftMeta}>
                <Ionicons name="location-outline" size={16} color={colors.gold} />
                <Text style={styles.shiftMetaText}>
                  {activeShift.section.name}
                  {activeShift.roleName ? ` · ${activeShift.roleName}` : ""}
                </Text>
              </View>
            </>
          ) : (
            <Text style={styles.shiftEmptyCopy}>
              Absensi tanpa jadwal mengikuti kebijakan organisasi yang aktif.
            </Text>
          )}
          <Text style={styles.shiftPolicy}>
            {policy?.name ?? "Memuat kebijakan…"}
            {policy?.modes.length
              ? ` · ${policy.modes.map(attendanceModeLabel).join(" + ")}`
              : ""}
          </Text>
        </View>
        <View style={styles.sectionTitle}>
          <View style={styles.announcementText}>
            <Text style={styles.eyebrow}>AKTIVITAS</Text>
            <Text style={styles.sectionHeading}>Catatan terbaru</Text>
          </View>
          <Ionicons name="arrow-forward" size={20} color={colors.gold} />
        </View>
        <View style={styles.timeline}>
          {loading && !today ? (
            <LoadingRows label="Memuat catatan kehadiran" />
          ) : today?.latestEvents.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="time-outline" size={26} color={colors.gold} />
              <Text style={styles.emptyTitle}>Belum ada catatan</Text>
              <Text style={styles.emptyCopy}>
                Clock-in dan clock-out hari ini akan muncul di sini.
              </Text>
            </View>
          ) : (
            today?.latestEvents.slice(0, 4).map((event) => (
              <View key={event.id} style={styles.event}>
                <View style={styles.dot} />
                <View style={styles.eventCopy}>
                  <Text style={styles.eventTitle}>
                    {actionLabel(event.actionType)}
                  </Text>
                  <Text style={styles.eventTime}>
                    {formatInstant(
                      new Date(event.recordedAt),
                      me?.timezone ?? "UTC",
                      {
                      hour: "2-digit",
                      minute: "2-digit",
                      day: "numeric",
                      month: "short",
                      },
                    )}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.decision,
                    event.decision === "APPROVED"
                      ? styles.approved
                      : styles.waiting,
                  ]}
                >
                  {event.decision === "APPROVED" ? "Tercatat" : "Menunggu"}
                </Text>
              </View>
            ))
          )}
        </View>
        <View style={styles.announcement}>
          <Ionicons name="megaphone-outline" size={22} color={colors.gold} />
          <View style={styles.announcementText}>
            <Text style={styles.announcementTitle}>
              {announcements[0]?.title ?? "Informasi tim"}
              {unreadNotifications > 0 ? ` · ${unreadNotifications} baru` : ""}
            </Text>
            <Text style={styles.announcementCopy}>
              {announcements[0]?.body ??
                "Pengumuman penting dari BG GOLD akan tampil di area ini."}
            </Text>
          </View>
        </View>
      </ScrollView>
      <Modal
        visible={Boolean(requiredAnnouncement)}
        transparent
        animationType={reducedMotion ? "none" : "fade"}
        onRequestClose={() => undefined}
      >
        <ScrollView
          contentContainerStyle={styles.requiredBackdropContent}
          style={styles.requiredBackdrop}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.requiredCard} accessibilityViewIsModal>
            <Text style={styles.eyebrow}>
              {requiredAnnouncement?.priority === "URGENT"
                ? "PENGUMUMAN MENDESAK"
                : "PENGUMUMAN PENTING"}
            </Text>
            <Text style={styles.sheetTitle}>{requiredAnnouncement?.title}</Text>
            <Text style={styles.requiredBody}>{requiredAnnouncement?.body}</Text>
            <Text style={styles.requiredNote}>
              Konfirmasi ini dicatat agar tim tahu informasi sudah diterima.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: submitting, busy: submitting }}
              disabled={submitting}
              onPress={() =>
                requiredAnnouncement &&
                void acknowledgeAnnouncement(requiredAnnouncement.id)
              }
              style={styles.confirmButton}
            >
              <Text style={styles.confirmText}>
                {submitting ? "Menyimpan…" : "Saya sudah membaca"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </Modal>
      <Modal
        visible={preview !== null}
        transparent
        animationType={reducedMotion ? "none" : "slide"}
        onRequestClose={() => setPreview(null)}
      >
        <View style={styles.modalBackdrop}>
          <ScrollView
            contentContainerStyle={[
              styles.sheet,
              { paddingBottom: spacing.xl + insets.bottom },
            ]}
            style={styles.sheetScroll}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.sheetHandle} />
            <Text style={styles.eyebrow}>PERIKSA BUKTI</Text>
            <Text style={styles.sheetTitle}>
              {isDeviceDemo
                ? "Absensi satu langkah"
                : preview
                  ? actionLabel(preview.action)
                  : "Absensi"}
            </Text>
            {isDeviceDemo ? (
              <View style={styles.identityPanel}>
                <View style={styles.identityHeading}>
                  <View style={styles.identityIcon}>
                    <Ionicons name="person-outline" size={20} color={colors.gold} />
                  </View>
                  <View style={styles.identityCopy}>
                    <Text style={styles.evidenceLabel}>NAMA KARYAWAN</Text>
                <Text style={styles.identityHint}>
                      Nama ini akan mengikat akun demo ke HP ini. Kamera depan terbuka otomatis.
                    </Text>
                  </View>
                </View>
                <TextInput
                  accessibilityLabel="Nama karyawan untuk absensi"
                  autoCapitalize="words"
                  editable={me?.fullName === "Karyawan Demo 2"}
                  maxLength={80}
                  onChangeText={setAttendanceName}
                  placeholder="Contoh: Ayu Pratama"
                  style={[
                    styles.identityInput,
                    me?.fullName !== "Karyawan Demo 2" &&
                      styles.identityInputLocked,
                  ]}
                  value={attendanceName}
                />
                {me?.fullName !== "Karyawan Demo 2" ? (
                  <View style={styles.bindingStatus}>
                    <Ionicons name="lock-closed" size={14} color={colors.emerald} />
                    <Text style={styles.bindingStatusText}>Terikat aman ke HP ini</Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            <View style={styles.evidenceRow}>
              <Ionicons name="time-outline" size={21} color={colors.gold} />
              <View style={styles.evidenceCopy}>
                <Text style={styles.evidenceLabel}>Waktu organisasi</Text>
                <Text style={styles.evidenceValue}>
                  {formatInstant(
                    new Date(preview?.organizationRecordedAt ?? Date.now()),
                    organizationTimezone,
                    {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    },
                  )}
                </Text>
                <Text style={styles.evidenceMeta}>{organizationTimezone}</Text>
              </View>
            </View>
            {auth.isDemo ? (
              <View style={styles.locationPicker}>
                <Text style={styles.locationPickerLabel}>PILIH LOKASI ABSEN</Text>
                <Text style={styles.locationPickerHint}>
                  Pilih tempat kerja yang sesuai sebelum mengirim.
                </Text>
                <View style={styles.locationOptions}>
                  {locationChoices.map((location) => {
                    const selected = location.id === preview?.sectionId;
                    return (
                      <Pressable
                        accessibilityLabel={`${location.name}, ${location.detail}`}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected }}
                        key={location.id}
                        onPress={() => {
                          setSelectedLocationId(location.id);
                          setPreview((current) =>
                            current
                              ? {
                                  ...current,
                                  sectionId: location.id,
                                  locationName: location.name,
                                }
                              : current,
                          );
                        }}
                        style={({ pressed }) => [
                          styles.locationOption,
                          selected && styles.locationOptionSelected,
                          pressed && styles.pressed,
                        ]}
                      >
                        <View
                          style={[
                            styles.locationRadio,
                            selected && styles.locationRadioSelected,
                          ]}
                        >
                          {selected ? <View style={styles.locationRadioDot} /> : null}
                        </View>
                        <View style={styles.locationOptionCopy}>
                          <Text style={styles.locationOptionName}>{location.name}</Text>
                          <Text style={styles.locationOptionDetail}>{location.detail}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
            <View style={styles.evidenceRow}>
              <Ionicons name="location-outline" size={21} color={colors.gold} />
              <View style={styles.evidenceCopy}>
                <Text style={styles.evidenceLabel}>Lokasi terpilih</Text>
                <Text style={styles.evidenceValue}>
                  {preview?.locationName ?? activeShift?.section.name ?? "Belum dipilih"}
                </Text>
                <Text style={styles.evidenceMeta}>
                  {isDeviceDemo
                    ? "Dipilih manual · GPS tidak diperlukan"
                    : preview?.latitude === undefined
                      ? "GPS tidak tersedia"
                      : `GPS ditemukan · akurasi ±${Math.round(preview.accuracy ?? 0)} m`}
                </Text>
              </View>
            </View>
            {policy?.modes.includes("WIFI") ? <View style={styles.evidenceRow}><Ionicons name="wifi-outline" size={21} color={colors.gold}/><View><Text style={styles.evidenceLabel}>Wi-Fi outlet</Text><Text style={styles.evidenceValue}>{preview?.wifi ? `${preview.wifi.ssid} · access point dikenali` : "Tidak dapat dikenali"}</Text></View></View> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={preview?.selfieUri ? "Ganti foto bukti" : "Ambil foto bukti"}
              onPress={() => void takeSelfie()}
              style={styles.selfieRow}
            >
              {preview?.selfieUri ? (
                <Image
                  source={{ uri: preview.selfieUri }}
                  style={styles.selfie}
                />
              ) : (
                <View style={styles.cameraIcon}>
                  <Ionicons
                    name="camera-outline"
                    size={22}
                    color={colors.gold}
                  />
                </View>
              )}
              <View>
                <Text style={styles.evidenceLabel}>
                  {isDeviceDemo || policy?.selfieRequired || policy?.modes.includes("FACE_VERIFICATION") ? "FOTO WAJAH WAJIB" : "SELFIE OPSIONAL"}
                </Text>
                <Text style={styles.evidenceValue}>
                  {preview?.selfieUri
                    ? "Foto siap dikirim"
                    : isDeviceDemo
                      ? "Buka kamera depan"
                      : "Ambil foto bukti"}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                size={18}
                color={colors.inkMuted}
              />
            </Pressable>
            {policy?.modes.includes("DYNAMIC_QR") ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={dynamicQRToken ? "Pindai ulang QR lokasi" : "Pindai QR lokasi"}
                onPress={() => void scanDynamicQR()}
                style={styles.qrRow}
              >
                <View style={styles.cameraIcon}>
                  <Ionicons
                    name={dynamicQRToken ? "checkmark" : "qr-code-outline"}
                    size={22}
                    color={dynamicQRToken ? colors.emerald : colors.gold}
                  />
                </View>
                <View style={styles.qrCopy}>
                  <Text style={styles.evidenceLabel}>QR LOKASI WAJIB</Text>
                  <Text style={styles.evidenceValue}>
                    {dynamicQRToken
                      ? "QR siap diverifikasi"
                      : "Pindai kode yang sedang tampil di outlet"}
                  </Text>
                </View>
                <Ionicons name="scan-outline" size={20} color={colors.gold} />
              </Pressable>
            ) : null}
            <Text style={styles.sheetNote}>
              {isDeviceDemo
                ? "Setelah dikirim, nama dan HP ini terkunci untuk karyawan yang sama. Absensi tidak dapat diulang pada hari yang sama."
                : auth.isDemo
                  ? "Waktu organisasi dan lokasi pilihan akan disimpan bersama catatan demo di perangkat ini."
                  : "Backend akan menggunakan waktu server dan memeriksa kebijakan organisasi sebelum mencatat absensi."}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Kirim absensi"
              accessibilityState={{
                disabled:
                  submitting ||
                  (isDeviceDemo &&
                    (attendanceName.trim().length < 2 || !preview?.selfieUri)) ||
                  (Boolean(policy?.modes.includes("DYNAMIC_QR")) &&
                    !dynamicQRToken),
                busy: submitting,
              }}
              disabled={
                submitting ||
                (isDeviceDemo &&
                  (attendanceName.trim().length < 2 || !preview?.selfieUri)) ||
                (Boolean(policy?.modes.includes("DYNAMIC_QR")) &&
                  !dynamicQRToken)
              }
              onPress={() => void submit()}
              style={[
                styles.confirmButton,
                policy?.modes.includes("DYNAMIC_QR") &&
                  !dynamicQRToken &&
                  styles.disabledButton,
                isDeviceDemo &&
                  (attendanceName.trim().length < 2 || !preview?.selfieUri) &&
                  styles.disabledButton,
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.confirmText}>Kirim absensi</Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Batalkan absensi"
              onPress={() => setPreview(null)}
              style={styles.cancelButton}
            >
              <Text>Batal</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>
      <Modal
        visible={scanningQR}
        animationType={reducedMotion ? "none" : "fade"}
        onRequestClose={() => setScanningQR(false)}
      >
        <View style={styles.scanner}>
          {scanningQR ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={({ data }) => {
                const tokenValue = data.trim();
                if (tokenValue) {
                  setDynamicQRToken(tokenValue);
                  setScanningQR(false);
                }
              }}
            />
          ) : null}
          <View
            style={[
              styles.scannerOverlay,
              { paddingBottom: spacing.xl + insets.bottom },
            ]}
          >
            <Text style={styles.scannerTitle}>Arahkan ke QR BG GOLD</Text>
            <View style={styles.scanFrame} />
            <Text style={styles.scannerCopy}>
              Kode berubah cepat dan hanya dapat dipakai satu kali.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tutup pemindai QR"
              onPress={() => setScanningQR(false)}
              style={styles.scannerClose}
            >
              <Text style={styles.scannerCloseText}>Tutup pemindai</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function attendanceModeLabel(mode: string) {
  const labels: Record<string, string> = {
    ANYWHERE: "Di mana saja",
    LOCATION_ONLY: "Lokasi dicatat",
    GEOFENCE: "Radius lokasi",
    DYNAMIC_QR: "QR dinamis",
    WIFI: "Wi-Fi outlet",
    SELFIE: "Selfie",
    FACE_VERIFICATION: "Verifikasi wajah",
    DEVICE_INTEGRITY: "Keamanan perangkat",
    DEVICE_LOCK: "Satu HP",
  };
  return labels[mode] ?? mode;
}

const serif = Platform.select({ ios: "Georgia", android: "serif" });
const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: 110 },
  demoNotice: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
    backgroundColor: "#F6EBCB",
    borderLeftWidth: 3,
    borderColor: colors.gold,
  },
  demoNoticeCopy: { flex: 1 },
  demoNoticeTitle: {
    fontSize: 9,
    letterSpacing: 1.4,
    fontWeight: "800",
    color: colors.espresso,
  },
  demoNoticeText: {
    fontSize: 11,
    lineHeight: 16,
    color: colors.inkMuted,
    marginTop: 2,
  },
  header: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  headerCopy: { flex: 1, minWidth: 0, paddingRight: spacing.md },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 1.8,
    fontWeight: "700",
    color: "#8A6C2D",
    marginBottom: 5,
  },
  greeting: {
    flexShrink: 1,
    fontFamily: serif,
    fontSize: 29,
    color: colors.espresso,
  },
  date: { color: colors.inkMuted, fontSize: 13, marginTop: 4 },
  avatar: {
    flexShrink: 0,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.espresso,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: colors.goldSoft, fontWeight: "700" },
  hero: {
    backgroundColor: colors.espresso,
    borderRadius: radius.panel,
    elevation: 6,
    padding: spacing.lg,
    shadowColor: colors.espresso,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
  },
  heroEyebrow: {
    fontSize: 10,
    letterSpacing: 1.6,
    fontWeight: "700",
    color: colors.goldSoft,
  },
  heroState: {
    fontFamily: serif,
    fontSize: 32,
    color: colors.white,
    marginTop: spacing.sm,
  },
  heroTime: {
    fontSize: 52,
    fontVariant: ["tabular-nums"],
    fontWeight: "600",
    color: colors.white,
    marginTop: spacing.lg,
  },
  heroNote: { color: "#CDBFB3", fontSize: 12 },
  actionButton: {
    minHeight: 56,
    paddingVertical: spacing.sm,
    borderRadius: radius.control,
    backgroundColor: colors.goldSoft,
    marginTop: spacing.lg,
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    elevation: 1,
    opacity: 0.92,
    shadowOpacity: 0.06,
    transform: [{ translateY: 2 }, { scale: 0.99 }],
  },
  actionButtonText: { fontWeight: "700" },
  pending: {
    marginTop: spacing.lg,
    borderTopWidth: 1,
    borderColor: "#4D3931",
    paddingTop: spacing.md,
  },
  pendingText: { color: "#E8DED4", lineHeight: 20 },
  shiftSummary: {
    borderBottomWidth: 1,
    borderColor: colors.line,
    paddingVertical: spacing.lg,
  },
  shiftSummaryHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  shiftSummaryCopy: { flex: 1, minWidth: 0 },
  shiftSummaryTitle: {
    color: colors.espresso,
    fontFamily: serif,
    fontSize: 23,
    marginTop: 5,
  },
  shiftSummaryTime: {
    color: colors.espresso,
    fontSize: 18,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    marginTop: spacing.md,
  },
  shiftMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.sm,
  },
  shiftMetaText: { flex: 1, color: colors.espresso },
  shiftEmptyCopy: { color: colors.inkMuted, lineHeight: 20, marginTop: spacing.sm },
  shiftPolicy: { color: colors.inkMuted, fontSize: 12, marginTop: spacing.sm },
  sectionTitle: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  sectionHeading: { fontFamily: serif, fontSize: 23, color: colors.espresso },
  timeline: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.panel,
    elevation: 3,
    paddingHorizontal: spacing.md,
    minHeight: 120,
    justifyContent: "center",
    shadowColor: colors.espresso,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 9,
  },
  event: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    gap: spacing.sm,
  },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.gold },
  eventCopy: { flex: 1 },
  eventTitle: { fontWeight: "600", color: colors.espresso },
  eventTime: { fontSize: 12, color: colors.inkMuted, marginTop: 3 },
  decision: {
    fontSize: 10,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 5,
  },
  approved: { color: colors.emerald, backgroundColor: "#E9F4EF" },
  waiting: { color: "#856313", backgroundColor: "#F8F0D9" },
  empty: { alignItems: "center", padding: spacing.lg },
  emptyTitle: {
    fontWeight: "600",
    marginTop: spacing.sm,
    color: colors.espresso,
  },
  emptyCopy: {
    fontSize: 12,
    textAlign: "center",
    color: colors.inkMuted,
    marginTop: 4,
  },
  error: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    borderLeftWidth: 3,
    borderColor: colors.ruby,
    backgroundColor: "#FBEFEF",
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  notice: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
    padding: spacing.md,
    backgroundColor: "#EAF4EE",
    borderLeftWidth: 3,
    borderColor: colors.emerald,
  },
  retryButton: { minHeight: 44, justifyContent: "center", marginLeft: "auto" },
  retryText: { color: colors.ruby, fontWeight: "700", fontSize: 12 },
  feedbackCopy: { flex: 1 },
  announcement: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.lg,
    paddingVertical: spacing.lg,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  announcementText: { flex: 1, minWidth: 0 },
  announcementTitle: { fontWeight: "700", color: colors.espresso },
  announcementCopy: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.inkMuted,
    marginTop: 4,
    maxWidth: 280,
  },
  requiredBackdrop: {
    flex: 1,
    backgroundColor: "rgba(36,18,14,.68)",
  },
  requiredBackdropContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  requiredCard: {
    backgroundColor: colors.ivory,
    padding: spacing.xl,
    borderTopWidth: 4,
    borderColor: colors.gold,
  },
  requiredBody: { color: colors.espresso, fontSize: 15, lineHeight: 23 },
  requiredNote: {
    color: colors.inkMuted,
    fontSize: 11,
    lineHeight: 17,
    marginTop: spacing.lg,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(36,18,14,.45)",
  },
  sheet: {
    backgroundColor: colors.ivory,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  sheetScroll: { maxHeight: "94%", backgroundColor: colors.ivory },
  sheetHandle: {
    alignSelf: "center",
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.line,
    marginBottom: spacing.lg,
  },
  sheetTitle: {
    fontFamily: serif,
    fontSize: 30,
    color: colors.espresso,
    marginBottom: spacing.lg,
  },
  identityPanel: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.panel,
    elevation: 3,
    marginBottom: spacing.md,
    padding: spacing.md,
    shadowColor: colors.espresso,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 9,
  },
  identityHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  identityIcon: {
    alignItems: "center",
    backgroundColor: "#F7EFCF",
    height: 40,
    justifyContent: "center",
    width: 40,
    borderRadius: 14,
  },
  identityCopy: { flex: 1, minWidth: 0 },
  identityHint: {
    color: colors.inkMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  identityInput: {
    backgroundColor: colors.ivory,
    borderColor: colors.gold,
    borderWidth: 1,
    color: colors.espresso,
    fontSize: 16,
    marginTop: spacing.md,
    minHeight: 50,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.field,
  },
  identityInputLocked: {
    backgroundColor: "#EDF4EF",
    borderColor: "#B8D6C3",
  },
  bindingStatus: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: spacing.sm,
  },
  bindingStatusText: { color: colors.emerald, fontSize: 11, fontWeight: "700" },
  evidenceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  evidenceCopy: { flex: 1, minWidth: 0 },
  evidenceMeta: {
    color: colors.inkMuted,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 3,
  },
  locationPicker: {
    backgroundColor: "#F3EFE7",
    borderRadius: radius.panel,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  locationPickerLabel: {
    color: "#7B5D1D",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.3,
  },
  locationPickerHint: {
    color: colors.inkMuted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  locationOptions: { gap: 7, marginTop: spacing.md },
  locationOption: {
    alignItems: "center",
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.control,
    elevation: 2,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 58,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    shadowColor: colors.espresso,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  locationOptionSelected: {
    backgroundColor: "#FFF8DF",
    borderColor: colors.gold,
  },
  locationRadio: {
    alignItems: "center",
    borderColor: colors.inkMuted,
    borderRadius: 9,
    borderWidth: 1,
    height: 18,
    justifyContent: "center",
    width: 18,
  },
  locationRadioSelected: { borderColor: colors.gold, borderWidth: 2 },
  locationRadioDot: {
    backgroundColor: colors.gold,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  locationOptionCopy: { flex: 1, minWidth: 0 },
  locationOptionName: { color: colors.espresso, fontWeight: "800" },
  locationOptionDetail: {
    color: colors.inkMuted,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
  selfieRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  qrRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  qrCopy: { flex: 1 },
  cameraIcon: {
    width: 48,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.paper,
  },
  selfie: { width: 48, height: 58 },
  evidenceLabel: { fontSize: 11, color: colors.inkMuted },
  evidenceValue: {
    fontWeight: "600",
    color: colors.espresso,
    marginTop: 3,
    flex: 1,
  },
  sheetNote: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.inkMuted,
    marginTop: spacing.md,
  },
  confirmButton: {
    minHeight: 54,
    paddingVertical: spacing.sm,
    backgroundColor: colors.espresso,
    borderRadius: radius.control,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.lg,
  },
  confirmText: { color: colors.white, fontWeight: "700" },
  disabledButton: { opacity: 0.42 },
  cancelButton: { minHeight: 48, alignItems: "center", justifyContent: "center" },
  scanner: { flex: 1, backgroundColor: colors.espresso },
  scannerOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 90,
    paddingBottom: 54,
    backgroundColor: "rgba(23,12,9,.3)",
  },
  scannerTitle: {
    color: colors.white,
    fontFamily: serif,
    fontSize: 27,
  },
  scanFrame: {
    width: 244,
    height: 244,
    borderWidth: 2,
    borderColor: colors.goldSoft,
    borderRadius: 24,
  },
  scannerCopy: {
    color: colors.white,
    textAlign: "center",
    maxWidth: 280,
    lineHeight: 20,
  },
  scannerClose: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.ivory,
    borderRadius: radius.control,
  },
  scannerCloseText: { color: colors.espresso, fontWeight: "700" },
});

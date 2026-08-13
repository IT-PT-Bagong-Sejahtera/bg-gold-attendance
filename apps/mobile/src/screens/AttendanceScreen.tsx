import { Ionicons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import * as Location from "expo-location";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Screen } from "../components/Screen";
import { LoadingRows } from "../components/LoadingRows";
import { actionLabel, optimisticAttendanceState } from "../lib/attendance";
import {
  api,
  type AttendanceAction,
  type AttendanceEvent,
  type Me,
  type Policy,
  type Shift,
  type Today,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { subscribeAttendanceReconnect } from "../lib/attendanceReconnect";
import { registerPushDevice } from "../lib/pushRegistration";
import {
  flushAttendanceOutbox,
  submitAttendanceResilient,
} from "../lib/offlineOutbox";
import { formatInstant } from "../lib/timezone";
import { colors, spacing } from "../theme";

export function AttendanceScreen() {
  const token = useAuth().session!.accessToken;
  const [items, setItems] = useState<AttendanceEvent[]>([]);
  const [today, setToday] = useState<Today | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [workMoreReason, setWorkMoreReason] = useState("");
  const load = useCallback(async () => {
    try {
      const identity = await api.me(token);
      setMe(identity);
      const synchronized = await flushAttendanceOutbox(token, {
        organizationId: identity.organizationId,
        membershipId: identity.membershipId,
      });
      if (synchronized.sent > 0) {
        setNotice(`${synchronized.sent} absensi offline berhasil disinkronkan.`);
      } else if (synchronized.needsReview > 0) {
        setNotice("Ada absensi offline yang perlu ditinjau oleh Anda atau supervisor.");
      }
      const rangeStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const rangeEnd = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const [history, current, shifts] = await Promise.all([
        api.history(token),
        api.today(token),
        api.shifts(token, rangeStart.toISOString(), rangeEnd.toISOString()),
      ]);
      const shift =
        shifts.find((item) => item.id === current.activeShiftId) ?? null;
      const currentPolicy = await api.policy(token, shift?.section.id);
      setItems(history);
      setToday(current);
      setActiveShift(shift);
      setPolicy(currentPolicy);
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Riwayat belum dapat dimuat.",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);
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
          setNotice("Ada absensi offline yang perlu ditinjau oleh Anda atau supervisor.");
        }
      },
    );
  }, [load, me, token]);
  const secondaryAction = useMemo<AttendanceAction | null>(
    () =>
      today?.state === "WORKING"
        ? "START_BREAK"
        : today?.state === "ON_BREAK"
          ? "END_BREAK"
          : today?.state === "COMPLETED"
            ? "WORK_MORE"
            : null,
    [today],
  );
  const breakWindow = useMemo(
    () => scheduledBreakWindow(policy, activeShift, new Date()),
    [policy, activeShift],
  );
  const breakOutsideBlocked =
    secondaryAction === "START_BREAK" &&
    Boolean(policy?.preventUnscheduledBreak) &&
    breakWindow?.status !== "OPEN";
  async function submit(action: AttendanceAction) {
    if (!me) {
      setError("Identitas akun belum siap. Muat ulang lalu coba kembali.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      let locationEvidence: null | {
        latitude: number;
        longitude: number;
        accuracyMeters: number;
        capturedAt: string;
      } = null;
      if (permission.granted) {
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        locationEvidence = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracyMeters: location.coords.accuracy ?? 0,
          capturedAt: new Date(location.timestamp).toISOString(),
        };
      }
      const idempotencyKey = Crypto.randomUUID();
      const deviceId = await registerPushDevice(token, me.organizationId).catch(
        () => undefined,
      );
      const payload = {
        type: action,
        reason: action === "WORK_MORE" ? workMoreReason.trim() : undefined,
        evidence: { location: locationEvidence, deviceId },
      };
      const result = await submitAttendanceResilient(
        token,
        { organizationId: me.organizationId, membershipId: me.membershipId },
        idempotencyKey,
        payload,
      );
      if (result.queued) {
        const recordedAt = new Date().toISOString();
        setToday((current) =>
          current
            ? { ...current, state: optimisticAttendanceState(action) }
            : current,
        );
        setItems((current) => [
          {
            id: idempotencyKey,
            actionType: action,
            decision: "PENDING",
            recordedAt,
            reason: payload.reason,
          },
          ...current,
        ]);
        setNotice(
          "Tindakan tersimpan di perangkat. Pengiriman ulang akan memakai idempotency key yang sama saat jaringan pulih.",
        );
      } else {
        await load();
      }
      if (action === "WORK_MORE") setWorkMoreReason("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Tindakan belum dapat diproses.",
      );
    } finally {
      setSubmitting(false);
    }
  }
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
        <Text style={styles.eyebrow}>KEHADIRAN</Text>
        <Text style={styles.title}>Riwayat waktu</Text>
        <Text style={styles.copy}>
          Semua catatan menggunakan waktu server dan tidak dapat ditimpa.
        </Text>
        {secondaryAction ? (
          <View
            style={[
              styles.quickAction,
              secondaryAction === "WORK_MORE" && styles.quickActionExpanded,
            ]}
          >
            <View>
              <Text style={styles.quickEyebrow}>TINDAKAN SAAT INI</Text>
              <Text style={styles.quickTitle}>
                {secondaryAction === "START_BREAK"
                  ? "Waktunya beristirahat?"
                  : secondaryAction === "END_BREAK"
                    ? "Siap kembali bekerja?"
                    : "Perlu melanjutkan pekerjaan?"}
              </Text>
            </View>
            {secondaryAction === "WORK_MORE" ? (
              <TextInput
                accessibilityLabel="Alasan kerja tambahan"
                maxLength={500}
                multiline
                placeholder="Jelaskan pekerjaan yang perlu dilanjutkan"
                placeholderTextColor={colors.inkMuted}
                value={workMoreReason}
                onChangeText={setWorkMoreReason}
                style={styles.reasonInput}
              />
            ) : null}
            {secondaryAction === "START_BREAK" && breakWindow ? (
              <View style={styles.breakNotice}>
                <Ionicons
                  name={
                    breakWindow.status === "OPEN"
                      ? "checkmark-circle-outline"
                      : "time-outline"
                  }
                  size={18}
                  color={
                    breakWindow.status === "OPEN"
                      ? colors.emerald
                      : colors.gold
                  }
                />
                <View style={styles.breakNoticeCopy}>
                  <Text style={styles.breakNoticeTitle}>
                    Jadwal {formatClock(breakWindow.startsAt, me?.timezone ?? "UTC")}–
                    {formatClock(breakWindow.endsAt, me?.timezone ?? "UTC")}
                  </Text>
                  <Text style={styles.breakNoticeText}>
                    {breakWindow.status === "OPEN"
                      ? "Jadwal istirahat sedang berlangsung."
                      : policy?.preventUnscheduledBreak
                        ? "Tindakan akan aktif saat jadwal istirahat dimulai."
                        : policy?.unscheduledBreakRequiresApproval
                          ? "Di luar jadwal, permintaan akan menunggu persetujuan."
                          : "Anda sedang berada di luar jadwal istirahat."}
                  </Text>
                </View>
              </View>
            ) : null}
            <Pressable
              disabled={
                submitting ||
                (secondaryAction === "WORK_MORE" && !workMoreReason.trim()) ||
                breakOutsideBlocked
              }
              accessibilityRole="button"
              onPress={() => void submit(secondaryAction)}
              style={[
                styles.quickButton,
                breakOutsideBlocked && styles.quickButtonDisabled,
              ]}
            >
              {submitting ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <>
                  <Ionicons
                    name={
                      secondaryAction === "START_BREAK"
                        ? "cafe-outline"
                        : secondaryAction === "END_BREAK"
                          ? "play-outline"
                          : "add-outline"
                    }
                    size={19}
                    color={colors.white}
                  />
                  <Text style={styles.quickButtonText}>
                    {actionLabel(secondaryAction)}
                  </Text>
                </>
              )}
            </Pressable>
          </View>
        ) : null}
        <View style={styles.rule} />
        {error ? (
          <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>
            <Ionicons
              name="alert-circle-outline"
              size={19}
              color={colors.ruby}
            />
            <Text style={styles.feedbackCopy}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={()=>{setLoading(true);void load();}} style={styles.retryButton}><Text style={styles.retryText}>Coba lagi</Text></Pressable>
          </View>
        ) : null}
        {notice ? (
          <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.notice}>
            <Ionicons name="cloud-done-outline" size={19} color={colors.emerald} />
            <Text>{notice}</Text>
          </View>
        ) : null}
        {loading && items.length === 0 ? (
          <LoadingRows label="Memuat riwayat absensi" />
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="calendar-outline" size={28} color={colors.gold} />
            <Text style={styles.emptyTitle}>Belum ada riwayat</Text>
            <Text style={styles.copy}>
              Catatan absensi Anda akan tersusun per hari di sini.
            </Text>
          </View>
        ) : (
          items.map((item) => (
            <View key={item.id} style={styles.row}>
              <View style={styles.icon}>
                <Ionicons
                  name={eventIcon(item.actionType)}
                  size={20}
                  color={colors.gold}
                />
              </View>
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>
                  {actionLabel(item.actionType)}
                </Text>
                <Text style={styles.rowTime}>
                  {formatInstant(
                    new Date(item.recordedAt),
                    me?.timezone ?? "UTC",
                    {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    },
                  )}
                </Text>
              </View>
              <Text
                style={[
                  styles.status,
                  item.decision === "REJECTED" && styles.rejected,
                ]}
              >
                {item.decision === "APPROVED"
                  ? "Tercatat"
                  : item.decision === "PENDING"
                    ? "Menunggu"
                    : "Ditolak"}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

export function scheduledBreakWindow(
  policy: Policy | null,
  shift: Shift | null,
  now: Date,
): { startsAt: Date; endsAt: Date; status: "BEFORE" | "OPEN" | "AFTER" } | null {
  if (
    !policy ||
    !shift ||
    policy.scheduledBreakStartOffsetMinutes === undefined ||
    policy.scheduledBreakEndOffsetMinutes === undefined
  ) {
    return null;
  }
  const shiftStart = new Date(shift.startsAt).getTime();
  const startsAt = new Date(
    shiftStart + policy.scheduledBreakStartOffsetMinutes * 60_000,
  );
  const endsAt = new Date(
    shiftStart + policy.scheduledBreakEndOffsetMinutes * 60_000,
  );
  const status =
    now < startsAt ? "BEFORE" : now >= endsAt ? "AFTER" : "OPEN";
  return { startsAt, endsAt, status };
}

function formatClock(value: Date, timezone: string) {
  return formatInstant(value, timezone, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function eventIcon(action: string): keyof typeof Ionicons.glyphMap {
  return action === "CLOCK_IN"
    ? "log-in-outline"
    : action === "CLOCK_OUT"
      ? "log-out-outline"
      : action === "START_BREAK"
        ? "cafe-outline"
        : action === "END_BREAK"
          ? "play-outline"
          : "time-outline";
}
const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: 110 },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 1.8,
    fontWeight: "700",
    color: "#8A6C2D",
  },
  title: {
    fontFamily: "serif",
    fontSize: 32,
    color: colors.espresso,
    marginTop: 6,
  },
  copy: { color: colors.inkMuted, lineHeight: 21, marginTop: 8 },
  quickAction: {
    marginTop: spacing.lg,
    paddingVertical: spacing.lg,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
  },
  quickEyebrow: {
    fontSize: 9,
    letterSpacing: 1.3,
    color: colors.inkMuted,
    fontWeight: "700",
  },
  quickActionExpanded: { alignItems: "stretch", flexDirection: "column" },
  quickTitle: {
    fontFamily: "serif",
    fontSize: 18,
    color: colors.espresso,
    marginTop: 4,
  },
  quickButton: {
    minHeight: 46,
    paddingHorizontal: 14,
    backgroundColor: colors.espresso,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  quickButtonText: { color: colors.white, fontWeight: "700" },
  quickButtonDisabled: { opacity: 0.38 },
  reasonInput: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.paper,
    padding: spacing.md,
    color: colors.espresso,
    textAlignVertical: "top",
  },
  breakNotice: {
    width: "100%",
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.ivoryDeep,
    borderLeftWidth: 3,
    borderColor: colors.gold,
  },
  breakNoticeCopy: { flex: 1 },
  breakNoticeTitle: { color: colors.espresso, fontWeight: "700" },
  breakNoticeText: {
    color: colors.inkMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  rule: { height: 1, backgroundColor: colors.line, marginTop: spacing.lg },
  loader: { marginTop: 80 },
  error: {
    flexDirection: "row",
    gap: spacing.sm,
    color: colors.ruby,
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: "#FBEFEF",
    borderLeftWidth: 3,
    borderColor: colors.ruby,
  },
  retryButton:{minHeight:44,justifyContent:"center",marginLeft:"auto"},retryText:{color:colors.ruby,fontWeight:"700",fontSize:12},
  feedbackCopy:{flex:1},
  notice: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: "#EAF4EE",
    borderLeftWidth: 3,
    borderColor: colors.emerald,
  },
  empty: { alignItems: "center", marginTop: 60, gap: 8 },
  emptyTitle: { fontWeight: "700", color: colors.espresso },
  row: {
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.ivoryDeep,
    alignItems: "center",
    justifyContent: "center",
  },
  rowCopy: { flex: 1 },
  rowTitle: { fontWeight: "700", color: colors.espresso },
  rowTime: { fontSize: 12, color: colors.inkMuted, marginTop: 4 },
  status: { fontSize: 11, color: colors.emerald, fontWeight: "700" },
  rejected: { color: colors.ruby },
});

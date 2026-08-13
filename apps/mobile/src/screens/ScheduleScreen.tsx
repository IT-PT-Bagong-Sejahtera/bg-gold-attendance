import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { LoadingRows } from "../components/LoadingRows";
import { Screen } from "../components/Screen";
import { api, type OpenShift, type Shift } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  addCalendarDays,
  addCalendarMonths,
  calendarDateInTimeZone,
  calendarDateKey,
  daysInCalendarMonth,
  formatCalendarDate,
  formatInstant,
  instantDateKey,
  sameCalendarDate,
  startOfCalendarMonth,
  startOfCalendarWeek,
  type CalendarDate,
  zonedDateTimeToUtc,
} from "../lib/timezone";
import { colors, spacing } from "../theme";

type ScheduleView = "DAY" | "WEEK" | "MONTH";

const viewOptions: Array<{
  value: ScheduleView;
  label: string;
  accessibilityLabel: string;
}> = [
  { value: "DAY", label: "Hari", accessibilityLabel: "Tampilan jadwal harian" },
  { value: "WEEK", label: "Minggu", accessibilityLabel: "Tampilan jadwal mingguan" },
  { value: "MONTH", label: "Kalender", accessibilityLabel: "Tampilan jadwal kalender" },
];

export function ScheduleScreen() {
  const token = useAuth().session!.accessToken;
  const { fontScale, width } = useWindowDimensions();
  const needsStackedLayout = fontScale >= 1.5 || width < 380;
  const [view, setView] = useState<ScheduleView>("WEEK");
  const [timezone, setTimezone] = useState("UTC");
  const [timezoneReady, setTimezoneReady] = useState(false);
  const [cursor, setCursor] = useState(() =>
    calendarDateInTimeZone(new Date(), "UTC"),
  );
  const [items, setItems] = useState<Shift[]>([]);
  const [openShifts, setOpenShifts] = useState<OpenShift[]>([]);
  const [requesting, setRequesting] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const range = useMemo(
    () => periodRange(view, cursor, timezone),
    [cursor, timezone, view],
  );
  const visibleItems = useMemo(
    () =>
      items.filter((shift) => {
        const start = new Date(shift.startsAt).getTime();
        const end = new Date(shift.endsAt).getTime();
        return start < range.to.getTime() && end > range.from.getTime();
      }),
    [items, range.from, range.to],
  );

  const load = useCallback(async () => {
    if (!timezoneReady) return;
    setLoading(true);
    setError("");
    try {
      const [assigned, available] = await Promise.all([
        api.shifts(token, range.from.toISOString(), range.to.toISOString()),
        api.openShifts(token, range.from.toISOString(), range.to.toISOString()),
      ]);
      setItems(assigned);
      setOpenShifts(available);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Jadwal belum dapat dimuat.",
      );
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, timezoneReady, token]);

  const loadTimezone = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const identity = await api.me(token);
      setTimezone(identity.timezone);
      setCursor(calendarDateInTimeZone(new Date(), identity.timezone));
      setTimezoneReady(true);
    } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Zona waktu organisasi belum dapat dimuat.",
        );
        setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadTimezone();
  }, [loadTimezone]);

  useEffect(() => {
    void load();
  }, [load]);

  async function requestShift(shift: OpenShift) {
    setRequesting(shift.id);
    setError("");
    try {
      await api.requestShift(token, shift.id);
      setOpenShifts((current) =>
        current.map((item) =>
          item.id === shift.id ? { ...item, requestStatus: "PENDING" } : item,
        ),
      );
      setNotice("Permintaan shift dikirim untuk ditinjau supervisor.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Permintaan shift gagal dikirim.",
      );
    } finally {
      setRequesting("");
    }
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => void (timezoneReady ? load() : loadTimezone())}
            tintColor={colors.gold}
          />
        }
      >
        <Text style={styles.eyebrow}>JADWAL</Text>
        <Text style={styles.title}>Waktu kerja Anda</Text>
        <Text style={styles.copy}>
          Shift yang sudah diterbitkan, ditampilkan sesuai periode pilihan.
        </Text>

        <View accessibilityRole="tablist" style={styles.viewTabs}>
          {viewOptions.map((option) => {
            const selected = option.value === view;
            return (
              <Pressable
                accessibilityLabel={option.accessibilityLabel}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                key={option.value}
                onPress={() => setView(option.value)}
                style={[styles.viewTab, selected && styles.viewTabSelected]}
              >
                <Text
                  style={[
                    styles.viewTabText,
                    selected && styles.viewTabTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.periodControls}>
          <Pressable
            accessibilityLabel={`${viewLabel(view)} sebelumnya`}
            accessibilityRole="button"
            onPress={() => setCursor((current) => movePeriod(current, view, -1))}
            style={styles.periodButton}
          >
            <Ionicons name="chevron-back" size={20} color={colors.espresso} />
          </Pressable>
          <View style={styles.periodCopy}>
            <Text style={styles.periodLabel}>{formatPeriod(view, cursor)}</Text>
            {!sameCalendarDate(
              cursor,
              calendarDateInTimeZone(new Date(), timezone),
            ) ? (
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  setCursor(calendarDateInTimeZone(new Date(), timezone))
                }
                style={styles.todayButton}
              >
                <Text style={styles.todayText}>Kembali ke hari ini</Text>
              </Pressable>
            ) : null}
          </View>
          <Pressable
            accessibilityLabel={`${viewLabel(view)} berikutnya`}
            accessibilityRole="button"
            onPress={() => setCursor((current) => movePeriod(current, view, 1))}
            style={styles.periodButton}
          >
            <Ionicons name="chevron-forward" size={20} color={colors.espresso} />
          </Pressable>
        </View>

        <View style={styles.rule} />
        {notice ? (
          <View
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            style={styles.notice}
          >
            <Ionicons
              name="checkmark-circle-outline"
              size={20}
              color={colors.emerald}
            />
            <Text style={styles.feedbackCopy}>{notice}</Text>
          </View>
        ) : null}
        {error ? (
          <View
            accessibilityLiveRegion="assertive"
            accessibilityRole="alert"
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
              onPress={() => void (timezoneReady ? load() : loadTimezone())}
              style={styles.retryButton}
            >
              <Text style={styles.retryText}>Coba lagi</Text>
            </Pressable>
          </View>
        ) : null}
        {loading && visibleItems.length === 0 ? (
          <LoadingRows label="Memuat jadwal kerja" />
        ) : null}
        {!error && (!loading || visibleItems.length > 0) ? (
          <SchedulePeriod
            cursor={cursor}
            items={visibleItems}
            onSelectCalendarDay={setCursor}
            timezone={timezone}
            view={view}
          />
        ) : null}

        {openShifts.length > 0 ? (
          <View style={styles.openSection}>
            <Text style={styles.eyebrow}>OPEN SHIFT</Text>
            <Text style={styles.openTitle}>Slot yang dapat diminta</Text>
            {openShifts.map((shift) => (
              <View key={shift.id} style={[styles.openRow, needsStackedLayout && styles.openRowStacked]}>
                <View style={styles.openCopy}>
                  <Text style={styles.shiftTitle}>{shift.title}</Text>
                  <Text style={styles.time}>
                    {formatTime(new Date(shift.startsAt), timezone)}–
                    {formatTime(new Date(shift.endsAt), timezone)} · {shift.section.name}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    busy: requesting === shift.id,
                    disabled:
                      Boolean(shift.requestStatus) || requesting === shift.id,
                  }}
                  disabled={
                    Boolean(shift.requestStatus) || requesting === shift.id
                  }
                  onPress={() => void requestShift(shift)}
                  style={[styles.requestButton, needsStackedLayout && styles.requestButtonStacked]}
                >
                  <Text style={styles.requestText}>
                    {shift.requestStatus === "PENDING"
                      ? "Menunggu"
                      : requesting === shift.id
                        ? "Mengirim…"
                        : "Minta shift"}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function SchedulePeriod({
  cursor,
  items,
  onSelectCalendarDay,
  timezone,
  view,
}: {
  cursor: CalendarDate;
  items: Shift[];
  onSelectCalendarDay: (day: CalendarDate) => void;
  timezone: string;
  view: ScheduleView;
}) {
  if (view === "DAY") {
    return items.length > 0 ? (
      <View style={styles.agenda}>
        {items.map((shift) => (
          <ShiftCard key={shift.id} shift={shift} timezone={timezone} />
        ))}
      </View>
    ) : (
      <PeriodEmpty copy="Tidak ada shift yang diterbitkan untuk hari ini." />
    );
  }

  if (view === "WEEK") {
    if (items.length === 0) {
      return (
        <PeriodEmpty copy="Tidak ada shift yang diterbitkan pada minggu ini." />
      );
    }
    const start = startOfCalendarWeek(cursor);
    return (
      <View style={styles.weekList}>
        {Array.from({ length: 7 }, (_, index) => addCalendarDays(start, index)).map(
          (day) => {
            const shifts = items.filter((shift) =>
              instantDateKey(new Date(shift.startsAt), timezone) ===
                calendarDateKey(day),
            );
            return (
              <View key={calendarDateKey(day)} style={styles.weekDay}>
                <View style={styles.weekDayHeading}>
                  <Text style={styles.weekDayName}>
                    {formatCalendarDate(day, { weekday: "short" })
                      .toUpperCase()}
                  </Text>
                  <Text style={styles.weekDayNumber}>
                    {formatCalendarDate(day, {
                      day: "2-digit",
                      month: "short",
                    })}
                  </Text>
                </View>
                <View style={styles.weekDayAgenda}>
                  {shifts.length > 0 ? (
                    shifts.map((shift) => (
                      <ShiftCard compact key={shift.id} shift={shift} timezone={timezone} />
                    ))
                  ) : (
                    <Text style={styles.weekEmpty}>Tidak ada shift</Text>
                  )}
                </View>
              </View>
            );
          },
        )}
      </View>
    );
  }

  const monthStart = startOfCalendarMonth(cursor);
  const days = daysInCalendarMonth(cursor);
  const leadingDays =
    (new Date(Date.UTC(monthStart.year, monthStart.month - 1, 1, 12)).getUTCDay() +
      6) %
    7;
  const selectedItems = items.filter((shift) =>
    instantDateKey(new Date(shift.startsAt), timezone) === calendarDateKey(cursor),
  );
  return (
    <View>
      <View style={styles.calendarWeekdays}>
        {['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((day) => (
          <Text key={day} style={styles.calendarWeekday}>
            {day}
          </Text>
        ))}
      </View>
      <View style={styles.calendarGrid}>
        {Array.from({ length: leadingDays }, (_, index) => (
          <View key={`blank-${index}`} style={styles.calendarBlank} />
        ))}
        {Array.from({ length: days }, (_, index) => {
          const day = { year: cursor.year, month: cursor.month, day: index + 1 };
          const count = items.filter((shift) =>
            instantDateKey(new Date(shift.startsAt), timezone) ===
              calendarDateKey(day),
          ).length;
          const selected = sameCalendarDate(day, cursor);
          return (
            <Pressable
              accessibilityLabel={`Pilih ${formatFullDate(day)}, ${count} shift`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              key={calendarDateKey(day)}
              onPress={() => onSelectCalendarDay(day)}
              style={[
                styles.calendarDay,
                selected && styles.calendarDaySelected,
              ]}
            >
              <Text
                style={[
                  styles.calendarDayNumber,
                  selected && styles.calendarDayNumberSelected,
                ]}
              >
                {index + 1}
              </Text>
              {count > 0 ? (
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={styles.calendarCount}
                >
                  <Text style={styles.calendarCountText}>{count}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
      <View style={styles.calendarAgenda}>
        <Text style={styles.calendarAgendaTitle}>{formatFullDate(cursor)}</Text>
        {selectedItems.length > 0 ? (
          selectedItems.map((shift) => (
            <ShiftCard compact key={shift.id} shift={shift} timezone={timezone} />
          ))
        ) : (
          <Text style={styles.weekEmpty}>Tidak ada shift pada tanggal ini.</Text>
        )}
      </View>
    </View>
  );
}

function ShiftCard({
  compact = false,
  shift,
  timezone,
}: {
  compact?: boolean;
  shift: Shift;
  timezone: string;
}) {
  const start = new Date(shift.startsAt);
  const end = new Date(shift.endsAt);
  return (
    <View style={[styles.shiftCard, compact && styles.shiftCardCompact]}>
      <View style={styles.shiftTimeBlock}>
        <Text style={styles.time}>{formatTime(start, timezone)}</Text>
        <Text style={styles.endTime}>sampai {formatTime(end, timezone)}</Text>
      </View>
      <View style={styles.shiftDetail}>
        <Text style={styles.shiftTitle}>{shift.title}</Text>
        <View style={styles.location}>
          <Ionicons name="location-outline" size={15} color={colors.gold} />
          <Text style={styles.locationText}>{shift.section.name}</Text>
        </View>
        {shift.roleName ? <Text style={styles.role}>{shift.roleName}</Text> : null}
      </View>
    </View>
  );
}

function PeriodEmpty({ copy }: { copy: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons name="calendar-outline" size={30} color={colors.gold} />
      <Text style={styles.emptyTitle}>Belum ada jadwal</Text>
      <Text style={styles.copy}>{copy}</Text>
    </View>
  );
}

function periodRange(view: ScheduleView, cursor: CalendarDate, timezone: string) {
  if (view === "DAY") {
    return {
      from: zonedDateTimeToUtc(cursor, timezone),
      to: zonedDateTimeToUtc(addCalendarDays(cursor, 1), timezone),
    };
  }
  if (view === "WEEK") {
    const from = startOfCalendarWeek(cursor);
    return {
      from: zonedDateTimeToUtc(from, timezone),
      to: zonedDateTimeToUtc(addCalendarDays(from, 7), timezone),
    };
  }
  const from = startOfCalendarMonth(cursor);
  return {
    from: zonedDateTimeToUtc(from, timezone),
    to: zonedDateTimeToUtc(addCalendarMonths(from, 1), timezone),
  };
}

function movePeriod(value: CalendarDate, view: ScheduleView, direction: -1 | 1) {
  if (view === "DAY") return addCalendarDays(value, direction);
  if (view === "WEEK") return addCalendarDays(value, direction * 7);
  return addCalendarMonths(value, direction);
}

function formatPeriod(view: ScheduleView, cursor: CalendarDate) {
  if (view === "DAY") return formatFullDate(cursor);
  if (view === "WEEK") {
    const start = startOfCalendarWeek(cursor);
    const end = addCalendarDays(start, 6);
    return `${formatShortDate(start)} – ${formatShortDate(end)}`;
  }
  return formatCalendarDate(cursor, {
    month: "long",
    year: "numeric",
  });
}

function formatFullDate(value: CalendarDate) {
  return formatCalendarDate(value, {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  });
}

function formatShortDate(value: CalendarDate) {
  return formatCalendarDate(value, {
    day: "2-digit",
    month: "short",
  });
}

function formatTime(value: Date, timezone: string) {
  return formatInstant(value, timezone, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function viewLabel(view: ScheduleView) {
  return view === "DAY" ? "Hari" : view === "WEEK" ? "Minggu" : "Bulan";
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
  copy: { color: colors.inkMuted, lineHeight: 20, marginTop: 6 },
  viewTabs: {
    flexDirection: "row",
    marginTop: spacing.lg,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  viewTab: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 3,
    borderColor: "transparent",
    paddingHorizontal: 4,
  },
  viewTabSelected: { borderColor: colors.gold },
  viewTabText: { color: colors.inkMuted, fontSize: 12, fontWeight: "700" },
  viewTabTextSelected: { color: colors.espresso },
  periodControls: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  periodButton: {
    width: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  periodCopy: { flex: 1, alignItems: "center", paddingHorizontal: 4 },
  periodLabel: {
    color: colors.espresso,
    fontFamily: "serif",
    fontSize: 17,
    textAlign: "center",
  },
  todayButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 6 },
  todayText: { color: "#795D25", fontSize: 11, fontWeight: "700" },
  rule: { height: 1, backgroundColor: colors.line, marginBottom: spacing.lg },
  error: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderLeftWidth: 3,
    borderColor: colors.ruby,
    backgroundColor: "#FBEFEF",
    padding: spacing.md,
  },
  feedbackCopy: { flex: 1 },
  retryButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 6 },
  retryText: { color: colors.ruby, fontWeight: "700", fontSize: 12 },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderLeftWidth: 3,
    borderColor: colors.emerald,
    backgroundColor: "#EAF4EE",
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  empty: {
    alignItems: "center",
    marginTop: 42,
    gap: 8,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  emptyTitle: { color: colors.espresso, fontWeight: "700" },
  agenda: { gap: spacing.sm },
  shiftCard: {
    minHeight: 100,
    flexDirection: "row",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  shiftCardCompact: { minHeight: 84 },
  shiftTimeBlock: { width: 76, borderRightWidth: 1, borderColor: colors.line },
  shiftDetail: { flex: 1, minWidth: 0 },
  shiftTitle: { fontFamily: "serif", fontSize: 19, color: colors.espresso },
  time: { fontWeight: "700", color: colors.espresso },
  endTime: { color: colors.inkMuted, fontSize: 11, marginTop: 4 },
  location: {
    flexDirection: "row",
    gap: 5,
    alignItems: "center",
    marginTop: 8,
  },
  locationText: { flex: 1, color: colors.espresso },
  role: { color: colors.inkMuted, fontSize: 12, marginTop: 5 },
  weekList: { borderTopWidth: 1, borderColor: colors.line },
  weekDay: {
    flexDirection: "row",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  weekDayHeading: { width: 64, paddingTop: 3 },
  weekDayName: {
    color: "#8A6C2D",
    fontSize: 9,
    letterSpacing: 1,
    fontWeight: "700",
  },
  weekDayNumber: {
    color: colors.espresso,
    fontFamily: "serif",
    fontSize: 16,
    marginTop: 5,
  },
  weekDayAgenda: { flex: 1, minWidth: 0 },
  weekEmpty: { color: colors.inkMuted, fontSize: 12, paddingVertical: 12 },
  calendarWeekdays: { flexDirection: "row", borderBottomWidth: 1, borderColor: colors.line },
  calendarWeekday: {
    width: "14.2857%",
    paddingVertical: 8,
    textAlign: "center",
    color: colors.inkMuted,
    fontSize: 9,
    fontWeight: "700",
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderLeftWidth: 1,
    borderColor: colors.line,
  },
  calendarBlank: {
    width: "14.2857%",
    minHeight: 56,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#F6F1E8",
  },
  calendarDay: {
    width: "14.2857%",
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.white,
  },
  calendarDaySelected: { backgroundColor: colors.espresso },
  calendarDayNumber: { color: colors.espresso, fontWeight: "700" },
  calendarDayNumberSelected: { color: colors.goldSoft },
  calendarCount: {
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 3,
    backgroundColor: "#EAF4EE",
  },
  calendarCountText: { color: colors.emerald, fontSize: 9, fontWeight: "700" },
  calendarAgenda: { marginTop: spacing.lg },
  calendarAgendaTitle: {
    color: colors.espresso,
    fontFamily: "serif",
    fontSize: 20,
    marginBottom: spacing.sm,
  },
  openSection: {
    marginTop: spacing.xl,
    borderTopWidth: 1,
    borderColor: colors.line,
    paddingTop: spacing.lg,
  },
  openTitle: {
    fontFamily: "serif",
    fontSize: 24,
    color: colors.espresso,
    marginBottom: spacing.sm,
  },
  openRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  openRowStacked: { alignItems: "stretch", flexDirection: "column" },
  openCopy: { flex: 1 },
  requestButton: {
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: colors.espresso,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  requestButtonStacked: { alignSelf: "flex-start" },
  requestText: { color: colors.white, fontWeight: "700", fontSize: 12 },
});

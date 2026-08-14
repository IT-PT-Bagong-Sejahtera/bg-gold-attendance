import { Ionicons } from "@expo/vector-icons";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { LoadingRows } from "../components/LoadingRows";
import { GuidedTutorial, type TutorialStep } from "../components/GuidedTutorial";
import { Screen } from "../components/Screen";
import {
  api,
  type Employee,
  type Me,
  type OpenShift,
  type Section,
  type Shift,
} from "../lib/api";
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
  const [me, setMe] = useState<Me | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const [savingParticipants, setSavingParticipants] = useState(false);
  const [createEventOpen, setCreateEventOpen] = useState(false);
  const [savingEvent, setSavingEvent] = useState(false);
  const [openShifts, setOpenShifts] = useState<OpenShift[]>([]);
  const [requesting, setRequesting] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tutorialVisible, setTutorialVisible] = useState(false);
  const viewTabsRef = useRef<View>(null);
  const periodControlsRef = useRef<View>(null);
  const addEventButtonRef = useRef<View>(null);
  const scheduleAreaRef = useRef<View>(null);
  const canManage = Boolean(
    me?.roles?.some((role) =>
      ["OWNER", "ADMIN", "HR", "SUPERVISOR"].includes(role),
    ),
  );
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
  const tutorialSteps = useMemo<TutorialStep[]>(() => {
    const common: TutorialStep[] = [
      {
        target: viewTabsRef,
        title: "Pilih cara melihat jadwal",
        body: "Gunakan Hari untuk fokus hari ini, Minggu untuk agenda kerja, atau Kalender untuk memilih tanggal tertentu.",
      },
      {
        target: periodControlsRef,
        title: "Berpindah tanggal dan periode",
        body: "Gunakan panah kiri dan kanan untuk melihat hari, minggu, atau bulan sebelumnya dan berikutnya.",
      },
    ];
    if (canManage) {
      common.push({
        target: addEventButtonRef,
        title: "Tambahkan event custom",
        body: "Pilih tanggalnya, lalu ketuk Tambah event. Supervisor dapat mengisi nama event, showroom, jam, dan karyawan yang ikut tanpa membuat clock-in harian.",
      });
    }
    common.push({
      target: scheduleAreaRef,
      title: canManage ? "Buka dan atur peserta" : "Buka detail jadwal Anda",
      body: canManage
        ? "Ketuk sebuah jadwal untuk melihat detail serta menambah atau menghapus karyawan yang bertugas."
        : "Ketuk sebuah jadwal untuk melihat waktu, lokasi, dan rekan kerja yang bertugas bersama Anda.",
    });
    return common;
  }, [canManage]);

  const load = useCallback(async () => {
    if (!timezoneReady) return;
    setLoading(true);
    setError("");
    try {
      const [assigned, available, employeeItems, sectionItems] = await Promise.all([
        canManage
          ? api.supervisorShifts(
              token,
              range.from.toISOString(),
              range.to.toISOString(),
            )
          : api.shifts(token, range.from.toISOString(), range.to.toISOString()),
        api.openShifts(token, range.from.toISOString(), range.to.toISOString()),
        canManage ? api.employees(token) : Promise.resolve([]),
        canManage ? api.sections(token) : Promise.resolve([]),
      ]);
      setItems(assigned);
      setOpenShifts(available);
      setEmployees(employeeItems.filter((item) => item.status === "ACTIVE"));
      setSections(sectionItems.filter((item) => item.status === "ACTIVE"));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Jadwal belum dapat dimuat.",
      );
    } finally {
      setLoading(false);
    }
  }, [canManage, range.from, range.to, timezoneReady, token]);

  const loadTimezone = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const identity = await api.me(token);
      setMe(identity);
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

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

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

  async function saveParticipants(shift: Shift, membershipIds: string[]) {
    setSavingParticipants(true);
    setError("");
    try {
      await api.updateShiftParticipants(token, shift.id, membershipIds);
      const participants = employees
        .filter((employee) => membershipIds.includes(employee.id))
        .map((employee) => ({
          membershipId: employee.id,
          employeeName: employee.fullName,
          employeeNumber: employee.employeeNumber,
        }));
      const updated = { ...shift, participants };
      setItems((current) =>
        current.map((item) => (item.id === shift.id ? updated : item)),
      );
      setSelectedShift(updated);
      setNotice("Peserta shift berhasil diperbarui.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Peserta shift belum dapat disimpan.",
      );
    } finally {
      setSavingParticipants(false);
    }
  }

  async function createCustomEvent(input: {
    title: string;
    showroomName: string;
    sectionId: string;
    startsAt: Date;
    endsAt: Date;
    membershipIds: string[];
  }) {
    setSavingEvent(true);
    try {
      await api.createShift(token, {
        sectionId: input.sectionId,
        title: input.title,
        scheduleType: "EVENT",
        showroomName: input.showroomName,
        startsAt: input.startsAt.toISOString(),
        endsAt: input.endsAt.toISOString(),
        publish: true,
        open: false,
        membershipIds: input.membershipIds,
      });
      setNotice(
        `${input.title} ditambahkan di ${input.showroomName} untuk ${input.membershipIds.length} karyawan.`,
      );
      await load();
    } finally {
      setSavingEvent(false);
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
        <View style={styles.headingRow}>
          <Text style={styles.eyebrow}>JADWAL</Text>
          <Pressable
            accessibilityHint="Membuka panduan langkah demi langkah untuk halaman jadwal"
            accessibilityLabel="Buka tutorial jadwal"
            accessibilityRole="button"
            onPress={() => setTutorialVisible(true)}
            style={({ pressed }) => [styles.tutorialButton, pressed && styles.tutorialButtonPressed]}
          >
            <Ionicons name="help-circle-outline" size={18} color={colors.espresso} />
            <Text style={styles.tutorialButtonText}>Tutorial</Text>
          </Pressable>
        </View>
        <Text style={styles.title}>{canManage ? "Kalender tim" : "Waktu kerja Anda"}</Text>
        <Text style={styles.copy}>
          {canManage
            ? "Buka shift untuk melihat dan mengatur karyawan yang bertugas."
            : "Buka shift untuk melihat detail dan rekan kerja yang bertugas bersama Anda."}
        </Text>

        <View ref={viewTabsRef} collapsable={false} accessibilityRole="tablist" style={styles.viewTabs}>
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

        <View ref={periodControlsRef} collapsable={false} style={styles.periodControls}>
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
        {canManage ? (
          <View style={styles.addEventPanel}>
            <View style={styles.addEventCopy}>
              <Text style={styles.addEventEyebrow}>TANGGAL TERPILIH</Text>
              <Text style={styles.addEventDate}>{formatFullDate(cursor)}</Text>
              <Text style={styles.addEventHint}>
                Event custom tampil di jadwal tanpa menjadi shift clock-in harian.
              </Text>
            </View>
            <View ref={addEventButtonRef} collapsable={false}>
              <Pressable
                accessibilityLabel={`Tambah event pada ${formatFullDate(cursor)}`}
                accessibilityRole="button"
                onPress={() => setCreateEventOpen(true)}
                style={styles.addEventButton}
              >
                <Ionicons name="add" size={20} color={colors.espresso} />
                <Text style={styles.addEventButtonText}>Tambah event</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
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
        <View ref={scheduleAreaRef} collapsable={false}>
          {!error && (!loading || visibleItems.length > 0) ? (
            <SchedulePeriod
              cursor={cursor}
              items={visibleItems}
              onSelectCalendarDay={setCursor}
              onSelectShift={setSelectedShift}
              timezone={timezone}
              view={view}
            />
          ) : null}
        </View>

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
      <ShiftDetailModal
        canManage={canManage}
        employees={employees}
        onClose={() => setSelectedShift(null)}
        onSave={saveParticipants}
        saving={savingParticipants}
        shift={selectedShift}
        timezone={timezone}
      />
      <CreateEventModal
        date={cursor}
        employees={employees}
        onClose={() => setCreateEventOpen(false)}
        onSave={createCustomEvent}
        saving={savingEvent}
        sections={sections}
        timezone={timezone}
        visible={createEventOpen}
      />
      <GuidedTutorial
        onClose={() => setTutorialVisible(false)}
        steps={tutorialSteps}
        visible={tutorialVisible}
      />
    </Screen>
  );
}

function SchedulePeriod({
  cursor,
  items,
  onSelectCalendarDay,
  onSelectShift,
  timezone,
  view,
}: {
  cursor: CalendarDate;
  items: Shift[];
  onSelectCalendarDay: (day: CalendarDate) => void;
  onSelectShift: (shift: Shift) => void;
  timezone: string;
  view: ScheduleView;
}) {
  if (view === "DAY") {
    return items.length > 0 ? (
      <View style={styles.agenda}>
        {items.map((shift) => (
          <ShiftCard key={shift.id} onPress={onSelectShift} shift={shift} timezone={timezone} />
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
                      <ShiftCard compact key={shift.id} onPress={onSelectShift} shift={shift} timezone={timezone} />
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
            <ShiftCard compact key={shift.id} onPress={onSelectShift} shift={shift} timezone={timezone} />
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
  onPress,
  shift,
  timezone,
}: {
  compact?: boolean;
  onPress: (shift: Shift) => void;
  shift: Shift;
  timezone: string;
}) {
  const start = new Date(shift.startsAt);
  const end = new Date(shift.endsAt);
  const isEvent = shift.scheduleType === "EVENT";
  return (
    <Pressable
      accessibilityHint="Membuka detail dan daftar karyawan dalam jadwal"
      accessibilityLabel={`Lihat detail jadwal ${shift.title}`}
      accessibilityRole="button"
      onPress={() => onPress(shift)}
      style={({ pressed }) => [
        styles.shiftCard,
        compact && styles.shiftCardCompact,
        pressed && styles.shiftCardPressed,
      ]}
    >
      <View style={styles.shiftTimeBlock}>
        <Text style={styles.time}>{formatTime(start, timezone)}</Text>
        <Text style={styles.endTime}>sampai {formatTime(end, timezone)}</Text>
      </View>
      <View style={styles.shiftDetail}>
        {isEvent ? <Text style={styles.eventBadge}>EVENT CUSTOM</Text> : null}
        <Text style={styles.shiftTitle}>{shift.title}</Text>
        <View style={styles.location}>
          <Ionicons name="location-outline" size={15} color={colors.gold} />
          <Text style={styles.locationText}>
            {shift.showroomName ?? shift.section.name}
          </Text>
        </View>
        {shift.roleName ? <Text style={styles.role}>{shift.roleName}</Text> : null}
        <Text style={styles.participantCount}>
          {shift.participants?.length ?? 0} karyawan · ketuk untuk detail
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={17} color={colors.inkMuted} />
    </Pressable>
  );
}

function ShiftDetailModal({
  canManage,
  employees,
  onClose,
  onSave,
  saving,
  shift,
  timezone,
}: {
  canManage: boolean;
  employees: Employee[];
  onClose(): void;
  onSave(shift: Shift, membershipIds: string[]): Promise<void>;
  saving: boolean;
  shift: Shift | null;
  timezone: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    setSelected(shift?.participants?.map((item) => item.membershipId) ?? []);
  }, [shift]);

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={Boolean(shift)}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.detailSheet}>
          <View style={styles.detailHeader}>
            <View style={styles.detailHeaderCopy}>
              <Text style={styles.eyebrow}>
                {shift?.scheduleType === "EVENT" ? "DETAIL EVENT CUSTOM" : "DETAIL JADWAL"}
              </Text>
              <Text style={styles.detailTitle}>{shift?.title ?? ""}</Text>
            </View>
            <Pressable
              accessibilityLabel="Tutup detail jadwal"
              accessibilityRole="button"
              onPress={onClose}
              style={styles.detailClose}
            >
              <Ionicons name="close" size={23} color={colors.espresso} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.detailContent}
            showsVerticalScrollIndicator={false}
          >
            {shift ? (
              <>
                <View style={styles.shiftDetailSummary}>
                  <View style={styles.detailFactRow}>
                    <Ionicons name="time-outline" size={20} color={colors.gold} />
                    <View style={styles.detailFactCopy}>
                      <Text style={styles.detailFactLabel}>WAKTU</Text>
                      <Text style={styles.detailFactValue}>
                        {formatInstant(new Date(shift.startsAt), timezone, {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                        })}
                        {" · "}
                        {formatTime(new Date(shift.startsAt), timezone)}–
                        {formatTime(new Date(shift.endsAt), timezone)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.detailFactRow}>
                    <Ionicons name="location-outline" size={20} color={colors.gold} />
                    <View style={styles.detailFactCopy}>
                      <Text style={styles.detailFactLabel}>
                        {shift.scheduleType === "EVENT" ? "SHOWROOM" : "LOKASI & POSISI"}
                      </Text>
                      <Text style={styles.detailFactValue}>
                        {shift.showroomName ?? shift.section.name}
                        {shift.roleName ? ` · ${shift.roleName}` : ""}
                      </Text>
                    </View>
                  </View>
                  {shift.status ? (
                    <Text style={styles.publicationStatus}>
                      {shift.status === "PUBLISHED" ? "JADWAL TERBIT" : "DRAF"}
                    </Text>
                  ) : null}
                </View>

                <View style={styles.participantHeading}>
                  <View>
                    <Text style={styles.eyebrow}>KARYAWAN BERTUGAS</Text>
                    <Text style={styles.participantTitle}>
                      {selected.length} orang dipilih
                    </Text>
                  </View>
                  {canManage ? (
                    <Text style={styles.editHint}>Ketuk untuk memilih</Text>
                  ) : null}
                </View>

                {canManage ? (
                  employees.length > 0 ? (
                    employees.map((employee) => {
                      const checked = selected.includes(employee.id);
                      return (
                        <Pressable
                          accessibilityLabel={`${checked ? "Hapus" : "Tambahkan"} ${employee.fullName} dari shift`}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked }}
                          key={employee.id}
                          onPress={() => toggle(employee.id)}
                          style={({ pressed }) => [
                            styles.employeeRow,
                            checked && styles.employeeRowSelected,
                            pressed && styles.employeeRowPressed,
                          ]}
                        >
                          <View style={[styles.checkbox, checked && styles.checkboxSelected]}>
                            {checked ? (
                              <Ionicons name="checkmark" size={15} color={colors.white} />
                            ) : null}
                          </View>
                          <View style={styles.employeeCopy}>
                            <Text style={styles.employeeName}>{employee.fullName}</Text>
                            <Text style={styles.employeeMeta}>
                              {employee.employeeNumber}
                              {employee.jobTitle ? ` · ${employee.jobTitle}` : ""}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })
                  ) : (
                    <Text style={styles.detailEmpty}>Belum ada karyawan aktif.</Text>
                  )
                ) : shift.participants && shift.participants.length > 0 ? (
                  shift.participants.map((participant, index) => (
                    <View key={participant.membershipId} style={styles.employeeRow}>
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{index + 1}</Text>
                      </View>
                      <View style={styles.employeeCopy}>
                        <Text style={styles.employeeName}>{participant.employeeName}</Text>
                        <Text style={styles.employeeMeta}>{participant.employeeNumber}</Text>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={styles.detailEmpty}>
                    Belum ada daftar rekan kerja untuk shift ini.
                  </Text>
                )}

                {canManage ? (
                  <Pressable
                    accessibilityLabel="Simpan peserta jadwal"
                    accessibilityRole="button"
                    accessibilityState={{ busy: saving, disabled: saving }}
                    disabled={saving}
                    onPress={() => void onSave(shift, selected)}
                    style={[styles.saveParticipants, saving && styles.saveDisabled]}
                  >
                    {saving ? (
                      <ActivityIndicator color={colors.white} />
                    ) : (
                      <>
                        <Ionicons name="people-outline" size={19} color={colors.white} />
                        <Text style={styles.saveParticipantsText}>Simpan peserta jadwal</Text>
                      </>
                    )}
                  </Pressable>
                ) : null}
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function CreateEventModal({
  date,
  employees,
  onClose,
  onSave,
  saving,
  sections,
  timezone,
  visible,
}: {
  date: CalendarDate;
  employees: Employee[];
  onClose(): void;
  onSave(input: {
    title: string;
    showroomName: string;
    sectionId: string;
    startsAt: Date;
    endsAt: Date;
    membershipIds: string[];
  }): Promise<void>;
  saving: boolean;
  sections: Section[];
  timezone: string;
  visible: boolean;
}) {
  const [title, setTitle] = useState("");
  const [showroomName, setShowroomName] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [startsAt, setStartsAt] = useState(() =>
    zonedDateTimeToUtc(date, timezone, 9),
  );
  const [endsAt, setEndsAt] = useState(() =>
    zonedDateTimeToUtc(date, timezone, 17),
  );
  const [picker, setPicker] = useState<"start" | "end" | null>(null);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!visible) return;
    setTitle("");
    setShowroomName("");
    setSelected([]);
    setSectionId(sections[0]?.id ?? "");
    setStartsAt(zonedDateTimeToUtc(date, timezone, 9));
    setEndsAt(zonedDateTimeToUtc(date, timezone, 17));
    setPicker(null);
    setFormError("");
  }, [date, sections, timezone, visible]);

  function changeTime(event: DateTimePickerEvent, selectedTime?: Date) {
    const target = picker;
    setPicker(null);
    if (event.type === "dismissed" || !selectedTime || !target) return;
    const value = zonedDateTimeToUtc(
      date,
      timezone,
      selectedTime.getHours(),
      selectedTime.getMinutes(),
    );
    if (target === "start") {
      setStartsAt(value);
      if (endsAt <= value) setEndsAt(new Date(value.getTime() + 2 * 60 * 60_000));
    } else {
      setEndsAt(value);
    }
  }

  function toggleEmployee(id: string) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  async function submit() {
    if (!title.trim() || !showroomName.trim() || !sectionId) {
      setFormError("Nama event, nama showroom, dan area administrasi wajib diisi.");
      return;
    }
    if (selected.length === 0) {
      setFormError("Pilih minimal satu karyawan yang mengikuti event.");
      return;
    }
    if (endsAt <= startsAt) {
      setFormError("Jam selesai harus setelah jam mulai.");
      return;
    }
    setFormError("");
    try {
      await onSave({
        title: title.trim(),
        showroomName: showroomName.trim(),
        sectionId,
        startsAt,
        endsAt,
        membershipIds: selected,
      });
      onClose();
    } catch (reason) {
      setFormError(
        reason instanceof Error ? reason.message : "Event belum dapat ditambahkan.",
      );
    }
  }

  return (
    <>
      <Modal
        animationType="slide"
        onRequestClose={onClose}
        transparent
        visible={visible}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.createSheet}>
            <View style={styles.detailHeader}>
              <View style={styles.detailHeaderCopy}>
                <Text style={styles.eyebrow}>EVENT CUSTOM</Text>
                <Text style={styles.detailTitle}>Tambah ke kalender</Text>
                <Text style={styles.createDate}>{formatFullDate(date)}</Text>
              </View>
              <Pressable
                accessibilityLabel="Tutup form event"
                accessibilityRole="button"
                disabled={saving}
                onPress={onClose}
                style={styles.detailClose}
              >
                <Ionicons name="close" size={23} color={colors.espresso} />
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={styles.createForm}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.customEventNote}>
                <Ionicons name="sparkles-outline" size={20} color={colors.gold} />
                <Text style={styles.customEventNoteText}>
                  Event ini hanya menjadi agenda tim dan tidak digunakan sebagai shift clock-in harian.
                </Text>
              </View>
              {formError ? (
                <View accessibilityRole="alert" style={styles.createError}>
                  <Ionicons name="alert-circle-outline" size={19} color={colors.ruby} />
                  <Text style={styles.createErrorText}>{formError}</Text>
                </View>
              ) : null}

              <Text style={styles.formLabel}>Nama event</Text>
              <TextInput
                accessibilityLabel="Nama event custom"
                maxLength={180}
                onChangeText={setTitle}
                style={styles.formInput}
                value={title}
              />

              <Text style={styles.formLabel}>Nama showroom</Text>
              <TextInput
                accessibilityLabel="Nama showroom event"
                maxLength={180}
                onChangeText={setShowroomName}
                style={styles.formInput}
                value={showroomName}
              />

              <Text style={styles.formLabel}>Area administrasi</Text>
              <View style={styles.sectionChoices}>
                {sections.map((section) => {
                  const checked = sectionId === section.id;
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked }}
                      key={section.id}
                      onPress={() => setSectionId(section.id)}
                      style={[styles.sectionChoice, checked && styles.sectionChoiceActive]}
                    >
                      <Text style={[styles.sectionChoiceText, checked && styles.sectionChoiceTextActive]}>
                        {section.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.formLabel}>Waktu event</Text>
              <View style={styles.eventTimeRow}>
                <EventTimeButton
                  label="Mulai"
                  onPress={() => setPicker("start")}
                  value={formatTime(startsAt, timezone)}
                />
                <EventTimeButton
                  label="Selesai"
                  onPress={() => setPicker("end")}
                  value={formatTime(endsAt, timezone)}
                />
              </View>

              <View style={styles.employeePickerHeading}>
                <Text style={styles.formLabel}>Karyawan yang ikut</Text>
                <Text style={styles.employeePickerCount}>{selected.length} dipilih</Text>
              </View>
              {employees.map((employee) => {
                const checked = selected.includes(employee.id);
                return (
                  <Pressable
                    accessibilityLabel={`${checked ? "Hapus" : "Pilih"} ${employee.fullName} untuk event`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    key={employee.id}
                    onPress={() => toggleEmployee(employee.id)}
                    style={[styles.employeeRow, checked && styles.employeeRowSelected]}
                  >
                    <View style={[styles.checkbox, checked && styles.checkboxSelected]}>
                      {checked ? <Ionicons name="checkmark" size={15} color={colors.white} /> : null}
                    </View>
                    <View style={styles.employeeCopy}>
                      <Text style={styles.employeeName}>{employee.fullName}</Text>
                      <Text style={styles.employeeMeta}>
                        {employee.employeeNumber}
                        {employee.jobTitle ? ` · ${employee.jobTitle}` : ""}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}

              <Pressable
                accessibilityLabel="Terbitkan event custom"
                accessibilityRole="button"
                accessibilityState={{ busy: saving, disabled: saving }}
                disabled={saving}
                onPress={() => void submit()}
                style={[styles.createEventSubmit, saving && styles.saveDisabled]}
              >
                {saving ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Ionicons name="calendar-outline" size={19} color={colors.white} />
                )}
                <Text style={styles.createEventSubmitText}>
                  {saving ? "Menerbitkan…" : "Terbitkan event"}
                </Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
      {picker ? (
        <DateTimePicker
          mode="time"
          onChange={changeTime}
          value={picker === "end" ? endsAt : startsAt}
        />
      ) : null}
    </>
  );
}

function EventTimeButton({
  label,
  onPress,
  value,
}: {
  label: string;
  onPress(): void;
  value: string;
}) {
  return (
    <Pressable
      accessibilityLabel={`Pilih jam ${label.toLowerCase()} event`}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.eventTimeButton}
    >
      <Ionicons name="time-outline" size={19} color={colors.gold} />
      <View>
        <Text style={styles.eventTimeLabel}>{label}</Text>
        <Text style={styles.eventTimeValue}>{value}</Text>
      </View>
    </Pressable>
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
  headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tutorialButton: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: colors.gold, borderRadius: 21, paddingHorizontal: 13, backgroundColor: colors.paper },
  tutorialButtonPressed: { backgroundColor: colors.goldSoft },
  tutorialButtonText: { color: colors.espresso, fontSize: 11, fontWeight: "800" },
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
  addEventPanel: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    backgroundColor: "#F7EDCF",
    borderLeftWidth: 3,
    borderColor: colors.gold,
  },
  addEventCopy: { flex: 1, minWidth: 190 },
  addEventEyebrow: { color: "#8A6C2D", fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  addEventDate: { color: colors.espresso, fontFamily: "serif", fontSize: 17, marginTop: 3 },
  addEventHint: { color: colors.inkMuted, fontSize: 10, lineHeight: 15, marginTop: 4 },
  addEventButton: { minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: spacing.md, backgroundColor: colors.goldSoft },
  addEventButtonText: { color: colors.espresso, fontSize: 12, fontWeight: "800" },
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
  shiftCardPressed: { backgroundColor: colors.ivoryDeep },
  shiftTimeBlock: { width: 76, borderRightWidth: 1, borderColor: colors.line },
  shiftDetail: { flex: 1, minWidth: 0 },
  shiftTitle: { fontFamily: "serif", fontSize: 19, color: colors.espresso },
  eventBadge: { alignSelf: "flex-start", color: "#795D25", fontSize: 8, fontWeight: "900", letterSpacing: 1, marginBottom: 4 },
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
  participantCount: { color: "#8A6C2D", fontSize: 10, fontWeight: "700", marginTop: 7 },
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
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(24,12,8,.48)" },
  detailSheet: { maxHeight: "94%", minHeight: "62%", backgroundColor: colors.ivory, borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: "hidden" },
  detailHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderColor: colors.line },
  detailHeaderCopy: { flex: 1 },
  detailTitle: { color: colors.espresso, fontFamily: "serif", fontSize: 26, marginTop: 4 },
  detailClose: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  detailContent: { padding: spacing.lg, paddingBottom: 64 },
  shiftDetailSummary: { padding: spacing.md, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, gap: spacing.md },
  detailFactRow: { flexDirection: "row", gap: spacing.sm },
  detailFactCopy: { flex: 1 },
  detailFactLabel: { color: colors.inkMuted, fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  detailFactValue: { color: colors.espresso, lineHeight: 20, marginTop: 3 },
  publicationStatus: { alignSelf: "flex-start", color: colors.emerald, backgroundColor: "#E4F2E9", fontSize: 9, fontWeight: "800", paddingHorizontal: 9, paddingVertical: 6 },
  participantHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: spacing.xl, marginBottom: spacing.sm },
  participantTitle: { color: colors.espresso, fontFamily: "serif", fontSize: 21, marginTop: 4 },
  editHint: { color: colors.inkMuted, fontSize: 10 },
  employeeRow: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderColor: colors.line },
  employeeRowSelected: { backgroundColor: "#FFF8DF" },
  employeeRowPressed: { opacity: .72 },
  checkbox: { width: 23, height: 23, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  checkboxSelected: { backgroundColor: colors.emerald, borderColor: colors.emerald },
  employeeCopy: { flex: 1 },
  employeeName: { color: colors.espresso, fontWeight: "700" },
  employeeMeta: { color: colors.inkMuted, fontSize: 11, marginTop: 4 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.ivoryDeep, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#8A6C2D", fontSize: 11, fontWeight: "800" },
  detailEmpty: { color: colors.inkMuted, lineHeight: 20, paddingVertical: spacing.lg },
  saveParticipants: { minHeight: 52, marginTop: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.espresso },
  saveParticipantsText: { color: colors.white, fontWeight: "800" },
  saveDisabled: { opacity: .55 },
  createSheet: { maxHeight: "94%", minHeight: "72%", backgroundColor: colors.ivory, borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: "hidden" },
  createDate: { color: colors.inkMuted, fontSize: 11, marginTop: 4 },
  createForm: { padding: spacing.lg, paddingBottom: 72 },
  customEventNote: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, backgroundColor: "#F7EDCF", borderLeftWidth: 3, borderColor: colors.gold },
  customEventNoteText: { flex: 1, color: colors.espresso, fontSize: 11, lineHeight: 17 },
  createError: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, marginTop: spacing.md, backgroundColor: "#FBEFEF", borderLeftWidth: 3, borderColor: colors.ruby },
  createErrorText: { flex: 1, color: colors.ruby, fontSize: 12, lineHeight: 18 },
  formLabel: { color: colors.espresso, fontSize: 10, fontWeight: "900", letterSpacing: .8, textTransform: "uppercase", marginTop: spacing.lg, marginBottom: 8 },
  formInput: { minHeight: 50, paddingHorizontal: spacing.md, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, color: colors.espresso },
  sectionChoices: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  sectionChoice: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line },
  sectionChoiceActive: { backgroundColor: colors.espresso, borderColor: colors.espresso },
  sectionChoiceText: { color: colors.espresso, fontSize: 11, fontWeight: "700" },
  sectionChoiceTextActive: { color: colors.white },
  eventTimeRow: { flexDirection: "row", gap: spacing.sm },
  eventTimeButton: { flex: 1, minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line },
  eventTimeLabel: { color: colors.inkMuted, fontSize: 9 },
  eventTimeValue: { color: colors.espresso, fontSize: 15, fontWeight: "800", marginTop: 2 },
  employeePickerHeading: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  employeePickerCount: { color: colors.inkMuted, fontSize: 10, marginBottom: 8 },
  createEventSubmit: { minHeight: 54, marginTop: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.espresso },
  createEventSubmitText: { color: colors.white, fontWeight: "900" },
});

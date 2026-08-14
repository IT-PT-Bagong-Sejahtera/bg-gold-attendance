import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { LoadingRows } from "../components/LoadingRows";
import { TutorialLauncher } from "../components/GuidedTutorial";
import { Screen } from "../components/Screen";
import { api, type Employee, type Section, type SupervisorShift } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatInstant } from "../lib/timezone";
import { colors, spacing } from "../theme";

type PickerTarget = "date" | "start" | "end" | null;

export function SupervisorAttendanceScreen() {
  const token = useAuth().session!.accessToken;
  const [events, setEvents] = useState<SupervisorShift[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [timezone, setTimezone] = useState("Asia/Jakarta");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [startsAt, setStartsAt] = useState(() => nextHour());
  const [endsAt, setEndsAt] = useState(() => new Date(nextHour().getTime() + 8 * 60 * 60_000));
  const [picker, setPicker] = useState<PickerTarget>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const from = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
      const to = new Date(Date.now() + 60 * 24 * 60 * 60_000).toISOString();
      const [identity, shiftItems, employeeItems, sectionItems] = await Promise.all([
        api.me(token), api.supervisorShifts(token, from, to), api.employees(token), api.sections(token),
      ]);
      setTimezone(identity.timezone);
      setEvents(shiftItems);
      setEmployees(employeeItems.filter((item) => item.status === "ACTIVE"));
      setSections(sectionItems.filter((item) => item.status === "ACTIVE"));
      setSectionId((current) => current || sectionItems.find((item) => item.status === "ACTIVE")?.id || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Event dan shift belum dapat dimuat.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const totalPeople = useMemo(() => new Set(events.flatMap((event) => (event.participants ?? []).map((person) => person.membershipId))).size, [events]);
  const addShiftRef = useRef<View>(null);
  const eventListRef = useRef<View>(null);

  function changePicker(event: DateTimePickerEvent, value?: Date) {
    const target = picker;
    setPicker(null);
    if (event.type === "dismissed" || !value || !target) return;
    if (target === "date") {
      setStartsAt((current) => withDate(current, value));
      setEndsAt((current) => withDate(current, value));
    } else if (target === "start") {
      const next = withTime(startsAt, value);
      setStartsAt(next);
      if (endsAt <= next) setEndsAt(new Date(next.getTime() + 8 * 60 * 60_000));
    } else {
      setEndsAt(withTime(endsAt, value));
    }
  }

  function toggleMember(id: string) {
    setSelectedMembers((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function save() {
    if (!title.trim() || !sectionId || selectedMembers.length === 0 || endsAt <= startsAt) {
      setError("Isi nama event, lokasi, waktu yang valid, dan pilih minimal satu karyawan.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.createShift(token, { sectionId, title: title.trim(), startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), publish: true, open: false, membershipIds: selectedMembers });
      setNotice(`${title.trim()} diterbitkan untuk ${selectedMembers.length} karyawan.`);
      setTitle("");
      setSelectedMembers([]);
      setFormOpen(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Shift belum dapat dibuat.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={colors.gold} />}>
        <Text style={styles.eyebrow}>HADIR · SUPERVISOR</Text>
        <View ref={addShiftRef} collapsable={false} style={styles.headingRow}>
          <View style={styles.headingCopy}><Text style={styles.title}>Event & shift</Text><Text style={styles.copy}>Atur jadwal kerja dan lihat jelas siapa saja yang ditugaskan.</Text></View>
          <Pressable accessibilityLabel="Tambah shift" accessibilityRole="button" onPress={() => setFormOpen(true)} style={styles.addButton}><Ionicons name="add-outline" size={20} color={colors.espresso} /><Text style={styles.addButtonText}>Tambah</Text></Pressable>
        </View>
        {error ? <View accessibilityRole="alert" style={styles.error}><Ionicons name="alert-circle-outline" size={19} color={colors.ruby} /><Text style={styles.feedback}>{error}</Text></View> : null}
        {notice ? <View accessibilityRole="alert" style={styles.notice}><Ionicons name="checkmark-circle-outline" size={19} color={colors.emerald} /><Text style={styles.feedback}>{notice}</Text></View> : null}
        <View ref={eventListRef} collapsable={false}>
          <View style={styles.summary}><View><Text style={styles.summaryValue}>{events.length}</Text><Text style={styles.summaryLabel}>event mendatang</Text></View><View style={styles.summaryRule} /><View><Text style={styles.summaryValue}>{totalPeople}</Text><Text style={styles.summaryLabel}>anggota terjadwal</Text></View></View>
          {loading && events.length === 0 ? <LoadingRows label="Memuat event supervisor" count={3} /> : null}
          {!loading && events.length === 0 ? <View style={styles.empty}><Ionicons name="calendar-outline" size={30} color={colors.gold} /><Text style={styles.emptyTitle}>Belum ada event</Text><Text style={styles.copy}>Gunakan Tambah untuk menerbitkan shift pertama.</Text></View> : null}
          {events.map((event) => <EventCard event={event} key={event.id} timezone={timezone} />)}
        </View>
      </ScrollView>
      <TutorialLauncher
        accessibilityLabel="Buka tutorial Hadir supervisor"
        steps={[
          {
            target: addShiftRef,
            title: "Tambahkan penugasan",
            body: "Ketuk Tambah untuk membuat event atau shift, memilih lokasi, tanggal, waktu, dan karyawan yang bertugas.",
          },
          {
            target: eventListRef,
            title: "Lihat tim yang terjadwal",
            body: "Ringkasan dan kartu event memperlihatkan jumlah anggota serta nama setiap karyawan yang ikut.",
          },
        ]}
      />
      <Modal animationType="slide" onRequestClose={() => setFormOpen(false)} transparent visible={formOpen}>
        <View style={styles.backdrop}><View style={styles.sheet}>
          <View style={styles.sheetHeader}><View><Text style={styles.eyebrow}>SHIFT BARU</Text><Text style={styles.sheetTitle}>Susun penugasan</Text></View><Pressable accessibilityLabel="Tutup form shift" accessibilityRole="button" onPress={() => setFormOpen(false)} style={styles.close}><Ionicons name="close-outline" size={24} color={colors.espresso} /></Pressable></View>
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>Nama event atau shift</Text><TextInput accessibilityLabel="Nama event atau shift" onChangeText={setTitle} style={styles.input} value={title} />
            <Text style={styles.label}>Lokasi</Text><View style={styles.choices}>{sections.map((section) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: sectionId === section.id }} key={section.id} onPress={() => setSectionId(section.id)} style={[styles.choice, sectionId === section.id && styles.choiceActive]}><Text style={[styles.choiceText, sectionId === section.id && styles.choiceTextActive]}>{section.name}</Text></Pressable>)}</View>
            <Text style={styles.label}>Tanggal & waktu</Text><View style={styles.dateGrid}><DateButton icon="calendar-outline" label="Tanggal" onPress={() => setPicker("date")} value={formatDate(startsAt)} /><DateButton icon="time-outline" label="Mulai" onPress={() => setPicker("start")} value={formatClock(startsAt)} /><DateButton icon="time-outline" label="Selesai" onPress={() => setPicker("end")} value={formatClock(endsAt)} /></View>
            <View style={styles.peopleHeader}><Text style={styles.label}>Siapa saja yang bertugas</Text><Text style={styles.selectedCount}>{selectedMembers.length} dipilih</Text></View>
            {employees.map((employee) => { const selected = selectedMembers.includes(employee.id); return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} key={employee.id} onPress={() => toggleMember(employee.id)} style={styles.personRow}><View style={[styles.checkbox, selected && styles.checkboxActive]}>{selected ? <Ionicons name="checkmark-outline" size={16} color={colors.white} /> : null}</View><View style={styles.personCopy}><Text style={styles.personName}>{employee.fullName}</Text><Text style={styles.personNumber}>{employee.employeeNumber}{employee.jobTitle ? ` · ${employee.jobTitle}` : ""}</Text></View></Pressable>; })}
            <Pressable accessibilityLabel="Terbitkan shift" accessibilityRole="button" accessibilityState={{ busy: saving, disabled: saving }} disabled={saving} onPress={() => void save()} style={styles.saveButton}>{saving ? <ActivityIndicator color={colors.white} /> : <Ionicons name="paper-plane-outline" size={19} color={colors.white} />}<Text style={styles.saveText}>{saving ? "Menerbitkan…" : "Terbitkan shift"}</Text></Pressable>
          </ScrollView>
        </View></View>
      </Modal>
      {picker ? <DateTimePicker mode={picker === "date" ? "date" : "time"} onChange={changePicker} value={picker === "end" ? endsAt : startsAt} /> : null}
    </Screen>
  );
}

function EventCard({ event, timezone }: { event: SupervisorShift; timezone: string }) {
  const participants = event.participants ?? [];
  return <View style={styles.card}><View style={styles.cardTop}><View style={styles.cardCopy}><Text style={styles.cardDate}>{formatInstant(new Date(event.startsAt), timezone, { weekday: "long", day: "numeric", month: "long" })}</Text>{event.scheduleType === "EVENT" ? <Text style={styles.cardEventType}>EVENT CUSTOM</Text> : null}<Text style={styles.cardTitle}>{event.title}</Text><Text style={styles.cardMeta}>{formatInstant(new Date(event.startsAt), timezone, { hour: "2-digit", minute: "2-digit" })}–{formatInstant(new Date(event.endsAt), timezone, { hour: "2-digit", minute: "2-digit" })} · {event.showroomName ?? event.section.name}</Text></View><Text style={styles.status}>{event.status === "PUBLISHED" ? "TERBIT" : "DRAF"}</Text></View><View style={styles.memberHeader}><Ionicons name="people-outline" size={17} color={colors.gold} /><Text style={styles.memberTitle}>Anggota event · {participants.length} orang</Text></View>{participants.length ? participants.map((person) => <View key={person.membershipId} style={styles.memberRow}><View style={styles.avatar}><Text style={styles.avatarText}>{person.employeeName.slice(0, 1)}</Text></View><Text style={styles.memberName}>{person.employeeName}</Text><Text style={styles.memberNumber}>{person.employeeNumber}</Text></View>) : <Text style={styles.noMember}>Belum ada karyawan yang ditugaskan.</Text>}</View>;
}

function DateButton({ icon, label, onPress, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress(): void; value: string }) { return <Pressable accessibilityLabel={`Pilih ${label.toLowerCase()}`} accessibilityRole="button" onPress={onPress} style={styles.dateButton}><Ionicons name={icon} size={18} color={colors.gold} /><View><Text style={styles.dateLabel}>{label}</Text><Text style={styles.dateValue}>{value}</Text></View></Pressable>; }
function nextHour() { const value = new Date(); value.setMinutes(0, 0, 0); value.setHours(value.getHours() + 1); return value; }
function withDate(base: Date, selected: Date) { const value = new Date(base); value.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate()); return value; }
function withTime(base: Date, selected: Date) { const value = new Date(base); value.setHours(selected.getHours(), selected.getMinutes(), 0, 0); return value; }
function formatDate(value: Date) { return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(value); }
function formatClock(value: Date) { return new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" }).format(value); }

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: 120 }, eyebrow: { color: "#8A6C2D", fontSize: 10, fontWeight: "800", letterSpacing: 1.7 }, headingRow: { alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: spacing.md, justifyContent: "space-between", marginTop: 6 }, headingCopy: { flex: 1, minWidth: 200 }, title: { color: colors.espresso, fontFamily: "serif", fontSize: 32 }, copy: { color: colors.inkMuted, lineHeight: 20, marginTop: 5 }, addButton: { alignItems: "center", backgroundColor: colors.goldSoft, flexDirection: "row", gap: 6, minHeight: 46, paddingHorizontal: spacing.md }, addButtonText: { color: colors.espresso, fontWeight: "900" }, error: { backgroundColor: "#FBEFEF", borderLeftColor: colors.ruby, borderLeftWidth: 3, flexDirection: "row", gap: 8, marginTop: spacing.md, padding: spacing.md }, notice: { backgroundColor: "#EAF4EE", borderLeftColor: colors.emerald, borderLeftWidth: 3, flexDirection: "row", gap: 8, marginTop: spacing.md, padding: spacing.md }, feedback: { color: colors.espresso, flex: 1, lineHeight: 20 }, summary: { backgroundColor: colors.espresso, borderRadius: 16, flexDirection: "row", gap: spacing.lg, marginTop: spacing.lg, padding: spacing.lg }, summaryValue: { color: colors.white, fontFamily: "serif", fontSize: 28 }, summaryLabel: { color: "#D7C9BE", fontSize: 11, marginTop: 2 }, summaryRule: { backgroundColor: "#5B443B", width: 1 }, empty: { alignItems: "center", gap: 8, paddingVertical: 48 }, emptyTitle: { color: colors.espresso, fontWeight: "800" }, card: { borderBottomColor: colors.line, borderBottomWidth: 1, paddingVertical: spacing.xl }, cardTop: { alignItems: "flex-start", flexDirection: "row", gap: spacing.md }, cardCopy: { flex: 1 }, cardDate: { color: "#8A6C2D", fontSize: 10, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" }, cardEventType: { alignSelf: "flex-start", color: "#795D25", fontSize: 8, fontWeight: "900", letterSpacing: 1, marginTop: 5 }, cardTitle: { color: colors.espresso, fontFamily: "serif", fontSize: 22, marginTop: 5 }, cardMeta: { color: colors.inkMuted, lineHeight: 19, marginTop: 5 }, status: { backgroundColor: "#E3F1E8", color: "#23633A", fontSize: 9, fontWeight: "900", paddingHorizontal: 8, paddingVertical: 6 }, memberHeader: { alignItems: "center", flexDirection: "row", gap: 7, marginTop: spacing.lg }, memberTitle: { color: colors.espresso, fontSize: 12, fontWeight: "800" }, memberRow: { alignItems: "center", flexDirection: "row", gap: 9, minHeight: 48 }, avatar: { alignItems: "center", backgroundColor: colors.ivoryDeep, height: 30, justifyContent: "center", width: 30 }, avatarText: { color: colors.espresso, fontWeight: "900" }, memberName: { color: colors.espresso, flex: 1, fontWeight: "700" }, memberNumber: { color: colors.inkMuted, fontSize: 10 }, noMember: { color: colors.inkMuted, marginTop: spacing.sm }, backdrop: { backgroundColor: "rgba(25,14,10,0.5)", flex: 1, justifyContent: "flex-end" }, sheet: { backgroundColor: colors.paper, maxHeight: "92%", paddingTop: spacing.lg }, sheetHeader: { borderBottomColor: colors.line, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingBottom: spacing.md, paddingHorizontal: spacing.lg }, sheetTitle: { color: colors.espresso, fontFamily: "serif", fontSize: 26, marginTop: 5 }, close: { alignItems: "center", height: 44, justifyContent: "center", width: 44 }, form: { padding: spacing.lg, paddingBottom: 52 }, label: { color: colors.espresso, fontSize: 11, fontWeight: "900", marginBottom: 8, marginTop: spacing.md, textTransform: "uppercase" }, input: { backgroundColor: colors.ivory, borderColor: colors.line, borderWidth: 1, color: colors.espresso, minHeight: 50, paddingHorizontal: spacing.md }, choices: { flexDirection: "row", flexWrap: "wrap", gap: 7 }, choice: { borderColor: colors.line, borderWidth: 1, minHeight: 44, justifyContent: "center", paddingHorizontal: 12 }, choiceActive: { backgroundColor: colors.espresso, borderColor: colors.espresso }, choiceText: { color: colors.espresso, fontSize: 11, fontWeight: "700" }, choiceTextActive: { color: colors.white }, dateGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, dateButton: { alignItems: "center", backgroundColor: colors.ivory, flexDirection: "row", flexGrow: 1, gap: 8, minHeight: 56, minWidth: 120, padding: 10 }, dateLabel: { color: colors.inkMuted, fontSize: 9 }, dateValue: { color: colors.espresso, fontWeight: "800", marginTop: 2 }, peopleHeader: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between" }, selectedCount: { color: colors.inkMuted, fontSize: 11, marginBottom: 8 }, personRow: { alignItems: "center", borderBottomColor: colors.line, borderBottomWidth: 1, flexDirection: "row", gap: 10, minHeight: 58 }, checkbox: { alignItems: "center", borderColor: colors.line, borderWidth: 1, height: 24, justifyContent: "center", width: 24 }, checkboxActive: { backgroundColor: colors.espresso, borderColor: colors.espresso }, personCopy: { flex: 1 }, personName: { color: colors.espresso, fontWeight: "800" }, personNumber: { color: colors.inkMuted, fontSize: 10, marginTop: 2 }, saveButton: { alignItems: "center", backgroundColor: colors.espresso, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: spacing.xl, minHeight: 52 }, saveText: { color: colors.white, fontWeight: "900" },
});

import { Ionicons } from "@expo/vector-icons";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, type AttendanceAction, type KioskContext, type KioskEmployee, type KioskEmployeeStatus } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useKioskMode } from "../lib/kioskMode";
import { colors, spacing } from "../theme";

type Phase = "SELECT" | "PIN" | "ACTION" | "SUCCESS";

export function KioskScreen() {
  const auth = useAuth();
  const kioskMode = useKioskMode();
  const kiosk = kioskMode.kiosk!;
  const [context, setContext] = useState<KioskContext | null>(null);
  const [phase, setPhase] = useState<Phase>("SELECT");
  const [selected, setSelected] = useState<KioskEmployee | null>(null);
  const [status, setStatus] = useState<KioskEmployeeStatus | null>(null);
  const [pin, setPin] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [photoURI, setPhotoURI] = useState("");
  const [exitArmed, setExitArmed] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setContext(await api.kioskContext(kiosk.token)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Kiosk belum dapat tersambung."); }
    finally { setLoading(false); }
  }, [kiosk.token]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);

  const employees = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("id-ID");
    if (!needle) return context?.employees ?? [];
    return (context?.employees ?? []).filter((employee) => `${employee.fullName} ${employee.employeeNumber}`.toLocaleLowerCase("id-ID").includes(needle));
  }, [context?.employees, query]);

  function choose(employee: KioskEmployee) {
    setSelected(employee); setPin(""); setStatus(null); setPhotoURI(""); setError(""); setPhase("PIN");
  }

  function reset() {
    if (resetTimer.current) { clearTimeout(resetTimer.current); resetTimer.current = null; }
    setSelected(null); setStatus(null); setPin(""); setPhotoURI(""); setQuery(""); setError(""); setSaving(false); setPhase("SELECT");
  }

  async function verifyPIN() {
    if (!selected || pin.length !== 6) { setError("Masukkan 6 angka PIN absensi pribadi."); return; }
    setSaving(true); setError("");
    try { setStatus(await api.kioskEmployeeStatus(kiosk.token, selected.employeeNumber, pin)); setPhase("ACTION"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "PIN belum dapat diverifikasi."); }
    finally { setSaving(false); }
  }

  const action = actionForState(status?.attendance.state);

  async function submitAttendance() {
    if (!selected || !status || !action) return;
    setSaving(true); setError("");
    try {
      const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
      if (!cameraPermission.granted) throw new Error("Izin kamera diperlukan untuk mengambil foto bukti.");
      const captured = await ImagePicker.launchCameraAsync({ cameraType: ImagePicker.CameraType.front, quality: .75, allowsEditing: false });
      if (captured.canceled || !captured.assets[0]) { setSaving(false); return; }
      const asset = captured.assets[0]; setPhotoURI(asset.uri);
      const attachment = await api.kioskAttendanceSelfie(kiosk.token, selected.employeeNumber, pin, asset.uri, asset.mimeType ?? "image/jpeg");
      let locationEvidence: { latitude: number; longitude: number; accuracyMeters: number; capturedAt: string } | undefined;
      const locationPermission = await Location.requestForegroundPermissionsAsync();
      if (locationPermission.granted) {
        const point = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        locationEvidence = { latitude: point.coords.latitude, longitude: point.coords.longitude, accuracyMeters: point.coords.accuracy ?? 0, capturedAt: new Date(point.timestamp).toISOString() };
      }
      const result = await api.kioskAttendanceAction(kiosk.token, {
        employeeNumber: selected.employeeNumber, pin, type: action,
        shiftId: status.attendance.activeShiftId,
        evidence: { attachmentId: attachment.id, location: locationEvidence },
      }, Crypto.randomUUID());
      setStatus((current) => current ? { ...current, attendance: { ...current.attendance, state: result.attendanceState } } : current);
      setPin(""); setPhase("SUCCESS");
      resetTimer.current = setTimeout(reset, 2800);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Absensi belum berhasil dikirim."); }
    finally { setSaving(false); }
  }

  async function exitKiosk() {
    if (!exitArmed) { setExitArmed(true); setTimeout(() => setExitArmed(false), 5000); return; }
    setSaving(true); setError("");
    try {
      if (auth.session) await api.revokeKiosk(auth.session.accessToken, kiosk.id);
      await kioskMode.clear();
      if (auth.session) await auth.logout();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Mode kiosk belum dapat dinonaktifkan."); }
    finally { setSaving(false); setExitArmed(false); }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <View style={styles.header}>
          <Image source={require("../../assets/bg-gold-logo.png")} resizeMode="contain" style={styles.logo} />
          <View style={styles.headerCopy}><Text style={styles.kicker}>KIOSK SHOWROOM</Text><Text numberOfLines={1} style={styles.showroom}>{context?.showroom.name ?? kiosk.showroom.name}</Text><Text numberOfLines={1} style={styles.address}>{context?.showroom.address ?? kiosk.showroom.address ?? kiosk.deviceLabel}</Text></View>
          <View style={styles.live}><View style={styles.dot} /><Text style={styles.liveText}>AKTIF</Text></View>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          {loading ? <View style={styles.center}><ActivityIndicator color={colors.gold} size="large" /><Text style={styles.muted}>Menyiapkan kiosk showroom…</Text></View> : null}
          {error ? <View accessibilityRole="alert" style={styles.errorBox}><Ionicons name="alert-circle-outline" size={20} color={colors.ruby} /><Text style={styles.errorText}>{error}</Text></View> : null}
          {!loading && phase === "SELECT" ? (
            <>
              <Text style={styles.step}>LANGKAH 1 DARI 3</Text><Text style={styles.title}>Siapa yang akan absen?</Text><Text style={styles.subtitle}>Pilih nama atau cari menggunakan nomor karyawan.</Text>
              <View style={styles.search}><Ionicons name="search-outline" size={20} color={colors.inkMuted} /><TextInput accessibilityLabel="Cari nama atau nomor karyawan" autoCapitalize="none" value={query} onChangeText={setQuery} placeholder="Cari karyawan" placeholderTextColor="#968D85" style={styles.searchInput} /></View>
              <View style={styles.list}>{employees.map((employee) => <Pressable accessibilityRole="button" accessibilityState={{ disabled: !employee.pinConfigured }} disabled={!employee.pinConfigured} key={employee.id} onPress={() => choose(employee)} style={({ pressed }) => [styles.employee, !employee.pinConfigured && styles.disabled, pressed && styles.pressed]}><View style={styles.avatar}><Text style={styles.avatarText}>{initials(employee.fullName)}</Text></View><View style={styles.employeeCopy}><Text style={styles.employeeName}>{employee.fullName}</Text><Text style={styles.employeeMeta}>{employee.employeeNumber}{employee.jobTitle ? ` · ${employee.jobTitle}` : ""}</Text>{!employee.pinConfigured ? <Text style={styles.pinMissing}>PIN belum diatur · hubungi supervisor</Text> : null}</View><Ionicons name={employee.pinConfigured ? "chevron-forward" : "lock-closed-outline"} size={20} color={employee.pinConfigured ? colors.gold : colors.inkMuted} /></Pressable>)}</View>
              {!employees.length ? <Text style={styles.empty}>Karyawan tidak ditemukan.</Text> : null}
            </>
          ) : null}
          {phase === "PIN" && selected ? (
            <View style={styles.focusCard}>
              <Pressable accessibilityRole="button" onPress={reset} style={styles.back}><Ionicons name="arrow-back" size={18} color={colors.espresso} /><Text>Kembali</Text></Pressable>
              <Text style={styles.step}>LANGKAH 2 DARI 3</Text><View style={styles.largeAvatar}><Text style={styles.largeAvatarText}>{initials(selected.fullName)}</Text></View><Text style={styles.centerTitle}>{selected.fullName}</Text><Text style={styles.centerMeta}>{selected.employeeNumber}</Text>
              <Text style={styles.pinLabel}>Masukkan PIN absensi pribadi</Text><TextInput accessibilityLabel="PIN absensi pribadi" autoFocus keyboardType="number-pad" maxLength={6} secureTextEntry value={pin} onChangeText={(value) => setPin(value.replace(/\D/g, "").slice(0, 6))} style={styles.pinInput} />
              <Text style={styles.pinHelp}>{kiosk.token.startsWith("demo-kiosk-") ? "PIN semua karyawan untuk demo: 123456" : "PIN tidak disimpan di HP kiosk ini."}</Text><Pressable accessibilityRole="button" disabled={saving || pin.length !== 6} onPress={() => void verifyPIN()} style={[styles.primary, (saving || pin.length !== 6) && styles.disabled]}>{saving ? <ActivityIndicator color={colors.espresso} /> : <Text style={styles.primaryText}>Lanjutkan</Text>}</Pressable>
            </View>
          ) : null}
          {phase === "ACTION" && selected && status ? (
            <View style={styles.focusCard}>
              <Pressable accessibilityRole="button" onPress={reset} style={styles.back}><Ionicons name="close" size={18} color={colors.espresso} /><Text>Ganti karyawan</Text></Pressable>
              <Text style={styles.step}>LANGKAH 3 DARI 3</Text><Text style={styles.centerTitle}>{selected.fullName}</Text><Text style={styles.centerMeta}>{selected.employeeNumber}</Text>
              <View style={styles.stateCard}><View><Text style={styles.stateLabel}>STATUS HARI INI</Text><Text style={styles.stateValue}>{stateLabel(status.attendance.state)}</Text></View><Ionicons name={status.attendance.state === "WORKING" ? "time" : "checkmark-circle"} size={30} color={colors.emerald} /></View>
              {action ? <><View style={styles.photoNote}><Ionicons name="camera-outline" size={20} color={colors.gold} /><Text style={styles.photoText}>Kamera depan akan terbuka. Ambil foto bukti saat menekan tombol di bawah.</Text></View><Pressable accessibilityLabel={actionLabel(action)} accessibilityRole="button" disabled={saving} onPress={() => void submitAttendance()} style={[styles.primary, saving && styles.disabled]}>{saving ? <><ActivityIndicator color={colors.espresso} /><Text style={styles.primaryText}>Mengirim absensi…</Text></> : <><Ionicons name="camera" size={19} color={colors.espresso} /><Text style={styles.primaryText}>{actionLabel(action)}</Text></>}</Pressable></> : <><Text style={styles.doneCopy}>{status.attendance.state === "COMPLETED" ? "Absensi masuk dan pulang hari ini sudah lengkap." : "Status ini belum dapat diproses dari kiosk. Hubungi supervisor."}</Text><Pressable accessibilityRole="button" onPress={reset} style={styles.secondary}><Text style={styles.secondaryText}>Selesai</Text></Pressable></>}
            </View>
          ) : null}
          {phase === "SUCCESS" && selected ? <View accessibilityLiveRegion="polite" style={styles.success}><View style={styles.successIcon}><Ionicons name="checkmark" size={38} color={colors.white} /></View><Text style={styles.successTitle}>Absensi berhasil</Text><Text style={styles.successName}>{selected.fullName}</Text><Text style={styles.successCopy}>Foto dan waktu telah tercatat. Layar akan kembali untuk karyawan berikutnya.</Text>{photoURI ? <Image source={{ uri: photoURI }} style={styles.thumb} /> : null}<Pressable accessibilityRole="button" onPress={reset} style={styles.secondary}><Text style={styles.secondaryText}>Kembali sekarang</Text></Pressable></View> : null}
        </ScrollView>
        <View style={styles.footer}><Text style={styles.footerText}>{kiosk.deviceLabel} · satu HP untuk seluruh karyawan</Text><Pressable accessibilityRole="button" disabled={saving} onPress={() => void exitKiosk()} style={styles.exit}><Ionicons name={exitArmed ? "warning-outline" : "lock-open-outline"} size={15} color={exitArmed ? colors.ruby : colors.inkMuted} /><Text style={[styles.exitText, exitArmed && styles.exitArmed]}>{exitArmed ? "Tekan lagi untuk keluar" : "Keluar kiosk"}</Text></Pressable></View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join(""); }
function actionForState(state?: string): AttendanceAction | null { if (state === "NOT_STARTED") return "CLOCK_IN"; if (state === "WORKING") return "CLOCK_OUT"; if (state === "ON_BREAK") return "END_BREAK"; return null; }
function stateLabel(state: string) { return ({ NOT_STARTED: "Belum clock-in", WORKING: "Sedang bekerja", ON_BREAK: "Sedang istirahat", COMPLETED: "Sudah selesai", PENDING: "Menunggu persetujuan" } as Record<string, string>)[state] ?? state; }
function actionLabel(action: AttendanceAction) { if (action === "CLOCK_IN") return "Ambil foto & clock-in"; if (action === "CLOCK_OUT") return "Ambil foto & clock-out"; return "Ambil foto & akhiri istirahat"; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.ivory }, flex: { flex: 1 }, header: { minHeight: 88, paddingHorizontal: spacing.lg, paddingVertical: 12, backgroundColor: colors.espresso, flexDirection: "row", alignItems: "center", gap: 12 }, logo: { width: 62, height: 48 }, headerCopy: { flex: 1 }, kicker: { color: colors.goldSoft, fontSize: 9, letterSpacing: 1.4, fontWeight: "800" }, showroom: { color: colors.white, fontFamily: "serif", fontSize: 19, marginTop: 2 }, address: { color: "#C8BEB5", fontSize: 10, marginTop: 2 }, live: { flexDirection: "row", alignItems: "center", gap: 5 }, dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#5DD49D" }, liveText: { color: "#A9E8CA", fontSize: 9, fontWeight: "800" }, content: { flexGrow: 1, padding: spacing.lg, paddingBottom: 32 }, center: { minHeight: 300, alignItems: "center", justifyContent: "center", gap: 14 }, muted: { color: colors.inkMuted }, step: { color: "#8A6C2D", fontSize: 10, fontWeight: "800", letterSpacing: 1.5, marginTop: 4 }, title: { color: colors.espresso, fontFamily: "serif", fontSize: 31, marginTop: 7 }, subtitle: { color: colors.inkMuted, lineHeight: 20, marginTop: 5 }, errorBox: { flexDirection: "row", gap: 9, padding: 13, backgroundColor: "#F9E8E6", borderRadius: 14, marginBottom: 14 }, errorText: { flex: 1, color: colors.ruby, lineHeight: 18 }, search: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, borderRadius: 16, marginTop: 20 }, searchInput: { flex: 1, minHeight: 50, color: colors.espresso }, list: { gap: 9, marginTop: 14 }, employee: { minHeight: 72, padding: 12, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, flexDirection: "row", alignItems: "center", gap: 12 }, pressed: { opacity: .72 }, avatar: { width: 45, height: 45, borderRadius: 23, backgroundColor: colors.ivoryDeep, alignItems: "center", justifyContent: "center" }, avatarText: { color: colors.brown, fontWeight: "800" }, employeeCopy: { flex: 1 }, employeeName: { color: colors.espresso, fontSize: 16, fontWeight: "700" }, employeeMeta: { color: colors.inkMuted, fontSize: 11, marginTop: 4 }, pinMissing: { color: colors.ruby, fontSize: 10, marginTop: 4, fontWeight: "700" }, empty: { textAlign: "center", color: colors.inkMuted, marginTop: 30 }, focusCard: { borderRadius: 24, backgroundColor: colors.paper, padding: spacing.lg, borderWidth: 1, borderColor: colors.line }, back: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40 }, largeAvatar: { width: 72, height: 72, borderRadius: 36, alignSelf: "center", marginTop: 16, backgroundColor: colors.espresso, alignItems: "center", justifyContent: "center" }, largeAvatarText: { color: colors.goldSoft, fontSize: 23, fontWeight: "800" }, centerTitle: { color: colors.espresso, fontFamily: "serif", fontSize: 27, textAlign: "center", marginTop: 13 }, centerMeta: { color: colors.inkMuted, textAlign: "center", marginTop: 4 }, pinLabel: { color: colors.espresso, fontWeight: "700", textAlign: "center", marginTop: 28 }, pinInput: { height: 62, borderWidth: 1.5, borderColor: colors.gold, borderRadius: 16, backgroundColor: colors.ivory, color: colors.espresso, fontSize: 28, fontWeight: "800", letterSpacing: 12, textAlign: "center", marginTop: 10, paddingLeft: 12 }, pinHelp: { textAlign: "center", color: colors.inkMuted, fontSize: 11, marginTop: 8 }, primary: { minHeight: 56, paddingHorizontal: 16, marginTop: 22, borderRadius: 16, backgroundColor: colors.gold, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }, primaryText: { color: colors.espresso, fontWeight: "900" }, disabled: { opacity: .5 }, stateCard: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#EEF6F1", borderRadius: 17, padding: 16, marginTop: 22 }, stateLabel: { color: colors.emerald, fontSize: 9, fontWeight: "800", letterSpacing: 1.2 }, stateValue: { color: colors.espresso, fontSize: 18, fontWeight: "800", marginTop: 3 }, photoNote: { flexDirection: "row", gap: 10, padding: 14, backgroundColor: colors.ivoryDeep, borderRadius: 14, marginTop: 15 }, photoText: { flex: 1, color: colors.inkMuted, lineHeight: 18, fontSize: 12 }, doneCopy: { color: colors.inkMuted, textAlign: "center", lineHeight: 20, marginTop: 22 }, secondary: { minHeight: 50, borderWidth: 1, borderColor: colors.line, borderRadius: 15, alignItems: "center", justifyContent: "center", marginTop: 18, paddingHorizontal: 20 }, secondaryText: { color: colors.espresso, fontWeight: "800" }, success: { alignItems: "center", borderRadius: 25, backgroundColor: colors.paper, padding: spacing.xl, borderWidth: 1, borderColor: colors.line }, successIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.emerald, alignItems: "center", justifyContent: "center" }, successTitle: { color: colors.emerald, fontSize: 12, fontWeight: "900", letterSpacing: 1.2, marginTop: 17 }, successName: { color: colors.espresso, fontFamily: "serif", fontSize: 29, textAlign: "center", marginTop: 7 }, successCopy: { color: colors.inkMuted, textAlign: "center", lineHeight: 20, marginTop: 8 }, thumb: { width: 78, height: 98, borderRadius: 14, marginTop: 16 }, footer: { minHeight: 52, borderTopWidth: 1, borderColor: colors.line, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.paper }, footerText: { flex: 1, color: colors.inkMuted, fontSize: 9 }, exit: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 42, paddingLeft: 10 }, exitText: { color: colors.inkMuted, fontSize: 10, fontWeight: "700" }, exitArmed: { color: colors.ruby },
});

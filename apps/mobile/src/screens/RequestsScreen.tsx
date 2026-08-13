import { Ionicons } from "@expo/vector-icons";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Screen } from "../components/Screen";
import { LoadingRows } from "../components/LoadingRows";
import { actionLabel } from "../lib/attendance";
import { api, type AttendanceRequest, type Claim, type ClaimType, type LeaveBalance, type LeaveRequest, type LeaveType } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatInstant } from "../lib/timezone";
import { colors, spacing } from "../theme";

const statusLabel: Record<AttendanceRequest["status"], string> = {
  PENDING: "Menunggu",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak",
  WITHDRAWN: "Dibatalkan",
};

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day ? new Date(year, month - 1, day) : new Date();
}

function displayDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(dateFromKey(value));
}

export function RequestsScreen() {
  const token = useAuth().session!.accessToken;
  const { fontScale, width } = useWindowDimensions();
  const needsStackedLayout = fontScale >= 1.5 || width < 380;
  const [items, setItems] = useState<AttendanceRequest[]>([]);
  const [leaveItems, setLeaveItems] = useState<LeaveRequest[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [claimItems, setClaimItems] = useState<Claim[]>([]);
  const [claimTypes, setClaimTypes] = useState<ClaimType[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [reason, setReason] = useState("");
  const [claimFormOpen, setClaimFormOpen] = useState(false);
  const [claimTypeId, setClaimTypeId] = useState("");
  const [claimTitle, setClaimTitle] = useState("");
  const [claimAmount, setClaimAmount] = useState("");
  const [incurredOn, setIncurredOn] = useState("");
  const [incurredOnPickerOpen, setIncurredOnPickerOpen] = useState(false);
  const [claimNotes, setClaimNotes] = useState("");
  const [claimReceipt, setClaimReceipt] = useState<{ uri: string; mimeType: string }>();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const load = useCallback(async () => {
    setError("");
    try {
      const [identity, attendance, leaves, types, leaveBalances, claims, availableClaimTypes] = await Promise.all([
        api.me(token), api.requests(token), api.leaveRequests(token), api.leaveTypes(token), api.leaveBalances(token), api.claims(token), api.claimTypes(token),
      ]);
      setTimezone(identity.timezone);
      setItems(attendance); setLeaveItems(leaves); setLeaveTypes(types); setBalances(leaveBalances);
      setClaimItems(claims); setClaimTypes(availableClaimTypes);
      setLeaveTypeId((current) => current || types[0]?.id || "");
      setClaimTypeId((current) => current || availableClaimTypes[0]?.id || "");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Permintaan belum dapat dimuat.",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);
  async function submitLeave() {
    if (!leaveTypeId || !startsOn || !endsOn || !reason.trim()) { setError("Jenis, tanggal, dan alasan cuti wajib diisi."); return; }
    setSaving(true); setError("");
    try { await api.createLeaveRequest(token, { leaveTypeId, startsOn, endsOn, reason: reason.trim() }); setReason(""); setStartsOn(""); setEndsOn(""); setFormOpen(false); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Permintaan cuti belum dapat dikirim."); }
    finally { setSaving(false); }
  }
  async function withdrawLeave(id: string) { setSaving(true); setError(""); try { await api.withdrawLeaveRequest(token,id); await load(); } catch(cause){setError(cause instanceof Error?cause.message:"Permintaan belum dapat dibatalkan.");} finally{setSaving(false);} }
  async function captureClaimReceipt() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { setError("Izin kamera diperlukan untuk memotret struk."); return; }
    const result = await ImagePicker.launchCameraAsync({ cameraType: ImagePicker.CameraType.back, quality: 0.8, allowsEditing: true });
    const asset = !result.canceled ? result.assets[0] : undefined;
    if (asset) setClaimReceipt({ uri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg" });
  }
  function selectIncurredOn(event: DateTimePickerEvent, selected?: Date) {
    setIncurredOnPickerOpen(false);
    if (event.type === "set" && selected) setIncurredOn(dateKey(selected));
  }
  async function submitClaim() {
    const amount = Number(claimAmount);
    const selectedType = claimTypes.find((type) => type.id === claimTypeId);
    if (!claimTypeId || !claimTitle.trim() || !incurredOn || !Number.isFinite(amount) || amount <= 0) { setError("Jenis, judul, nominal, dan tanggal klaim wajib diisi."); return; }
    if (selectedType?.receiptRequired && !claimReceipt) { setError("Jenis klaim ini mewajibkan foto struk."); return; }
    setSaving(true); setError("");
    try {
      const attachment = claimReceipt ? await api.claimReceipt(token, claimReceipt.uri, claimReceipt.mimeType) : undefined;
      await api.createClaim(token, { claimTypeId, title: claimTitle.trim(), amount, currency: "IDR", incurredOn, notes: claimNotes.trim(), attachmentId: attachment?.id });
      setClaimTitle(""); setClaimAmount(""); setIncurredOn(""); setClaimNotes(""); setClaimReceipt(undefined); setClaimFormOpen(false); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Klaim belum dapat dikirim."); }
    finally { setSaving(false); }
  }
  async function withdrawClaim(id: string) { setSaving(true); setError(""); try { await api.withdrawClaim(token, id); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Klaim belum dapat ditarik."); } finally { setSaving(false); } }
  useEffect(() => {
    void load();
  }, [load]);
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
        <Text style={styles.eyebrow}>PERMINTAAN</Text>
        <Text style={styles.title}>Keputusan yang jelas</Text>
        <Text style={styles.copy}>
          Permintaan absensi dan alasan keputusan tersimpan bersama riwayatnya.
        </Text>
        <View style={styles.rule} />
        <View style={[styles.leaveHeader, needsStackedLayout && styles.leaveHeaderStacked]}>
          <View style={styles.leaveHeaderCopy}><Text style={styles.sectionEyebrow}>CUTI</Text><Text style={styles.sectionTitle}>Waktu untuk beristirahat</Text></View>
          <Pressable accessibilityRole="button" onPress={() => setFormOpen((value) => !value)} style={[styles.addButton, needsStackedLayout && styles.addButtonStacked]}><Text style={styles.addButtonText}>{formOpen ? "Tutup" : "+ Ajukan cuti"}</Text></Pressable>
        </View>
        {balances.length > 0 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.balanceList}>{balances.map((balance)=><View key={balance.id} style={[styles.balance, needsStackedLayout && styles.balanceLarge]}><Text style={styles.balanceName}>{balance.leaveTypeName}</Text><Text style={styles.balanceValue}>{balance.availableDays}</Text><Text style={styles.balanceCopy}>hari tersedia · {balance.pendingDays} menunggu</Text></View>)}</ScrollView> : null}
        {formOpen ? <View style={styles.leaveForm}><Text style={styles.formLabel}>Jenis cuti</Text><View style={styles.typeChoices}>{leaveTypes.map((type)=><Pressable accessibilityRole="button" accessibilityState={{selected:leaveTypeId===type.id}} key={type.id} onPress={()=>setLeaveTypeId(type.id)} style={[styles.typeChoice,leaveTypeId===type.id&&styles.typeChoiceSelected]}><Text style={leaveTypeId===type.id?styles.typeTextSelected:styles.typeText}>{type.name}</Text></Pressable>)}</View><Text style={styles.formLabel}>Tanggal mulai · YYYY-MM-DD</Text><TextInput accessibilityLabel="Tanggal mulai cuti" value={startsOn} onChangeText={setStartsOn} placeholder="2026-09-14" style={styles.input}/><Text style={styles.formLabel}>Tanggal selesai · YYYY-MM-DD</Text><TextInput accessibilityLabel="Tanggal selesai cuti" value={endsOn} onChangeText={setEndsOn} placeholder="2026-09-16" style={styles.input}/><Text style={styles.formLabel}>Alasan</Text><TextInput accessibilityLabel="Alasan cuti" value={reason} onChangeText={setReason} multiline maxLength={500} placeholder="Jelaskan seperlunya" style={[styles.input,styles.reasonInput]}/><Pressable accessibilityRole="button" accessibilityState={{disabled:saving,busy:saving}} disabled={saving} onPress={()=>void submitLeave()} style={styles.submitButton}><Text style={styles.submitText}>{saving?"Mengirim…":"Kirim permintaan"}</Text></Pressable></View>:null}
        <View style={styles.leaveList}>{leaveItems.map((item)=><View key={item.id} style={styles.leaveRow}><View style={styles.leaveRowTop}><Text style={styles.action}>{item.leaveTypeName}</Text><Text style={[styles.status,item.status==="APPROVED"?styles.approved:item.status==="REJECTED"?styles.rejected:styles.pending]}>{statusLabel[item.status]}</Text></View><Text style={styles.time}>{item.startsOn}–{item.endsOn} · {item.totalDays} hari kerja</Text><Text style={styles.reason}>“{item.reason}”</Text>{item.decisionReason?<Text style={styles.decisionReason}>Catatan supervisor: {item.decisionReason}</Text>:null}{item.status==="PENDING"?<Pressable accessibilityRole="button" disabled={saving} onPress={()=>void withdrawLeave(item.id)} style={styles.withdrawButton}><Text style={styles.withdrawText}>Batalkan permintaan</Text></Pressable>:null}</View>)}</View>
        <View style={styles.subRule} />
        <View style={[styles.leaveHeader, needsStackedLayout && styles.leaveHeaderStacked]}>
          <View style={styles.leaveHeaderCopy}><Text style={styles.sectionEyebrow}>KLAIM</Text><Text style={styles.sectionTitle}>Biaya kerja, tanpa teka-teki</Text></View>
          <Pressable accessibilityRole="button" onPress={() => setClaimFormOpen((value) => !value)} style={[styles.addButton, needsStackedLayout && styles.addButtonStacked]}><Text style={styles.addButtonText}>{claimFormOpen ? "Tutup" : "+ Ajukan klaim"}</Text></Pressable>
        </View>
        {claimFormOpen ? <View style={styles.leaveForm}>
          <Text style={styles.formLabel}>Jenis klaim</Text><View style={styles.typeChoices}>{claimTypes.map((type)=><Pressable accessibilityRole="button" accessibilityState={{selected:claimTypeId===type.id}} key={type.id} onPress={()=>setClaimTypeId(type.id)} style={[styles.typeChoice,claimTypeId===type.id&&styles.typeChoiceSelected]}><Text style={claimTypeId===type.id?styles.typeTextSelected:styles.typeText}>{type.name}</Text></Pressable>)}</View>
          <Text style={styles.formLabel}>Judul</Text><TextInput accessibilityLabel="Judul klaim" value={claimTitle} onChangeText={setClaimTitle} maxLength={160} placeholder="Taksi ke outlet" style={styles.input}/>
          <Text style={styles.formLabel}>Nominal · IDR</Text><TextInput accessibilityLabel="Nominal klaim" value={claimAmount} onChangeText={setClaimAmount} keyboardType="decimal-pad" placeholder="175000" style={styles.input}/>
          <Text style={styles.formLabel}>Tanggal biaya</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Pilih tanggal biaya"
            accessibilityValue={{ text: incurredOn ? displayDate(incurredOn) : "Belum dipilih" }}
            onPress={() => setIncurredOnPickerOpen(true)}
            style={({ pressed }) => [styles.dateInput, pressed && styles.dateInputPressed]}
          >
            <Text style={styles.dateValue}>{displayDate(incurredOn)}</Text>
            <Ionicons name="calendar-outline" size={20} color={colors.espresso}/>
          </Pressable>
          {incurredOnPickerOpen ? <DateTimePicker
            testID="tanggal-biaya-picker"
            value={dateFromKey(incurredOn)}
            mode="date"
            display={Platform.OS === "ios" ? "inline" : "default"}
            maximumDate={new Date()}
            onChange={selectIncurredOn}
          /> : null}
          <Text style={styles.formLabel}>Catatan</Text><TextInput accessibilityLabel="Catatan klaim" value={claimNotes} onChangeText={setClaimNotes} multiline maxLength={1000} placeholder="Konteks singkat untuk pemeriksa" style={[styles.input,styles.reasonInput]}/>
          <Pressable accessibilityRole="button" accessibilityLabel={claimReceipt ? "Ganti foto struk" : "Foto struk"} onPress={()=>void captureClaimReceipt()} style={styles.receiptButton}><Ionicons name="camera-outline" size={18} color={colors.espresso}/><Text style={styles.receiptText}>{claimReceipt ? "Struk siap diunggah" : "Foto struk"}</Text></Pressable>
          <Text style={styles.ocrNote}>Jika OCR organisasi aktif, struk akan dibaca otomatis; pemeriksa tetap mengonfirmasi nominal.</Text>
          <Pressable accessibilityRole="button" disabled={saving} onPress={()=>void submitClaim()} style={styles.submitButton}><Text style={styles.submitText}>{saving?"Mengirim…":"Kirim klaim"}</Text></Pressable>
        </View>:null}
        <View style={styles.leaveList}>{claimItems.map((item)=><View key={item.id} style={styles.leaveRow}><View style={styles.leaveRowTop}><Text style={styles.action}>{item.title}</Text><Text style={[styles.status,item.status==="APPROVED"?styles.approved:item.status==="REJECTED"?styles.rejected:styles.pending]}>{statusLabel[item.status]}</Text></View><Text style={styles.claimAmount}>{new Intl.NumberFormat("id-ID",{style:"currency",currency:item.currency,maximumFractionDigits:0}).format(item.amount)}</Text><Text style={styles.time}>{item.claimTypeName} · {item.incurredOn}</Text>{item.ocrStatus==="COMPLETE"&&item.ocrResult?<Text style={styles.ocrNote}>OCR membaca {item.ocrResult.merchant||"struk"} · keyakinan {Math.round(item.ocrResult.confidence*100)}%</Text>:item.ocrStatus==="FAILED"?<Text style={styles.ocrNote}>OCR belum berhasil; struk tetap dapat diperiksa manual.</Text>:item.ocrStatus==="PENDING"?<Text style={styles.ocrNote}>Struk sedang dibaca OCR…</Text>:null}{item.notes?<Text style={styles.reason}>“{item.notes}”</Text>:null}{item.decisionReason?<Text style={styles.decisionReason}>Catatan pemeriksa: {item.decisionReason}</Text>:null}{item.status==="PENDING"?<Pressable accessibilityRole="button" disabled={saving} onPress={()=>void withdrawClaim(item.id)} style={styles.withdrawButton}><Text style={styles.withdrawText}>Tarik klaim</Text></Pressable>:null}</View>)}</View>
        <View style={styles.subRule} />
        <Text style={styles.sectionEyebrow}>ABSENSI</Text>
        {loading && items.length === 0 ? (
          <LoadingRows label="Memuat permintaan absensi" />
        ) : null}
        {error ? (
          <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>
            <Ionicons
              name="alert-circle-outline"
              size={20}
              color={colors.ruby}
            />
            <Text style={styles.feedbackCopy}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={()=>{setLoading(true);void load();}} style={styles.retryButton}><Text style={styles.retryText}>Coba lagi</Text></Pressable>
          </View>
        ) : null}
        {!loading && items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons
              name="file-tray-full-outline"
              size={30}
              color={colors.gold}
            />
            <Text style={styles.emptyTitle}>Belum ada permintaan</Text>
            <Text style={styles.centerCopy}>
              Clocking yang membutuhkan persetujuan akan tersusun di sini.
            </Text>
          </View>
        ) : null}
        <View>
          {items.map((item) => (
            <View style={styles.row} key={item.id}>
              <View
                style={[
                  styles.marker,
                  item.status === "APPROVED"
                    ? styles.markerApproved
                    : item.status === "REJECTED"
                      ? styles.markerRejected
                      : styles.markerPending,
                ]}
              >
                <Ionicons
                  name={
                    item.status === "APPROVED"
                      ? "checkmark"
                      : item.status === "REJECTED"
                        ? "close"
                        : "hourglass-outline"
                  }
                  size={17}
                  color={item.status === "PENDING" ? "#7A5B16" : colors.white}
                />
              </View>
              <View style={styles.rowBody}>
                <View style={styles.rowTop}>
                  <Text style={styles.action}>
                    {actionLabel(item.actionType)}
                  </Text>
                  <Text
                    style={[
                      styles.status,
                      item.status === "APPROVED"
                        ? styles.approved
                        : item.status === "REJECTED"
                          ? styles.rejected
                          : styles.pending,
                    ]}
                  >
                    {statusLabel[item.status]}
                  </Text>
                </View>
                <Text style={styles.time}>
                  {formatInstant(new Date(item.recordedAt), timezone, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
                {item.reason ? (
                  <Text style={styles.reason}>“{item.reason}”</Text>
                ) : null}
                {item.decisionReason ? (
                  <Text style={styles.decisionReason}>
                    Catatan supervisor: {item.decisionReason}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
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
  centerCopy: { color: colors.inkMuted, lineHeight: 20, textAlign: "center" },
  rule: { height: 1, backgroundColor: colors.line, marginVertical: spacing.lg },
  loader: { marginTop: 60 },
  error: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    padding: spacing.md,
    borderLeftWidth: 3,
    borderColor: colors.ruby,
    backgroundColor: "#FBEFEF",
  },
  retryButton:{minHeight:44,justifyContent:"center",marginLeft:"auto"},retryText:{color:colors.ruby,fontWeight:"700",fontSize:12},
  feedbackCopy:{flexGrow:1,flexShrink:1,minWidth:160},
  empty: {
    alignItems: "center",
    gap: 8,
    marginTop: 60,
    paddingHorizontal: spacing.lg,
  },
  emptyTitle: { fontWeight: "700", color: colors.espresso },
  row: {
    flexDirection: "row",
    gap: spacing.md,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  marker: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  markerPending: { backgroundColor: "#F2E4B9" },
  markerApproved: { backgroundColor: colors.emerald },
  markerRejected: { backgroundColor: colors.ruby },
  rowBody: { flex: 1 },
  rowTop: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
    alignItems: "center",
  },
  action: { flexGrow: 1, flexShrink: 1, minWidth: 130, fontFamily: "serif", fontSize: 19, color: colors.espresso },
  status: {
    fontSize: 10,
    fontWeight: "700",
    paddingVertical: 4,
    paddingHorizontal: 7,
  },
  approved: { color: colors.emerald, backgroundColor: "#E8F2ED" },
  rejected: { color: colors.ruby, backgroundColor: "#F8E9E9" },
  pending: { color: "#7A5B16", backgroundColor: "#F7EECF" },
  time: { fontSize: 12, color: colors.inkMuted, marginTop: 4 },
  reason: {
    color: colors.espresso,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 9,
  },
  decisionReason: {
    color: colors.inkMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 5,
  },
  leaveHeader: { flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:spacing.md },leaveHeaderStacked:{alignItems:"stretch",flexDirection:"column"},leaveHeaderCopy:{flex:1,minWidth:0},sectionEyebrow:{fontSize:10,letterSpacing:1.5,fontWeight:"700",color:"#8A6C2D"}, sectionTitle:{fontFamily:"serif",fontSize:23,color:colors.espresso,marginTop:4}, addButton:{minHeight:44,justifyContent:"center",paddingHorizontal:12,paddingVertical:8,borderWidth:1,borderColor:colors.espresso},addButtonStacked:{alignSelf:"flex-start"},addButtonText:{fontWeight:"700",color:colors.espresso,fontSize:12},balanceList:{gap:spacing.sm,paddingVertical:spacing.md},balance:{width:160,padding:spacing.md,backgroundColor:colors.paper,borderLeftWidth:3,borderColor:colors.gold},balanceLarge:{width:220},balanceName:{color:colors.inkMuted,fontSize:11},balanceValue:{fontFamily:"serif",fontSize:29,color:colors.espresso,marginTop:5},balanceCopy:{color:colors.inkMuted,fontSize:10,marginTop:2},leaveForm:{gap:8,padding:spacing.md,borderWidth:1,borderColor:colors.line,backgroundColor:colors.paper,marginBottom:spacing.md},formLabel:{fontSize:11,fontWeight:"700",color:colors.inkMuted,marginTop:3},typeChoices:{flexDirection:"row",flexWrap:"wrap",gap:7},typeChoice:{minHeight:44,justifyContent:"center",paddingHorizontal:10,paddingVertical:8,borderWidth:1,borderColor:colors.line},typeChoiceSelected:{backgroundColor:colors.espresso,borderColor:colors.espresso},typeText:{color:colors.espresso,fontSize:12},typeTextSelected:{color:colors.white,fontSize:12,fontWeight:"700"},input:{minHeight:46,borderWidth:1,borderColor:colors.line,paddingHorizontal:12,paddingVertical:8,color:colors.espresso,backgroundColor:colors.ivory},reasonInput:{minHeight:76,paddingTop:11,textAlignVertical:"top"},submitButton:{minHeight:48,alignItems:"center",justifyContent:"center",paddingVertical:8,backgroundColor:colors.espresso,marginTop:5},submitText:{color:colors.white,fontWeight:"700"},leaveList:{marginTop:4},leaveRow:{paddingVertical:spacing.md,borderBottomWidth:1,borderColor:colors.line},leaveRowTop:{flexDirection:"row",flexWrap:"wrap",gap:spacing.sm,justifyContent:"space-between",alignItems:"center"},withdrawButton:{minHeight:44,alignSelf:"flex-start",justifyContent:"center",marginTop:6},withdrawText:{color:colors.ruby,fontWeight:"700",fontSize:11},subRule:{height:1,backgroundColor:colors.line,marginVertical:spacing.lg},
  dateInput:{minHeight:46,borderWidth:1,borderColor:colors.line,paddingHorizontal:12,paddingVertical:8,backgroundColor:colors.ivory,flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:spacing.sm},dateInputPressed:{backgroundColor:colors.ivoryDeep,transform:[{translateY:1}]},dateValue:{flex:1,color:colors.espresso,fontWeight:"600"},receiptButton:{minHeight:48,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:8,borderWidth:1,borderColor:colors.espresso},receiptText:{color:colors.espresso,fontWeight:"700"},ocrNote:{fontSize:10,color:colors.inkMuted,lineHeight:15},claimAmount:{fontFamily:"serif",fontSize:18,color:colors.emerald,marginTop:5},
});

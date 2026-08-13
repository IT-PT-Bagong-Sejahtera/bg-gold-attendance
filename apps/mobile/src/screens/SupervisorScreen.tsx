import { Ionicons } from "@expo/vector-icons";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { LoadingRows } from "../components/LoadingRows";
import { Screen } from "../components/Screen";
import { actionLabel } from "../lib/attendance";
import {
  api,
  type ApprovalDecision,
  type SupervisorAttendanceRequest,
  type SupervisorAttendanceReport,
  type SupervisorAttendanceReportStatus,
  type SupervisorAttendanceReportRow,
  type SupervisorClaim,
  type SupervisorLeaveRequest,
  type SupervisorShiftRequest,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatInstant } from "../lib/timezone";
import { colors, spacing } from "../theme";

type ApprovalKind = "attendance" | "leave" | "claim" | "shift";
type SupervisorView = "approvals" | "approved" | "report";
type AttendanceDetail =
  | { kind: "request"; item: SupervisorAttendanceRequest }
  | { kind: "report"; item: SupervisorAttendanceReportRow };

export function SupervisorScreen() {
  const token = useAuth().session!.accessToken;
  const [attendance, setAttendance] = useState<SupervisorAttendanceRequest[]>([]);
  const [leaves, setLeaves] = useState<SupervisorLeaveRequest[]>([]);
  const [claims, setClaims] = useState<SupervisorClaim[]>([]);
  const [shifts, setShifts] = useState<SupervisorShiftRequest[]>([]);
  const [approvedAttendance, setApprovedAttendance] = useState<SupervisorAttendanceRequest[]>([]);
  const [approvedLeaves, setApprovedLeaves] = useState<SupervisorLeaveRequest[]>([]);
  const [approvedClaims, setApprovedClaims] = useState<SupervisorClaim[]>([]);
  const [approvedShifts, setApprovedShifts] = useState<SupervisorShiftRequest[]>([]);
  const [timezone, setTimezone] = useState("Asia/Jakarta");
  const [view, setView] = useState<SupervisorView>("approvals");
  const [report, setReport] = useState<SupervisorAttendanceReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [approvedLoading, setApprovedLoading] = useState(false);
  const [attendanceDetail, setAttendanceDetail] = useState<AttendanceDetail | null>(null);
  const [exporting, setExporting] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [processing, setProcessing] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [me, attendanceItems, leaveItems, claimItems, shiftItems] =
        await Promise.all([
          api.me(token),
          api.supervisorAttendanceRequests(token),
          api.supervisorLeaveRequests(token),
          api.supervisorClaims(token),
          api.supervisorShiftRequests(token),
        ]);
      setTimezone(me.timezone);
      setAttendance(attendanceItems);
      setLeaves(leaveItems);
      setClaims(claimItems);
      setShifts(shiftItems);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Antrean persetujuan belum dapat dimuat.",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadApproved = useCallback(async () => {
    setApprovedLoading(true);
    setError("");
    try {
      const [attendanceItems, leaveItems, claimItems, shiftItems] = await Promise.all([
        api.supervisorAttendanceRequests(token, "APPROVED"),
        api.supervisorLeaveRequests(token, "APPROVED"),
        api.supervisorClaims(token, "APPROVED"),
        api.supervisorShiftRequests(token, "APPROVED"),
      ]);
      setApprovedAttendance(attendanceItems);
      setApprovedLeaves(leaveItems);
      setApprovedClaims(claimItems);
      setApprovedShifts(shiftItems);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Riwayat persetujuan belum dapat dimuat.");
    } finally {
      setApprovedLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadReport = useCallback(async () => {
    setReportLoading(true);
    setError("");
    try {
      setReport(await api.supervisorAttendanceReport(token));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Rekap absensi belum dapat dimuat.",
      );
    } finally {
      setReportLoading(false);
    }
  }, [token]);

  const total = useMemo(
    () => attendance.length + leaves.length + claims.length + shifts.length,
    [attendance.length, claims.length, leaves.length, shifts.length],
  );
  const approvedTotal = approvedAttendance.length + approvedLeaves.length + approvedClaims.length + approvedShifts.length;

  async function decide(
    kind: ApprovalKind,
    id: string,
    decision: ApprovalDecision,
  ) {
    const reason = (reasons[id] ?? "").trim();
    if (decision === "REJECTED" && !reason) {
      setError("Tuliskan alasan sebelum menolak permintaan.");
      return;
    }
    setProcessing(id);
    setError("");
    setNotice("");
    try {
      if (kind === "attendance") {
        await api.decideAttendanceRequest(token, id, decision, reason);
      } else if (kind === "leave") {
        await api.decideLeaveRequest(token, id, decision, reason);
      } else if (kind === "claim") {
        await api.decideClaim(token, id, decision, reason);
      } else {
        await api.decideShiftRequest(token, id, decision, reason);
      }
      setNotice(
        decision === "APPROVED"
          ? "Permintaan disetujui dan antrean diperbarui."
          : "Permintaan ditolak dengan catatan supervisor.",
      );
      setReasons((current) => ({ ...current, [id]: "" }));
      await Promise.all([load(), loadApproved()]);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Keputusan belum dapat disimpan.",
      );
    } finally {
      setProcessing("");
    }
  }

  function selectView(nextView: SupervisorView) {
    setView(nextView);
    setError("");
    setNotice("");
    if (nextView === "report" && !report && !reportLoading) {
      void loadReport();
    } else if (nextView === "approved" && approvedTotal === 0 && !approvedLoading) {
      void loadApproved();
    }
  }

  async function exportReport() {
    if (!report || exporting) return;
    setExporting(true);
    setError("");
    setNotice("");
    try {
      const { exportSupervisorAttendanceExcel } = await import(
        "../lib/exportAttendanceExcel"
      );
      const { fileName } = await exportSupervisorAttendanceExcel(report);
      setNotice(`${fileName} siap. Di dialog Android pilih Files → Download agar mudah ditemukan di folder Download.`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "File Excel gagal dibuat.",
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={view === "approvals" ? loading : view === "approved" ? approvedLoading : reportLoading}
            onRefresh={() =>
              void (view === "approvals" ? load() : view === "approved" ? loadApproved() : loadReport())
            }
            tintColor={colors.gold}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>SUPERVISOR</Text>
        <Text style={styles.title}>
          {view === "approvals" ? "Keputusan tim" : view === "approved" ? "Sudah disetujui" : "Hasil absensi"}
        </Text>
        <Text style={styles.copy}>
          {view === "approvals"
            ? "Tinjau konteks setiap permintaan sebelum memberikan keputusan."
            : view === "approved"
              ? "Riwayat keputusan yang telah selesai tetap tersimpan dan dapat diperiksa kembali."
            : "Pantau hasil kerja tim dan bawa seluruh rekap ke Excel."}
        </Text>

        <View accessibilityRole="tablist" style={styles.viewTabs}>
          <ViewTab
            active={view === "approved"}
            icon="checkmark-circle-outline"
            label="Disetujui"
            onPress={() => selectView("approved")}
          />
          <ViewTab
            active={view === "approvals"}
            icon="checkmark-done-outline"
            label="Persetujuan"
            onPress={() => selectView("approvals")}
          />
          <ViewTab
            active={view === "report"}
            icon="bar-chart-outline"
            label="Hasil absensi"
            onPress={() => selectView("report")}
          />
        </View>

        {error ? (
          <View accessibilityRole="alert" style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={20} color={colors.ruby} />
            <Text style={styles.feedbackCopy}>{error}</Text>
          </View>
        ) : null}
        {notice ? (
          <View accessibilityRole="alert" style={styles.noticeBox}>
            <Ionicons name="checkmark-circle-outline" size={20} color={colors.emerald} />
            <Text style={styles.feedbackCopy}>{notice}</Text>
          </View>
        ) : null}

        {view === "approvals" ? (
          <>
        <View style={styles.summary}>
          <View style={styles.summaryIcon}>
            <Ionicons name="checkmark-done-outline" size={26} color={colors.goldSoft} />
          </View>
          <View style={styles.summaryCopy}>
            <Text style={styles.summaryValue}>{total}</Text>
            <Text style={styles.summaryLabel}>menunggu persetujuan</Text>
          </View>
        </View>

        {loading && total === 0 ? (
          <LoadingRows label="Memuat antrean persetujuan" count={3} />
        ) : null}

        {!loading && total === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="sparkles-outline" size={30} color={colors.gold} />
            <Text style={styles.emptyTitle}>Semua sudah ditinjau</Text>
            <Text style={styles.emptyCopy}>
              Tarik layar ke bawah untuk memeriksa permintaan baru.
            </Text>
          </View>
        ) : null}

        {attendance.length ? (
          <ApprovalSection title="Absensi" count={attendance.length} icon="time-outline">
            {attendance.map((item) => (
              <ApprovalCard
                key={item.id}
                employeeName={item.employeeName}
                employeeNumber={item.employeeNumber}
                title={actionLabel(item.actionType)}
                detail={formatInstant(new Date(item.recordedAt), timezone, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                reason={item.reason}
                rejectionReason={reasons[item.id] ?? ""}
                processing={processing === item.id}
                onReasonChange={(value) =>
                  setReasons((current) => ({ ...current, [item.id]: value }))
                }
                onDecision={(decision) => void decide("attendance", item.id, decision)}
                onDetail={() => setAttendanceDetail({ kind: "request", item })}
              />
            ))}
          </ApprovalSection>
        ) : null}

        {leaves.length ? (
          <ApprovalSection title="Cuti" count={leaves.length} icon="calendar-outline">
            {leaves.map((item) => (
              <ApprovalCard
                key={item.id}
                employeeName={item.employeeName}
                employeeNumber={item.employeeNumber}
                title={item.leaveTypeName}
                detail={`${item.startsOn}–${item.endsOn} · ${item.totalDays} hari kerja`}
                reason={item.reason}
                rejectionReason={reasons[item.id] ?? ""}
                processing={processing === item.id}
                onReasonChange={(value) =>
                  setReasons((current) => ({ ...current, [item.id]: value }))
                }
                onDecision={(decision) => void decide("leave", item.id, decision)}
              />
            ))}
          </ApprovalSection>
        ) : null}

        {claims.length ? (
          <ApprovalSection title="Klaim" count={claims.length} icon="receipt-outline">
            {claims.map((item) => (
              <ApprovalCard
                key={item.id}
                employeeName={item.employeeName}
                employeeNumber={item.employeeNumber}
                title={item.title}
                detail={`${new Intl.NumberFormat("id-ID", {
                  style: "currency",
                  currency: item.currency,
                  maximumFractionDigits: 0,
                }).format(item.amount)} · ${item.claimTypeName}`}
                reason={item.notes}
                supportingCopy={
                  item.ocrStatus === "COMPLETE" && item.ocrResult
                    ? `OCR ${item.ocrResult.merchant ?? "struk"} · keyakinan ${Math.round(item.ocrResult.confidence * 100)}%`
                    : undefined
                }
                rejectionReason={reasons[item.id] ?? ""}
                processing={processing === item.id}
                onReasonChange={(value) =>
                  setReasons((current) => ({ ...current, [item.id]: value }))
                }
                onDecision={(decision) => void decide("claim", item.id, decision)}
              />
            ))}
          </ApprovalSection>
        ) : null}

        {shifts.length ? (
          <ApprovalSection title="Shift" count={shifts.length} icon="people-outline">
            {shifts.map((item) => (
              <ApprovalCard
                key={item.id}
                employeeName={item.employeeName}
                employeeNumber={item.employeeNumber}
                title={item.shiftTitle}
                detail="Permintaan mengambil open shift"
                reason={item.reason}
                rejectionReason={reasons[item.id] ?? ""}
                processing={processing === item.id}
                onReasonChange={(value) =>
                  setReasons((current) => ({ ...current, [item.id]: value }))
                }
                onDecision={(decision) => void decide("shift", item.id, decision)}
              />
            ))}
          </ApprovalSection>
        ) : null}
          </>
        ) : view === "approved" ? (
          <ApprovedRequests
            attendance={approvedAttendance}
            claims={approvedClaims}
            leaves={approvedLeaves}
            loading={approvedLoading}
            onAttendanceDetail={(item) => setAttendanceDetail({ kind: "request", item })}
            shifts={approvedShifts}
            timezone={timezone}
          />
        ) : (
          <AttendanceReport
            exporting={exporting}
            loading={reportLoading}
            onExport={() => void exportReport()}
            onOpenDetail={(item) => setAttendanceDetail({ kind: "report", item })}
            report={report}
          />
        )}
      </ScrollView>
      <AttendanceDetailModal
        detail={attendanceDetail}
        onClose={() => setAttendanceDetail(null)}
        timezone={timezone}
      />
    </Screen>
  );
}

function ViewTab({
  active,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.viewTab,
        active && styles.viewTabActive,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons
        name={icon}
        size={18}
        color={active ? colors.white : colors.inkMuted}
      />
      <Text style={[styles.viewTabText, active && styles.viewTabTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function AttendanceReport({
  report,
  loading,
  exporting,
  onExport,
  onOpenDetail,
}: {
  report: SupervisorAttendanceReport | null;
  loading: boolean;
  exporting: boolean;
  onExport(): void;
  onOpenDetail(item: SupervisorAttendanceReportRow): void;
}) {
  if (loading && !report) {
    return <LoadingRows label="Memuat hasil absensi tim" count={4} />;
  }
  if (!report) return null;

  const present = report.rows.filter((row) =>
    ["ON_TIME", "LATE", "WORKING"].includes(row.status),
  ).length;
  const late = report.rows.filter((row) => row.status === "LATE").length;
  const absent = report.rows.filter((row) => row.status === "ABSENT").length;

  return (
    <View style={styles.report}>
      <View style={styles.reportHero}>
        <View style={styles.reportHeroCopy}>
          <Text style={styles.reportEyebrow}>REKAP TERAKHIR</Text>
          <Text style={styles.reportDate}>{formatReportDate(report.date)}</Text>
          <Text style={styles.reportOrganization}>{report.organizationName}</Text>
        </View>
        <Pressable
          accessibilityLabel="Export Excel semua karyawan"
          accessibilityRole="button"
          accessibilityState={{ busy: exporting, disabled: exporting }}
          disabled={exporting}
          onPress={onExport}
          style={({ pressed }) => [
            styles.exportButton,
            pressed && styles.pressed,
          ]}
        >
          {exporting ? (
            <ActivityIndicator color={colors.espresso} />
          ) : (
            <Ionicons name="download-outline" size={20} color={colors.espresso} />
          )}
          <Text style={styles.exportButtonText}>
            {exporting ? "Membuat…" : "Export Excel"}
          </Text>
        </Pressable>
      </View>

      <View style={styles.reportStats}>
        <ReportStat label="Semua" value={report.rows.length} />
        <ReportStat label="Hadir" value={present} />
        <ReportStat label="Terlambat" value={late} />
        <ReportStat label="Tidak hadir" value={absent} />
      </View>

      <View style={styles.reportListHeader}>
        <Text style={styles.reportListTitle}>Semua karyawan</Text>
        <Text style={styles.reportListCount}>{report.rows.length} orang</Text>
      </View>

      {report.rows.map((row) => (
        <View key={row.membershipId} style={styles.reportCard}>
          <View style={styles.reportEmployeeRow}>
            <View style={styles.reportEmployeeCopy}>
              <Text style={styles.employeeName}>{row.employeeName}</Text>
              <Text style={styles.employeeNumber}>{row.employeeNumber}</Text>
            </View>
            <AttendanceStatus status={row.status} />
          </View>
          <Text style={styles.reportShift}>{row.shiftTitle}</Text>
          <Text style={styles.reportOutlet}>{row.sectionName}</Text>
          <View style={styles.timeGrid}>
            <TimeResult
              icon="log-in-outline"
              label="Masuk"
              value={row.clockInAt ? reportTime(row.clockInAt) : "—"}
            />
            <TimeResult
              icon="log-out-outline"
              label="Pulang"
              value={row.clockOutAt ? reportTime(row.clockOutAt) : "—"}
            />
            <TimeResult
              icon="hourglass-outline"
              label="Durasi"
              value={workDuration(row.workMinutes)}
            />
          </View>
          <Pressable
            accessibilityLabel={`Lihat detail absensi ${row.employeeName}`}
            accessibilityRole="button"
            onPress={() => onOpenDetail(row)}
            style={styles.detailButton}
          >
            <Text style={styles.detailButtonText}>Lihat detail absensi</Text>
            <Ionicons name="arrow-forward-outline" size={16} color={colors.espresso} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function ReportStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.reportStat}>
      <Text style={styles.reportStatValue}>{value}</Text>
      <Text style={styles.reportStatLabel}>{label}</Text>
    </View>
  );
}

function AttendanceStatus({
  status,
}: {
  status: SupervisorAttendanceReportStatus;
}) {
  const labels: Record<SupervisorAttendanceReportStatus, string> = {
    ON_TIME: "TEPAT WAKTU",
    LATE: "TERLAMBAT",
    ABSENT: "TIDAK HADIR",
    LEAVE: "CUTI",
    WORKING: "BEKERJA",
  };
  const tone =
    status === "ON_TIME" || status === "WORKING"
      ? styles.statusGood
      : status === "LATE"
        ? styles.statusLate
        : status === "LEAVE"
          ? styles.statusLeave
          : styles.statusAbsent;
  return <Text style={[styles.statusPill, tone]}>{labels[status]}</Text>;
}

function TimeResult({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.timeResult}>
      <Ionicons name={icon} size={17} color={colors.gold} />
      <View style={styles.timeResultCopy}>
        <Text style={styles.timeResultLabel}>{label}</Text>
        <Text style={styles.timeResultValue}>{value}</Text>
      </View>
    </View>
  );
}

function formatReportDate(date: string) {
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function reportTime(instant: string) {
  return formatInstant(new Date(instant), "Asia/Jakarta", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function workDuration(minutes: number) {
  if (minutes <= 0) return "—";
  return `${Math.floor(minutes / 60)}j ${minutes % 60}m`;
}

function ApprovalSection({
  title,
  count,
  icon,
  children,
}: {
  title: string;
  count: number;
  icon: keyof typeof Ionicons.glyphMap;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <Ionicons name={icon} size={19} color={colors.gold} />
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
        <Text style={styles.count}>{count}</Text>
      </View>
      {children}
    </View>
  );
}

function ApprovalCard({
  employeeName,
  employeeNumber,
  title,
  detail,
  reason,
  supportingCopy,
  rejectionReason,
  processing,
  onReasonChange,
  onDecision,
  onDetail,
}: {
  employeeName: string;
  employeeNumber: string;
  title: string;
  detail: string;
  reason?: string;
  supportingCopy?: string;
  rejectionReason: string;
  processing: boolean;
  onReasonChange(value: string): void;
  onDecision(decision: ApprovalDecision): void;
  onDetail?(): void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.employeeRow}>
        <View style={styles.employeeCopy}>
          <Text style={styles.employeeName}>{employeeName}</Text>
          <Text style={styles.employeeNumber}>{employeeNumber}</Text>
        </View>
        <Text style={styles.pending}>MENUNGGU</Text>
      </View>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
      {reason ? <Text style={styles.reason}>“{reason}”</Text> : null}
      {supportingCopy ? (
        <Text style={styles.supportingCopy}>{supportingCopy}</Text>
      ) : null}
      {onDetail ? (
        <Pressable
          accessibilityLabel={`Lihat detail absensi ${employeeName}`}
          accessibilityRole="button"
          onPress={onDetail}
          style={styles.detailButton}
        >
          <Text style={styles.detailButtonText}>Lihat detail absensi</Text>
          <Ionicons name="arrow-forward-outline" size={16} color={colors.espresso} />
        </Pressable>
      ) : null}
      <TextInput
        accessibilityLabel={`Catatan keputusan untuk ${employeeName}`}
        editable={!processing}
        maxLength={500}
        multiline
        onChangeText={onReasonChange}
        placeholder="Alasan penolakan (wajib jika ditolak)"
        style={styles.reasonInput}
        textAlignVertical="top"
        value={rejectionReason}
      />
      <View style={styles.actions}>
        <Pressable
          accessibilityLabel={`Tolak permintaan ${employeeName}`}
          accessibilityRole="button"
          accessibilityState={{ disabled: processing, busy: processing }}
          disabled={processing}
          onPress={() => onDecision("REJECTED")}
          style={({ pressed }) => [styles.rejectButton, pressed && styles.pressed]}
        >
          <Ionicons name="close-outline" size={18} color={colors.ruby} />
          <Text style={styles.rejectText}>Tolak</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={`Setujui permintaan ${employeeName}`}
          accessibilityRole="button"
          accessibilityState={{ disabled: processing, busy: processing }}
          disabled={processing}
          onPress={() => onDecision("APPROVED")}
          style={({ pressed }) => [styles.approveButton, pressed && styles.pressed]}
        >
          {processing ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Ionicons name="checkmark-outline" size={18} color={colors.white} />
          )}
          <Text style={styles.approveText}>
            {processing ? "Menyimpan…" : "Setujui"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function ApprovedRequests({
  attendance,
  claims,
  leaves,
  loading,
  onAttendanceDetail,
  shifts,
  timezone,
}: {
  attendance: SupervisorAttendanceRequest[];
  claims: SupervisorClaim[];
  leaves: SupervisorLeaveRequest[];
  loading: boolean;
  onAttendanceDetail(item: SupervisorAttendanceRequest): void;
  shifts: SupervisorShiftRequest[];
  timezone: string;
}) {
  const total = attendance.length + claims.length + leaves.length + shifts.length;
  if (loading && total === 0) return <LoadingRows label="Memuat daftar yang disetujui" count={3} />;
  if (total === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="archive-outline" size={30} color={colors.gold} />
        <Text style={styles.emptyTitle}>Belum ada riwayat persetujuan</Text>
        <Text style={styles.emptyCopy}>Item yang disetujui akan tetap tampil di sini.</Text>
      </View>
    );
  }
  return (
    <View>
      <View style={[styles.summary, styles.approvedSummary]}>
        <View style={styles.summaryIcon}><Ionicons name="checkmark-circle-outline" size={26} color={colors.goldSoft} /></View>
        <View style={styles.summaryCopy}><Text style={styles.summaryValue}>{total}</Text><Text style={styles.summaryLabel}>permintaan sudah disetujui</Text></View>
      </View>
      {attendance.length ? (
        <ApprovalSection title="Absensi" count={attendance.length} icon="time-outline">
          {attendance.map((item) => (
            <ApprovedCard
              key={item.id}
              employeeName={item.employeeName}
              employeeNumber={item.employeeNumber}
              title={actionLabel(item.actionType)}
              detail={formatInstant(new Date(item.recordedAt), timezone, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              note={item.decisionReason}
              onDetail={() => onAttendanceDetail(item)}
            />
          ))}
        </ApprovalSection>
      ) : null}
      {leaves.length ? <ApprovalSection title="Cuti" count={leaves.length} icon="calendar-outline">{leaves.map((item) => <ApprovedCard key={item.id} employeeName={item.employeeName} employeeNumber={item.employeeNumber} title={item.leaveTypeName} detail={`${item.startsOn}–${item.endsOn} · ${item.totalDays} hari`} note={item.decisionReason} />)}</ApprovalSection> : null}
      {claims.length ? <ApprovalSection title="Klaim" count={claims.length} icon="receipt-outline">{claims.map((item) => <ApprovedCard key={item.id} employeeName={item.employeeName} employeeNumber={item.employeeNumber} title={item.title} detail={new Intl.NumberFormat("id-ID", { style: "currency", currency: item.currency, maximumFractionDigits: 0 }).format(item.amount)} note={item.decisionReason} />)}</ApprovalSection> : null}
      {shifts.length ? <ApprovalSection title="Shift" count={shifts.length} icon="people-outline">{shifts.map((item) => <ApprovedCard key={item.id} employeeName={item.employeeName} employeeNumber={item.employeeNumber} title={item.shiftTitle} detail="Permintaan mengambil open shift" note={item.decisionReason} />)}</ApprovalSection> : null}
    </View>
  );
}

function ApprovedCard({ employeeName, employeeNumber, title, detail, note, onDetail }: { employeeName: string; employeeNumber: string; title: string; detail: string; note?: string; onDetail?(): void }) {
  return (
    <View style={styles.card}>
      <View style={styles.employeeRow}><View style={styles.employeeCopy}><Text style={styles.employeeName}>{employeeName}</Text><Text style={styles.employeeNumber}>{employeeNumber}</Text></View><Text style={styles.approvedPill}>DISETUJUI</Text></View>
      <Text style={styles.cardTitle}>{title}</Text><Text style={styles.detail}>{detail}</Text>
      {note ? <Text style={styles.reason}>Catatan: {note}</Text> : null}
      {onDetail ? <Pressable accessibilityLabel={`Lihat detail absensi ${employeeName}`} accessibilityRole="button" onPress={onDetail} style={styles.detailButton}><Text style={styles.detailButtonText}>Lihat detail absensi</Text><Ionicons name="arrow-forward-outline" size={16} color={colors.espresso} /></Pressable> : null}
    </View>
  );
}

function AttendanceDetailModal({ detail, onClose, timezone }: { detail: AttendanceDetail | null; onClose(): void; timezone: string }) {
  const item = detail?.item;
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={Boolean(detail)}>
      <View style={styles.modalBackdrop}>
        <View style={styles.detailSheet}>
          <View style={styles.detailHeader}><View><Text style={styles.eyebrow}>DETAIL ABSENSI</Text><Text style={styles.detailTitle}>{item?.employeeName ?? ""}</Text></View><Pressable accessibilityLabel="Tutup detail absensi" accessibilityRole="button" onPress={onClose} style={styles.closeButton}><Ionicons name="close-outline" size={24} color={colors.espresso} /></Pressable></View>
          {detail ? (
            <ScrollView contentContainerStyle={styles.detailContent}>
              <DetailLine label="Nomor karyawan" value={detail.item.employeeNumber} />
              {detail.kind === "request" ? (
                <>
                  <DetailLine label="Tindakan" value={actionLabel(detail.item.actionType)} />
                  <DetailLine label="Waktu tercatat" value={formatInstant(new Date(detail.item.recordedAt), timezone, { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })} />
                  <DetailLine label="Status" value={detail.item.status === "APPROVED" ? "Disetujui" : detail.item.status === "PENDING" ? "Menunggu" : detail.item.status} />
                  <DetailLine label="Sumber" value={detail.item.source ?? "Mobile"} />
                  <DetailLine label="Lokasi GPS" value={detail.item.latitude !== undefined && detail.item.longitude !== undefined ? `${detail.item.latitude.toFixed(6)}, ${detail.item.longitude.toFixed(6)}` : "Tidak tersedia"} />
                  <DetailLine label="Akurasi" value={detail.item.accuracyM !== undefined ? `${Math.round(detail.item.accuracyM)} meter` : "Tidak tersedia"} />
                  <DetailLine label="Bukti foto" value={detail.item.attachmentId ? "Tersimpan sebagai bukti privat" : "Tidak ada foto"} />
                  <DetailLine label="Alasan karyawan" value={detail.item.reason || "—"} />
                  <DetailLine label="Catatan keputusan" value={detail.item.decisionReason || "—"} />
                </>
              ) : (
                <>
                  <DetailLine label="Shift" value={detail.item.shiftTitle} />
                  <DetailLine label="Lokasi" value={detail.item.sectionName} />
                  <DetailLine label="Jadwal" value={`${reportTime(detail.item.shiftStartsAt)}–${reportTime(detail.item.shiftEndsAt)}`} />
                  <DetailLine label="Clock-in" value={detail.item.clockInAt ? reportTime(detail.item.clockInAt) : "Belum tercatat"} />
                  <DetailLine label="Clock-out" value={detail.item.clockOutAt ? reportTime(detail.item.clockOutAt) : "Belum tercatat"} />
                  <DetailLine label="Durasi" value={workDuration(detail.item.workMinutes)} />
                  <DetailLine label="Status" value={detail.item.status.replaceAll("_", " ")} />
                </>
              )}
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return <View style={styles.detailLine}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: 120 },
  eyebrow: {
    color: "#8A6C2D",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.8,
  },
  title: {
    color: colors.espresso,
    fontFamily: "serif",
    fontSize: 32,
    marginTop: 6,
  },
  copy: { color: colors.inkMuted, lineHeight: 21, marginTop: 7 },
  viewTabs: {
    backgroundColor: "#EEE8E1",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: spacing.lg,
    padding: 4,
  },
  viewTab: {
    alignItems: "center",
    flexDirection: "row",
    flexGrow: 1,
    flexShrink: 1,
    gap: 7,
    justifyContent: "center",
    minHeight: 46,
    minWidth: 140,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  viewTabActive: { backgroundColor: colors.espresso },
  viewTabText: { color: colors.inkMuted, fontWeight: "800" },
  viewTabTextActive: { color: colors.white },
  summary: {
    alignItems: "center",
    backgroundColor: colors.espresso,
    borderRadius: 16,
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  approvedSummary: { backgroundColor: "#173F2B" },
  summaryIcon: {
    alignItems: "center",
    backgroundColor: "#463028",
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  summaryCopy: { flex: 1, minWidth: 0 },
  summaryValue: { color: colors.white, fontFamily: "serif", fontSize: 30 },
  summaryLabel: { color: "#D7C9BE", marginTop: 2 },
  errorBox: {
    alignItems: "flex-start",
    backgroundColor: "#FBEFEF",
    borderLeftColor: colors.ruby,
    borderLeftWidth: 3,
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  noticeBox: {
    alignItems: "flex-start",
    backgroundColor: "#EAF4EE",
    borderLeftColor: colors.emerald,
    borderLeftWidth: 3,
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  feedbackCopy: { color: colors.espresso, flex: 1, lineHeight: 20 },
  empty: { alignItems: "center", gap: 8, padding: spacing.xxl },
  emptyTitle: { color: colors.espresso, fontWeight: "700" },
  emptyCopy: { color: colors.inkMuted, textAlign: "center" },
  report: { marginTop: spacing.lg },
  reportHero: {
    alignItems: "flex-start",
    backgroundColor: colors.espresso,
    borderRadius: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
    justifyContent: "space-between",
    padding: spacing.lg,
  },
  reportHeroCopy: { flexGrow: 1, flexShrink: 1, minWidth: 190 },
  reportEyebrow: {
    color: colors.goldSoft,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  reportDate: {
    color: colors.white,
    fontFamily: "serif",
    fontSize: 23,
    lineHeight: 30,
    marginTop: 6,
  },
  reportOrganization: { color: "#D7C9BE", lineHeight: 20, marginTop: 5 },
  exportButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.goldSoft,
    flexDirection: "row",
    flexGrow: 1,
    gap: 8,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 165,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  exportButtonText: { color: colors.espresso, fontWeight: "900" },
  reportStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  reportStat: {
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 120,
    padding: spacing.md,
  },
  reportStatValue: { color: colors.espresso, fontFamily: "serif", fontSize: 25 },
  reportStatLabel: { color: colors.inkMuted, fontSize: 11, marginTop: 2 },
  reportListHeader: {
    alignItems: "flex-end",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
    marginTop: spacing.xl,
    paddingBottom: spacing.sm,
  },
  reportListTitle: { color: colors.espresso, fontFamily: "serif", fontSize: 23 },
  reportListCount: { color: colors.inkMuted, fontSize: 12 },
  reportCard: {
    backgroundColor: colors.paper,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    paddingVertical: spacing.lg,
  },
  reportEmployeeRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  reportEmployeeCopy: { flexGrow: 1, flexShrink: 1, minWidth: 160 },
  statusPill: {
    fontSize: 9,
    fontWeight: "900",
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  statusGood: { backgroundColor: "#E3F1E8", color: "#23633A" },
  statusLate: { backgroundColor: "#F8EDCA", color: "#755614" },
  statusLeave: { backgroundColor: "#E7EDF7", color: "#34527B" },
  statusAbsent: { backgroundColor: "#F8E6E6", color: colors.ruby },
  reportShift: {
    color: colors.espresso,
    fontFamily: "serif",
    fontSize: 19,
    marginTop: spacing.md,
  },
  reportOutlet: { color: colors.inkMuted, marginTop: 3 },
  timeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  timeResult: {
    alignItems: "center",
    backgroundColor: colors.ivory,
    flexDirection: "row",
    flexGrow: 1,
    gap: 8,
    minWidth: 110,
    padding: spacing.sm,
  },
  timeResultCopy: { flexShrink: 1, minWidth: 0 },
  timeResultLabel: { color: colors.inkMuted, fontSize: 10 },
  timeResultValue: { color: colors.espresso, fontWeight: "800", marginTop: 2 },
  section: { marginTop: spacing.xl },
  sectionHeader: {
    alignItems: "center",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: spacing.sm,
  },
  sectionTitleRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  sectionTitle: { color: colors.espresso, fontFamily: "serif", fontSize: 23 },
  count: {
    backgroundColor: "#F6EBCB",
    color: "#725718",
    fontWeight: "800",
    minWidth: 30,
    paddingHorizontal: 8,
    paddingVertical: 5,
    textAlign: "center",
  },
  card: {
    backgroundColor: colors.paper,
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    paddingVertical: spacing.lg,
  },
  employeeRow: {
    alignItems: "flex-start",
    flexDirection: "column",
    gap: spacing.sm,
  },
  employeeCopy: { flexGrow: 1, flexShrink: 1, minWidth: 150 },
  employeeName: { color: colors.espresso, fontWeight: "800" },
  employeeNumber: { color: colors.inkMuted, fontSize: 11, marginTop: 2 },
  pending: {
    alignSelf: "flex-start",
    backgroundColor: "#F7EECF",
    color: "#7A5B16",
    fontSize: 9,
    fontWeight: "800",
    paddingHorizontal: 7,
    paddingVertical: 5,
  },
  approvedPill: {
    alignSelf: "flex-start",
    backgroundColor: "#E3F1E8",
    color: "#23633A",
    fontSize: 9,
    fontWeight: "900",
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  cardTitle: {
    color: colors.espresso,
    fontFamily: "serif",
    fontSize: 21,
    marginTop: spacing.md,
  },
  detail: { color: colors.inkMuted, lineHeight: 19, marginTop: 4 },
  reason: { color: colors.espresso, lineHeight: 20, marginTop: spacing.sm },
  supportingCopy: {
    color: colors.emerald,
    fontSize: 11,
    lineHeight: 17,
    marginTop: spacing.sm,
  },
  detailButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderBottomColor: colors.gold,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 7,
    marginTop: spacing.md,
    minHeight: 44,
    paddingVertical: 9,
  },
  detailButtonText: { color: colors.espresso, fontSize: 12, fontWeight: "800" },
  reasonInput: {
    backgroundColor: colors.ivory,
    borderColor: colors.line,
    borderWidth: 1,
    color: colors.espresso,
    marginTop: spacing.md,
    minHeight: 72,
    padding: spacing.md,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  rejectButton: {
    alignItems: "center",
    borderColor: colors.ruby,
    borderWidth: 1,
    flexDirection: "row",
    flexGrow: 1,
    gap: 7,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 130,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  approveButton: {
    alignItems: "center",
    backgroundColor: colors.espresso,
    flexDirection: "row",
    flexGrow: 1,
    gap: 7,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 130,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rejectText: { color: colors.ruby, fontWeight: "800" },
  approveText: { color: colors.white, fontWeight: "800" },
  pressed: { opacity: 0.82 },
  modalBackdrop: { backgroundColor: "rgba(25,14,10,0.48)", flex: 1, justifyContent: "flex-end" },
  detailSheet: { backgroundColor: colors.paper, maxHeight: "88%", paddingTop: spacing.lg },
  detailHeader: { alignItems: "flex-start", borderBottomColor: colors.line, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  detailTitle: { color: colors.espresso, fontFamily: "serif", fontSize: 26, marginTop: 5 },
  closeButton: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  detailContent: { paddingHorizontal: spacing.lg, paddingBottom: 48 },
  detailLine: { borderBottomColor: colors.line, borderBottomWidth: 1, paddingVertical: spacing.md },
  detailLabel: { color: colors.inkMuted, fontSize: 10, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase" },
  detailValue: { color: colors.espresso, lineHeight: 20, marginTop: 5 },
});

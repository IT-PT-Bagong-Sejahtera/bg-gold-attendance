import { Ionicons } from "@expo/vector-icons";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ImageSourcePropType,
} from "react-native";
import { LoadingRows } from "../components/LoadingRows";
import { TutorialLauncher } from "../components/GuidedTutorial";
import { Screen } from "../components/Screen";
import { actionLabel } from "../lib/attendance";
import {
  api,
  type AttendanceEvidenceDetail,
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
import { demoEvidenceImage } from "../lib/demoEvidence";
import { formatInstant } from "../lib/timezone";
import { colors, spacing } from "../theme";

type ApprovalKind = "attendance" | "leave" | "claim" | "shift";
type SupervisorView = "approvals" | "approved" | "report";
type AttendanceDetail =
  | { kind: "request"; item: SupervisorAttendanceRequest }
  | { kind: "report"; item: SupervisorAttendanceReportRow };

export function SupervisorScreen() {
  const token = useAuth().session!.accessToken;
  const [attendance, setAttendance] = useState<SupervisorAttendanceRequest[]>(
    [],
  );
  const [leaves, setLeaves] = useState<SupervisorLeaveRequest[]>([]);
  const [claims, setClaims] = useState<SupervisorClaim[]>([]);
  const [shifts, setShifts] = useState<SupervisorShiftRequest[]>([]);
  const [approvedAttendance, setApprovedAttendance] = useState<
    SupervisorAttendanceRequest[]
  >([]);
  const [approvedLeaves, setApprovedLeaves] = useState<
    SupervisorLeaveRequest[]
  >([]);
  const [approvedClaims, setApprovedClaims] = useState<SupervisorClaim[]>([]);
  const [approvedShifts, setApprovedShifts] = useState<
    SupervisorShiftRequest[]
  >([]);
  const [timezone, setTimezone] = useState("Asia/Jakarta");
  const [view, setView] = useState<SupervisorView>("approvals");
  const [report, setReport] = useState<SupervisorAttendanceReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [approvedLoading, setApprovedLoading] = useState(false);
  const [attendanceDetail, setAttendanceDetail] =
    useState<AttendanceDetail | null>(null);
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
      const [attendanceItems, leaveItems, claimItems, shiftItems] =
        await Promise.all([
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
      setError(
        cause instanceof Error
          ? cause.message
          : "Riwayat persetujuan belum dapat dimuat.",
      );
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
  const approvedTotal =
    approvedAttendance.length +
    approvedLeaves.length +
    approvedClaims.length +
    approvedShifts.length;

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
    } else if (
      nextView === "approved" &&
      approvedTotal === 0 &&
      !approvedLoading
    ) {
      void loadApproved();
    }
  }

  async function exportReport() {
    if (!report || exporting) return;
    setExporting(true);
    setError("");
    setNotice("");
    try {
      const { exportSupervisorAttendanceExcel } =
        await import("../lib/exportAttendanceExcel");
      const { fileName } = await exportSupervisorAttendanceExcel(report);
      setNotice(
        `${fileName} siap. Di dialog Android pilih Files → Download agar mudah ditemukan di folder Download.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "File Excel gagal dibuat.",
      );
    } finally {
      setExporting(false);
    }
  }

  const supervisorTabsRef = useRef<View>(null);
  const supervisorWorkspaceRef = useRef<View>(null);
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={
              view === "approvals"
                ? loading
                : view === "approved"
                  ? approvedLoading
                  : reportLoading
            }
            onRefresh={() =>
              void (view === "approvals"
                ? load()
                : view === "approved"
                  ? loadApproved()
                  : loadReport())
            }
            tintColor={colors.gold}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>SUPERVISOR</Text>
        <Text style={styles.title}>
          {view === "approvals"
            ? "Keputusan tim"
            : view === "approved"
              ? "Sudah disetujui"
              : "Hasil absensi"}
        </Text>
        <Text style={styles.copy}>
          {view === "approvals"
            ? "Tinjau konteks setiap permintaan sebelum memberikan keputusan."
            : view === "approved"
              ? "Riwayat keputusan yang telah selesai tetap tersimpan dan dapat diperiksa kembali."
              : "Pantau hasil kerja tim dan bawa seluruh rekap ke Excel."}
        </Text>

        <View ref={supervisorTabsRef} collapsable={false} accessibilityRole="tablist" style={styles.viewTabs}>
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

        <View ref={supervisorWorkspaceRef} collapsable={false}>
        {error ? (
          <View accessibilityRole="alert" style={styles.errorBox}>
            <Ionicons
              name="alert-circle-outline"
              size={20}
              color={colors.ruby}
            />
            <Text style={styles.feedbackCopy}>{error}</Text>
          </View>
        ) : null}
        {notice ? (
          <View accessibilityRole="alert" style={styles.noticeBox}>
            <Ionicons
              name="checkmark-circle-outline"
              size={20}
              color={colors.emerald}
            />
            <Text style={styles.feedbackCopy}>{notice}</Text>
          </View>
        ) : null}

        {view === "approvals" ? (
          <>
            <View style={styles.summary}>
              <View style={styles.summaryIcon}>
                <Ionicons
                  name="checkmark-done-outline"
                  size={26}
                  color={colors.goldSoft}
                />
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
                <Ionicons
                  name="sparkles-outline"
                  size={30}
                  color={colors.gold}
                />
                <Text style={styles.emptyTitle}>Semua sudah ditinjau</Text>
                <Text style={styles.emptyCopy}>
                  Tarik layar ke bawah untuk memeriksa permintaan baru.
                </Text>
              </View>
            ) : null}

            {attendance.length ? (
              <ApprovalSection
                title="Absensi"
                count={attendance.length}
                icon="time-outline"
              >
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
                      setReasons((current) => ({
                        ...current,
                        [item.id]: value,
                      }))
                    }
                    onDecision={(decision) =>
                      void decide("attendance", item.id, decision)
                    }
                    onDetail={() =>
                      setAttendanceDetail({ kind: "request", item })
                    }
                  />
                ))}
              </ApprovalSection>
            ) : null}

            {leaves.length ? (
              <ApprovalSection
                title="Cuti"
                count={leaves.length}
                icon="calendar-outline"
              >
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
                      setReasons((current) => ({
                        ...current,
                        [item.id]: value,
                      }))
                    }
                    onDecision={(decision) =>
                      void decide("leave", item.id, decision)
                    }
                  />
                ))}
              </ApprovalSection>
            ) : null}

            {claims.length ? (
              <ApprovalSection
                title="Klaim"
                count={claims.length}
                icon="receipt-outline"
              >
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
                      setReasons((current) => ({
                        ...current,
                        [item.id]: value,
                      }))
                    }
                    onDecision={(decision) =>
                      void decide("claim", item.id, decision)
                    }
                  />
                ))}
              </ApprovalSection>
            ) : null}

            {shifts.length ? (
              <ApprovalSection
                title="Shift"
                count={shifts.length}
                icon="people-outline"
              >
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
                      setReasons((current) => ({
                        ...current,
                        [item.id]: value,
                      }))
                    }
                    onDecision={(decision) =>
                      void decide("shift", item.id, decision)
                    }
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
            onAttendanceDetail={(item) =>
              setAttendanceDetail({ kind: "request", item })
            }
            shifts={approvedShifts}
            timezone={timezone}
          />
        ) : (
          <AttendanceReport
            exporting={exporting}
            loading={reportLoading}
            onExport={() => void exportReport()}
            onOpenDetail={(item) =>
              setAttendanceDetail({ kind: "report", item })
            }
            report={report}
          />
        )}
        </View>
      </ScrollView>
      <TutorialLauncher
        accessibilityLabel="Buka tutorial Persetujuan"
        steps={[
          {
            target: supervisorTabsRef,
            title: "Pilih pekerjaan supervisor",
            body: "Gunakan Disetujui untuk riwayat keputusan, Persetujuan untuk antrean baru, dan Hasil absensi untuk rekap seluruh karyawan.",
          },
          {
            target: supervisorWorkspaceRef,
            title: "Tinjau, putuskan, dan ekspor",
            body: "Buka detail sebelum menyetujui atau menolak. Pada Hasil absensi, gunakan Ekspor Excel untuk mengunduh rekap semua karyawan.",
          },
        ]}
      />
      <AttendanceDetailModal
        detail={attendanceDetail}
        onClose={() => setAttendanceDetail(null)}
        token={token}
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
          <Text style={styles.reportOrganization}>
            {report.organizationName}
          </Text>
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
            <Ionicons
              name="download-outline"
              size={20}
              color={colors.espresso}
            />
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
            <Ionicons
              name="arrow-forward-outline"
              size={16}
              color={colors.espresso}
            />
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
          <Ionicons
            name="arrow-forward-outline"
            size={16}
            color={colors.espresso}
          />
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
          style={({ pressed }) => [
            styles.rejectButton,
            pressed && styles.pressed,
          ]}
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
          style={({ pressed }) => [
            styles.approveButton,
            pressed && styles.pressed,
          ]}
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
  const total =
    attendance.length + claims.length + leaves.length + shifts.length;
  if (loading && total === 0)
    return <LoadingRows label="Memuat daftar yang disetujui" count={3} />;
  if (total === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="archive-outline" size={30} color={colors.gold} />
        <Text style={styles.emptyTitle}>Belum ada riwayat persetujuan</Text>
        <Text style={styles.emptyCopy}>
          Item yang disetujui akan tetap tampil di sini.
        </Text>
      </View>
    );
  }
  return (
    <View>
      <View style={[styles.summary, styles.approvedSummary]}>
        <View style={styles.summaryIcon}>
          <Ionicons
            name="checkmark-circle-outline"
            size={26}
            color={colors.goldSoft}
          />
        </View>
        <View style={styles.summaryCopy}>
          <Text style={styles.summaryValue}>{total}</Text>
          <Text style={styles.summaryLabel}>permintaan sudah disetujui</Text>
        </View>
      </View>
      {attendance.length ? (
        <ApprovalSection
          title="Absensi"
          count={attendance.length}
          icon="time-outline"
        >
          {attendance.map((item) => (
            <ApprovedCard
              key={item.id}
              employeeName={item.employeeName}
              employeeNumber={item.employeeNumber}
              title={actionLabel(item.actionType)}
              detail={formatInstant(new Date(item.recordedAt), timezone, {
                day: "numeric",
                month: "long",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
              note={item.decisionReason}
              onDetail={() => onAttendanceDetail(item)}
            />
          ))}
        </ApprovalSection>
      ) : null}
      {leaves.length ? (
        <ApprovalSection
          title="Cuti"
          count={leaves.length}
          icon="calendar-outline"
        >
          {leaves.map((item) => (
            <ApprovedCard
              key={item.id}
              employeeName={item.employeeName}
              employeeNumber={item.employeeNumber}
              title={item.leaveTypeName}
              detail={`${item.startsOn}–${item.endsOn} · ${item.totalDays} hari`}
              note={item.decisionReason}
            />
          ))}
        </ApprovalSection>
      ) : null}
      {claims.length ? (
        <ApprovalSection
          title="Klaim"
          count={claims.length}
          icon="receipt-outline"
        >
          {claims.map((item) => (
            <ApprovedCard
              key={item.id}
              employeeName={item.employeeName}
              employeeNumber={item.employeeNumber}
              title={item.title}
              detail={new Intl.NumberFormat("id-ID", {
                style: "currency",
                currency: item.currency,
                maximumFractionDigits: 0,
              }).format(item.amount)}
              note={item.decisionReason}
            />
          ))}
        </ApprovalSection>
      ) : null}
      {shifts.length ? (
        <ApprovalSection
          title="Shift"
          count={shifts.length}
          icon="people-outline"
        >
          {shifts.map((item) => (
            <ApprovedCard
              key={item.id}
              employeeName={item.employeeName}
              employeeNumber={item.employeeNumber}
              title={item.shiftTitle}
              detail="Permintaan mengambil open shift"
              note={item.decisionReason}
            />
          ))}
        </ApprovalSection>
      ) : null}
    </View>
  );
}

function ApprovedCard({
  employeeName,
  employeeNumber,
  title,
  detail,
  note,
  onDetail,
}: {
  employeeName: string;
  employeeNumber: string;
  title: string;
  detail: string;
  note?: string;
  onDetail?(): void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.employeeRow}>
        <View style={styles.employeeCopy}>
          <Text style={styles.employeeName}>{employeeName}</Text>
          <Text style={styles.employeeNumber}>{employeeNumber}</Text>
        </View>
        <Text style={styles.approvedPill}>DISETUJUI</Text>
      </View>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
      {note ? <Text style={styles.reason}>Catatan: {note}</Text> : null}
      {onDetail ? (
        <Pressable
          accessibilityLabel={`Lihat detail absensi ${employeeName}`}
          accessibilityRole="button"
          onPress={onDetail}
          style={styles.detailButton}
        >
          <Text style={styles.detailButtonText}>Lihat detail absensi</Text>
          <Ionicons
            name="arrow-forward-outline"
            size={16}
            color={colors.espresso}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

function AttendanceDetailModal({
  detail,
  onClose,
  timezone,
  token,
}: {
  detail: AttendanceDetail | null;
  onClose(): void;
  timezone: string;
  token: string;
}) {
  const [eventPart, setEventPart] = useState<"in" | "out">("in");
  const [evidence, setEvidence] = useState<AttendanceEvidenceDetail | null>(
    null,
  );
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState("");
  const item = detail?.item;
  const eventId =
    detail?.kind === "request"
      ? detail.item.eventId
      : eventPart === "in"
        ? detail?.item.clockInEventId
        : detail?.item.clockOutEventId;

  useEffect(() => {
    setEventPart(
      detail?.kind === "report" &&
        !detail.item.clockInEventId &&
        detail.item.clockOutEventId
        ? "out"
        : "in",
    );
    setEvidence(null);
    setEvidenceError("");
  }, [detail]);

  useEffect(() => {
    let active = true;
    setEvidence(null);
    setEvidenceError("");
    if (!detail || !eventId) {
      setEvidenceLoading(false);
      return () => {
        active = false;
      };
    }
    setEvidenceLoading(true);
    void api
      .attendanceEvidence(token, eventId)
      .then((value) => {
        if (active) setEvidence(value);
      })
      .catch((cause) => {
        if (active)
          setEvidenceError(
            cause instanceof Error
              ? cause.message
              : "Bukti absensi belum dapat dimuat.",
          );
      })
      .finally(() => {
        if (active) setEvidenceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [detail, eventId, token]);

  const fallbackRequest = detail?.kind === "request" ? detail.item : null;
  const latitude = evidence?.location?.latitude ?? fallbackRequest?.latitude;
  const longitude = evidence?.location?.longitude ?? fallbackRequest?.longitude;
  const accuracy = evidence?.location?.accuracyM ?? fallbackRequest?.accuracyM;
  const imageSource: ImageSourcePropType | undefined = evidence?.attachment?.url
    ? (demoEvidenceImage(evidence.attachment.url) ?? {
        uri: evidence.attachment.url,
      })
    : undefined;
  const status =
    detail?.kind === "request" ? detail.item.status : evidence?.decision;
  const canSwitchEvents =
    detail?.kind === "report" &&
    Boolean(detail.item.clockInEventId || detail.item.clockOutEventId);

  async function openMap() {
    if (latitude === undefined || longitude === undefined) return;
    await Linking.openURL(
      `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`,
    );
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={Boolean(detail)}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.detailSheet}>
          <View style={styles.detailHeader}>
            <View style={styles.detailHeaderCopy}>
              <Text style={styles.eyebrow}>DETAIL ABSENSI</Text>
              <Text style={styles.detailTitle}>{item?.employeeName ?? ""}</Text>
              <Text style={styles.detailEmployeeNumber}>
                {item?.employeeNumber ?? ""}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Tutup detail absensi"
              accessibilityRole="button"
              onPress={onClose}
              style={styles.closeButton}
            >
              <Ionicons
                name="close-outline"
                size={24}
                color={colors.espresso}
              />
            </Pressable>
          </View>
          {detail ? (
            <ScrollView
              contentContainerStyle={styles.detailContent}
              showsVerticalScrollIndicator={false}
            >
              {detail.kind === "report" ? (
                <View style={styles.shiftSummary}>
                  <View style={styles.shiftSummaryTop}>
                    <View style={styles.shiftIcon}>
                      <Ionicons
                        name="calendar-clear-outline"
                        size={20}
                        color={colors.gold}
                      />
                    </View>
                    <View style={styles.shiftSummaryCopy}>
                      <Text style={styles.shiftSummaryTitle}>
                        {detail.item.shiftTitle}
                      </Text>
                      <Text style={styles.shiftSummaryOutlet}>
                        {detail.item.sectionName}
                      </Text>
                    </View>
                    <AttendanceStatus status={detail.item.status} />
                  </View>
                  <View style={styles.shiftSummaryTimes}>
                    <Text style={styles.shiftSummaryTime}>
                      {reportTime(detail.item.shiftStartsAt)}–
                      {reportTime(detail.item.shiftEndsAt)}
                    </Text>
                    <Text style={styles.shiftSummaryDuration}>
                      {workDuration(detail.item.workMinutes)}
                    </Text>
                  </View>
                </View>
              ) : null}

              {canSwitchEvents ? (
                <View accessibilityRole="tablist" style={styles.evidenceTabs}>
                  <EvidenceTab
                    disabled={!detail.item.clockInEventId}
                    label={`Masuk ${detail.item.clockInAt ? reportTime(detail.item.clockInAt) : "—"}`}
                    active={eventPart === "in"}
                    onPress={() => setEventPart("in")}
                  />
                  <EvidenceTab
                    disabled={!detail.item.clockOutEventId}
                    label={`Pulang ${detail.item.clockOutAt ? reportTime(detail.item.clockOutAt) : "—"}`}
                    active={eventPart === "out"}
                    onPress={() => setEventPart("out")}
                  />
                </View>
              ) : null}

              <View style={styles.evidenceHeading}>
                <View>
                  <Text style={styles.evidenceEyebrow}>BUKTI KEHADIRAN</Text>
                  <Text style={styles.evidenceTitle}>
                    {actionLabel(
                      (evidence?.actionType ??
                        (detail.kind === "request"
                          ? detail.item.actionType
                          : eventPart === "in"
                            ? "CLOCK_IN"
                            : "CLOCK_OUT")) as never,
                    )}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.detailStatus,
                    status === "APPROVED"
                      ? styles.detailStatusGood
                      : status === "PENDING"
                        ? styles.detailStatusPending
                        : styles.detailStatusBad,
                  ]}
                >
                  {status === "APPROVED"
                    ? "DISETUJUI"
                    : status === "PENDING"
                      ? "MENUNGGU"
                      : (status ?? "BELUM ADA")}
                </Text>
              </View>

              {evidenceLoading ? (
                <View style={styles.evidenceLoading}>
                  <ActivityIndicator color={colors.gold} />
                  <Text style={styles.evidenceLoadingText}>
                    Membuka bukti privat…
                  </Text>
                </View>
              ) : null}
              {evidenceError ? (
                <View style={styles.evidenceError}>
                  <Ionicons
                    name="cloud-offline-outline"
                    size={20}
                    color={colors.ruby}
                  />
                  <Text style={styles.evidenceErrorText}>{evidenceError}</Text>
                </View>
              ) : null}

              {imageSource ? (
                <View style={styles.photoCard}>
                  <Image
                    accessibilityLabel={`Foto bukti absensi ${item?.employeeName ?? "karyawan"}`}
                    resizeMode="cover"
                    source={imageSource}
                    style={styles.evidencePhoto}
                  />
                  <View style={styles.photoCaption}>
                    <View style={styles.photoCaptionCopy}>
                      <Text style={styles.photoLabel}>SELFIE ABSENSI</Text>
                      <Text style={styles.photoMeta}>
                        {evidence?.attachment
                          ? `${evidence.attachment.contentType.replace("image/", "").toUpperCase()} · ${formatFileSize(evidence.attachment.sizeBytes)}`
                          : "Bukti privat"}
                      </Text>
                    </View>
                    <View style={styles.privateBadge}>
                      <Ionicons
                        name="lock-closed-outline"
                        size={13}
                        color={colors.emerald}
                      />
                      <Text style={styles.privateBadgeText}>PRIVAT</Text>
                    </View>
                  </View>
                </View>
              ) : !evidenceLoading ? (
                <View style={styles.noPhoto}>
                  <Ionicons
                    name="image-outline"
                    size={25}
                    color={colors.inkMuted}
                  />
                  <View style={styles.noPhotoCopy}>
                    <Text style={styles.noPhotoTitle}>Foto tidak tersedia</Text>
                    <Text style={styles.noPhotoText}>
                      {eventId
                        ? "Tidak ada lampiran foto pada absensi ini."
                        : "Karyawan belum memiliki catatan absensi untuk bagian ini."}
                    </Text>
                  </View>
                </View>
              ) : null}

              <DetailSection icon="location-outline" title="Lokasi saat absen">
                <View style={styles.locationCard}>
                  <View style={styles.locationPin}>
                    <Ionicons name="location" size={21} color={colors.white} />
                  </View>
                  <View style={styles.locationCopy}>
                    <Text style={styles.locationName}>
                      {evidence?.section?.name ??
                        (detail.kind === "report"
                          ? detail.item.sectionName
                          : "Lokasi kerja")}
                    </Text>
                    {evidence?.section?.address ? (
                      <Text style={styles.locationAddress}>
                        {evidence.section.address}
                      </Text>
                    ) : null}
                    {latitude !== undefined && longitude !== undefined ? (
                      <Text style={styles.coordinates}>
                        {latitude.toFixed(6)}, {longitude.toFixed(6)}
                      </Text>
                    ) : (
                      <Text style={styles.locationAddress}>
                        Koordinat tidak tersedia
                      </Text>
                    )}
                  </View>
                </View>
                <View style={styles.locationFacts}>
                  <EvidenceFact
                    icon="navigate-outline"
                    label="Akurasi"
                    value={
                      accuracy !== undefined
                        ? `±${Math.round(accuracy)} meter`
                        : "—"
                    }
                  />
                  <EvidenceFact
                    icon="time-outline"
                    label="Diambil"
                    value={
                      evidence?.location?.capturedAt
                        ? formatDetailTime(
                            evidence.location.capturedAt,
                            timezone,
                          )
                        : "—"
                    }
                  />
                </View>
                {latitude !== undefined && longitude !== undefined ? (
                  <Pressable
                    accessibilityLabel="Buka lokasi absensi di Google Maps"
                    accessibilityRole="link"
                    onPress={() => void openMap()}
                    style={styles.mapButton}
                  >
                    <Ionicons
                      name="map-outline"
                      size={18}
                      color={colors.espresso}
                    />
                    <Text style={styles.mapButtonText}>
                      Buka di Google Maps
                    </Text>
                    <Ionicons
                      name="open-outline"
                      size={15}
                      color={colors.espresso}
                    />
                  </Pressable>
                ) : null}
              </DetailSection>

              <DetailSection icon="shield-checkmark-outline" title="Verifikasi">
                <View style={styles.verificationGrid}>
                  <VerificationItem
                    icon="person-outline"
                    label="Kecocokan wajah"
                    value={
                      evidence?.faceVerification
                        ? evidence.faceVerification.verified
                          ? `${Math.round(evidence.faceVerification.similarityScore * 100)}% cocok`
                          : "Tidak cocok"
                        : "Tidak digunakan"
                    }
                    good={Boolean(evidence?.faceVerification?.verified)}
                  />
                  <VerificationItem
                    icon="eye-outline"
                    label="Liveness"
                    value={
                      evidence?.faceVerification
                        ? evidence.faceVerification.livenessPassed
                          ? "Lulus"
                          : "Gagal"
                        : "Tidak digunakan"
                    }
                    good={Boolean(evidence?.faceVerification?.livenessPassed)}
                  />
                  <VerificationItem
                    icon="phone-portrait-outline"
                    label="Integritas perangkat"
                    value={integrityLabel(evidence)}
                    good={evidence?.integrityVerdict?.riskScore === 0}
                  />
                  <VerificationItem
                    icon="wifi-outline"
                    label="Jaringan Wi-Fi"
                    value={evidence?.wifiSSID ?? "Tidak direkam"}
                    good={Boolean(evidence?.wifiSSID)}
                  />
                </View>
              </DetailSection>

              <DetailSection icon="receipt-outline" title="Rincian pencatatan">
                <DetailLine
                  label="Waktu tercatat server"
                  value={formatDetailTime(
                    evidence?.recordedAt ??
                      (detail.kind === "request"
                        ? detail.item.recordedAt
                        : eventPart === "in"
                          ? detail.item.clockInAt
                          : detail.item.clockOutAt),
                    timezone,
                  )}
                />
                <DetailLine
                  label="Bukti diterima"
                  value={formatDetailTime(evidence?.evidenceSavedAt, timezone)}
                />
                <DetailLine
                  label="Sumber"
                  value={sourceLabel(
                    evidence?.source ??
                      (detail.kind === "request"
                        ? detail.item.source
                        : undefined),
                  )}
                />
                <DetailLine
                  label="Perangkat"
                  value={
                    evidence?.device
                      ? `${evidence.device.label ?? "Perangkat terdaftar"} · ${evidence.device.platform}`
                      : "Tidak direkam"
                  }
                />
                {detail.kind === "request" ? (
                  <>
                    <DetailLine
                      label="Permintaan dikirim"
                      value={formatDetailTime(
                        detail.item.requestedAt,
                        timezone,
                      )}
                    />
                    <DetailLine
                      label="Keputusan diberikan"
                      value={formatDetailTime(detail.item.decidedAt, timezone)}
                    />
                    <DetailLine
                      label="Alasan karyawan"
                      value={detail.item.reason || "—"}
                    />
                    <DetailLine
                      label="Catatan supervisor"
                      value={detail.item.decisionReason || "—"}
                    />
                  </>
                ) : null}
              </DetailSection>
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function EvidenceTab({
  active,
  disabled,
  label,
  onPress,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.evidenceTab,
        active && styles.evidenceTabActive,
        disabled && styles.evidenceTabDisabled,
      ]}
    >
      <Text
        style={[styles.evidenceTabText, active && styles.evidenceTabTextActive]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function DetailSection({
  children,
  icon,
  title,
}: {
  children: ReactNode;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
}) {
  return (
    <View style={styles.detailSection}>
      <View style={styles.detailSectionHeader}>
        <Ionicons name={icon} size={18} color={colors.gold} />
        <Text style={styles.detailSectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function EvidenceFact({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.evidenceFact}>
      <Ionicons name={icon} size={16} color={colors.gold} />
      <View>
        <Text style={styles.evidenceFactLabel}>{label}</Text>
        <Text style={styles.evidenceFactValue}>{value}</Text>
      </View>
    </View>
  );
}

function VerificationItem({
  good,
  icon,
  label,
  value,
}: {
  good: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.verificationItem}>
      <View
        style={[styles.verificationIcon, good && styles.verificationIconGood]}
      >
        <Ionicons
          name={good ? "checkmark" : icon}
          size={17}
          color={good ? colors.emerald : colors.inkMuted}
        />
      </View>
      <Text style={styles.verificationLabel}>{label}</Text>
      <Text style={styles.verificationValue}>{value}</Text>
    </View>
  );
}

function formatDetailTime(instant: string | undefined, timezone: string) {
  if (!instant) return "—";
  return formatInstant(new Date(instant), timezone, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function sourceLabel(source?: string) {
  const labels: Record<string, string> = {
    MOBILE: "Aplikasi Android",
    KIOSK: "Perangkat kiosk",
    ADMIN: "Koreksi admin",
    SYSTEM: "Otomatis sistem",
  };
  return source ? (labels[source] ?? source) : "Tidak direkam";
}

function integrityLabel(evidence: AttendanceEvidenceDetail | null) {
  const integrity = evidence?.integrityVerdict;
  if (!integrity) return "Tidak digunakan";
  if (integrity.riskScore !== undefined)
    return integrity.riskScore === 0
      ? "Aman · risiko 0"
      : `Risiko ${integrity.riskScore}`;
  return integrity.failOpen ? "Pemeriksaan dilewati" : "Terverifikasi";
}

function formatFileSize(bytes: number) {
  if (!bytes) return "ukuran tidak diketahui";
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.round(bytes / 1000)} KB`;
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailLine}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
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
  reportStatValue: {
    color: colors.espresso,
    fontFamily: "serif",
    fontSize: 25,
  },
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
  reportListTitle: {
    color: colors.espresso,
    fontFamily: "serif",
    fontSize: 23,
  },
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
  modalBackdrop: {
    backgroundColor: "rgba(25,14,10,0.48)",
    flex: 1,
    justifyContent: "flex-end",
  },
  detailSheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "94%",
    paddingTop: spacing.lg,
  },
  detailHeader: {
    alignItems: "flex-start",
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  detailHeaderCopy: { flex: 1, minWidth: 0 },
  detailTitle: {
    color: colors.espresso,
    fontFamily: "serif",
    fontSize: 26,
    marginTop: 5,
  },
  detailEmployeeNumber: { color: colors.inkMuted, fontSize: 12, marginTop: 3 },
  closeButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  detailContent: { paddingHorizontal: spacing.lg, paddingBottom: 72 },
  shiftSummary: {
    backgroundColor: colors.espresso,
    borderRadius: 16,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  shiftSummaryTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  shiftIcon: {
    alignItems: "center",
    backgroundColor: "#49352D",
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  shiftSummaryCopy: { flex: 1, minWidth: 0 },
  shiftSummaryTitle: { color: colors.white, fontWeight: "800" },
  shiftSummaryOutlet: { color: "#D8C9BE", fontSize: 11, marginTop: 3 },
  shiftSummaryTimes: {
    borderTopColor: "#513C33",
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.md,
    paddingTop: spacing.sm,
  },
  shiftSummaryTime: { color: colors.goldSoft, fontSize: 12, fontWeight: "800" },
  shiftSummaryDuration: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "800",
  },
  evidenceTabs: {
    backgroundColor: "#EEE8E1",
    flexDirection: "row",
    gap: 4,
    marginTop: spacing.lg,
    padding: 4,
  },
  evidenceTab: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  evidenceTabActive: { backgroundColor: colors.espresso },
  evidenceTabDisabled: { opacity: 0.38 },
  evidenceTabText: { color: colors.inkMuted, fontSize: 12, fontWeight: "800" },
  evidenceTabTextActive: { color: colors.white },
  evidenceHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.lg,
  },
  evidenceEyebrow: {
    color: "#8A6C2D",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  evidenceTitle: {
    color: colors.espresso,
    fontFamily: "serif",
    fontSize: 22,
    marginTop: 4,
  },
  detailStatus: {
    fontSize: 9,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  detailStatusGood: { backgroundColor: "#E3F1E8", color: "#23633A" },
  detailStatusPending: { backgroundColor: "#F7EAC5", color: "#7A5B12" },
  detailStatusBad: { backgroundColor: "#FBEFEF", color: colors.ruby },
  evidenceLoading: {
    alignItems: "center",
    backgroundColor: colors.ivory,
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  evidenceLoadingText: { color: colors.inkMuted, fontSize: 12 },
  evidenceError: {
    alignItems: "center",
    backgroundColor: "#FBEFEF",
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  evidenceErrorText: {
    color: colors.ruby,
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  photoCard: {
    backgroundColor: colors.white,
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: spacing.md,
    overflow: "hidden",
  },
  evidencePhoto: {
    backgroundColor: "#E8E1D9",
    height: 360,
    width: "100%",
  },
  photoCaption: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    padding: spacing.md,
  },
  photoCaptionCopy: { flex: 1 },
  photoLabel: {
    color: colors.espresso,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
  },
  photoMeta: { color: colors.inkMuted, fontSize: 11, marginTop: 4 },
  privateBadge: {
    alignItems: "center",
    backgroundColor: "#EAF4EE",
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  privateBadgeText: { color: colors.emerald, fontSize: 9, fontWeight: "900" },
  noPhoto: {
    alignItems: "center",
    backgroundColor: colors.ivory,
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  noPhotoCopy: { flex: 1 },
  noPhotoTitle: { color: colors.espresso, fontWeight: "800" },
  noPhotoText: {
    color: colors.inkMuted,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 3,
  },
  detailSection: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
  },
  detailSectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  detailSectionTitle: {
    color: colors.espresso,
    fontFamily: "serif",
    fontSize: 19,
  },
  locationCard: {
    alignItems: "flex-start",
    backgroundColor: "#F5EFE6",
    borderLeftColor: colors.gold,
    borderLeftWidth: 3,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
  },
  locationPin: {
    alignItems: "center",
    backgroundColor: colors.espresso,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  locationCopy: { flex: 1 },
  locationName: { color: colors.espresso, fontWeight: "900" },
  locationAddress: {
    color: colors.inkMuted,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 4,
  },
  coordinates: {
    color: "#745C27",
    fontFamily: "monospace",
    fontSize: 11,
    marginTop: 7,
  },
  locationFacts: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  evidenceFact: {
    alignItems: "center",
    backgroundColor: colors.ivory,
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 56,
    padding: spacing.sm,
  },
  evidenceFactLabel: {
    color: colors.inkMuted,
    fontSize: 9,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  evidenceFactValue: {
    color: colors.espresso,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 3,
  },
  mapButton: {
    alignItems: "center",
    borderColor: colors.gold,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    marginTop: spacing.sm,
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  mapButtonText: {
    color: colors.espresso,
    flex: 1,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  verificationGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  verificationItem: {
    backgroundColor: colors.ivory,
    flexGrow: 1,
    minHeight: 116,
    minWidth: "46%",
    padding: spacing.md,
    width: "46%",
  },
  verificationIcon: {
    alignItems: "center",
    backgroundColor: "#E7E0D8",
    height: 31,
    justifyContent: "center",
    width: 31,
  },
  verificationIconGood: { backgroundColor: "#E3F1E8" },
  verificationLabel: {
    color: colors.inkMuted,
    fontSize: 9,
    fontWeight: "800",
    marginTop: spacing.sm,
    textTransform: "uppercase",
  },
  verificationValue: {
    color: colors.espresso,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
    marginTop: 4,
  },
  detailLine: {
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    paddingVertical: spacing.md,
  },
  detailLabel: {
    color: colors.inkMuted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  detailValue: { color: colors.espresso, lineHeight: 20, marginTop: 5 },
});

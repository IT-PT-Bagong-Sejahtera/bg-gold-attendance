import { createContext, useContext, useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import {
  CalendarDays,
  Clock3,
  LogOut,
  ShieldCheck,
  Users,
  MapPin,
  ChevronRight,
} from "lucide-react";
import { downloadFile, request, type Me, type Today } from "./lib/api";
import { useAuth } from "./lib/auth";
import {
  addCalendarDays,
  calendarDateInTimeZone,
  calendarDateKey,
  formatCalendarDate,
  formatInstant,
  instantDateKey,
  instantToOrganizationLocalInput,
  organizationLocalInputToUtc,
  startOfCalendarWeek,
  zonedDateTimeToUtc,
} from "./lib/timezone";

const OrganizationTimeZoneContext = createContext("UTC");

function useOrganizationTimeZone() {
  return useContext(OrganizationTimeZoneContext);
}

export function App() {
  const { session, ready } = useAuth();
  if (!ready) return <LaunchScreen />;
  return session ? <Dashboard /> : <LoginScreen />;
}

function LaunchScreen() {
  return (
    <main className="launch" aria-live="polite">
      <img src="/bg-gold-logo.png" alt="BG GOLD" />
      <span>Menyiapkan ruang kerja…</span>
    </main>
  );
}

function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Tidak dapat masuk.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-layout">
      <section className="login-story" aria-label="BG GOLD Attendance">
        <div className="brand-lockup">
          <img src="/bg-gold-logo.png" alt="BG GOLD" />
          <span>Attendance</span>
        </div>
        <div className="story-copy">
          <p className="eyebrow">WORKFORCE OPERATIONS</p>
          <h1>Waktu kerja yang jelas, untuk tim yang bergerak.</h1>
          <p>
            Jadwal, kehadiran, dan persetujuan dalam satu alur yang rapi—tanpa
            menghilangkan sisi manusia dari pekerjaan sehari-hari.
          </p>
        </div>
        <p className="story-foot">BG GOLD · Indonesia</p>
      </section>
      <section className="login-panel">
        <form onSubmit={submit} className="login-form">
          <div>
            <p className="eyebrow">SELAMAT DATANG</p>
            <h2>Masuk ke ruang kerja</h2>
            <p className="muted">
              Gunakan akun yang diberikan oleh administrator BG GOLD.
            </p>
          </div>
          <label>
            Email
            <input
              autoComplete="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Kata sandi
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button" disabled={loading}>
            {loading ? "Memeriksa akun…" : "Masuk"}
            <ChevronRight size={18} />
          </button>
        </form>
      </section>
    </main>
  );
}

function Dashboard() {
  const { session, logout } = useAuth();
  const token = session!.accessToken;
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => request<Me>("/me", {}, token),
  });
  const organizationTimezone = me.data?.timezone;
  const timezone = organizationTimezone ?? "UTC";
  const today = useQuery({
    queryKey: ["attendance", "today"],
    queryFn: () => request<Today>("/me/attendance/today", {}, token),
  });
  const employees = useQuery({
    queryKey: ["employees"],
    queryFn: () => request<Employee[]>("/employees", {}, token),
  });
  const sections = useQuery({
    queryKey: ["sections"],
    queryFn: () => request<Section[]>("/sections", {}, token),
  });
  const policies = useQuery({
    queryKey: ["policies"],
    queryFn: () => request<Policy[]>("/policies", {}, token),
  });
  const shifts = useQuery({
    queryKey: ["shifts", organizationTimezone],
    enabled: Boolean(organizationTimezone),
    queryFn: () => {
      const today = calendarDateInTimeZone(new Date(), timezone);
      const from = zonedDateTimeToUtc(addCalendarDays(today, -7), timezone);
      const to = zonedDateTimeToUtc(addCalendarDays(today, 32), timezone);
      return request<Shift[]>(
        `/shifts?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
        {},
        token,
      );
    },
  });
  const approvals = useQuery({
    queryKey: ["attendance", "requests", "pending"],
    queryFn: () =>
      request<AttendanceRequestAdmin[]>(
        "/attendance/requests?status=PENDING",
        {},
        token,
      ),
  });
  const leaveRequests = useQuery({
    queryKey: ["leave", "requests", "pending"],
    queryFn: () =>
      request<LeaveRequestAdmin[]>("/leave-requests?status=PENDING", {}, token),
  });
  const leaveTypes = useQuery({
    queryKey: ["leave", "types"],
    queryFn: () => request<LeaveTypeAdmin[]>("/leave-types", {}, token),
  });
  const claimRequests = useQuery({
    queryKey: ["claim", "requests", "pending"],
    queryFn: () => request<ClaimAdmin[]>("/claims?status=PENDING", {}, token),
  });
  const claimTypes = useQuery({
    queryKey: ["claim", "types"],
    queryFn: () => request<ClaimTypeAdmin[]>("/claim-types", {}, token),
  });
  const shiftRequests = useQuery({
    queryKey: ["shift", "requests", "pending"],
    queryFn: () =>
      request<ShiftRequestAdmin[]>("/shift-requests?status=PENDING", {}, token),
  });
  const attendanceRecords = useQuery({
    queryKey: ["attendance", "records", "recent", organizationTimezone],
    enabled: Boolean(organizationTimezone),
    queryFn: () => {
      const today = calendarDateInTimeZone(new Date(), timezone);
      const from = zonedDateTimeToUtc(addCalendarDays(today, -14), timezone);
      const to = zonedDateTimeToUtc(addCalendarDays(today, 1), timezone);
      return request<AttendanceRecordAdmin[]>(
        `/attendance/records?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&limit=100`,
        {},
        token,
      );
    },
  });
  const timesheets = useQuery({
    queryKey: ["attendance", "timesheets", "recent", organizationTimezone],
    enabled: Boolean(organizationTimezone),
    queryFn: () => {
      const today = calendarDateInTimeZone(new Date(), timezone);
      const from = zonedDateTimeToUtc(addCalendarDays(today, -14), timezone);
      const to = zonedDateTimeToUtc(addCalendarDays(today, 1), timezone);
      return request<TimesheetSummaryAdmin[]>(
        `/attendance/timesheets?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
        {},
        token,
      );
    },
  });
  const auditLogs = useQuery({
    queryKey: ["audit", "recent"],
    queryFn: () => request<AuditLogAdmin[]>("/audit-logs?limit=20", {}, token),
  });
  const dashboardQueries = [
    me,
    today,
    employees,
    sections,
    policies,
    shifts,
    approvals,
    leaveRequests,
    leaveTypes,
    claimRequests,
    claimTypes,
    shiftRequests,
    attendanceRecords,
    timesheets,
    auditLogs,
  ] as const;
  const failedQueryCount = dashboardQueries.filter((query) => query.isError).length;
  function retryFailedQueries() {
    for (const query of dashboardQueries) {
      if (query.isError) void query.refetch();
    }
  }
  const name = me.data?.fullName ?? "Tim BG GOLD";
  const firstName = name.split(" ")[0];
  const stateLabel: Record<Today["state"], string> = {
    NOT_STARTED: "Belum mulai",
    WORKING: "Sedang bekerja",
    ON_BREAK: "Sedang istirahat",
    COMPLETED: "Selesai",
    PENDING: "Menunggu persetujuan",
  };

  return (
    <OrganizationTimeZoneContext.Provider value={timezone}>
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup compact">
          <img src="/bg-gold-logo.png" alt="BG GOLD" />
          <span>Attendance</span>
        </div>
        <nav aria-label="Navigasi utama">
          <a className="active" href="#overview">
            <Clock3 size={19} />
            Ringkasan
          </a>
          <a href="#people">
            <Users size={19} />
            Karyawan
          </a>
          <a href="#schedule">
            <CalendarDays size={19} />
            Jadwal
          </a>
          <a href="#locations">
            <MapPin size={19} />
            Lokasi kerja
          </a>
          <a href="#policies">
            <ShieldCheck size={19} />
            Kebijakan
          </a>
        </nav>
        <button className="logout-button" onClick={logout}>
          <LogOut size={18} />
          Keluar
        </button>
      </aside>
      <main className="dashboard" id="overview">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">RINGKASAN HARI INI</p>
            <h1>Selamat pagi, {firstName}.</h1>
            <p className="muted">
              {formatInstant(new Date(), timezone, {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
          <div className="account-chip">
            <span>{name.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{name}</strong>
              <small>{me.data?.roles.join(" · ") || "Memuat peran"}</small>
            </div>
          </div>
        </header>
        {failedQueryCount > 0 && (
          <div className="notice error dashboard-error" role="alert">
            <span>
              {failedQueryCount} bagian data terbaru belum dapat dimuat.
              Periksa koneksi API lalu coba kembali.
            </span>
            <button className="text-button" onClick={retryFailedQueries}>
              Coba lagi
            </button>
          </div>
        )}
        <section className="status-band">
          <div>
            <p className="eyebrow">STATUS ANDA</p>
            <strong>
              {today.data ? stateLabel[today.data.state] : "Memuat…"}
            </strong>
            <span>Waktu resmi menggunakan waktu server.</span>
          </div>
          <div
            className={`status-orb ${today.data?.state.toLowerCase() ?? "loading"}`}
          >
            <Clock3 size={28} />
            <span>
              {formatInstant(new Date(), timezone, {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        </section>
        <div className="dashboard-grid">
          <section className="work-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">AKTIVITAS</p>
                <h2>Catatan terbaru</h2>
              </div>
              <button className="text-button">
                Lihat semua <ChevronRight size={16} />
              </button>
            </div>
            <div className="timeline">
              {today.isLoading && <p className="muted">Memuat aktivitas…</p>}
              {today.data?.latestEvents.length === 0 && (
                <div className="empty-state">
                  <Clock3 size={24} />
                  <strong>Belum ada catatan hari ini</strong>
                  <span>
                    Aktivitas clock-in dan clock-out akan tampil di sini.
                  </span>
                </div>
              )}
              {today.data?.latestEvents.map((event) => (
                <div className="timeline-row" key={event.id}>
                  <span className="timeline-mark" />
                  <div>
                    <strong>{actionLabel(event.actionType)}</strong>
                    <small>
                      {formatInstant(new Date(event.recordedAt), timezone, {
                        hour: "2-digit",
                        minute: "2-digit",
                        day: "numeric",
                        month: "short",
                      })}
                    </small>
                  </div>
                  <span className={`decision ${event.decision.toLowerCase()}`}>
                    {event.decision === "APPROVED"
                      ? "Tercatat"
                      : event.decision === "PENDING"
                        ? "Menunggu"
                        : "Ditolak"}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <aside className="attention-panel">
            <p className="eyebrow">PERLU PERHATIAN</p>
            <h2>Operasional tim</h2>
            <div className="attention-item">
              <Clock3 size={20} />
              <div>
                <strong>
                  {approvals.isLoading || leaveRequests.isLoading || claimRequests.isLoading
                    ? "Memeriksa persetujuan"
                    : `${(approvals.data?.length ?? 0) + (leaveRequests.data?.length ?? 0) + (claimRequests.data?.length ?? 0)} persetujuan menunggu`}
                </strong>
                <span>Tinjau catatan yang membutuhkan keputusan.</span>
              </div>
              <ChevronRight size={18} />
            </div>
            <div className="attention-item">
              <CalendarDays size={20} />
              <div>
                <strong>Jadwal kerja</strong>
                <span>Susun shift dan terbitkan untuk tim.</span>
              </div>
              <ChevronRight size={18} />
            </div>
            <div className="attention-item">
              <ShieldCheck size={20} />
              <div>
                <strong>Kebijakan absensi</strong>
                <span>Atur bukti dan batas waktu per lokasi.</span>
              </div>
              <ChevronRight size={18} />
            </div>
          </aside>
        </div>
        <OperationsDirectory
          token={token}
          actorRoles={me.data?.roles ?? []}
          employees={employees.data ?? []}
          sections={sections.data ?? []}
          policies={policies.data ?? []}
          shifts={shifts.data ?? []}
          approvals={approvals.data ?? []}
          leaveRequests={leaveRequests.data ?? []}
          leaveTypes={leaveTypes.data ?? []}
          claimRequests={claimRequests.data ?? []}
          claimTypes={claimTypes.data ?? []}
          shiftRequests={shiftRequests.data ?? []}
          attendanceRecords={attendanceRecords.data ?? []}
          timesheets={timesheets.data ?? []}
          auditLogs={auditLogs.data ?? []}
          loading={
            employees.isLoading ||
            sections.isLoading ||
            policies.isLoading ||
            shifts.isLoading ||
            approvals.isLoading ||
            leaveRequests.isLoading ||
            leaveTypes.isLoading ||
            claimRequests.isLoading ||
            claimTypes.isLoading ||
            shiftRequests.isLoading ||
            attendanceRecords.isLoading
            || timesheets.isLoading
            || auditLogs.isLoading
          }
          onSectionCreated={() => void sections.refetch()}
          onEmployeesChanged={() => void employees.refetch()}
          onShiftCreated={() => void shifts.refetch()}
          onPolicyCreated={() => void policies.refetch()}
          onCorrectionCreated={() => {
            void attendanceRecords.refetch();
            void timesheets.refetch();
          }}
          onApprovalDecided={() => {
            void approvals.refetch();
            void today.refetch();
          }}
          onLeaveChanged={() => {
            void leaveRequests.refetch();
            void leaveTypes.refetch();
          }}
          onClaimChanged={() => {
            void claimRequests.refetch();
            void claimTypes.refetch();
          }}
          onShiftRequestDecided={() => {
            void shiftRequests.refetch();
            void shifts.refetch();
          }}
        />
      </main>
    </div>
    </OrganizationTimeZoneContext.Provider>
  );
}

type Employee = {
  id: string;
  fullName: string;
  email: string;
  employeeNumber: string;
  jobTitle?: string;
  status: string;
  roles: string[];
};
type Section = {
  id: string;
  code: string;
  name: string;
  address?: string;
  timezone?: string;
  latitude?: number;
  longitude?: number;
  status: string;
};
type Policy = {
  id: string;
  name: string;
  modes: string[];
  selfieRequired: boolean;
  minimumLocationAccuracyMeters?: number;
  earlyClockInMinutes: number;
  lateClockInMinutes: number;
  earlyClockOutMinutes: number;
  lateClockOutMinutes: number;
  preventEarlyClockIn: boolean;
  preventLateClockIn: boolean;
  preventEarlyClockOut: boolean;
  preventLateClockOut: boolean;
  workMoreRequiresApproval?: boolean;
  unscheduledBreakRequiresApproval?: boolean;
  preventUnscheduledBreak?: boolean;
  scheduledBreakStartOffsetMinutes?: number;
  scheduledBreakEndOffsetMinutes?: number;
  breakRoundingMinutes?: number;
  status: string;
};
type Shift = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: string;
  section: { id: string; name: string };
};
type AttendanceRequestAdmin = {
  id: string;
  eventId: string;
  membershipId: string;
  employeeName: string;
  employeeNumber: string;
  actionType: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  requestedAt: string;
  recordedAt: string;
  reason?: string;
  decidedAt?: string;
  decisionReason?: string;
};
type LeaveRequestAdmin = {
  id: string;
  membershipId: string;
  employeeName: string;
  employeeNumber: string;
  leaveTypeId: string;
  leaveTypeName: string;
  startsOn: string;
  endsOn: string;
  totalDays: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  requestedAt: string;
  decisionReason?: string;
};
type LeaveTypeAdmin = {
  id: string;
  code: string;
  name: string;
  paid: boolean;
  status: string;
};
type ClaimAdmin = {
  id: string;
  membershipId: string;
  employeeName: string;
  employeeNumber: string;
  claimTypeId: string;
  claimTypeName: string;
  title: string;
  amount: number;
  currency: string;
  incurredOn: string;
  notes?: string;
  attachmentId?: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  ocrStatus: "NOT_CONFIGURED" | "PENDING" | "COMPLETE" | "FAILED";
  ocrProvider?: string;
  ocrResult?: { merchant?: string; total?: number; currency?: string; transactionDate?: string; confidence: number; reference?: string };
  requestedAt: string;
};
type ClaimTypeAdmin = {
  id: string;
  code: string;
  name: string;
  receiptRequired: boolean;
  status: string;
};
type ShiftRequestAdmin = {
  id: string;
  shiftId: string;
  shiftTitle: string;
  membershipId: string;
  employeeName: string;
  employeeNumber: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  requestedAt: string;
  reason?: string;
};
type AttendanceRecordAdmin = {
  id: string;
  membershipId: string;
  employeeName: string;
  employeeNumber: string;
  actionType: string;
  decision: "PENDING" | "APPROVED" | "REJECTED";
  recordedAt: string;
  reason?: string;
  latestCorrection?: {
    eventId: string;
    correctedActionType: string;
    correctedRecordedAt: string;
    reason: string;
    createdAt: string;
  };
};
type TimesheetSummaryAdmin = {
  membershipId: string;
  employeeName: string;
  employeeNumber: string;
  date: string;
  firstClockIn?: string;
  lastClockOut?: string;
  grossMinutes: number;
  actualBreakMinutes: number;
  roundedBreakMinutes: number;
  netMinutes: number;
};
type AuditLogAdmin = {
  id: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  actorUserId: string;
  actorName: string;
  actorEmail: string;
  metadata?: Record<string, unknown>;
  requestId?: string;
  createdAt: string;
};

function OperationsDirectory({
  token,
  actorRoles,
  employees,
  sections,
  policies,
  shifts,
  approvals,
  leaveRequests,
  leaveTypes,
  claimRequests,
  claimTypes,
  shiftRequests,
  attendanceRecords,
  timesheets,
  auditLogs,
  loading,
  onSectionCreated,
  onEmployeesChanged,
  onShiftCreated,
  onPolicyCreated,
  onCorrectionCreated,
  onApprovalDecided,
  onLeaveChanged,
  onClaimChanged,
  onShiftRequestDecided,
}: {
  token: string;
  actorRoles: string[];
  employees: Employee[];
  sections: Section[];
  policies: Policy[];
  shifts: Shift[];
  approvals: AttendanceRequestAdmin[];
  leaveRequests: LeaveRequestAdmin[];
  leaveTypes: LeaveTypeAdmin[];
  claimRequests: ClaimAdmin[];
  claimTypes: ClaimTypeAdmin[];
  shiftRequests: ShiftRequestAdmin[];
  attendanceRecords: AttendanceRecordAdmin[];
  timesheets: TimesheetSummaryAdmin[];
  auditLogs: AuditLogAdmin[];
  loading: boolean;
  onSectionCreated: () => void;
  onEmployeesChanged: () => void;
  onShiftCreated: () => void;
  onPolicyCreated: () => void;
  onCorrectionCreated: () => void;
  onApprovalDecided: () => void;
  onLeaveChanged: () => void;
  onClaimChanged: () => void;
  onShiftRequestDecided: () => void;
}) {
  const timezone = useOrganizationTimeZone();
  return (
    <section className="operations-directory" aria-label="Data operasional">
      <div className="section-heading">
        <div>
          <p className="eyebrow">DIREKTORI OPERASIONAL</p>
          <h2>Kelola dasar organisasi</h2>
        </div>
        <span className="muted">
          {loading ? "Memuat data…" : "Data API aktif"}
        </span>
      </div>
      <ApprovalQueue
        token={token}
        requests={approvals}
        loading={loading}
        onDecided={onApprovalDecided}
      />
      <LeaveRequestQueue
        token={token}
        requests={leaveRequests}
        loading={loading}
        onDecided={onLeaveChanged}
      />
      <LeaveConfiguration
        token={token}
        employees={employees}
        leaveTypes={leaveTypes}
        onChanged={onLeaveChanged}
      />
      <ClaimRequestQueue
        token={token}
        requests={claimRequests}
        loading={loading}
        onDecided={onClaimChanged}
      />
      <ClaimConfiguration
        token={token}
        claimTypes={claimTypes}
        onChanged={onClaimChanged}
      />
      <AnnouncementComposer token={token} />
      <ShiftRequestQueue
        token={token}
        requests={shiftRequests}
        loading={loading}
        onDecided={onShiftRequestDecided}
      />
      <TimesheetSummary token={token} items={timesheets} loading={loading} />
      <AuditTrail items={auditLogs} loading={loading} />
      <AttendanceRoster
        token={token}
        records={attendanceRecords}
        loading={loading}
        onCorrected={onCorrectionCreated}
      />
      <WeeklyPlanner shifts={shifts} />
      <div className="resource-grid">
        <article id="people" className="resource-panel">
          <div className="resource-head">
            <Users size={20} />
            <div>
              <h3>Karyawan</h3>
              <span>{employees.length} anggota</span>
            </div>
          </div>
          <div className="resource-list">
            {loading && employees.length === 0 ? <ResourceSkeleton label="Memuat karyawan" /> : null}
            {employees.slice(0, 5).map((item) => (
              <div className="resource-row employee-resource" key={item.id}>
                <span className="initial">{item.fullName.slice(0, 1)}</span>
                <div>
                  <strong>{item.fullName}</strong>
                  <small>
                    {item.employeeNumber} · {item.roles.join(", ")} ·{" "}
                    {item.status === "ACTIVE"
                      ? "Aktif"
                      : item.status === "INVITED"
                        ? "Diundang"
                        : "Nonaktif"}
                  </small>
                </div>
                <EmployeeStatusButton
                  token={token}
                  employee={item}
                  onChanged={onEmployeesChanged}
                />
              </div>
            ))}
            {!loading && employees.length === 0 ? (
              <p className="muted">Belum ada karyawan.</p>
            ) : null}
          </div>
          <EmployeeEditor
            token={token}
            employees={employees}
            onChanged={onEmployeesChanged}
          />
          <QuickEmployeeForm
            token={token}
            actorRoles={actorRoles}
            onCreated={onEmployeesChanged}
          />
        </article>
        <article id="schedule" className="resource-panel">
          <div className="resource-head">
            <CalendarDays size={20} />
            <div>
              <h3>Jadwal</h3>
              <span>{shifts.length} shift</span>
            </div>
          </div>
          <div className="resource-list">
            {loading && shifts.length === 0 ? <ResourceSkeleton label="Memuat jadwal" /> : null}
            {shifts.slice(0, 5).map((item) => (
              <div className="resource-row date-resource" key={item.id}>
                <time>
                  {formatInstant(new Date(item.startsAt), timezone, {
                    day: "2-digit",
                    month: "short",
                  })}
                </time>
                <div>
                  <strong>{item.title}</strong>
                  <small>
                    {item.section.name} ·{" "}
                    {formatInstant(new Date(item.startsAt), timezone, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                </div>
                <ShiftStatusButton
                  token={token}
                  shift={item}
                  onChanged={onShiftCreated}
                />
              </div>
            ))}
            {!loading && shifts.length === 0 ? (
              <p className="muted">Belum ada shift pada rentang ini.</p>
            ) : null}
          </div>
          <QuickShiftForm
            token={token}
            sections={sections}
            employees={employees}
            onCreated={onShiftCreated}
          />
        </article>
        <article id="locations" className="resource-panel">
          <div className="resource-head">
            <MapPin size={20} />
            <div>
              <h3>Lokasi kerja</h3>
              <span>{sections.length} lokasi</span>
            </div>
          </div>
          <div className="resource-list">
            {loading && sections.length === 0 ? <ResourceSkeleton label="Memuat lokasi kerja" /> : null}
            {sections.slice(0, 4).map((item) => (
              <div className="resource-row" key={item.id}>
                <span className="code-mark">{item.code}</span>
                <div>
                  <strong>{item.name}</strong>
                  <small>
                    {item.address || "Alamat belum diisi"} · {item.status}
                  </small>
                </div>
                <SectionStatusButton
                  token={token}
                  section={item}
                  onChanged={onSectionCreated}
                />
              </div>
            ))}
            {!loading && sections.length === 0 ? (
              <p className="muted">Belum ada lokasi kerja.</p>
            ) : null}
          </div>
          <DynamicQRPanel token={token} sections={sections} />
          <SectionEditor
            token={token}
            sections={sections}
            onChanged={onSectionCreated}
          />
          <QuickSectionForm token={token} onCreated={onSectionCreated} />
        </article>
        <article id="policies" className="resource-panel">
          <div className="resource-head">
            <ShieldCheck size={20} />
            <div>
              <h3>Kebijakan</h3>
              <span>{policies.length} aturan</span>
            </div>
          </div>
          <div className="resource-list">
            {loading && policies.length === 0 ? <ResourceSkeleton label="Memuat kebijakan" /> : null}
            {policies.slice(0, 5).map((item) => (
              <div className="resource-row" key={item.id}>
                <span className="policy-mark">
                  <ShieldCheck size={15} />
                </span>
                <div>
                  <strong>{item.name}</strong>
                  <small>
                    {item.modes.join(" · ")}
                    {item.selfieRequired ? " · Selfie wajib" : ""}
                  </small>
                </div>
              </div>
            ))}
            {!loading && policies.length === 0 ? (
              <p className="muted">Belum ada kebijakan aktif.</p>
            ) : null}
          </div>
          <PolicyEditor token={token} policies={policies} onChanged={onPolicyCreated} />
          <QuickPolicyForm
            token={token}
            sections={sections}
            employees={employees}
            onCreated={onPolicyCreated}
          />
        </article>
      </div>
    </section>
  );
}

function ResourceSkeleton({ label }: { label: string }) {
  return (
    <div className="resource-skeleton" role="status" aria-label={label}>
      <span className="sr-only">{label}…</span>
      {[0, 1, 2].map((item) => (
        <span className="resource-skeleton-row" aria-hidden="true" key={item}>
          <span />
          <span />
        </span>
      ))}
    </div>
  );
}

function PolicyEditor({ token, policies, onChanged }: { token: string; policies: Policy[]; onChanged: () => void }) {
  const active = policies.filter((item) => item.status === "ACTIVE");
  const [policyId, setPolicyId] = useState("");
  const selected = active.find((item) => item.id === policyId);
  const [name, setName] = useState("");
  const [earlyClockIn, setEarlyClockIn] = useState("0");
  const [lateClockIn, setLateClockIn] = useState("0");
  const [earlyClockOut, setEarlyClockOut] = useState("0");
  const [lateClockOut, setLateClockOut] = useState("0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!selected) return;
    setName(selected.name);
    setEarlyClockIn(String(selected.earlyClockInMinutes));
    setLateClockIn(String(selected.lateClockInMinutes));
    setEarlyClockOut(String(selected.earlyClockOutMinutes));
    setLateClockOut(String(selected.lateClockOutMinutes));
  }, [selected]);
  if (active.length === 0 && !notice) return null;
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await request(`/policies/${encodeURIComponent(selected.id)}`, { method: "PATCH", body: JSON.stringify({ name: name.trim(), earlyClockInMinutes: Number(earlyClockIn), lateClockInMinutes: Number(lateClockIn), earlyClockOutMinutes: Number(earlyClockOut), lateClockOutMinutes: Number(lateClockOut) }) }, token);
      setNotice("Kebijakan berhasil diperbarui.");
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Kebijakan gagal diperbarui.");
    } finally {
      setSaving(false);
    }
  }
  async function archive() {
    if (!selected) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await request(`/policies/${encodeURIComponent(selected.id)}/archive`, { method: "POST", body: "{}" }, token);
      setPolicyId("");
      setNotice("Kebijakan dipindahkan ke arsip.");
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Kebijakan gagal diarsipkan.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="policy-form" onSubmit={save}>
      <label className="form-span">Kebijakan yang diubah<select aria-label="Kebijakan yang diubah" value={policyId} onChange={(event)=>setPolicyId(event.target.value)}><option value="">Pilih kebijakan aktif</option>{active.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {selected ? <>
        <label className="form-span">Nama aturan terpilih<input aria-label="Nama kebijakan edit" value={name} onChange={(event)=>setName(event.target.value)} required/></label>
        <div className="inline-numbers form-span">
          <label>Clock-in awal<input aria-label="Edit clock-in awal" type="number" min="0" max="1440" value={earlyClockIn} onChange={(event)=>setEarlyClockIn(event.target.value)}/></label>
          <label>Clock-in terlambat<input aria-label="Edit clock-in terlambat" type="number" min="0" max="1440" value={lateClockIn} onChange={(event)=>setLateClockIn(event.target.value)}/></label>
          <label>Clock-out awal<input aria-label="Edit clock-out awal" type="number" min="0" max="1440" value={earlyClockOut} onChange={(event)=>setEarlyClockOut(event.target.value)}/></label>
          <label>Clock-out terlambat<input aria-label="Edit clock-out terlambat" type="number" min="0" max="1440" value={lateClockOut} onChange={(event)=>setLateClockOut(event.target.value)}/></label>
        </div>
        <div className="form-actions form-span"><button className="small-primary" disabled={saving}>{saving ? "Menyimpan…" : "Simpan perubahan kebijakan"}</button><button type="button" className="text-button" disabled={saving} onClick={()=>void archive()}>Arsipkan kebijakan</button></div>
      </> : null}
      {error ? <p className="form-error form-span" role="alert">{error}</p> : null}
      {notice ? <p className="form-success form-span" role="status">{notice}</p> : null}
    </form>
  );
}

function QuickPolicyForm({
  token,
  sections,
  employees,
  onCreated,
}: {
  token: string;
  sections: Section[];
  employees: Employee[];
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [mode, setMode] = useState("ANYWHERE");
  const [target, setTarget] = useState("ORGANIZATION");
  const [selfieRequired, setSelfieRequired] = useState(false);
  const [accuracy, setAccuracy] = useState("100");
  const [geofenceRadius, setGeofenceRadius] = useState("100");
  const [wifiSSID, setWifiSSID] = useState("");
  const [wifiBSSID, setWifiBSSID] = useState("");
  const [faceFailClosed, setFaceFailClosed] = useState(true);
  const [integrityFailClosed, setIntegrityFailClosed] = useState(true);
  const [maxRiskScore, setMaxRiskScore] = useState("30");
  const [earlyClockIn, setEarlyClockIn] = useState("30");
  const [lateClockIn, setLateClockIn] = useState("15");
  const [earlyClockOut, setEarlyClockOut] = useState("0");
  const [lateClockOut, setLateClockOut] = useState("30");
  const [preventEarlyClockIn, setPreventEarlyClockIn] = useState(false);
  const [preventLateClockIn, setPreventLateClockIn] = useState(false);
  const [preventEarlyClockOut, setPreventEarlyClockOut] = useState(false);
  const [preventLateClockOut, setPreventLateClockOut] = useState(false);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [workMoreApproval, setWorkMoreApproval] = useState(false);
  const [breakApproval, setBreakApproval] = useState(false);
  const [preventUnscheduledBreak, setPreventUnscheduledBreak] = useState(false);
  const [breakStart, setBreakStart] = useState("");
  const [breakEnd, setBreakEnd] = useState("");
  const [breakRounding, setBreakRounding] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await request<{ id: string }>(
        "/policies",
        {
          method: "POST",
          body: JSON.stringify({
            name,
            modes: selfieRequired ? [mode, "SELFIE"] : [mode],
            selfieRequired,
            minimumLocationAccuracyMeters: Number(accuracy),
            geofenceRadiusMeters:
              mode === "GEOFENCE" ? Number(geofenceRadius) : undefined,
            wifiNetworks:
              mode === "WIFI" ? [{ ssid: wifiSSID.trim(), bssid: wifiBSSID.trim() }] : undefined,
            faceFailClosed: mode === "FACE_VERIFICATION" ? faceFailClosed : undefined,
            integrityFailClosed: mode === "DEVICE_INTEGRITY" ? integrityFailClosed : undefined,
            maxRiskScore: mode === "DEVICE_INTEGRITY" ? Number(maxRiskScore) : undefined,
            earlyClockInMinutes: Number(earlyClockIn),
            lateClockInMinutes: Number(lateClockIn),
            earlyClockOutMinutes: Number(earlyClockOut),
            lateClockOutMinutes: Number(lateClockOut),
            preventEarlyClockIn,
            preventLateClockIn,
            preventEarlyClockOut,
            preventLateClockOut,
            unscheduledRequiresApproval: requiresApproval,
            workMoreRequiresApproval: workMoreApproval,
            unscheduledBreakRequiresApproval: breakApproval,
            preventUnscheduledBreak,
            scheduledBreakStartOffsetMinutes: breakStart
              ? Number(breakStart)
              : undefined,
            scheduledBreakEndOffsetMinutes: breakEnd
              ? Number(breakEnd)
              : undefined,
            breakRoundingMinutes: breakRounding
              ? Number(breakRounding)
              : undefined,
            sectionId: target.startsWith("SECTION:")
              ? target.slice("SECTION:".length)
              : undefined,
            membershipId: target.startsWith("EMPLOYEE:")
              ? target.slice("EMPLOYEE:".length)
              : undefined,
          }),
        },
        token,
      );
      setName("");
      setOpen(false);
      onCreated();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Kebijakan gagal dibuat.",
      );
    } finally {
      setSaving(false);
    }
  }
  if (!open) {
    return (
      <button
        className="text-button add-resource"
        onClick={() => setOpen(true)}
      >
        + Buat kebijakan
      </button>
    );
  }
  return (
    <form className="policy-form" onSubmit={submit}>
      <label>
        Nama kebijakan
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </label>
      {mode === "GEOFENCE" ? (
        <label>
          Radius lokasi (meter)
          <input
            type="number"
            min="10"
            max="5000"
            value={geofenceRadius}
            onChange={(event) => setGeofenceRadius(event.target.value)}
            required
          />
        </label>
      ) : null}
      {mode === "WIFI" ? <div className="inline-numbers form-span"><label>Nama Wi-Fi (SSID)<input aria-label="Nama Wi-Fi" value={wifiSSID} onChange={(event)=>setWifiSSID(event.target.value)} required/></label><label>Access point (BSSID)<input aria-label="BSSID Wi-Fi" value={wifiBSSID} onChange={(event)=>setWifiBSSID(event.target.value)} placeholder="AA:BB:CC:DD:EE:FF" required/></label></div> : null}
      {mode === "FACE_VERIFICATION" ? <label className="publish-check"><input type="checkbox" checked={faceFailClosed} onChange={(event)=>setFaceFailClosed(event.target.checked)}/>Tolak absensi bila provider wajah tidak tersedia</label> : null}
      {mode === "DEVICE_INTEGRITY" ? <div className="inline-numbers form-span"><label>Skor risiko maksimum<input aria-label="Skor risiko maksimum" type="number" min="0" max="100" value={maxRiskScore} onChange={(event)=>setMaxRiskScore(event.target.value)} required/></label><label className="publish-check"><input type="checkbox" checked={integrityFailClosed} onChange={(event)=>setIntegrityFailClosed(event.target.checked)}/>Tolak bila pemeriksaan perangkat tidak tersedia</label></div> : null}
      <label>
        Mode utama
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="ANYWHERE">Di mana saja</option>
          <option value="LOCATION_ONLY">Catat lokasi</option>
          <option value="GEOFENCE">Dalam radius lokasi</option>
          <option value="DYNAMIC_QR">QR dinamis lokasi</option>
          <option value="WIFI">Wi-Fi outlet</option>
          <option value="FACE_VERIFICATION">Wajah + liveness</option>
          <option value="DEVICE_INTEGRITY">Keamanan perangkat Android</option>
        </select>
      </label>
      <label>
        Berlaku untuk
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="ORGANIZATION">Seluruh organisasi</option>
          {sections
            .filter((item) => item.status === "ACTIVE")
            .map((item) => (
              <option key={item.id} value={`SECTION:${item.id}`}>
                Lokasi · {item.name}
              </option>
            ))}
          {employees
            .filter((item) => item.status === "ACTIVE")
            .map((item) => (
              <option key={item.id} value={`EMPLOYEE:${item.id}`}>
                Karyawan · {item.fullName}
              </option>
            ))}
        </select>
      </label>
      <label>
        Batas akurasi GPS (meter)
        <input
          type="number"
          min="1"
          max="1000"
          value={accuracy}
          onChange={(e) => setAccuracy(e.target.value)}
          required
        />
      </label>
      <div className="time-guard-panel form-span">
        <div className="policy-group-heading">
          <strong>Jendela waktu absensi</strong>
          <span>Toleransi dihitung dari awal dan akhir shift.</span>
        </div>
        <div className="time-guard-grid">
          <label>
            <span>Masuk lebih awal</span>
            <input
              aria-label="Toleransi masuk lebih awal"
              type="number"
              min="0"
              max="1440"
              value={earlyClockIn}
              onChange={(e) => setEarlyClockIn(e.target.value)}
              required
            />
            <small>menit sebelum shift</small>
            <span className="compact-check">
              <input
                type="checkbox"
                checked={preventEarlyClockIn}
                onChange={(e) => setPreventEarlyClockIn(e.target.checked)}
              />
              Tolak di luar batas
            </span>
          </label>
          <label>
            <span>Masuk terlambat</span>
            <input
              aria-label="Toleransi masuk terlambat"
              type="number"
              min="0"
              max="1440"
              value={lateClockIn}
              onChange={(e) => setLateClockIn(e.target.value)}
              required
            />
            <small>menit setelah shift</small>
            <span className="compact-check">
              <input
                type="checkbox"
                checked={preventLateClockIn}
                onChange={(e) => setPreventLateClockIn(e.target.checked)}
              />
              Tolak di luar batas
            </span>
          </label>
          <label>
            <span>Pulang lebih awal</span>
            <input
              aria-label="Toleransi pulang lebih awal"
              type="number"
              min="0"
              max="1440"
              value={earlyClockOut}
              onChange={(e) => setEarlyClockOut(e.target.value)}
              required
            />
            <small>menit sebelum selesai</small>
            <span className="compact-check">
              <input
                type="checkbox"
                checked={preventEarlyClockOut}
                onChange={(e) => setPreventEarlyClockOut(e.target.checked)}
              />
              Tolak di luar batas
            </span>
          </label>
          <label>
            <span>Pulang terlambat</span>
            <input
              aria-label="Toleransi pulang terlambat"
              type="number"
              min="0"
              max="1440"
              value={lateClockOut}
              onChange={(e) => setLateClockOut(e.target.value)}
              required
            />
            <small>menit setelah selesai</small>
            <span className="compact-check">
              <input
                type="checkbox"
                checked={preventLateClockOut}
                onChange={(e) => setPreventLateClockOut(e.target.checked)}
              />
              Tolak di luar batas
            </span>
          </label>
        </div>
      </div>
      <div className="policy-checks">
        <label>
          <input
            type="checkbox"
            checked={selfieRequired}
            onChange={(e) => setSelfieRequired(e.target.checked)}
          />{" "}
          Selfie wajib
        </label>
        <label>
          <input
            type="checkbox"
            checked={requiresApproval}
            onChange={(e) => setRequiresApproval(e.target.checked)}
          />{" "}
          Absensi tanpa shift perlu persetujuan
        </label>
        <label>
          <input
            type="checkbox"
            checked={workMoreApproval}
            onChange={(e) => setWorkMoreApproval(e.target.checked)}
          />{" "}
          Kerja tambahan perlu persetujuan
        </label>
        <label>
          <input
            type="checkbox"
            checked={breakApproval}
            onChange={(e) => {
              setBreakApproval(e.target.checked);
              if (e.target.checked) setPreventUnscheduledBreak(false);
            }}
          />{" "}
          Istirahat di luar jadwal perlu persetujuan
        </label>
        <label>
          <input
            type="checkbox"
            checked={preventUnscheduledBreak}
            onChange={(e) => {
              setPreventUnscheduledBreak(e.target.checked);
              if (e.target.checked) setBreakApproval(false);
            }}
          />{" "}
          Tolak istirahat di luar jadwal
        </label>
      </div>
      <label>
        Scheduled break · menit setelah shift mulai
        <div className="inline-numbers">
          <input
            aria-label="Awal scheduled break"
            type="number"
            min="0"
            placeholder="Mulai"
            value={breakStart}
            onChange={(e) => setBreakStart(e.target.value)}
          />
          <input
            aria-label="Akhir scheduled break"
            type="number"
            min="1"
            placeholder="Selesai"
            value={breakEnd}
            onChange={(e) => setBreakEnd(e.target.value)}
          />
        </div>
      </label>
      <label>
        Pembulatan break (menit)
        <input
          type="number"
          min="1"
          max="60"
          value={breakRounding}
          onChange={(e) => setBreakRounding(e.target.value)}
          placeholder="Tidak dibulatkan"
        />
      </label>
      {error ? <small className="form-error form-span">{error}</small> : null}
      <div className="form-span">
        <button className="small-primary" disabled={saving}>
          {saving ? "Menyimpan…" : "Aktifkan kebijakan"}
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => setOpen(false)}
        >
          Batal
        </button>
      </div>
    </form>
  );
}

type DynamicQRIssue = {
  token: string;
  sectionId: string;
  expiresAt: string;
};

function DynamicQRPanel({
  token,
  sections,
}: {
  token: string;
  sections: Section[];
}) {
  const activeSections = sections.filter((item) => item.status === "ACTIVE");
  const [sectionId, setSectionId] = useState("");
  const [issued, setIssued] = useState<DynamicQRIssue | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const selected = activeSections.find((item) => item.id === sectionId);

  useEffect(() => {
    if (!activeSections.some((item) => item.id === sectionId)) {
      setSectionId(activeSections[0]?.id ?? "");
      setIssued(null);
    }
  }, [activeSections, sectionId]);

  async function issue() {
    if (!sectionId || loading) return;
    setLoading(true);
    setError("");
    try {
      setIssued(
        await request<DynamicQRIssue>(
          `/sections/${sectionId}/dynamic-qr`,
          { method: "POST" },
          token,
        ),
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "QR belum dapat dibuat.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!issued) return;
    const update = () => {
      setSecondsLeft(
        Math.max(0, Math.ceil((Date.parse(issued.expiresAt) - Date.now()) / 1000)),
      );
    };
    update();
    const interval = window.setInterval(update, 1_000);
    const refresh = window.setTimeout(
      () => void issue(),
      Math.max(1_000, Date.parse(issued.expiresAt) - Date.now() - 5_000),
    );
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(refresh);
    };
  }, [issued]);

  if (activeSections.length === 0) return null;
  return (
    <div className="dynamic-qr-panel">
      <div className="dynamic-qr-controls">
        <label>
          QR absensi outlet
          <select
            value={sectionId}
            onChange={(event) => {
              setSectionId(event.target.value);
              setIssued(null);
            }}
          >
            {activeSections.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button className="small-primary" disabled={loading} onClick={() => void issue()}>
          {loading ? "Membuat…" : issued ? "Perbarui QR" : "Tampilkan QR outlet"}
        </button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      {issued && selected ? (
        <div className="dynamic-qr-display" aria-live="polite">
          <div className="qr-paper">
            <QRCodeSVG
              value={issued.token}
              size={220}
              level="M"
              marginSize={2}
              title={`QR dinamis ${selected.name}`}
            />
          </div>
          <div>
            <p className="eyebrow">SIAP DIPINDAI</p>
            <strong>{selected.name}</strong>
            <span>Berubah otomatis dalam {secondsLeft} detik</span>
            <small>
              Tampilkan di layar outlet. Setiap kode hanya dapat digunakan satu kali per karyawan.
            </small>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ShiftStatusButton({
  token,
  shift,
  onChanged,
}: {
  token: string;
  shift: Shift;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const published = shift.status === "PUBLISHED";
  async function change() {
    setSaving(true);
    setError("");
    try {
      await request(
        `/shifts/${encodeURIComponent(shift.id)}/${published ? "unpublish" : "publish"}`,
        { method: "POST" },
        token,
      );
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Status shift gagal diubah.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="shift-status-action">
      <button disabled={saving} onClick={() => void change()}>
        {saving ? "…" : published ? "Tarik" : "Terbitkan"}
      </button>
      {error ? <small>{error}</small> : null}
    </div>
  );
}

function QuickShiftForm({
  token,
  sections,
  employees,
  onCreated,
}: {
  token: string;
  sections: Section[];
  employees: Employee[];
  onCreated: () => void;
}) {
  const timezone = useOrganizationTimeZone();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [membershipId, setMembershipId] = useState("");
  const [date, setDate] = useState("");
  const [startsAt, setStartsAt] = useState("09:00");
  const [endsAt, setEndsAt] = useState("17:00");
  const [publish, setPublish] = useState(true);
  const [openForRequests, setOpenForRequests] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const start = organizationLocalInputToUtc(`${date}T${startsAt}`, timezone);
    const end = organizationLocalInputToUtc(`${date}T${endsAt}`, timezone);
    if (!end.getTime() || !start.getTime() || end <= start) {
      setError("Waktu selesai harus sesudah waktu mulai.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await request<{ id: string }>(
        "/shifts",
        {
          method: "POST",
          body: JSON.stringify({
            title,
            sectionId,
            startsAt: start.toISOString(),
            endsAt: end.toISOString(),
            publish,
            open: openForRequests,
            membershipIds: membershipId ? [membershipId] : [],
          }),
        },
        token,
      );
      setTitle("");
      setDate("");
      setMembershipId("");
      setOpen(false);
      onCreated();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Shift gagal dibuat.",
      );
    } finally {
      setSaving(false);
    }
  }
  if (!open) {
    return (
      <button
        className="text-button add-resource"
        onClick={() => setOpen(true)}
      >
        + Buat shift
      </button>
    );
  }
  return (
    <form className="shift-form" onSubmit={submit}>
      <label className="form-span">
        Nama shift
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </label>
      <label className="form-span">
        Lokasi
        <select
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          required
        >
          <option value="">Pilih lokasi</option>
          {sections
            .filter((item) => item.status === "ACTIVE")
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
        </select>
      </label>
      <label>
        Tanggal
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </label>
      <label>
        Mulai
        <input
          type="time"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
          required
        />
      </label>
      <label>
        Selesai
        <input
          type="time"
          value={endsAt}
          onChange={(e) => setEndsAt(e.target.value)}
          required
        />
      </label>
      <label>
        Karyawan
        <select
          value={membershipId}
          onChange={(e) => setMembershipId(e.target.value)}
        >
          <option value="">Tanpa penugasan</option>
          {employees
            .filter((item) => item.status === "ACTIVE")
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.fullName}
              </option>
            ))}
        </select>
      </label>
      <label className="publish-check form-span">
        <input
          type="checkbox"
          checked={publish}
          onChange={(e) => setPublish(e.target.checked)}
        />
        Terbitkan langsung untuk karyawan
      </label>
      <label className="publish-check form-span">
        <input
          type="checkbox"
          checked={openForRequests}
          onChange={(event) => {
            setOpenForRequests(event.target.checked);
            if (event.target.checked) setPublish(true);
          }}
        />
        Buka agar dapat diminta karyawan
      </label>
      {error ? <small className="form-error form-span">{error}</small> : null}
      <div className="form-span">
        <button className="small-primary" disabled={saving}>
          {saving ? "Menyimpan…" : "Simpan shift"}
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => setOpen(false)}
        >
          Batal
        </button>
      </div>
    </form>
  );
}

function EmployeeStatusButton({
  token,
  employee,
  onChanged,
}: {
  token: string;
  employee: Employee;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const active = employee.status === "ACTIVE";
  if (employee.status === "INVITED") {
    return <small className="invited-state">Menunggu aktivasi</small>;
  }
  async function changeStatus() {
    setSaving(true);
    setError("");
    try {
      await request(
        `/employees/${encodeURIComponent(employee.id)}/${active ? "deactivate" : "activate"}`,
        { method: "POST" },
        token,
      );
      onChanged();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Status gagal diperbarui.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="employee-status-action">
      <button
        className={active ? "deactivate-link" : "activate-link"}
        disabled={saving}
        onClick={() => void changeStatus()}
      >
        {saving ? "Menyimpan…" : active ? "Nonaktifkan" : "Aktifkan"}
      </button>
      {error ? <small className="form-error">{error}</small> : null}
    </div>
  );
}

const employeeRoleOptions = ["OWNER", "ADMIN", "HR", "SUPERVISOR", "EMPLOYEE"];

function EmployeeEditor({
  token,
  employees,
  onChanged,
}: {
  token: string;
  employees: Employee[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedID, setSelectedID] = useState("");
  const [fullName, setFullName] = useState("");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  function select(employee: Employee) {
    setSelectedID(employee.id);
    setFullName(employee.fullName);
    setEmployeeNumber(employee.employeeNumber);
    setJobTitle(employee.jobTitle ?? "");
    setRoles(employee.roles);
    setError("");
  }
  function begin() {
    const first = employees[0];
    if (first) select(first);
    setOpen(true);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await request(
        `/employees/${encodeURIComponent(selectedID)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ fullName, employeeNumber, jobTitle, roles }),
        },
        token,
      );
      setOpen(false);
      onChanged();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Profil gagal diperbarui.",
      );
    } finally {
      setSaving(false);
    }
  }
  if (!open) {
    return (
      <button
        className="text-button add-resource"
        disabled={employees.length === 0}
        onClick={begin}
      >
        Edit profil & peran
      </button>
    );
  }
  return (
    <form className="employee-form employee-editor" onSubmit={submit}>
      <label className="form-span">
        Pilih karyawan
        <select
          aria-label="Pilih karyawan untuk diedit"
          value={selectedID}
          onChange={(event) => {
            const employee = employees.find(
              (item) => item.id === event.target.value,
            );
            if (employee) select(employee);
          }}
        >
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.fullName} · {employee.employeeNumber}
            </option>
          ))}
        </select>
      </label>
      <label>
        Nama lengkap
        <input
          aria-label="Nama lengkap untuk diedit"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          required
        />
      </label>
      <label>
        Nomor karyawan
        <input
          aria-label="Nomor karyawan untuk diedit"
          value={employeeNumber}
          onChange={(event) => setEmployeeNumber(event.target.value)}
          required
        />
      </label>
      <label className="form-span">
        Jabatan
        <input
          aria-label="Jabatan untuk diedit"
          value={jobTitle}
          onChange={(event) => setJobTitle(event.target.value)}
        />
      </label>
      <fieldset className="role-editor form-span">
        <legend>Peran akses</legend>
        {employeeRoleOptions.map((role) => (
          <label key={role}>
            <input
              type="checkbox"
              checked={roles.includes(role)}
              onChange={(event) =>
                setRoles((current) =>
                  event.target.checked
                    ? [...current, role]
                    : current.filter((item) => item !== role),
                )
              }
            />
            {role}
          </label>
        ))}
      </fieldset>
      {error ? <small className="form-error form-span">{error}</small> : null}
      <div className="form-span">
        <button className="small-primary" disabled={saving || roles.length === 0}>
          {saving ? "Menyimpan…" : "Simpan perubahan"}
        </button>
        <button type="button" className="text-button" onClick={() => setOpen(false)}>
          Batal
        </button>
      </div>
    </form>
  );
}

function QuickEmployeeForm({
  token,
  actorRoles,
  onCreated,
}: {
  token: string;
  actorRoles: string[];
  onCreated: () => void;
}) {
  const isSuperadmin = actorRoles.includes("OWNER");
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [password, setPassword] = useState("");
  const [accountRole, setAccountRole] = useState<"EMPLOYEE" | "SUPERVISOR">("EMPLOYEE");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const created = await request<{
        id: string;
        invitationStatus: "SENT" | "FAILED" | "NOT_CONFIGURED" | "NOT_REQUIRED";
        developmentInviteToken?: string;
      }>(
        "/employees",
        {
          method: "POST",
          body: JSON.stringify({
            fullName,
            email,
            employeeNumber,
            jobTitle,
            password: password || undefined,
            roles: [accountRole],
          }),
        },
        token,
      );
      setFullName("");
      setEmail("");
      setEmployeeNumber("");
      setJobTitle("");
      setPassword("");
      setAccountRole("EMPLOYEE");
      setOpen(false);
      setNotice(
        created.invitationStatus === "SENT"
          ? accountRole === "SUPERVISOR"
            ? "Undangan akun telah dikirim ke email supervisor."
            : "Undangan akun telah dikirim ke email karyawan."
          : created.developmentInviteToken
            ? `Mode lokal · token undangan: ${created.developmentInviteToken}`
            : created.invitationStatus === "NOT_REQUIRED"
              ? `${accountRole === "SUPERVISOR" ? "Supervisor" : "Karyawan"} ditambahkan dan sudah dapat masuk.`
              : "Akun dibuat, tetapi email undangan belum terkirim.",
      );
      onCreated();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Karyawan gagal dibuat.",
      );
    } finally {
      setSaving(false);
    }
  }
  if (!open) {
    return (
      <>
        {notice ? <small className="invite-notice">{notice}</small> : null}
        <button
          className="text-button add-resource"
          onClick={() => setOpen(true)}
        >
          + Tambah karyawan
        </button>
      </>
    );
  }
  return (
    <form className="employee-form" onSubmit={submit}>
      <label>
        Nama lengkap
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
        />
      </label>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>
      <label>
        Nomor karyawan
        <input
          value={employeeNumber}
          onChange={(e) => setEmployeeNumber(e.target.value)}
          required
        />
      </label>
      <label>
        Jabatan
        <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
      </label>
      {isSuperadmin ? (
        <fieldset className="form-span role-picker">
          <legend>Jenis akun</legend>
          <label>
            <input
              type="radio"
              name="account-role"
              checked={accountRole === "EMPLOYEE"}
              onChange={() => setAccountRole("EMPLOYEE")}
            />
            Karyawan
          </label>
          <label>
            <input
              type="radio"
              name="account-role"
              checked={accountRole === "SUPERVISOR"}
              onChange={() => setAccountRole("SUPERVISOR")}
            />
            Supervisor
          </label>
        </fieldset>
      ) : null}
      <label className="form-span">
        Kata sandi sementara (opsional)
        <input
          type="password"
          minLength={12}
          placeholder="Kosongkan untuk mengirim undangan email"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error ? <small className="form-error form-span">{error}</small> : null}
      <div className="form-span">
        <button className="small-primary" disabled={saving}>
          {saving
            ? "Menyimpan…"
            : password
              ? accountRole === "SUPERVISOR"
                ? "Buat supervisor"
                : "Buat karyawan"
              : "Kirim undangan"}
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => setOpen(false)}
        >
          Batal
        </button>
      </div>
    </form>
  );
}

function WeeklyPlanner({ shifts }: { shifts: Shift[] }) {
  const timezone = useOrganizationTimeZone();
  const [offset, setOffset] = useState(0);
  const today = calendarDateInTimeZone(new Date(), timezone);
  const start = addCalendarDays(startOfCalendarWeek(today), offset * 7);
  const days = Array.from({ length: 7 }, (_, index) =>
    addCalendarDays(start, index),
  );
  return (
    <section className="weekly-planner" aria-labelledby="planner-title">
      <header>
        <div>
          <p className="eyebrow">PERENCANA MINGGUAN</p>
          <h3 id="planner-title">Jadwal tim per minggu</h3>
        </div>
        <div className="week-controls">
          <button aria-label="Minggu sebelumnya" onClick={() => setOffset((value) => value - 1)}>‹</button>
          <span>
            {days[0] ? formatCalendarDate(days[0], { day: "numeric", month: "short" }) : ""}
            {" – "}
            {days[6] ? formatCalendarDate(days[6], { day: "numeric", month: "short", year: "numeric" }) : ""}
          </span>
          <button aria-label="Minggu berikutnya" onClick={() => setOffset((value) => value + 1)}>›</button>
        </div>
      </header>
      <div className="week-grid">
        {days.map((day) => {
          const dayShifts = shifts.filter((shift) => {
            return instantDateKey(new Date(shift.startsAt), timezone) === calendarDateKey(day);
          });
          return (
            <article key={calendarDateKey(day)} className="week-day">
              <div className="week-day-heading">
                <span>{formatCalendarDate(day, { weekday: "short" })}</span>
                <strong>{day.day}</strong>
              </div>
              <div className="week-shifts">
                {dayShifts.map((shift) => (
                  <div className={`week-shift ${shift.status.toLowerCase()}`} key={shift.id}>
                    <strong>{shift.title}</strong>
                    <small>
                      {formatInstant(new Date(shift.startsAt), timezone, { hour: "2-digit", minute: "2-digit" })}
                      {" · "}{shift.section.name}
                    </small>
                  </div>
                ))}
                {dayShifts.length === 0 ? <span className="week-empty">—</span> : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function TimesheetSummary({
  token,
  items,
  loading,
}: {
  token: string;
  items: TimesheetSummaryAdmin[];
  loading: boolean;
}) {
  const [downloading, setDownloading] = useState("");
  const [downloadError, setDownloadError] = useState("");
  async function download(path: string, filename: string) {
    setDownloading(path);
    setDownloadError("");
    try {
      const blob = await downloadFile(path, token);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setDownloadError(
        reason instanceof Error ? reason.message : "Laporan gagal diunduh.",
      );
    } finally {
      setDownloading("");
    }
  }
  return (
    <section className="timesheet-summary" aria-labelledby="timesheet-title">
      <header>
        <div>
          <p className="eyebrow">RINGKASAN JAM KERJA</p>
          <h3 id="timesheet-title">Waktu bersih setelah istirahat</h3>
        </div>
        <div className="report-actions">
          <button
            className="text-button"
            disabled={Boolean(downloading)}
            onClick={() =>
              void download("/reports/attendance.csv", "bg-gold-attendance.csv")
            }
          >
            {downloading === "/reports/attendance.csv"
              ? "Menyiapkan…"
              : "Unduh attendance CSV"}
          </button>
          <button
            className="text-button"
            disabled={Boolean(downloading)}
            onClick={() =>
              void download("/reports/timesheets.csv", "bg-gold-timesheets.csv")
            }
          >
            {downloading === "/reports/timesheets.csv"
              ? "Menyiapkan…"
              : "Unduh timesheet CSV"}
          </button>
        </div>
      </header>
      {downloadError ? (
        <p className="form-error report-error" role="alert">
          {downloadError}
        </p>
      ) : null}
      {loading && items.length === 0 ? (
        <p className="muted roster-message">Menghitung timesheet…</p>
      ) : null}
      {!loading && items.length === 0 ? (
        <div className="roster-empty">
          <Clock3 size={24} />
          <span>Belum ada sesi kerja lengkap untuk dihitung.</span>
        </div>
      ) : null}
      <div className="timesheet-list">
        {items.slice(0, 20).map((item) => (
          <article
            className="timesheet-row"
            key={`${item.membershipId}:${item.date}`}
          >
            <div>
              <strong>{item.employeeName}</strong>
              <small>
                {formatInstant(new Date(`${item.date}T12:00:00Z`), "UTC", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
              </small>
            </div>
            <div className="time-metric">
              <small>Jam kotor</small>
              <strong>{formatMinutes(item.grossMinutes)}</strong>
            </div>
            <div className="time-metric">
              <small>
                Istirahat
                {item.actualBreakMinutes !== item.roundedBreakMinutes
                  ? ` · aktual ${formatMinutes(item.actualBreakMinutes)}`
                  : ""}
              </small>
              <strong>{formatMinutes(item.roundedBreakMinutes)}</strong>
            </div>
            <div className="time-metric net-time">
              <small>Waktu bersih</small>
              <strong>{formatMinutes(item.netMinutes)}</strong>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function AuditTrail({ items, loading }: { items: AuditLogAdmin[]; loading: boolean }) {
  const timezone = useOrganizationTimeZone();
  return (
    <section className="timesheet-summary" aria-labelledby="audit-title">
      <header>
        <div>
          <p className="eyebrow">JEJAK PERUBAHAN</p>
          <h3 id="audit-title">Aktivitas penting organisasi</h3>
        </div>
        <span>{loading ? "Memuat audit…" : `${items.length} aktivitas terbaru`}</span>
      </header>
      {!loading && items.length === 0 ? (
        <div className="roster-empty">
          <ShieldCheck size={24} />
          <span>Belum ada aktivitas audit yang dapat ditampilkan.</span>
        </div>
      ) : null}
      <div className="timesheet-list">
        {items.map((item) => (
          <article className="timesheet-row audit-row" key={item.id}>
            <div>
              <strong>{auditActionLabel(item.action)}</strong>
              <small>{item.actorName} · {item.actorEmail}</small>
            </div>
            <div className="time-metric">
              <small>Sumber</small>
              <strong>{item.resourceType.replaceAll("_", " ")}</strong>
            </div>
            <div className="time-metric">
              <small>Waktu</small>
              <strong>{formatInstant(new Date(item.createdAt), timezone, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</strong>
            </div>
            <div className="time-metric">
              <small>Request ID</small>
              <strong>{item.requestId ? item.requestId.slice(0, 12) : "Sistem"}</strong>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function auditActionLabel(action: string) {
  const labels: Record<string, string> = {
    "employee.create": "Karyawan dibuat",
    "employee.update": "Profil karyawan diubah",
    "employee.activate": "Karyawan diaktifkan",
    "employee.deactivate": "Karyawan dinonaktifkan",
    "section.create": "Lokasi dibuat",
    "section.update": "Lokasi diubah",
    "policy.create": "Kebijakan dibuat",
    "shift.create": "Shift dibuat",
    "shift.publish": "Shift diterbitkan",
    "shift.unpublish": "Shift ditarik",
    "attendance.request.decision": "Permintaan absensi diputuskan",
    "attendance.correction.create": "Koreksi absensi dibuat",
    "leave.request.decide": "Permintaan cuti diputuskan",
    "claim.request.decide": "Klaim diputuskan",
    "announcement.create": "Pengumuman dibuat",
  };
  return labels[action] ?? action.replaceAll(".", " · ");
}

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}j ${remainder.toString().padStart(2, "0")}m`;
}

function AttendanceRoster({
  token,
  records,
  loading,
  onCorrected,
}: {
  token: string;
  records: AttendanceRecordAdmin[];
  loading: boolean;
  onCorrected: () => void;
}) {
  return (
    <section className="attendance-roster" aria-labelledby="records-title">
      <header>
        <div>
          <p className="eyebrow">TIMESHEET TERBARU</p>
          <h3 id="records-title">Catatan kehadiran tim</h3>
        </div>
        <span>14 hari terakhir</span>
      </header>
      {loading && records.length === 0 ? (
        <p className="muted roster-message">Memuat catatan…</p>
      ) : null}
      {!loading && records.length === 0 ? (
        <div className="roster-empty">
          <Clock3 size={24} />
          <span>Belum ada aktivitas tim pada rentang ini.</span>
        </div>
      ) : null}
      <div className="record-list">
        {records.slice(0, 30).map((record) => (
          <AttendanceRecordRow
            key={record.id}
            token={token}
            record={record}
            onCorrected={onCorrected}
          />
        ))}
      </div>
    </section>
  );
}

function AttendanceRecordRow({
  token,
  record,
  onCorrected,
}: {
  token: string;
  record: AttendanceRecordAdmin;
  onCorrected: () => void;
}) {
  const timezone = useOrganizationTimeZone();
  const [editing, setEditing] = useState(false);
  const [actionType, setActionType] = useState(
    ["CLOCK_IN", "CLOCK_OUT", "START_BREAK", "END_BREAK", "WORK_MORE"].includes(
      record.actionType,
    )
      ? record.actionType
      : "CLOCK_IN",
  );
  const [recordedAt, setRecordedAt] = useState(
    instantToOrganizationLocalInput(new Date(record.recordedAt), timezone),
  );
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await request(
        "/attendance/corrections",
        {
          method: "POST",
          body: JSON.stringify({
            originalEventId: record.id,
            correctedActionType: actionType,
            correctedRecordedAt: organizationLocalInputToUtc(recordedAt, timezone).toISOString(),
            reason,
          }),
        },
        token,
      );
      setEditing(false);
      setReason("");
      onCorrected();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Koreksi belum dapat disimpan.",
      );
    } finally {
      setSaving(false);
    }
  }
  const effectiveAction =
    record.latestCorrection?.correctedActionType ?? record.actionType;
  const effectiveTime =
    record.latestCorrection?.correctedRecordedAt ?? record.recordedAt;
  return (
    <article className="record-row">
      <div className="record-person">
        <strong>{record.employeeName}</strong>
        <small>{record.employeeNumber}</small>
      </div>
      <div className="record-action">
        <strong>{actionLabel(effectiveAction)}</strong>
        <small>
          {formatInstant(new Date(effectiveTime), timezone, {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </small>
      </div>
      <div>
        <span className={`decision ${record.decision.toLowerCase()}`}>
          {record.decision === "APPROVED"
            ? "Tercatat"
            : record.decision === "PENDING"
              ? "Menunggu"
              : "Ditolak"}
        </span>
        {record.latestCorrection ? (
          <small className="correction-note">Sudah dikoreksi</small>
        ) : null}
      </div>
      <button
        className="record-edit"
        onClick={() => setEditing((value) => !value)}
      >
        {editing ? "Tutup" : "Koreksi"}
      </button>
      {editing ? (
        <form className="correction-form" onSubmit={submit}>
          <label>
            Tindakan
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
            >
              <option value="CLOCK_IN">Clock-in</option>
              <option value="CLOCK_OUT">Clock-out</option>
              <option value="START_BREAK">Mulai istirahat</option>
              <option value="END_BREAK">Selesai istirahat</option>
              <option value="WORK_MORE">Kerja tambahan</option>
            </select>
          </label>
          <label>
            Waktu yang benar
            <input
              type="datetime-local"
              value={recordedAt}
              onChange={(e) => setRecordedAt(e.target.value)}
              required
            />
          </label>
          <label className="correction-reason">
            Alasan koreksi
            <textarea
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </label>
          {error ? (
            <small className="form-error correction-reason">{error}</small>
          ) : null}
          <div className="correction-controls">
            <button
              className="small-primary"
              disabled={saving || !reason.trim()}
            >
              {saving ? "Menyimpan…" : "Simpan koreksi"}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setEditing(false)}
            >
              Batal
            </button>
          </div>
        </form>
      ) : null}
    </article>
  );
}

function LeaveRequestQueue({
  token,
  requests,
  loading,
  onDecided,
}: {
  token: string;
  requests: LeaveRequestAdmin[];
  loading: boolean;
  onDecided: () => void;
}) {
  const [rejectingId, setRejectingId] = useState<string>();
  const [reason, setReason] = useState("");
  const [savingId, setSavingId] = useState<string>();
  const [error, setError] = useState("");

  async function decide(item: LeaveRequestAdmin, decision: "APPROVED" | "REJECTED") {
    setSavingId(item.id);
    setError("");
    try {
      await request(
        `/leave-requests/${encodeURIComponent(item.id)}/decision`,
        {
          method: "POST",
          body: JSON.stringify({
            decision,
            reason: decision === "REJECTED" ? reason.trim() : undefined,
          }),
        },
        token,
      );
      setRejectingId(undefined);
      setReason("");
      onDecided();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Keputusan cuti belum dapat disimpan.");
    } finally {
      setSavingId(undefined);
    }
  }

  return (
    <section className="approval-queue" aria-labelledby="leave-approval-title">
      <header>
        <div>
          <p className="eyebrow">PERSETUJUAN CUTI</p>
          <h3 id="leave-approval-title">Waktu istirahat tim</h3>
        </div>
        <span>{requests.length} menunggu</span>
      </header>
      {error ? <p className="form-error approval-message" role="alert">{error}</p> : null}
      {loading && requests.length === 0 ? <p className="muted approval-message">Memuat antrean cuti…</p> : null}
      {!loading && requests.length === 0 ? (
        <div className="approval-empty">
          <ShieldCheck size={24} />
          <div><strong>Semua cuti sudah ditinjau</strong><span>Permintaan baru akan muncul di sini.</span></div>
        </div>
      ) : null}
      <div className="approval-list">
        {requests.map((item) => {
          const isRejecting = rejectingId === item.id;
          return (
            <article className="approval-row" key={item.id}>
              <div className="approval-person">
                <span>{item.employeeName.slice(0, 1).toUpperCase()}</span>
                <div><strong>{item.employeeName}</strong><small>{item.employeeNumber}</small></div>
              </div>
              <div className="approval-detail">
                <strong>{item.leaveTypeName} · {item.totalDays} hari</strong>
                <span>{item.startsOn} – {item.endsOn}</span>
                <small>“{item.reason}”</small>
              </div>
              <div className="approval-actions">
                {isRejecting ? (
                  <form onSubmit={(event) => { event.preventDefault(); if (reason.trim()) void decide(item, "REJECTED"); }}>
                    <label htmlFor={`leave-rejection-${item.id}`}>Alasan penolakan</label>
                    <textarea id={`leave-rejection-${item.id}`} value={reason} maxLength={500} autoFocus onChange={(event) => setReason(event.target.value)} />
                    <div><button type="button" className="text-button" onClick={() => { setRejectingId(undefined); setReason(""); }}>Batal</button><button className="reject-confirm" disabled={!reason.trim() || savingId === item.id}>Konfirmasi tolak</button></div>
                  </form>
                ) : (
                  <><button className="reject-button" disabled={Boolean(savingId)} onClick={() => setRejectingId(item.id)}>Tolak cuti</button><button className="approve-button" disabled={Boolean(savingId)} onClick={() => void decide(item, "APPROVED")}>{savingId === item.id ? "Menyimpan…" : "Setujui cuti"}</button></>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function LeaveConfiguration({
  token,
  employees,
  leaveTypes,
  onChanged,
}: {
  token: string;
  employees: Employee[];
  leaveTypes: LeaveTypeAdmin[];
  onChanged: () => void;
}) {
  const timezone = useOrganizationTimeZone();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [paid, setPaid] = useState(true);
  const [membershipId, setMembershipId] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [year, setYear] = useState(
    String(calendarDateInTimeZone(new Date(), timezone).year),
  );
  const [days, setDays] = useState("12");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function createType(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError(""); setMessage("");
    try {
      await request("/leave-types", { method: "POST", body: JSON.stringify({ code: code.trim(), name: name.trim(), paid }) }, token);
      setCode(""); setName(""); setMessage("Jenis cuti berhasil ditambahkan."); onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Jenis cuti belum dapat dibuat."); }
    finally { setSaving(false); }
  }

  async function setBalance(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError(""); setMessage("");
    try {
      await request("/leave-balances", { method: "POST", body: JSON.stringify({ membershipId, leaveTypeId, year: Number(year), entitlementDays: Number(days) }) }, token);
      setMessage("Jatah cuti berhasil disimpan.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Jatah cuti belum dapat disimpan."); }
    finally { setSaving(false); }
  }

  return (
    <section className="leave-configuration" aria-labelledby="leave-config-title">
      <header><div><p className="eyebrow">PENGATURAN CUTI</p><h3 id="leave-config-title">Jenis dan jatah cuti</h3></div><span>{leaveTypes.length} jenis aktif</span></header>
      {error ? <p className="form-error leave-config-message" role="alert">{error}</p> : null}
      {message ? <p className="invite-notice leave-config-message" role="status">{message}</p> : null}
      <div className="leave-config-grid">
        <form className="employee-form" onSubmit={createType}>
          <label>Kode jenis cuti<input aria-label="Kode jenis cuti" value={code} maxLength={30} required onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="ANNUAL" /></label>
          <label>Nama jenis cuti<input aria-label="Nama jenis cuti" value={name} maxLength={120} required onChange={(event) => setName(event.target.value)} placeholder="Cuti Tahunan" /></label>
          <label className="form-span publish-check"><input type="checkbox" checked={paid} onChange={(event) => setPaid(event.target.checked)} />Cuti berbayar</label>
          <div className="form-span"><button className="small-primary" disabled={saving}>Tambah jenis</button></div>
        </form>
        <form className="employee-form" onSubmit={setBalance}>
          <label className="form-span">Karyawan<select aria-label="Karyawan untuk jatah cuti" value={membershipId} required onChange={(event) => setMembershipId(event.target.value)}><option value="">Pilih karyawan</option>{employees.filter((item) => item.status === "ACTIVE").map((item) => <option key={item.id} value={item.id}>{item.fullName} · {item.employeeNumber}</option>)}</select></label>
          <label>Jenis cuti<select aria-label="Jenis untuk jatah cuti" value={leaveTypeId} required onChange={(event) => setLeaveTypeId(event.target.value)}><option value="">Pilih jenis</option>{leaveTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Tahun<input aria-label="Tahun jatah cuti" type="number" min="2000" max="2200" value={year} required onChange={(event) => setYear(event.target.value)} /></label>
          <label className="form-span">Jumlah hari<input aria-label="Jumlah hari cuti" type="number" min="0" max="366" step="0.5" value={days} required onChange={(event) => setDays(event.target.value)} /></label>
          <div className="form-span"><button className="small-primary" disabled={saving}>Simpan jatah</button></div>
        </form>
      </div>
    </section>
  );
}

function ClaimRequestQueue({ token, requests, loading, onDecided }: { token: string; requests: ClaimAdmin[]; loading: boolean; onDecided: () => void }) {
  const [rejectingId, setRejectingId] = useState<string>();
  const [reason, setReason] = useState("");
  const [savingId, setSavingId] = useState<string>();
  const [error, setError] = useState("");
  async function decide(item: ClaimAdmin, decision: "APPROVED" | "REJECTED") {
    setSavingId(item.id); setError("");
    try {
      await request(`/claims/${encodeURIComponent(item.id)}/decision`, { method: "POST", body: JSON.stringify({ decision, reason: decision === "REJECTED" ? reason.trim() : undefined }) }, token);
      setRejectingId(undefined); setReason(""); onDecided();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Keputusan klaim belum dapat disimpan."); }
    finally { setSavingId(undefined); }
  }
  async function openReceipt(item: ClaimAdmin) {
    setError("");
    try {
      const value = await request<{ url: string; expiresAt: string }>(`/claims/${encodeURIComponent(item.id)}/receipt-url`, {}, token);
      window.open(value.url, "_blank", "noopener,noreferrer");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Struk belum dapat dibuka."); }
  }
  return (
    <section className="approval-queue" aria-labelledby="claim-approval-title">
      <header><div><p className="eyebrow">PERSETUJUAN KLAIM</p><h3 id="claim-approval-title">Biaya yang perlu diperiksa</h3></div><span>{requests.length} menunggu</span></header>
      {error ? <p className="form-error approval-message" role="alert">{error}</p> : null}
      {loading && requests.length === 0 ? <p className="muted approval-message">Memuat antrean klaim…</p> : null}
      {!loading && requests.length === 0 ? <div className="approval-empty"><ShieldCheck size={24}/><div><strong>Semua klaim sudah ditinjau</strong><span>Klaim baru akan muncul di sini.</span></div></div> : null}
      <div className="approval-list">{requests.map((item) => <article className="approval-row" key={item.id}>
        <div className="approval-person"><span>{item.employeeName.slice(0,1).toUpperCase()}</span><div><strong>{item.employeeName}</strong><small>{item.employeeNumber}</small></div></div>
        <div className="approval-detail"><strong>{item.title}</strong><span>{new Intl.NumberFormat("id-ID", { style: "currency", currency: item.currency, maximumFractionDigits: 0 }).format(item.amount)} · {item.incurredOn}</span><small>{item.claimTypeName} · {item.notes || "Tanpa catatan"}</small>{item.ocrStatus === "COMPLETE" && item.ocrResult ? <small className="ocr-evidence">OCR: {item.ocrResult.merchant || "struk terbaca"} · {item.ocrResult.total ? new Intl.NumberFormat("id-ID", { style:"currency", currency:item.ocrResult.currency || item.currency, maximumFractionDigits:0 }).format(item.ocrResult.total) : "nominal tidak terbaca"} · {Math.round(item.ocrResult.confidence*100)}%</small> : item.ocrStatus === "FAILED" ? <small className="ocr-evidence">OCR gagal—periksa struk secara manual.</small> : item.ocrStatus === "PENDING" ? <small className="ocr-evidence">OCR sedang memproses struk…</small> : null}{item.attachmentId ? <button type="button" className="receipt-link" onClick={() => void openReceipt(item)}>Lihat struk</button> : null}</div>
        <div className="approval-actions">{rejectingId === item.id ? <form onSubmit={(event) => { event.preventDefault(); if (reason.trim()) void decide(item,"REJECTED"); }}><label htmlFor={`claim-rejection-${item.id}`}>Alasan penolakan</label><textarea id={`claim-rejection-${item.id}`} value={reason} maxLength={500} autoFocus onChange={(event)=>setReason(event.target.value)}/><div><button type="button" className="text-button" onClick={()=>{setRejectingId(undefined);setReason("");}}>Batal</button><button className="reject-confirm" disabled={!reason.trim() || savingId === item.id}>Konfirmasi tolak</button></div></form> : <><button className="reject-button" disabled={Boolean(savingId)} onClick={()=>setRejectingId(item.id)}>Tolak klaim</button><button className="approve-button" disabled={Boolean(savingId)} onClick={()=>void decide(item,"APPROVED")}>{savingId===item.id?"Menyimpan…":"Setujui klaim"}</button></>}</div>
      </article>)}</div>
    </section>
  );
}

function ClaimConfiguration({ token, claimTypes, onChanged }: { token: string; claimTypes: ClaimTypeAdmin[]; onChanged: () => void }) {
  const [code, setCode] = useState(""); const [name, setName] = useState(""); const [receiptRequired, setReceiptRequired] = useState(true); const [saving, setSaving] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setMessage(""); setError("");
    try { await request("/claim-types", { method:"POST", body:JSON.stringify({ code:code.trim(), name:name.trim(), receiptRequired }) }, token); setCode(""); setName(""); setMessage("Jenis klaim berhasil ditambahkan."); onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Jenis klaim belum dapat dibuat."); }
    finally { setSaving(false); }
  }
  return <section className="leave-configuration" aria-labelledby="claim-config-title"><header><div><p className="eyebrow">PENGATURAN KLAIM</p><h3 id="claim-config-title">Kategori biaya</h3></div><span>{claimTypes.length} jenis aktif</span></header>{error?<p className="form-error leave-config-message" role="alert">{error}</p>:null}{message?<p className="invite-notice leave-config-message" role="status">{message}</p>:null}<div className="claim-config-body"><form className="employee-form" onSubmit={submit}><label>Kode jenis klaim<input aria-label="Kode jenis klaim" value={code} required maxLength={30} onChange={(event)=>setCode(event.target.value.toUpperCase())} placeholder="TRAVEL"/></label><label>Nama jenis klaim<input aria-label="Nama jenis klaim" value={name} required maxLength={120} onChange={(event)=>setName(event.target.value)} placeholder="Perjalanan Dinas"/></label><label className="form-span publish-check"><input type="checkbox" checked={receiptRequired} onChange={(event)=>setReceiptRequired(event.target.checked)}/>Wajib menyertakan struk</label><div className="form-span"><button className="small-primary" disabled={saving}>Tambah jenis klaim</button></div></form></div></section>;
}

function AnnouncementComposer({ token }: { token: string }) {
  const [title, setTitle] = useState(""); const [body, setBody] = useState(""); const [priority, setPriority] = useState("NORMAL"); const [role, setRole] = useState("ALL"); const [requiresAck, setRequiresAck] = useState(false); const [saving, setSaving] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setMessage(""); setError("");
    try { await request("/announcements", { method:"POST", body:JSON.stringify({ title:title.trim(), body:body.trim(), priority, requiresAcknowledgment:requiresAck, audiences:role==="ALL"?[{type:"ALL"}]:[{type:"ROLE",value:role}], publish:true }) }, token); setTitle(""); setBody(""); setMessage("Pengumuman sudah diterbitkan dan masuk ke antrean notifikasi."); }
    catch(cause){setError(cause instanceof Error?cause.message:"Pengumuman belum dapat diterbitkan.");}
    finally{setSaving(false);}
  }
  return <section className="leave-configuration" aria-labelledby="announcement-compose-title"><header><div><p className="eyebrow">KOMUNIKASI TIM</p><h3 id="announcement-compose-title">Terbitkan pengumuman</h3></div><span>Outbox transaksional</span></header>{error?<p className="form-error leave-config-message" role="alert">{error}</p>:null}{message?<p className="invite-notice leave-config-message" role="status">{message}</p>:null}<div className="claim-config-body"><form className="employee-form announcement-form" onSubmit={submit}><label className="form-span">Judul<input aria-label="Judul pengumuman" value={title} required maxLength={180} onChange={(event)=>setTitle(event.target.value)} placeholder="Perubahan jadwal toko"/></label><label className="form-span">Isi<textarea aria-label="Isi pengumuman" value={body} required maxLength={10000} onChange={(event)=>setBody(event.target.value)} placeholder="Tulis informasi yang perlu diketahui tim."/></label><label>Prioritas<select aria-label="Prioritas pengumuman" value={priority} onChange={(event)=>setPriority(event.target.value)}><option value="NORMAL">Normal</option><option value="IMPORTANT">Penting</option><option value="URGENT">Mendesak</option></select></label><label>Audiens<select aria-label="Audiens pengumuman" value={role} onChange={(event)=>setRole(event.target.value)}><option value="ALL">Semua anggota</option><option value="EMPLOYEE">Karyawan</option><option value="SUPERVISOR">Supervisor</option><option value="HR">HR</option></select></label><label className="form-span publish-check"><input type="checkbox" checked={requiresAck} onChange={(event)=>setRequiresAck(event.target.checked)}/>Wajib dikonfirmasi oleh penerima</label><div className="form-span"><button className="small-primary" disabled={saving}>{saving?"Menerbitkan…":"Terbitkan sekarang"}</button></div></form></div></section>;
}

function ShiftRequestQueue({
  token,
  requests,
  loading,
  onDecided,
}: {
  token: string;
  requests: ShiftRequestAdmin[];
  loading: boolean;
  onDecided: () => void;
}) {
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  async function decide(id: string, decision: "APPROVED" | "REJECTED") {
    setSaving(id + decision);
    setError("");
    try {
      await request(
        `/shift-requests/${id}/decision`,
        { method: "POST", body: JSON.stringify({ decision }) },
        token,
      );
      onDecided();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Keputusan shift gagal disimpan.");
    } finally {
      setSaving("");
    }
  }
  return (
    <section className="approval-queue" aria-label="Permintaan open shift">
      <header><div><p className="eyebrow">OPEN SHIFT</p><h3>Permintaan shift</h3></div><span>{requests.length} menunggu</span></header>
      {error ? <p className="form-error approval-message">{error}</p> : null}
      {!loading && requests.length === 0 ? <div className="approval-empty"><ShieldCheck size={22} /><div><strong>Tidak ada permintaan shift</strong><span>Permintaan baru akan muncul di sini.</span></div></div> : null}
      <div className="approval-list">
        {requests.map((item) => <article className="approval-row" key={item.id}><div className="approval-person"><span>{item.employeeName.slice(0,1)}</span><div><strong>{item.employeeName}</strong><small>{item.employeeNumber}</small></div></div><div className="approval-detail"><strong>{item.shiftTitle}</strong><small>{item.reason || "Tanpa catatan tambahan"}</small></div><div className="approval-actions"><button className="reject-button" disabled={Boolean(saving)} onClick={() => void decide(item.id,"REJECTED")}>Tolak shift</button><button className="approve-button" disabled={Boolean(saving)} onClick={() => void decide(item.id,"APPROVED")}>{saving === item.id+"APPROVED" ? "Menyimpan…" : "Setujui shift"}</button></div></article>)}
      </div>
    </section>
  );
}

function ApprovalQueue({
  token,
  requests,
  loading,
  onDecided,
}: {
  token: string;
  requests: AttendanceRequestAdmin[];
  loading: boolean;
  onDecided: () => void;
}) {
  const timezone = useOrganizationTimeZone();
  const [rejectingId, setRejectingId] = useState<string>();
  const [reason, setReason] = useState("");
  const [savingId, setSavingId] = useState<string>();
  const [error, setError] = useState("");

  async function decide(
    item: AttendanceRequestAdmin,
    decision: "APPROVED" | "REJECTED",
  ) {
    setSavingId(item.id);
    setError("");
    try {
      await request(
        `/attendance/requests/${encodeURIComponent(item.id)}/decision`,
        {
          method: "POST",
          body: JSON.stringify({
            decision,
            reason: decision === "REJECTED" ? reason.trim() : undefined,
          }),
        },
        token,
      );
      setRejectingId(undefined);
      setReason("");
      onDecided();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Keputusan belum dapat disimpan.",
      );
    } finally {
      setSavingId(undefined);
    }
  }

  return (
    <section className="approval-queue" aria-labelledby="approval-title">
      <header>
        <div>
          <p className="eyebrow">PERSETUJUAN ABSENSI</p>
          <h3 id="approval-title">Keputusan yang perlu ditinjau</h3>
        </div>
        <span>{requests.length} menunggu</span>
      </header>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading && requests.length === 0 ? (
        <p className="muted approval-message">Memuat antrean…</p>
      ) : null}
      {!loading && requests.length === 0 ? (
        <div className="approval-empty">
          <ShieldCheck size={24} />
          <div>
            <strong>Semua sudah ditinjau</strong>
            <span>Tidak ada permintaan absensi yang menunggu keputusan.</span>
          </div>
        </div>
      ) : null}
      <div className="approval-list">
        {requests.map((item) => {
          const isRejecting = rejectingId === item.id;
          const isSaving = savingId === item.id;
          return (
            <article className="approval-row" key={item.id}>
              <div className="approval-person">
                <span>{item.employeeName.slice(0, 1).toUpperCase()}</span>
                <div>
                  <strong>{item.employeeName}</strong>
                  <small>{item.employeeNumber}</small>
                </div>
              </div>
              <div className="approval-detail">
                <strong>{actionLabel(item.actionType)}</strong>
                <span>
                  {formatInstant(new Date(item.recordedAt), timezone, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                {item.reason ? <small>“{item.reason}”</small> : null}
              </div>
              <div className="approval-actions">
                {isRejecting ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (reason.trim()) void decide(item, "REJECTED");
                    }}
                  >
                    <label htmlFor={`rejection-${item.id}`}>
                      Alasan penolakan
                    </label>
                    <textarea
                      id={`rejection-${item.id}`}
                      maxLength={500}
                      autoFocus
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      required
                    />
                    <div>
                      <button
                        className="reject-confirm"
                        disabled={isSaving || !reason.trim()}
                      >
                        {isSaving ? "Menyimpan…" : "Tolak permintaan"}
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          setRejectingId(undefined);
                          setReason("");
                        }}
                      >
                        Batal
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <button
                      className="approve-button"
                      disabled={isSaving}
                      onClick={() => void decide(item, "APPROVED")}
                    >
                      {isSaving ? "Menyimpan…" : "Setujui"}
                    </button>
                    <button
                      className="reject-button"
                      disabled={isSaving}
                      onClick={() => {
                        setError("");
                        setRejectingId(item.id);
                        setReason("");
                      }}
                    >
                      Tolak
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function SectionStatusButton({
  token,
  section,
  onChanged,
}: {
  token: string;
  section: Section;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const active = section.status === "ACTIVE";
  async function change() {
    setSaving(true);
    try {
      await request(
        `/sections/${encodeURIComponent(section.id)}/${active ? "deactivate" : "activate"}`,
        { method: "POST" },
        token,
      );
      onChanged();
    } finally {
      setSaving(false);
    }
  }
  return (
    <button
      className={active ? "deactivate-link section-action" : "activate-link section-action"}
      disabled={saving}
      onClick={() => void change()}
    >
      {saving ? "…" : active ? "Nonaktifkan" : "Aktifkan"}
    </button>
  );
}

function SectionEditor({
  token,
  sections,
  onChanged,
}: {
  token: string;
  sections: Section[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedID, setSelectedID] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [timezone, setTimezone] = useState("Asia/Jakarta");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  function select(section: Section) {
    setSelectedID(section.id);
    setCode(section.code);
    setName(section.name);
    setAddress(section.address ?? "");
    setTimezone(section.timezone ?? "Asia/Jakarta");
    setLatitude(section.latitude?.toString() ?? "");
    setLongitude(section.longitude?.toString() ?? "");
  }
  function begin() {
    if (sections[0]) select(sections[0]);
    setOpen(true);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await request(
        `/sections/${encodeURIComponent(selectedID)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            code,
            name,
            address,
            timezone,
            latitude: latitude ? Number(latitude) : undefined,
            longitude: longitude ? Number(longitude) : undefined,
          }),
        },
        token,
      );
      setOpen(false);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Lokasi gagal diperbarui.");
    } finally {
      setSaving(false);
    }
  }
  if (!open) {
    return (
      <button className="text-button add-resource" disabled={!sections.length} onClick={begin}>
        Edit lokasi
      </button>
    );
  }
  return (
    <form className="employee-form location-editor" onSubmit={submit}>
      <label className="form-span">
        Pilih lokasi
        <select
          value={selectedID}
          onChange={(event) => {
            const section = sections.find((item) => item.id === event.target.value);
            if (section) select(section);
          }}
        >
          {sections.map((section) => (
            <option key={section.id} value={section.id}>{section.name}</option>
          ))}
        </select>
      </label>
      <label>Kode<input value={code} onChange={(event) => setCode(event.target.value)} required /></label>
      <label>Nama<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
      <label className="form-span">Alamat<input value={address} onChange={(event) => setAddress(event.target.value)} /></label>
      <label className="form-span">Timezone<input value={timezone} onChange={(event) => setTimezone(event.target.value)} required /></label>
      <label>Latitude<input type="number" step="any" value={latitude} onChange={(event) => setLatitude(event.target.value)} /></label>
      <label>Longitude<input type="number" step="any" value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label>
      {error ? <small className="form-error form-span">{error}</small> : null}
      <div className="form-span">
        <button className="small-primary" disabled={saving}>{saving ? "Menyimpan…" : "Simpan lokasi"}</button>
        <button type="button" className="text-button" onClick={() => setOpen(false)}>Batal</button>
      </div>
    </form>
  );
}

function QuickSectionForm({
  token,
  onCreated,
}: {
  token: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await request<{ id: string }>(
        "/sections",
        {
          method: "POST",
          body: JSON.stringify({ code, name, timezone: "Asia/Jakarta" }),
        },
        token,
      );
      setCode("");
      setName("");
      setOpen(false);
      onCreated();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Lokasi gagal dibuat.",
      );
    } finally {
      setSaving(false);
    }
  }
  if (!open)
    return (
      <button
        className="text-button add-resource"
        onClick={() => setOpen(true)}
      >
        + Tambah lokasi
      </button>
    );
  return (
    <form className="quick-form" onSubmit={submit}>
      <input
        aria-label="Kode lokasi"
        placeholder="Kode"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        required
      />
      <input
        aria-label="Nama lokasi"
        placeholder="Nama lokasi"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      {error ? <small className="form-error">{error}</small> : null}
      <div>
        <button className="small-primary" disabled={saving}>
          {saving ? "Menyimpan…" : "Simpan"}
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => setOpen(false)}
        >
          Batal
        </button>
      </div>
    </form>
  );
}

function actionLabel(action: string) {
  return (
    (
      {
        CLOCK_IN: "Clock-in",
        CLOCK_OUT: "Clock-out",
        START_BREAK: "Mulai istirahat",
        END_BREAK: "Selesai istirahat",
        WORK_MORE: "Kerja tambahan",
        AUTO_CLOCK_OUT: "Clock-out otomatis",
        CORRECTION: "Koreksi absensi",
      } as Record<string, string>
    )[action] ?? action
  );
}

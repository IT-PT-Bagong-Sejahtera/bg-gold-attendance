package controllers

import (
	"database/sql"
	"encoding/csv"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/bg-gold/attendance-api/common"
	"github.com/bg-gold/attendance-api/services/auth"
)

type supervisorAttendanceReportRow struct {
	MembershipID   string     `json:"membershipId"`
	EmployeeName   string     `json:"employeeName"`
	EmployeeNumber string     `json:"employeeNumber"`
	SectionName    string     `json:"sectionName"`
	ShiftTitle     string     `json:"shiftTitle"`
	ShiftStartsAt  time.Time  `json:"shiftStartsAt"`
	ShiftEndsAt    time.Time  `json:"shiftEndsAt"`
	ClockInAt      *time.Time `json:"clockInAt,omitempty"`
	ClockOutAt     *time.Time `json:"clockOutAt,omitempty"`
	WorkMinutes    int        `json:"workMinutes"`
	Status         string     `json:"status"`
}

func (s *Server) supervisorAttendanceReport(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	var organizationName, timezone string
	if err := s.db.QueryRowContext(r.Context(), `SELECT name,timezone FROM organizations WHERE id=UUID_TO_BIN(?)`, p.OrganizationID).Scan(&organizationName, &timezone); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	localNow := time.Now().In(location)
	dateText := strings.TrimSpace(r.URL.Query().Get("date"))
	if dateText == "" {
		dateText = localNow.Format("2006-01-02")
	}
	day, err := time.ParseInLocation("2006-01-02", dateText, location)
	if err != nil {
		writeValidation(w, r, "Tanggal laporan tidak valid.")
		return
	}
	from, to := day.UTC(), day.AddDate(0, 0, 1).UTC()
	rows, err := s.db.QueryContext(r.Context(), `
		SELECT BIN_TO_UUID(m.id),u.full_name,m.employee_number,COALESCE(sec.name,'Tanpa lokasi'),COALESCE(sh.title,'Tanpa shift'),
		       COALESCE(sh.starts_at,?),COALESCE(sh.ends_at,?),
		       MIN(CASE WHEN e.action_type='CLOCK_IN' AND e.decision='APPROVED' THEN e.server_recorded_at END),
		       MAX(CASE WHEN e.action_type IN ('CLOCK_OUT','AUTO_CLOCK_OUT') AND e.decision='APPROVED' THEN e.server_recorded_at END)
		FROM organization_memberships m
		JOIN users u ON u.id=m.user_id
		LEFT JOIN shift_assignments sa ON sa.membership_id=m.id AND sa.status<>'CANCELLED'
		LEFT JOIN shifts sh ON sh.id=sa.shift_id AND sh.status='PUBLISHED' AND sh.starts_at<? AND sh.ends_at>?
		LEFT JOIN sections sec ON sec.id=sh.section_id
		LEFT JOIN attendance_events e ON e.membership_id=m.id AND e.server_recorded_at>=? AND e.server_recorded_at<?
		WHERE m.organization_id=UUID_TO_BIN(?) AND m.status='ACTIVE'
		GROUP BY m.id,u.full_name,m.employee_number,sec.name,sh.id,sh.title,sh.starts_at,sh.ends_at
		ORDER BY u.full_name`, from, to, to, from, from, to, p.OrganizationID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer rows.Close()
	items := []supervisorAttendanceReportRow{}
	for rows.Next() {
		var item supervisorAttendanceReportRow
		var clockIn, clockOut sql.NullTime
		if err := rows.Scan(&item.MembershipID, &item.EmployeeName, &item.EmployeeNumber, &item.SectionName, &item.ShiftTitle, &item.ShiftStartsAt, &item.ShiftEndsAt, &clockIn, &clockOut); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		item.Status = "ABSENT"
		if clockIn.Valid {
			value := clockIn.Time
			item.ClockInAt = &value
			item.Status = "ON_TIME"
			if clockIn.Time.After(item.ShiftStartsAt) {
				item.Status = "LATE"
			}
			if clockOut.Valid {
				out := clockOut.Time
				item.ClockOutAt = &out
				item.WorkMinutes = int(out.Sub(clockIn.Time).Minutes())
			} else {
				item.Status = "WORKING"
			}
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": map[string]any{"date": dateText, "generatedAt": time.Now().UTC(), "organizationName": organizationName, "rows": items}, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) exportAttendanceCSV(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	from, to, ok := reportRange(w, r)
	if !ok {
		return
	}
	items, err := s.queryAttendanceRecords(r.Context(), p.OrganizationID, strings.TrimSpace(r.URL.Query().Get("membershipId")), from, to, 50000)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	startCSV(w, "bg-gold-attendance.csv")
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"employee_number", "employee_name", "action", "decision", "recorded_at", "reason", "corrected", "correction_reason"})
	for _, item := range items {
		action, recordedAt, corrected, correctionReason := item.ActionType, item.RecordedAt, "false", ""
		if item.LatestCorrection != nil {
			action = item.LatestCorrection.CorrectedActionType
			recordedAt = item.LatestCorrection.CorrectedRecordedAt
			corrected = "true"
			correctionReason = item.LatestCorrection.Reason
		}
		reason := ""
		if item.Reason != nil {
			reason = *item.Reason
		}
		_ = writer.Write([]string{item.EmployeeNumber, item.EmployeeName, action, item.Decision, recordedAt.UTC().Format(time.RFC3339), reason, corrected, correctionReason})
	}
	writer.Flush()
}

func (s *Server) exportTimesheetsCSV(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	from, to, ok := reportRange(w, r)
	if !ok {
		return
	}
	events, err := s.loadTimesheetEvents(r, p.OrganizationID, strings.TrimSpace(r.URL.Query().Get("membershipId")), from, to)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var timezone string
	if err = s.db.QueryRowContext(r.Context(), `SELECT timezone FROM organizations WHERE id=UUID_TO_BIN(?)`, p.OrganizationID).Scan(&timezone); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	location, err := time.LoadLocation(timezone)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	items := buildTimesheetSummaries(events, location)
	startCSV(w, "bg-gold-timesheets.csv")
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"employee_number", "employee_name", "date", "first_clock_in", "last_clock_out", "gross_minutes", "actual_break_minutes", "rounded_break_minutes", "net_minutes"})
	for _, item := range items {
		first, last := "", ""
		if item.FirstClockIn != nil {
			first = item.FirstClockIn.UTC().Format(time.RFC3339)
		}
		if item.LastClockOut != nil {
			last = item.LastClockOut.UTC().Format(time.RFC3339)
		}
		_ = writer.Write([]string{item.EmployeeNumber, item.EmployeeName, item.Date, first, last, strconv.Itoa(item.GrossMinutes), strconv.Itoa(item.ActualBreakMinutes), strconv.Itoa(item.RoundedBreakMinutes), strconv.Itoa(item.NetMinutes)})
	}
	writer.Flush()
}

func reportRange(w http.ResponseWriter, r *http.Request) (time.Time, time.Time, bool) {
	now := time.Now().UTC()
	from, err := parseTimeQuery(r, "from", now.AddDate(0, 0, -31))
	if err != nil {
		writeValidation(w, r, "Tanggal mulai tidak valid.")
		return time.Time{}, time.Time{}, false
	}
	to, err := parseTimeQuery(r, "to", now.AddDate(0, 0, 1))
	if err != nil || !to.After(from) || to.Sub(from) > 366*24*time.Hour {
		writeValidation(w, r, "Rentang tanggal tidak valid.")
		return time.Time{}, time.Time{}, false
	}
	return from.UTC(), to.UTC(), true
}

func startCSV(w http.ResponseWriter, filename string) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte{0xEF, 0xBB, 0xBF})
}

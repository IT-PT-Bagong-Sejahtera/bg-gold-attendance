package controllers

import (
	"database/sql"
	"encoding/json"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/bg-gold/attendance-api/common"
	"github.com/bg-gold/attendance-api/services/auth"
)

type timesheetSummaryItem struct {
	MembershipID        string     `json:"membershipId"`
	EmployeeName        string     `json:"employeeName"`
	EmployeeNumber      string     `json:"employeeNumber"`
	Date                string     `json:"date"`
	FirstClockIn        *time.Time `json:"firstClockIn,omitempty"`
	LastClockOut        *time.Time `json:"lastClockOut,omitempty"`
	GrossMinutes        int        `json:"grossMinutes"`
	ActualBreakMinutes  int        `json:"actualBreakMinutes"`
	RoundedBreakMinutes int        `json:"roundedBreakMinutes"`
	NetMinutes          int        `json:"netMinutes"`
}

type timesheetEvent struct {
	MembershipID   string
	EmployeeName   string
	EmployeeNumber string
	ActionType     string
	Decision       string
	RecordedAt     time.Time
	Rounding       uint16
}

type timesheetState struct {
	workingAt *time.Time
	breakAt   *time.Time
	rounding  uint16
}

func (s *Server) listTimesheetSummaries(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	now := time.Now().UTC()
	from, err := parseTimeQuery(r, "from", now.AddDate(0, 0, -31))
	if err != nil {
		writeValidation(w, r, "Tanggal mulai tidak valid.")
		return
	}
	to, err := parseTimeQuery(r, "to", now.AddDate(0, 0, 1))
	if err != nil || !to.After(from) || to.Sub(from) > 366*24*time.Hour {
		writeValidation(w, r, "Rentang tanggal tidak valid.")
		return
	}
	membershipID := strings.TrimSpace(r.URL.Query().Get("membershipId"))
	events, err := s.loadTimesheetEvents(r, p.OrganizationID, membershipID, from.UTC(), to.UTC())
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
	httpx.JSON(w, http.StatusOK, map[string]any{"data": items, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) loadTimesheetEvents(r *http.Request, organizationID, membershipID string, from, to time.Time) ([]timesheetEvent, error) {
	query := `SELECT BIN_TO_UUID(e.membership_id),u.full_name,m.employee_number,e.action_type,COALESCE(ad.decision,e.decision),e.server_recorded_at,CAST(e.policy_snapshot AS CHAR),CAST(ce.policy_snapshot AS CHAR)
		FROM attendance_events e
		JOIN organization_memberships m ON m.id=e.membership_id
		JOIN users u ON u.id=m.user_id
		LEFT JOIN attendance_requests ar ON ar.attendance_event_id=e.id
		LEFT JOIN attendance_decisions ad ON ad.request_id=ar.id
		LEFT JOIN attendance_corrections c ON c.id=(SELECT c2.id FROM attendance_corrections c2 WHERE c2.original_event_id=e.id ORDER BY c2.created_at DESC LIMIT 1)
		LEFT JOIN attendance_events ce ON ce.id=c.correction_event_id
		WHERE e.organization_id=UUID_TO_BIN(?) AND e.action_type<>'CORRECTION' AND e.server_recorded_at>=? AND e.server_recorded_at<?`
	args := []any{organizationID, from, to}
	if membershipID != "" {
		query += ` AND e.membership_id=UUID_TO_BIN(?)`
		args = append(args, membershipID)
	}
	query += ` ORDER BY e.membership_id,e.server_recorded_at`
	rows, err := s.db.QueryContext(r.Context(), query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []timesheetEvent{}
	for rows.Next() {
		var event timesheetEvent
		var policySnapshot, correctionSnapshot sql.NullString
		if err = rows.Scan(&event.MembershipID, &event.EmployeeName, &event.EmployeeNumber, &event.ActionType, &event.Decision, &event.RecordedAt, &policySnapshot, &correctionSnapshot); err != nil {
			return nil, err
		}
		if event.Decision != "APPROVED" {
			continue
		}
		if policySnapshot.Valid {
			var policy struct {
				BreakRoundingMinutes *uint16
			}
			if json.Unmarshal([]byte(policySnapshot.String), &policy) == nil && policy.BreakRoundingMinutes != nil {
				event.Rounding = *policy.BreakRoundingMinutes
			}
		}
		if correctionSnapshot.Valid {
			var correction struct {
				ActionType string    `json:"correctedActionType"`
				RecordedAt time.Time `json:"correctedRecordedAt"`
			}
			if json.Unmarshal([]byte(correctionSnapshot.String), &correction) == nil {
				if correction.ActionType != "" {
					event.ActionType = correction.ActionType
				}
				if !correction.RecordedAt.IsZero() {
					event.RecordedAt = correction.RecordedAt.UTC()
				}
			}
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func buildTimesheetSummaries(events []timesheetEvent, location *time.Location) []timesheetSummaryItem {
	sort.SliceStable(events, func(i, j int) bool {
		if events[i].MembershipID == events[j].MembershipID {
			return events[i].RecordedAt.Before(events[j].RecordedAt)
		}
		return events[i].MembershipID < events[j].MembershipID
	})
	states := map[string]*timesheetState{}
	summaries := map[string]*timesheetSummaryItem{}
	getSummary := func(event timesheetEvent, at time.Time) *timesheetSummaryItem {
		date := at.In(location).Format("2006-01-02")
		key := event.MembershipID + ":" + date
		if summaries[key] == nil {
			summaries[key] = &timesheetSummaryItem{MembershipID: event.MembershipID, EmployeeName: event.EmployeeName, EmployeeNumber: event.EmployeeNumber, Date: date}
		}
		return summaries[key]
	}
	for _, event := range events {
		state := states[event.MembershipID]
		if state == nil {
			state = &timesheetState{}
			states[event.MembershipID] = state
		}
		switch event.ActionType {
		case "CLOCK_IN", "WORK_MORE":
			if state.workingAt == nil {
				value := event.RecordedAt
				state.workingAt = &value
			}
		case "START_BREAK":
			if state.breakAt == nil {
				value := event.RecordedAt
				state.breakAt = &value
				state.rounding = event.Rounding
			}
		case "END_BREAK":
			if state.breakAt != nil && event.RecordedAt.After(*state.breakAt) {
				summary := getSummary(event, *state.breakAt)
				duration := event.RecordedAt.Sub(*state.breakAt)
				summary.ActualBreakMinutes += nearestMinute(duration)
				summary.RoundedBreakMinutes += roundBreakDuration(duration, state.rounding)
			}
			state.breakAt = nil
			state.rounding = 0
		case "CLOCK_OUT", "AUTO_CLOCK_OUT":
			if state.workingAt != nil && event.RecordedAt.After(*state.workingAt) {
				summary := getSummary(event, *state.workingAt)
				summary.GrossMinutes += nearestMinute(event.RecordedAt.Sub(*state.workingAt))
				if summary.FirstClockIn == nil || state.workingAt.Before(*summary.FirstClockIn) {
					value := *state.workingAt
					summary.FirstClockIn = &value
				}
				if summary.LastClockOut == nil || event.RecordedAt.After(*summary.LastClockOut) {
					value := event.RecordedAt
					summary.LastClockOut = &value
				}
			}
			state.workingAt = nil
			state.breakAt = nil
			state.rounding = 0
		}
	}
	items := make([]timesheetSummaryItem, 0, len(summaries))
	for _, summary := range summaries {
		summary.NetMinutes = summary.GrossMinutes - summary.RoundedBreakMinutes
		if summary.NetMinutes < 0 {
			summary.NetMinutes = 0
		}
		items = append(items, *summary)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Date == items[j].Date {
			return items[i].EmployeeName < items[j].EmployeeName
		}
		return items[i].Date > items[j].Date
	})
	return items
}

func nearestMinute(duration time.Duration) int {
	return int(math.Floor(duration.Minutes() + 0.5))
}

func roundBreakDuration(duration time.Duration, increment uint16) int {
	minutes := nearestMinute(duration)
	if increment == 0 {
		return minutes
	}
	step := int(increment)
	return ((minutes + step/2) / step) * step
}

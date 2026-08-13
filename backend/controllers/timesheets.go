package controllers

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/bg-gold/attendance-api/common"
	"github.com/bg-gold/attendance-api/services/auth"
)

type attendanceRecordItem struct {
	ID               string                    `json:"id"`
	MembershipID     string                    `json:"membershipId"`
	EmployeeName     string                    `json:"employeeName"`
	EmployeeNumber   string                    `json:"employeeNumber"`
	ActionType       string                    `json:"actionType"`
	Decision         string                    `json:"decision"`
	RecordedAt       time.Time                 `json:"recordedAt"`
	Reason           *string                   `json:"reason,omitempty"`
	LatestCorrection *attendanceCorrectionView `json:"latestCorrection,omitempty"`
}

type attendanceCorrectionView struct {
	EventID             string    `json:"eventId"`
	CorrectedActionType string    `json:"correctedActionType"`
	CorrectedRecordedAt time.Time `json:"correctedRecordedAt"`
	Reason              string    `json:"reason"`
	CreatedAt           time.Time `json:"createdAt"`
}

func (s *Server) listAttendanceRecords(w http.ResponseWriter, r *http.Request) {
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
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	membershipID := strings.TrimSpace(r.URL.Query().Get("membershipId"))
	items, err := s.queryAttendanceRecords(r.Context(), p.OrganizationID, membershipID, from.UTC(), to.UTC(), limit)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": items, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) queryAttendanceRecords(ctx context.Context, organizationID, membershipID string, from, to time.Time, limit int) ([]attendanceRecordItem, error) {
	query := `SELECT BIN_TO_UUID(e.id),BIN_TO_UUID(e.membership_id),u.full_name,m.employee_number,e.action_type,COALESCE(ad.decision,e.decision),e.server_recorded_at,e.reason,BIN_TO_UUID(c.correction_event_id),c.reason,ce.policy_snapshot,c.created_at FROM attendance_events e JOIN organization_memberships m ON m.id=e.membership_id JOIN users u ON u.id=m.user_id LEFT JOIN attendance_requests ar ON ar.attendance_event_id=e.id LEFT JOIN attendance_decisions ad ON ad.request_id=ar.id LEFT JOIN attendance_corrections c ON c.id=(SELECT c2.id FROM attendance_corrections c2 WHERE c2.original_event_id=e.id ORDER BY c2.created_at DESC LIMIT 1) LEFT JOIN attendance_events ce ON ce.id=c.correction_event_id WHERE e.organization_id=UUID_TO_BIN(?) AND e.action_type<>'CORRECTION' AND e.server_recorded_at>=? AND e.server_recorded_at<?`
	args := []any{organizationID, from.UTC(), to.UTC()}
	if membershipID != "" {
		query += ` AND e.membership_id=UUID_TO_BIN(?)`
		args = append(args, membershipID)
	}
	query += ` ORDER BY e.server_recorded_at DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []attendanceRecordItem{}
	for rows.Next() {
		var item attendanceRecordItem
		var reason, correctionEventID, correctionReason, snapshot sql.NullString
		var correctionCreatedAt sql.NullTime
		if err = rows.Scan(&item.ID, &item.MembershipID, &item.EmployeeName, &item.EmployeeNumber, &item.ActionType, &item.Decision, &item.RecordedAt, &reason, &correctionEventID, &correctionReason, &snapshot, &correctionCreatedAt); err != nil {
			return nil, err
		}
		if reason.Valid {
			item.Reason = &reason.String
		}
		if correctionEventID.Valid && snapshot.Valid && correctionCreatedAt.Valid {
			var corrected struct {
				ActionType string    `json:"correctedActionType"`
				RecordedAt time.Time `json:"correctedRecordedAt"`
			}
			if json.Unmarshal([]byte(snapshot.String), &corrected) == nil {
				item.LatestCorrection = &attendanceCorrectionView{EventID: correctionEventID.String, CorrectedActionType: corrected.ActionType, CorrectedRecordedAt: corrected.RecordedAt, Reason: correctionReason.String, CreatedAt: correctionCreatedAt.Time}
			}
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

package controllers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/bg-gold/attendance-api/common"
	"github.com/bg-gold/attendance-api/helpers"
	"github.com/bg-gold/attendance-api/services/auth"
	"github.com/go-chi/chi/v5"
)

type attendanceRequestItem struct {
	ID             string     `json:"id"`
	EventID        string     `json:"eventId"`
	MembershipID   string     `json:"membershipId"`
	EmployeeName   string     `json:"employeeName"`
	EmployeeNumber string     `json:"employeeNumber"`
	ActionType     string     `json:"actionType"`
	Status         string     `json:"status"`
	RequestedAt    time.Time  `json:"requestedAt"`
	RecordedAt     time.Time  `json:"recordedAt"`
	Reason         *string    `json:"reason,omitempty"`
	DecidedAt      *time.Time `json:"decidedAt,omitempty"`
	DecisionReason *string    `json:"decisionReason,omitempty"`
	Source         string     `json:"source"`
	SectionID      *string    `json:"sectionId,omitempty"`
	AttachmentID   *string    `json:"attachmentId,omitempty"`
	Latitude       *float64   `json:"latitude,omitempty"`
	Longitude      *float64   `json:"longitude,omitempty"`
	AccuracyM      *float64   `json:"accuracyM,omitempty"`
}

func (s *Server) myAttendanceRequests(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	items, err := s.queryAttendanceRequests(r, p.OrganizationID, p.MembershipID, "")
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": items, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) listAttendanceRequests(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	status := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("status")))
	if status != "" && status != "PENDING" && status != "APPROVED" && status != "REJECTED" && status != "WITHDRAWN" {
		writeValidation(w, r, "Status permintaan tidak valid.")
		return
	}
	items, err := s.queryAttendanceRequests(r, p.OrganizationID, "", status)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": items, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) queryAttendanceRequests(r *http.Request, organizationID, membershipID, status string) ([]attendanceRequestItem, error) {
	query := `SELECT BIN_TO_UUID(ar.id),BIN_TO_UUID(e.id),BIN_TO_UUID(m.id),u.full_name,m.employee_number,e.action_type,ar.status,ar.requested_at,e.server_recorded_at,e.reason,ar.decided_at,ad.reason,e.source,BIN_TO_UUID(e.section_id),BIN_TO_UUID(ev.attachment_id),ev.latitude,ev.longitude,ev.accuracy_meters FROM attendance_requests ar JOIN attendance_events e ON e.id=ar.attendance_event_id JOIN organization_memberships m ON m.id=ar.membership_id JOIN users u ON u.id=m.user_id LEFT JOIN attendance_decisions ad ON ad.request_id=ar.id LEFT JOIN attendance_evidence ev ON ev.event_id=e.id WHERE ar.organization_id=UUID_TO_BIN(?)`
	args := []any{organizationID}
	if membershipID != "" {
		query += ` AND ar.membership_id=UUID_TO_BIN(?)`
		args = append(args, membershipID)
	}
	if status != "" {
		query += ` AND ar.status=?`
		args = append(args, status)
	}
	query += ` ORDER BY ar.requested_at DESC LIMIT 200`
	rows, err := s.db.QueryContext(r.Context(), query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []attendanceRequestItem{}
	for rows.Next() {
		var v attendanceRequestItem
		var reason, decisionReason sql.NullString
		var sectionID, attachmentID sql.NullString
		var latitude, longitude, accuracy sql.NullFloat64
		var decided sql.NullTime
		if err := rows.Scan(&v.ID, &v.EventID, &v.MembershipID, &v.EmployeeName, &v.EmployeeNumber, &v.ActionType, &v.Status, &v.RequestedAt, &v.RecordedAt, &reason, &decided, &decisionReason, &v.Source, &sectionID, &attachmentID, &latitude, &longitude, &accuracy); err != nil {
			return nil, err
		}
		if reason.Valid {
			v.Reason = &reason.String
		}
		if decided.Valid {
			v.DecidedAt = &decided.Time
		}
		if decisionReason.Valid {
			v.DecisionReason = &decisionReason.String
		}
		if sectionID.Valid {
			v.SectionID = &sectionID.String
		}
		if attachmentID.Valid {
			v.AttachmentID = &attachmentID.String
		}
		if latitude.Valid {
			v.Latitude = &latitude.Float64
		}
		if longitude.Valid {
			v.Longitude = &longitude.Float64
		}
		if accuracy.Valid {
			v.AccuracyM = &accuracy.Float64
		}
		items = append(items, v)
	}
	return items, rows.Err()
}

func (s *Server) decideAttendanceRequest(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	requestID := strings.TrimSpace(chi.URLParam(r, "requestID"))
	var in struct {
		Decision string `json:"decision"`
		Reason   string `json:"reason"`
	}
	if !httpx.DecodeJSON(w, r, &in) {
		return
	}
	in.Decision = strings.ToUpper(strings.TrimSpace(in.Decision))
	in.Reason = strings.TrimSpace(in.Reason)
	if in.Decision != "APPROVED" && in.Decision != "REJECTED" {
		writeValidation(w, r, "Keputusan harus APPROVED atau REJECTED.")
		return
	}
	if in.Decision == "REJECTED" && in.Reason == "" {
		writeValidation(w, r, "Alasan wajib diisi saat menolak permintaan.")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer tx.Rollback()
	var eventID, membershipID, actionType, status string
	var shiftID sql.NullString
	err = tx.QueryRowContext(r.Context(), `SELECT BIN_TO_UUID(ar.attendance_event_id),BIN_TO_UUID(ar.membership_id),e.action_type,ar.status,BIN_TO_UUID(e.shift_id) FROM attendance_requests ar JOIN attendance_events e ON e.id=ar.attendance_event_id WHERE ar.id=UUID_TO_BIN(?) AND ar.organization_id=UUID_TO_BIN(?) FOR UPDATE`, requestID, p.OrganizationID).Scan(&eventID, &membershipID, &actionType, &status, &shiftID)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, r, &httpx.Error{Status: http.StatusNotFound, Code: "REQUEST_NOT_FOUND", Message: "Permintaan tidak ditemukan."})
		return
	}
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if status != "PENDING" {
		httpx.WriteError(w, r, &httpx.Error{Status: http.StatusConflict, Code: "REQUEST_ALREADY_DECIDED", Message: "Permintaan ini sudah memiliki keputusan."})
		return
	}
	decisionID, _ := identity.NewUUID()
	now := time.Now().UTC()
	if _, err = tx.ExecContext(r.Context(), `INSERT INTO attendance_decisions(id,request_id,decided_by,decision,reason) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),?,NULLIF(?,''))`, decisionID, requestID, p.UserID, in.Decision, in.Reason); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if _, err = tx.ExecContext(r.Context(), `UPDATE attendance_requests SET status=?,decided_at=? WHERE id=UUID_TO_BIN(?)`, in.Decision, now, requestID); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if actionType == "CLOCK_IN" || actionType == "WORK_MORE" || actionType == "START_BREAK" {
		nextState := "NOT_STARTED"
		activeShift := ""
		if actionType == "WORK_MORE" {
			nextState = "COMPLETED"
		}
		if actionType == "START_BREAK" {
			nextState = "WORKING"
			if shiftID.Valid {
				activeShift = shiftID.String
			}
		}
		if in.Decision == "APPROVED" {
			if actionType == "START_BREAK" {
				nextState = "ON_BREAK"
			} else {
				nextState = "WORKING"
			}
			if shiftID.Valid {
				activeShift = shiftID.String
			}
		}
		if _, err = tx.ExecContext(r.Context(), `UPDATE attendance_state SET state=?,active_shift_id=UUID_TO_BIN(NULLIF(?,'')),version=version+1 WHERE membership_id=UUID_TO_BIN(?) AND state='PENDING' AND last_event_id=UUID_TO_BIN(?)`, nextState, activeShift, membershipID, eventID); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
	}
	if err = insertAudit(r.Context(), tx, p, "attendance.request.decision", "attendance_request", requestID, map[string]any{"decision": in.Decision, "eventId": eventID}); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": map[string]any{"id": requestID, "status": in.Decision, "decidedAt": now}, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) createAttendanceCorrection(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	var in struct {
		OriginalEventID     string    `json:"originalEventId"`
		CorrectedActionType string    `json:"correctedActionType"`
		CorrectedRecordedAt time.Time `json:"correctedRecordedAt"`
		Reason              string    `json:"reason"`
	}
	if !httpx.DecodeJSON(w, r, &in) {
		return
	}
	in.OriginalEventID = strings.TrimSpace(in.OriginalEventID)
	in.CorrectedActionType = strings.ToUpper(strings.TrimSpace(in.CorrectedActionType))
	in.Reason = strings.TrimSpace(in.Reason)
	allowed := map[string]bool{"CLOCK_IN": true, "CLOCK_OUT": true, "START_BREAK": true, "END_BREAK": true, "WORK_MORE": true}
	if in.OriginalEventID == "" || !allowed[in.CorrectedActionType] || in.CorrectedRecordedAt.IsZero() || in.Reason == "" {
		writeValidation(w, r, "Event asli, tindakan, waktu koreksi, dan alasan wajib diisi.")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer tx.Rollback()
	var membershipID, policyID string
	err = tx.QueryRowContext(r.Context(), `SELECT BIN_TO_UUID(membership_id),BIN_TO_UUID(policy_id) FROM attendance_events WHERE id=UUID_TO_BIN(?) AND organization_id=UUID_TO_BIN(?)`, in.OriginalEventID, p.OrganizationID).Scan(&membershipID, &policyID)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, r, &httpx.Error{Status: http.StatusNotFound, Code: "ATTENDANCE_EVENT_NOT_FOUND", Message: "Catatan absensi asli tidak ditemukan."})
		return
	}
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	correctionEventID, _ := identity.NewUUID()
	correctionID, _ := identity.NewUUID()
	snapshot, _ := json.Marshal(map[string]any{"correctedActionType": in.CorrectedActionType, "correctedRecordedAt": in.CorrectedRecordedAt.UTC(), "originalEventId": in.OriginalEventID})
	if _, err = tx.ExecContext(r.Context(), `INSERT INTO attendance_events(id,organization_id,membership_id,policy_id,action_type,decision,server_recorded_at,reason,policy_snapshot,source,created_by) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),'CORRECTION','APPROVED',UTC_TIMESTAMP(6),?,?, 'ADMIN',UUID_TO_BIN(?))`, correctionEventID, p.OrganizationID, membershipID, policyID, in.Reason, string(snapshot), p.UserID); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if _, err = tx.ExecContext(r.Context(), `INSERT INTO attendance_corrections(id,organization_id,original_event_id,correction_event_id,reason,created_by) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),?,UUID_TO_BIN(?))`, correctionID, p.OrganizationID, in.OriginalEventID, correctionEventID, in.Reason, p.UserID); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = insertAudit(r.Context(), tx, p, "attendance.correction.create", "attendance_correction", correctionID, map[string]any{"originalEventId": in.OriginalEventID, "correctionEventId": correctionEventID}); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"data": map[string]string{"id": correctionID, "correctionEventId": correctionEventID}, "requestId": httpx.RequestID(r.Context())})
}

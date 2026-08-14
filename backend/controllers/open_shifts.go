package controllers

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/bg-gold/attendance-api/common"
	"github.com/bg-gold/attendance-api/helpers"
	"github.com/bg-gold/attendance-api/services/auth"
	"github.com/go-chi/chi/v5"
)

type openShiftItem struct {
	shiftItem
	RequestStatus *string `json:"requestStatus"`
}

func (s *Server) myOpenShifts(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	from, to, ok := operationRange(w, r)
	if !ok {
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT BIN_TO_UUID(sh.id),sh.title,sh.role_name,sh.starts_at,sh.ends_at,sh.status,BIN_TO_UUID(sec.id),sec.name,sr.status FROM shifts sh JOIN sections sec ON sec.id=sh.section_id LEFT JOIN shift_requests sr ON sr.shift_id=sh.id AND sr.membership_id=UUID_TO_BIN(?) LEFT JOIN shift_assignments sa ON sa.shift_id=sh.id AND sa.membership_id=UUID_TO_BIN(?) AND sa.status<>'CANCELLED' WHERE sh.organization_id=UUID_TO_BIN(?) AND sh.status='PUBLISHED' AND sh.schedule_type='SHIFT' AND sh.is_open=TRUE AND sa.id IS NULL AND sh.starts_at<? AND sh.ends_at>? ORDER BY sh.starts_at`, p.MembershipID, p.MembershipID, p.OrganizationID, to.UTC(), from.UTC())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer rows.Close()
	items := []openShiftItem{}
	for rows.Next() {
		var v openShiftItem
		var role, requestStatus sql.NullString
		if err := rows.Scan(&v.ID, &v.Title, &role, &v.StartsAt, &v.EndsAt, &v.Status, &v.Section.ID, &v.Section.Name, &requestStatus); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if role.Valid {
			v.RoleName = &role.String
		}
		if requestStatus.Valid {
			v.RequestStatus = &requestStatus.String
		}
		items = append(items, v)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": items, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) requestOpenShift(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	shiftID := strings.TrimSpace(chi.URLParam(r, "shiftID"))
	var in struct {
		Reason string `json:"reason"`
	}
	if !httpx.DecodeJSON(w, r, &in) {
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer tx.Rollback()
	var available bool
	if err = tx.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM shifts WHERE id=UUID_TO_BIN(?) AND organization_id=UUID_TO_BIN(?) AND status='PUBLISHED' AND schedule_type='SHIFT' AND is_open=TRUE AND starts_at>UTC_TIMESTAMP(6))`, shiftID, p.OrganizationID).Scan(&available); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if !available {
		httpx.WriteError(w, r, &httpx.Error{Status: 404, Code: "OPEN_SHIFT_NOT_FOUND", Message: "Open shift tidak tersedia."})
		return
	}
	id, _ := identity.NewUUID()
	_, err = tx.ExecContext(r.Context(), `INSERT INTO shift_requests(id,organization_id,shift_id,membership_id,reason) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),NULLIF(?,''))`, id, p.OrganizationID, shiftID, p.MembershipID, strings.TrimSpace(in.Reason))
	if err != nil {
		httpx.WriteError(w, r, &httpx.Error{Status: 409, Code: "SHIFT_REQUEST_EXISTS", Message: "Permintaan untuk shift ini sudah ada.", Err: err})
		return
	}
	if err = insertAudit(r.Context(), tx, p, "shift.request", "shift_request", id, map[string]any{"shiftId": shiftID}); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, 201, map[string]any{"data": map[string]string{"id": id, "status": "PENDING"}, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) listShiftRequests(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	rows, err := s.db.QueryContext(r.Context(), `SELECT BIN_TO_UUID(sr.id),BIN_TO_UUID(sr.shift_id),sh.title,BIN_TO_UUID(sr.membership_id),u.full_name,m.employee_number,sr.status,sr.reason,sr.requested_at FROM shift_requests sr JOIN shifts sh ON sh.id=sr.shift_id JOIN organization_memberships m ON m.id=sr.membership_id JOIN users u ON u.id=m.user_id WHERE sr.organization_id=UUID_TO_BIN(?) AND sr.status=COALESCE(NULLIF(?,''),'PENDING') ORDER BY sr.requested_at`, p.OrganizationID, r.URL.Query().Get("status"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, shiftID, title, membershipID, name, number, status string
		var reason sql.NullString
		var requested time.Time
		if err = rows.Scan(&id, &shiftID, &title, &membershipID, &name, &number, &status, &reason, &requested); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		item := map[string]any{"id": id, "shiftId": shiftID, "shiftTitle": title, "membershipId": membershipID, "employeeName": name, "employeeNumber": number, "status": status, "requestedAt": requested}
		if reason.Valid {
			item["reason"] = reason.String
		}
		items = append(items, item)
	}
	httpx.JSON(w, 200, map[string]any{"data": items, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) decideShiftRequest(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	requestID := chi.URLParam(r, "requestID")
	var in struct {
		Decision string `json:"decision"`
		Reason   string `json:"reason"`
	}
	if !httpx.DecodeJSON(w, r, &in) {
		return
	}
	in.Decision = strings.ToUpper(strings.TrimSpace(in.Decision))
	if in.Decision != "APPROVED" && in.Decision != "REJECTED" {
		writeValidation(w, r, "Keputusan shift harus APPROVED atau REJECTED.")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer tx.Rollback()
	var shiftID, membershipID, status string
	var starts, ends time.Time
	err = tx.QueryRowContext(r.Context(), `SELECT BIN_TO_UUID(sr.shift_id),BIN_TO_UUID(sr.membership_id),sr.status,sh.starts_at,sh.ends_at FROM shift_requests sr JOIN shifts sh ON sh.id=sr.shift_id WHERE sr.id=UUID_TO_BIN(?) AND sr.organization_id=UUID_TO_BIN(?) FOR UPDATE`, requestID, p.OrganizationID).Scan(&shiftID, &membershipID, &status, &starts, &ends)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, r, &httpx.Error{Status: 404, Code: "SHIFT_REQUEST_NOT_FOUND", Message: "Permintaan shift tidak ditemukan."})
		return
	}
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if status != "PENDING" {
		httpx.WriteError(w, r, &httpx.Error{Status: 409, Code: "SHIFT_REQUEST_DECIDED", Message: "Permintaan shift sudah diputuskan."})
		return
	}
	if in.Decision == "APPROVED" {
		var conflicts int
		if err = tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM shift_assignments sa JOIN shifts sh ON sh.id=sa.shift_id WHERE sa.membership_id=UUID_TO_BIN(?) AND sa.status<>'CANCELLED' AND sh.status='PUBLISHED' AND sh.schedule_type='SHIFT' AND sh.starts_at<? AND sh.ends_at>?`, membershipID, ends, starts).Scan(&conflicts); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if conflicts > 0 {
			httpx.WriteError(w, r, &httpx.Error{Status: 409, Code: "SHIFT_CONFLICT", Message: "Karyawan memiliki jadwal yang bertumpang tindih."})
			return
		}
		assignmentID, _ := identity.NewUUID()
		if _, err = tx.ExecContext(r.Context(), `INSERT INTO shift_assignments(id,shift_id,membership_id) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?))`, assignmentID, shiftID, membershipID); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
	}
	_, err = tx.ExecContext(r.Context(), `UPDATE shift_requests SET status=?,decided_at=UTC_TIMESTAMP(6),decided_by=UUID_TO_BIN(?),decision_reason=NULLIF(?,'') WHERE id=UUID_TO_BIN(?)`, in.Decision, p.UserID, strings.TrimSpace(in.Reason), requestID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = insertAudit(r.Context(), tx, p, "shift.request.decide", "shift_request", requestID, map[string]any{"decision": in.Decision}); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, 200, map[string]any{"data": map[string]string{"id": requestID, "status": in.Decision}, "requestId": httpx.RequestID(r.Context())})
}

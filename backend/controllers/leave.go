package controllers

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/bg-gold/attendance-api/common"
	"github.com/bg-gold/attendance-api/helpers"
	"github.com/bg-gold/attendance-api/services/auth"
	"github.com/go-chi/chi/v5"
)

const leaveDateLayout = "2006-01-02"

type leaveRequestItem struct {
	ID             string     `json:"id"`
	MembershipID   string     `json:"membershipId"`
	EmployeeName   string     `json:"employeeName"`
	EmployeeNumber string     `json:"employeeNumber"`
	LeaveTypeID    string     `json:"leaveTypeId"`
	LeaveTypeName  string     `json:"leaveTypeName"`
	StartsOn       string     `json:"startsOn"`
	EndsOn         string     `json:"endsOn"`
	TotalDays      float64    `json:"totalDays"`
	Reason         string     `json:"reason"`
	Status         string     `json:"status"`
	RequestedAt    time.Time  `json:"requestedAt"`
	DecisionReason *string    `json:"decisionReason,omitempty"`
	DecidedAt      *time.Time `json:"decidedAt,omitempty"`
}

func (s *Server) listLeaveTypes(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	rows, err := s.db.QueryContext(r.Context(), `SELECT BIN_TO_UUID(id),code,name,paid,status FROM leave_types WHERE organization_id=UUID_TO_BIN(?) AND status='ACTIVE' ORDER BY name`, p.OrganizationID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, code, name, status string
		var paid bool
		if err = rows.Scan(&id, &code, &name, &paid, &status); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		items = append(items, map[string]any{"id": id, "code": code, "name": name, "paid": paid, "status": status})
	}
	httpx.JSON(w, 200, map[string]any{"data": items, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) createLeaveType(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	var in struct {
		Code string `json:"code"`
		Name string `json:"name"`
		Paid *bool  `json:"paid"`
	}
	if !httpx.DecodeJSON(w, r, &in) {
		return
	}
	in.Code = strings.ToUpper(strings.TrimSpace(in.Code))
	in.Name = strings.TrimSpace(in.Name)
	if in.Code == "" || in.Name == "" {
		writeValidation(w, r, "Kode dan nama jenis cuti wajib diisi.")
		return
	}
	paid := true
	if in.Paid != nil {
		paid = *in.Paid
	}
	id, _ := identity.NewUUID()
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(r.Context(), `INSERT INTO leave_types(id,organization_id,code,name,paid) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),?,?,?)`, id, p.OrganizationID, in.Code, in.Name, paid); err != nil {
		writeConflict(w, r, "LEAVE_TYPE_EXISTS", "Kode jenis cuti sudah digunakan.", err)
		return
	}
	if err = insertAudit(r.Context(), tx, p, "leave.type.create", "leave_type", id, map[string]any{"code": in.Code}); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, 201, map[string]any{"data": map[string]string{"id": id}, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) setLeaveBalance(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	var in struct {
		MembershipID    string  `json:"membershipId"`
		LeaveTypeID     string  `json:"leaveTypeId"`
		Year            int     `json:"year"`
		EntitlementDays float64 `json:"entitlementDays"`
	}
	if !httpx.DecodeJSON(w, r, &in) {
		return
	}
	if in.Year < 2000 || in.Year > 2200 || in.EntitlementDays < 0 || in.EntitlementDays > 366 {
		writeValidation(w, r, "Tahun atau jatah cuti tidak valid.")
		return
	}
	id, _ := identity.NewUUID()
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer tx.Rollback()
	var committedDays float64
	err = tx.QueryRowContext(r.Context(), `SELECT COALESCE(lb.used_days+lb.pending_days,0) FROM organization_memberships m JOIN leave_types lt ON lt.id=UUID_TO_BIN(?) AND lt.organization_id=m.organization_id AND lt.status='ACTIVE' LEFT JOIN leave_balances lb ON lb.membership_id=m.id AND lb.leave_type_id=lt.id AND lb.balance_year=? WHERE m.id=UUID_TO_BIN(?) AND m.organization_id=UUID_TO_BIN(?) AND m.status='ACTIVE'`, in.LeaveTypeID, in.Year, in.MembershipID, p.OrganizationID).Scan(&committedDays)
	if errors.Is(err, sql.ErrNoRows) {
		writeValidation(w, r, "Karyawan atau jenis cuti tidak valid.")
		return
	}
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if in.EntitlementDays < committedDays {
		writeValidation(w, r, "Jatah cuti tidak boleh lebih kecil dari jumlah yang sudah digunakan atau sedang menunggu.")
		return
	}
	_, err = tx.ExecContext(r.Context(), `INSERT INTO leave_balances(id,organization_id,membership_id,leave_type_id,balance_year,entitlement_days) SELECT UUID_TO_BIN(?),UUID_TO_BIN(?),m.id,lt.id,?,? FROM organization_memberships m JOIN leave_types lt ON lt.id=UUID_TO_BIN(?) AND lt.organization_id=m.organization_id AND lt.status='ACTIVE' WHERE m.id=UUID_TO_BIN(?) AND m.organization_id=UUID_TO_BIN(?) AND m.status='ACTIVE' ON DUPLICATE KEY UPDATE entitlement_days=VALUES(entitlement_days)`, id, p.OrganizationID, in.Year, in.EntitlementDays, in.LeaveTypeID, in.MembershipID, p.OrganizationID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var balanceID string
	if err = tx.QueryRowContext(r.Context(), `SELECT BIN_TO_UUID(id) FROM leave_balances WHERE membership_id=UUID_TO_BIN(?) AND leave_type_id=UUID_TO_BIN(?) AND balance_year=?`, in.MembershipID, in.LeaveTypeID, in.Year).Scan(&balanceID); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = insertAudit(r.Context(), tx, p, "leave.balance.set", "leave_balance", balanceID, map[string]any{"year": in.Year, "entitlementDays": in.EntitlementDays}); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, 200, map[string]any{"data": map[string]any{"id": balanceID, "entitlementDays": in.EntitlementDays}, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) myLeaveBalances(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	year, _ := strconv.Atoi(r.URL.Query().Get("year"))
	if year == 0 {
		year = time.Now().In(time.UTC).Year()
	}
	rows, err := s.db.QueryContext(r.Context(), `SELECT BIN_TO_UUID(lb.id),BIN_TO_UUID(lt.id),lt.name,lb.balance_year,lb.entitlement_days,lb.used_days,lb.pending_days FROM leave_balances lb JOIN leave_types lt ON lt.id=lb.leave_type_id WHERE lb.organization_id=UUID_TO_BIN(?) AND lb.membership_id=UUID_TO_BIN(?) AND lb.balance_year=? ORDER BY lt.name`, p.OrganizationID, p.MembershipID, year)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, typeID, name string
		var y int
		var entitlement, used, pending float64
		if err = rows.Scan(&id, &typeID, &name, &y, &entitlement, &used, &pending); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		items = append(items, map[string]any{"id": id, "leaveTypeId": typeID, "leaveTypeName": name, "year": y, "entitlementDays": entitlement, "usedDays": used, "pendingDays": pending, "availableDays": entitlement - used - pending})
	}
	httpx.JSON(w, 200, map[string]any{"data": items, "requestId": httpx.RequestID(r.Context())})
}

func parseLeaveRange(startRaw, endRaw string) (time.Time, time.Time, error) {
	start, err := time.Parse(leaveDateLayout, strings.TrimSpace(startRaw))
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	end, err := time.Parse(leaveDateLayout, strings.TrimSpace(endRaw))
	if err != nil || end.Before(start) {
		return time.Time{}, time.Time{}, errors.New("invalid leave range")
	}
	if end.Sub(start) > 366*24*time.Hour {
		return time.Time{}, time.Time{}, errors.New("leave range too long")
	}
	return start, end, nil
}

func leaveDaysByYear(start, end time.Time) map[int]float64 {
	result := map[int]float64{}
	for day := start; !day.After(end); day = day.AddDate(0, 0, 1) {
		if day.Weekday() != time.Saturday && day.Weekday() != time.Sunday {
			result[day.Year()]++
		}
	}
	return result
}

func (s *Server) createLeaveRequest(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	var in struct {
		LeaveTypeID string `json:"leaveTypeId"`
		StartsOn    string `json:"startsOn"`
		EndsOn      string `json:"endsOn"`
		Reason      string `json:"reason"`
	}
	if !httpx.DecodeJSON(w, r, &in) {
		return
	}
	start, end, err := parseLeaveRange(in.StartsOn, in.EndsOn)
	in.Reason = strings.TrimSpace(in.Reason)
	if err != nil || in.Reason == "" {
		writeValidation(w, r, "Tanggal dan alasan cuti wajib valid.")
		return
	}
	allocations := leaveDaysByYear(start, end)
	total := 0.0
	for _, days := range allocations {
		total += days
	}
	if total == 0 {
		writeValidation(w, r, "Rentang cuti tidak memiliki hari kerja.")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer tx.Rollback()
	var overlap int
	if err = tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM leave_requests WHERE membership_id=UUID_TO_BIN(?) AND status IN ('PENDING','APPROVED') AND starts_on<=? AND ends_on>=?`, p.MembershipID, end, start).Scan(&overlap); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if overlap > 0 {
		httpx.WriteError(w, r, &httpx.Error{Status: 409, Code: "LEAVE_OVERLAP", Message: "Tanggal cuti bertumpang tindih dengan permintaan lain."})
		return
	}
	requestID, _ := identity.NewUUID()
	if _, err = tx.ExecContext(r.Context(), `INSERT INTO leave_requests(id,organization_id,membership_id,leave_type_id,starts_on,ends_on,total_days,reason) SELECT UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),id,?,?,?,? FROM leave_types WHERE id=UUID_TO_BIN(?) AND organization_id=UUID_TO_BIN(?) AND status='ACTIVE'`, requestID, p.OrganizationID, p.MembershipID, start, end, total, in.Reason, in.LeaveTypeID, p.OrganizationID); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	for year, days := range allocations {
		var balanceID string
		var entitlement, used, pending float64
		err = tx.QueryRowContext(r.Context(), `SELECT BIN_TO_UUID(id),entitlement_days,used_days,pending_days FROM leave_balances WHERE membership_id=UUID_TO_BIN(?) AND leave_type_id=UUID_TO_BIN(?) AND balance_year=? FOR UPDATE`, p.MembershipID, in.LeaveTypeID, year).Scan(&balanceID, &entitlement, &used, &pending)
		if errors.Is(err, sql.ErrNoRows) {
			httpx.WriteError(w, r, &httpx.Error{Status: 422, Code: "LEAVE_BALANCE_MISSING", Message: fmt.Sprintf("Saldo cuti tahun %d belum tersedia.", year)})
			return
		}
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if entitlement-used-pending < days {
			httpx.WriteError(w, r, &httpx.Error{Status: 422, Code: "LEAVE_BALANCE_INSUFFICIENT", Message: "Saldo cuti tidak mencukupi."})
			return
		}
		if _, err = tx.ExecContext(r.Context(), `UPDATE leave_balances SET pending_days=pending_days+? WHERE id=UUID_TO_BIN(?)`, days, balanceID); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if _, err = tx.ExecContext(r.Context(), `INSERT INTO leave_request_allocations(request_id,balance_id,days) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),?)`, requestID, balanceID, days); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
	}
	if err = insertAudit(r.Context(), tx, p, "leave.request.create", "leave_request", requestID, map[string]any{"days": total}); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, 201, map[string]any{"data": map[string]any{"id": requestID, "status": "PENDING", "totalDays": total}, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) myLeaveRequests(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	items, err := s.queryLeaveRequests(r, p.OrganizationID, p.MembershipID, r.URL.Query().Get("status"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, 200, map[string]any{"data": items, "requestId": httpx.RequestID(r.Context())})
}
func (s *Server) listLeaveRequests(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	items, err := s.queryLeaveRequests(r, p.OrganizationID, "", r.URL.Query().Get("status"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, 200, map[string]any{"data": items, "requestId": httpx.RequestID(r.Context())})
}
func (s *Server) queryLeaveRequests(r *http.Request, orgID, membershipID, status string) ([]leaveRequestItem, error) {
	query := `SELECT BIN_TO_UUID(lr.id),BIN_TO_UUID(lr.membership_id),u.full_name,m.employee_number,BIN_TO_UUID(lt.id),lt.name,DATE_FORMAT(lr.starts_on,'%Y-%m-%d'),DATE_FORMAT(lr.ends_on,'%Y-%m-%d'),lr.total_days,lr.reason,lr.status,lr.requested_at,ld.reason,ld.decided_at FROM leave_requests lr JOIN organization_memberships m ON m.id=lr.membership_id JOIN users u ON u.id=m.user_id JOIN leave_types lt ON lt.id=lr.leave_type_id LEFT JOIN leave_decisions ld ON ld.request_id=lr.id WHERE lr.organization_id=UUID_TO_BIN(?)`
	args := []any{orgID}
	if membershipID != "" {
		query += ` AND lr.membership_id=UUID_TO_BIN(?)`
		args = append(args, membershipID)
	}
	if strings.TrimSpace(status) != "" {
		query += ` AND lr.status=?`
		args = append(args, strings.ToUpper(status))
	}
	query += ` ORDER BY lr.requested_at DESC`
	rows, err := s.db.QueryContext(r.Context(), query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []leaveRequestItem{}
	for rows.Next() {
		var item leaveRequestItem
		var decisionReason sql.NullString
		var decidedAt sql.NullTime
		if err = rows.Scan(&item.ID, &item.MembershipID, &item.EmployeeName, &item.EmployeeNumber, &item.LeaveTypeID, &item.LeaveTypeName, &item.StartsOn, &item.EndsOn, &item.TotalDays, &item.Reason, &item.Status, &item.RequestedAt, &decisionReason, &decidedAt); err != nil {
			return nil, err
		}
		if decisionReason.Valid {
			item.DecisionReason = &decisionReason.String
		}
		if decidedAt.Valid {
			item.DecidedAt = &decidedAt.Time
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Server) withdrawLeaveRequest(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	requestID := chi.URLParam(r, "requestID")
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer tx.Rollback()
	var status string
	err = tx.QueryRowContext(r.Context(), `SELECT status FROM leave_requests WHERE id=UUID_TO_BIN(?) AND organization_id=UUID_TO_BIN(?) AND membership_id=UUID_TO_BIN(?) FOR UPDATE`, requestID, p.OrganizationID, p.MembershipID).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, r, &httpx.Error{Status: 404, Code: "LEAVE_REQUEST_NOT_FOUND", Message: "Permintaan cuti tidak ditemukan."})
		return
	}
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if status != "PENDING" {
		httpx.WriteError(w, r, &httpx.Error{Status: 409, Code: "LEAVE_REQUEST_DECIDED", Message: "Hanya permintaan yang masih menunggu dapat dibatalkan."})
		return
	}
	if err = s.releaseLeavePending(r, tx, requestID, false); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if _, err = tx.ExecContext(r.Context(), `UPDATE leave_requests SET status='WITHDRAWN',withdrawn_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)`, requestID); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = insertAudit(r.Context(), tx, p, "leave.request.withdraw", "leave_request", requestID, nil); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, 200, map[string]any{"data": map[string]string{"id": requestID, "status": "WITHDRAWN"}, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) releaseLeavePending(r *http.Request, tx *sql.Tx, requestID string, approve bool) error {
	rows, err := tx.QueryContext(r.Context(), `SELECT BIN_TO_UUID(lb.id),a.days FROM leave_request_allocations a JOIN leave_balances lb ON lb.id=a.balance_id WHERE a.request_id=UUID_TO_BIN(?) FOR UPDATE`, requestID)
	if err != nil {
		return err
	}
	type allocation struct {
		id   string
		days float64
	}
	values := []allocation{}
	for rows.Next() {
		var v allocation
		if err = rows.Scan(&v.id, &v.days); err != nil {
			rows.Close()
			return err
		}
		values = append(values, v)
	}
	if err = rows.Close(); err != nil {
		return err
	}
	for _, v := range values {
		if approve {
			_, err = tx.ExecContext(r.Context(), `UPDATE leave_balances SET pending_days=pending_days-?,used_days=used_days+? WHERE id=UUID_TO_BIN(?)`, v.days, v.days, v.id)
		} else {
			_, err = tx.ExecContext(r.Context(), `UPDATE leave_balances SET pending_days=pending_days-? WHERE id=UUID_TO_BIN(?)`, v.days, v.id)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) decideLeaveRequest(w http.ResponseWriter, r *http.Request) {
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
	in.Reason = strings.TrimSpace(in.Reason)
	if in.Decision != "APPROVED" && in.Decision != "REJECTED" {
		writeValidation(w, r, "Keputusan cuti harus APPROVED atau REJECTED.")
		return
	}
	if in.Decision == "REJECTED" && in.Reason == "" {
		writeValidation(w, r, "Alasan wajib diisi saat menolak cuti.")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer tx.Rollback()
	var status string
	err = tx.QueryRowContext(r.Context(), `SELECT status FROM leave_requests WHERE id=UUID_TO_BIN(?) AND organization_id=UUID_TO_BIN(?) FOR UPDATE`, requestID, p.OrganizationID).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, r, &httpx.Error{Status: 404, Code: "LEAVE_REQUEST_NOT_FOUND", Message: "Permintaan cuti tidak ditemukan."})
		return
	}
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if status != "PENDING" {
		httpx.WriteError(w, r, &httpx.Error{Status: 409, Code: "LEAVE_REQUEST_DECIDED", Message: "Permintaan cuti sudah diputuskan."})
		return
	}
	if err = s.releaseLeavePending(r, tx, requestID, in.Decision == "APPROVED"); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	decisionID, _ := identity.NewUUID()
	if _, err = tx.ExecContext(r.Context(), `INSERT INTO leave_decisions(id,request_id,decision,reason,decided_by) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),?,NULLIF(?,''),UUID_TO_BIN(?))`, decisionID, requestID, in.Decision, in.Reason, p.UserID); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if _, err = tx.ExecContext(r.Context(), `UPDATE leave_requests SET status=? WHERE id=UUID_TO_BIN(?)`, in.Decision, requestID); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = insertAudit(r.Context(), tx, p, "leave.request.decide", "leave_request", requestID, map[string]any{"decision": in.Decision}); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, 200, map[string]any{"data": map[string]string{"id": requestID, "status": in.Decision}, "requestId": httpx.RequestID(r.Context())})
}

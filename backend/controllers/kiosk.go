package controllers

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"

	"github.com/bg-gold/attendance-api/common"
	"github.com/bg-gold/attendance-api/helpers"
	"github.com/bg-gold/attendance-api/services/attendance"
	"github.com/bg-gold/attendance-api/services/auth"
	"github.com/go-chi/chi/v5"
	"golang.org/x/crypto/bcrypt"
)

type kioskDevice struct {
	ID             string
	OrganizationID string
	SectionID      string
	SectionCode    string
	SectionName    string
	SectionAddress string
	DeviceLabel    string
	Platform       string
	DeviceModel    string
}

type kioskCredentials struct {
	EmployeeNumber string `json:"employeeNumber"`
	PIN            string `json:"pin"`
}

func validKioskPIN(pin string) bool {
	if len(pin) != 6 {
		return false
	}
	for _, digit := range pin {
		if digit < '0' || digit > '9' {
			return false
		}
	}
	return true
}

func randomKioskToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return "bgk_" + base64.RawURLEncoding.EncodeToString(raw), nil
}

func kioskHash(value string) []byte {
	digest := sha256.Sum256([]byte(strings.TrimSpace(value)))
	return digest[:]
}

func (s *Server) activateKiosk(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	var in struct {
		SectionID      string `json:"sectionId"`
		InstallationID string `json:"installationId"`
		DeviceLabel    string `json:"deviceLabel"`
		Platform       string `json:"platform"`
		DeviceModel    string `json:"deviceModel"`
	}
	if !httpx.DecodeJSON(w, r, &in) {
		return
	}
	in.SectionID = strings.TrimSpace(in.SectionID)
	in.InstallationID = strings.TrimSpace(in.InstallationID)
	in.DeviceLabel = strings.TrimSpace(in.DeviceLabel)
	if in.SectionID == "" || in.InstallationID == "" || in.DeviceLabel == "" || len(in.InstallationID) > 255 || len(in.DeviceLabel) > 120 {
		writeValidation(w, r, "Showroom, identitas instalasi, dan nama perangkat wajib diisi.")
		return
	}
	var sectionExists bool
	if err := s.db.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM sections WHERE id=UUID_TO_BIN(?) AND organization_id=UUID_TO_BIN(?) AND status='ACTIVE')`, in.SectionID, p.OrganizationID).Scan(&sectionExists); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if !sectionExists {
		httpx.WriteError(w, r, &httpx.Error{Status: http.StatusNotFound, Code: "SHOWROOM_NOT_FOUND", Message: "Showroom aktif tidak ditemukan."})
		return
	}
	token, err := randomKioskToken()
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	id, err := identity.NewUUID()
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	installationHash := kioskHash(strings.ToLower(in.InstallationID))
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(r.Context(), `
		INSERT INTO kiosk_devices(id,organization_id,section_id,installation_hash,token_hash,device_label,platform,device_model,status,activated_by,activated_at,revoked_at)
		VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),?,?,?,?,NULLIF(?,''),'ACTIVE',UUID_TO_BIN(?),UTC_TIMESTAMP(6),NULL)
		ON DUPLICATE KEY UPDATE section_id=VALUES(section_id),token_hash=VALUES(token_hash),device_label=VALUES(device_label),platform=VALUES(platform),device_model=VALUES(device_model),status='ACTIVE',activated_by=VALUES(activated_by),activated_at=UTC_TIMESTAMP(6),revoked_at=NULL`,
		id, p.OrganizationID, in.SectionID, installationHash, kioskHash(token), in.DeviceLabel, strings.TrimSpace(in.Platform), strings.TrimSpace(in.DeviceModel), p.UserID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = tx.QueryRowContext(r.Context(), `SELECT BIN_TO_UUID(id) FROM kiosk_devices WHERE organization_id=UUID_TO_BIN(?) AND installation_hash=?`, p.OrganizationID, installationHash).Scan(&id); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = insertAudit(r.Context(), tx, p, "kiosk.activate", "kiosk_device", id, map[string]any{"sectionId": in.SectionID, "deviceLabel": in.DeviceLabel}); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"data": map[string]any{
		"id": id, "token": token, "sectionId": in.SectionID, "deviceLabel": in.DeviceLabel,
	}, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) revokeKiosk(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer tx.Rollback()
	kioskID := chi.URLParam(r, "kioskID")
	result, err := tx.ExecContext(r.Context(), `UPDATE kiosk_devices SET status='REVOKED',revoked_at=UTC_TIMESTAMP(6),updated_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?) AND organization_id=UUID_TO_BIN(?)`, kioskID, p.OrganizationID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		httpx.WriteError(w, r, &httpx.Error{Status: http.StatusNotFound, Code: "KIOSK_NOT_FOUND", Message: "Perangkat kiosk tidak ditemukan."})
		return
	}
	if err = insertAudit(r.Context(), tx, p, "kiosk.revoke", "kiosk_device", kioskID, nil); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) resetEmployeeKioskPIN(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	var in struct {
		PIN string `json:"pin"`
	}
	if !httpx.DecodeJSON(w, r, &in) {
		return
	}
	if !validKioskPIN(in.PIN) {
		writeValidation(w, r, "PIN absensi wajib terdiri dari tepat 6 angka.")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.PIN), bcrypt.DefaultCost)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer tx.Rollback()
	employeeID := chi.URLParam(r, "employeeID")
	result, err := tx.ExecContext(r.Context(), `UPDATE organization_memberships SET kiosk_pin_hash=?,updated_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?) AND organization_id=UUID_TO_BIN(?)`, string(hash), employeeID, p.OrganizationID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		httpx.WriteError(w, r, &httpx.Error{Status: http.StatusNotFound, Code: "EMPLOYEE_NOT_FOUND", Message: "Karyawan tidak ditemukan."})
		return
	}
	if err = insertAudit(r.Context(), tx, p, "employee.kiosk_pin.reset", "organization_membership", employeeID, nil); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) kioskContext(w http.ResponseWriter, r *http.Request) {
	kiosk, err := s.resolveKiosk(r)
	if err != nil {
		writeKioskAuthError(w, r, err)
		return
	}
	rows, err := s.db.QueryContext(r.Context(), `
		SELECT BIN_TO_UUID(m.id),u.full_name,m.employee_number,COALESCE(m.job_title,''),m.kiosk_pin_hash IS NOT NULL
		FROM organization_memberships m
		JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
		WHERE m.organization_id=UUID_TO_BIN(?) AND m.status='ACTIVE'
		  AND EXISTS(SELECT 1 FROM membership_roles mr JOIN roles ro ON ro.id=mr.role_id WHERE mr.membership_id=m.id AND ro.code='EMPLOYEE')
		ORDER BY u.full_name`, kiosk.OrganizationID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer rows.Close()
	employees := []map[string]any{}
	for rows.Next() {
		var id, name, number, title string
		var pinConfigured bool
		if err = rows.Scan(&id, &name, &number, &title, &pinConfigured); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		employees = append(employees, map[string]any{"id": id, "fullName": name, "employeeNumber": number, "jobTitle": title, "pinConfigured": pinConfigured})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": map[string]any{
		"kiosk":     map[string]any{"id": kiosk.ID, "deviceLabel": kiosk.DeviceLabel},
		"showroom":  map[string]any{"id": kiosk.SectionID, "code": kiosk.SectionCode, "name": kiosk.SectionName, "address": kiosk.SectionAddress},
		"employees": employees,
	}, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) kioskEmployeeStatus(w http.ResponseWriter, r *http.Request) {
	kiosk, err := s.resolveKiosk(r)
	if err != nil {
		writeKioskAuthError(w, r, err)
		return
	}
	var credentials kioskCredentials
	if !httpx.DecodeJSON(w, r, &credentials) {
		return
	}
	principal, employee, err := s.authenticateKioskEmployee(r, kiosk, credentials.EmployeeNumber, credentials.PIN)
	if err != nil {
		writeKioskEmployeeError(w, r, err)
		return
	}
	today, err := s.attendance.Today(r.Context(), principal)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": map[string]any{"employee": employee, "attendance": today}, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) kioskAttendanceAction(w http.ResponseWriter, r *http.Request) {
	kiosk, err := s.resolveKiosk(r)
	if err != nil {
		writeKioskAuthError(w, r, err)
		return
	}
	var in struct {
		EmployeeNumber string              `json:"employeeNumber"`
		PIN            string              `json:"pin"`
		Type           attendance.Action   `json:"type"`
		ShiftID        string              `json:"shiftId"`
		Reason         string              `json:"reason"`
		Evidence       attendance.Evidence `json:"evidence"`
	}
	if !httpx.DecodeJSON(w, r, &in) {
		return
	}
	principal, _, err := s.authenticateKioskEmployee(r, kiosk, in.EmployeeNumber, in.PIN)
	if err != nil {
		writeKioskEmployeeError(w, r, err)
		return
	}
	input := attendance.ActionInput{Type: in.Type, ShiftID: in.ShiftID, SectionID: kiosk.SectionID, Reason: in.Reason, Evidence: in.Evidence, Source: "KIOSK"}
	input.Evidence.DeviceID = ""
	input.Evidence.KioskDeviceID = kiosk.ID
	result, cached, err := s.attendance.Submit(r.Context(), principal, r.Header.Get("Idempotency-Key"), input, httpx.RequestID(r.Context()), remoteIP(r.RemoteAddr))
	if err != nil {
		writeAttendanceError(w, r, err)
		return
	}
	status := http.StatusCreated
	if cached {
		status = http.StatusOK
	}
	httpx.JSON(w, status, map[string]any{"data": result, "requestId": httpx.RequestID(r.Context()), "idempotentReplay": cached})
}

func (s *Server) kioskAttendanceSelfie(w http.ResponseWriter, r *http.Request) {
	kiosk, err := s.resolveKiosk(r)
	if err != nil {
		writeKioskAuthError(w, r, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maximumEvidenceBytes+(1<<20))
	if err = r.ParseMultipartForm(maximumEvidenceBytes); err != nil {
		httpx.WriteError(w, r, &httpx.Error{Status: http.StatusBadRequest, Code: "INVALID_UPLOAD", Message: "Foto tidak dapat dibaca.", Err: err})
		return
	}
	principal, _, err := s.authenticateKioskEmployee(r, kiosk, r.FormValue("employeeNumber"), r.FormValue("pin"))
	if err != nil {
		writeKioskEmployeeError(w, r, err)
		return
	}
	r = r.WithContext(auth.WithPrincipal(r.Context(), principal))
	s.uploadPrivateImage(w, r, "ATTENDANCE_SELFIE", 180, "Foto selfie wajib disertakan.")
}

func (s *Server) resolveKiosk(r *http.Request) (kioskDevice, error) {
	token := strings.TrimSpace(r.Header.Get("X-Kiosk-Token"))
	if token == "" {
		return kioskDevice{}, auth.ErrUnauthenticated
	}
	var item kioskDevice
	err := s.db.QueryRowContext(r.Context(), `
		SELECT BIN_TO_UUID(k.id),BIN_TO_UUID(k.organization_id),BIN_TO_UUID(k.section_id),sec.code,sec.name,COALESCE(sec.address,''),k.device_label,COALESCE(k.platform,''),COALESCE(k.device_model,'')
		FROM kiosk_devices k JOIN sections sec ON sec.id=k.section_id AND sec.status='ACTIVE'
		WHERE k.token_hash=? AND k.status='ACTIVE' AND k.revoked_at IS NULL`, kioskHash(token)).Scan(
		&item.ID, &item.OrganizationID, &item.SectionID, &item.SectionCode, &item.SectionName, &item.SectionAddress, &item.DeviceLabel, &item.Platform, &item.DeviceModel)
	if err != nil {
		return kioskDevice{}, err
	}
	_, _ = s.db.ExecContext(r.Context(), `UPDATE kiosk_devices SET last_seen_at=UTC_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)`, item.ID)
	return item, nil
}

func (s *Server) authenticateKioskEmployee(r *http.Request, kiosk kioskDevice, employeeNumber, pin string) (auth.Principal, map[string]any, error) {
	employeeNumber = strings.TrimSpace(employeeNumber)
	if employeeNumber == "" || !validKioskPIN(pin) {
		return auth.Principal{}, nil, auth.ErrUnauthenticated
	}
	var userID, membershipID, fullName, jobTitle, pinHash string
	err := s.db.QueryRowContext(r.Context(), `
		SELECT BIN_TO_UUID(m.user_id),BIN_TO_UUID(m.id),u.full_name,COALESCE(m.job_title,''),COALESCE(m.kiosk_pin_hash,'')
		FROM organization_memberships m JOIN users u ON u.id=m.user_id AND u.status='ACTIVE'
		WHERE m.organization_id=UUID_TO_BIN(?) AND m.employee_number=? AND m.status='ACTIVE'
		  AND EXISTS(SELECT 1 FROM membership_roles mr JOIN roles ro ON ro.id=mr.role_id WHERE mr.membership_id=m.id AND ro.code='EMPLOYEE')`, kiosk.OrganizationID, employeeNumber).Scan(&userID, &membershipID, &fullName, &jobTitle, &pinHash)
	if err != nil || pinHash == "" || bcrypt.CompareHashAndPassword([]byte(pinHash), []byte(pin)) != nil {
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return auth.Principal{}, nil, err
		}
		return auth.Principal{}, nil, auth.ErrUnauthenticated
	}
	principal := auth.Principal{UserID: userID, OrganizationID: kiosk.OrganizationID, MembershipID: membershipID, Permissions: map[string]bool{"attendance.own": true, "policy.read": true, "shift.read": true}}
	employee := map[string]any{"id": membershipID, "fullName": fullName, "employeeNumber": employeeNumber, "jobTitle": jobTitle}
	return principal, employee, nil
}

func writeKioskAuthError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, sql.ErrNoRows) || errors.Is(err, auth.ErrUnauthenticated) {
		httpx.WriteError(w, r, &httpx.Error{Status: http.StatusUnauthorized, Code: "KIOSK_UNAUTHENTICATED", Message: "Mode kiosk tidak aktif atau sudah dicabut.", Err: err})
		return
	}
	httpx.WriteError(w, r, err)
}

func writeKioskEmployeeError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, auth.ErrUnauthenticated) {
		httpx.WriteError(w, r, &httpx.Error{Status: http.StatusUnauthorized, Code: "KIOSK_EMPLOYEE_INVALID", Message: "Nomor karyawan atau PIN absensi tidak sesuai.", Err: err})
		return
	}
	httpx.WriteError(w, r, err)
}

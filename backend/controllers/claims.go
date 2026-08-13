package controllers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/bg-gold/attendance-api/common"
	"github.com/bg-gold/attendance-api/helpers"
	"github.com/bg-gold/attendance-api/services/auth"
	"github.com/go-chi/chi/v5"
)

type claimItem struct {
	ID             string            `json:"id"`
	MembershipID   string            `json:"membershipId"`
	EmployeeName   string            `json:"employeeName"`
	EmployeeNumber string            `json:"employeeNumber"`
	ClaimTypeID    string            `json:"claimTypeId"`
	ClaimTypeName  string            `json:"claimTypeName"`
	Title          string            `json:"title"`
	Amount         float64           `json:"amount"`
	Currency       string            `json:"currency"`
	IncurredOn     string            `json:"incurredOn"`
	Notes          *string           `json:"notes,omitempty"`
	AttachmentID   *string           `json:"attachmentId,omitempty"`
	Status         string            `json:"status"`
	OCRStatus      string            `json:"ocrStatus"`
	OCRProvider    *string           `json:"ocrProvider,omitempty"`
	OCRResult      *ReceiptOCRResult `json:"ocrResult,omitempty"`
	RequestedAt    time.Time         `json:"requestedAt"`
	DecisionReason *string           `json:"decisionReason,omitempty"`
	DecidedAt      *time.Time        `json:"decidedAt,omitempty"`
}

func (s *Server) listClaimTypes(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	rows, err := s.db.QueryContext(r.Context(), `SELECT BIN_TO_UUID(id),code,name,receipt_required,status FROM claim_types WHERE organization_id=UUID_TO_BIN(?) AND status='ACTIVE' ORDER BY name`, p.OrganizationID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, code, name, status string
		var receiptRequired bool
		if err = rows.Scan(&id, &code, &name, &receiptRequired, &status); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		items = append(items, map[string]any{"id": id, "code": code, "name": name, "receiptRequired": receiptRequired, "status": status})
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": items, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) createClaimType(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	var in struct {
		Code            string `json:"code"`
		Name            string `json:"name"`
		ReceiptRequired *bool  `json:"receiptRequired"`
	}
	if !httpx.DecodeJSON(w, r, &in) {
		return
	}
	in.Code, in.Name = strings.ToUpper(strings.TrimSpace(in.Code)), strings.TrimSpace(in.Name)
	if in.Code == "" || in.Name == "" || len(in.Code) > 30 || len(in.Name) > 120 {
		writeValidation(w, r, "Kode dan nama jenis klaim wajib valid.")
		return
	}
	required := true
	if in.ReceiptRequired != nil {
		required = *in.ReceiptRequired
	}
	id, _ := identity.NewUUID()
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(r.Context(), `INSERT INTO claim_types(id,organization_id,code,name,receipt_required) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),?,?,?)`, id, p.OrganizationID, in.Code, in.Name, required); err != nil {
		writeConflict(w, r, "CLAIM_TYPE_EXISTS", "Kode jenis klaim sudah digunakan.", err)
		return
	}
	if err = insertAudit(r.Context(), tx, p, "claim.type.create", "claim_type", id, map[string]any{"code": in.Code}); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"data": map[string]string{"id": id}, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) createClaim(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	var in struct {
		ClaimTypeID  string  `json:"claimTypeId"`
		Title        string  `json:"title"`
		Amount       float64 `json:"amount"`
		Currency     string  `json:"currency"`
		IncurredOn   string  `json:"incurredOn"`
		Notes        string  `json:"notes"`
		AttachmentID string  `json:"attachmentId"`
	}
	if !httpx.DecodeJSON(w, r, &in) {
		return
	}
	in.Title, in.Notes, in.Currency, in.AttachmentID = strings.TrimSpace(in.Title), strings.TrimSpace(in.Notes), strings.ToUpper(strings.TrimSpace(in.Currency)), strings.TrimSpace(in.AttachmentID)
	if in.Currency == "" {
		in.Currency = "IDR"
	}
	incurred, err := time.Parse(leaveDateLayout, strings.TrimSpace(in.IncurredOn))
	if err != nil || in.ClaimTypeID == "" || in.Title == "" || len(in.Title) > 160 || in.Amount <= 0 || in.Amount > 999999999999.99 || len(in.Currency) != 3 || len(in.Notes) > 1000 {
		writeValidation(w, r, "Jenis, judul, nominal, mata uang, dan tanggal klaim wajib valid.")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer tx.Rollback()
	var receiptRequired bool
	if err = tx.QueryRowContext(r.Context(), `SELECT receipt_required FROM claim_types WHERE id=UUID_TO_BIN(?) AND organization_id=UUID_TO_BIN(?) AND status='ACTIVE'`, in.ClaimTypeID, p.OrganizationID).Scan(&receiptRequired); errors.Is(err, sql.ErrNoRows) {
		writeValidation(w, r, "Jenis klaim tidak valid.")
		return
	} else if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if receiptRequired && in.AttachmentID == "" {
		writeValidation(w, r, "Jenis klaim ini mewajibkan foto struk.")
		return
	}
	receiptObjectKey := ""
	if in.AttachmentID != "" {
		err = tx.QueryRowContext(r.Context(), `SELECT a.object_key FROM attachments a WHERE a.id=UUID_TO_BIN(?) AND a.organization_id=UUID_TO_BIN(?) AND a.owner_user_id=UUID_TO_BIN(?) AND a.purpose='CLAIM_RECEIPT' AND a.finalized_at IS NOT NULL AND a.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM claims c WHERE c.attachment_id=a.id)`, in.AttachmentID, p.OrganizationID, p.UserID).Scan(&receiptObjectKey)
		if errors.Is(err, sql.ErrNoRows) {
			writeValidation(w, r, "Foto struk tidak tersedia atau sudah digunakan.")
			return
		}
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
	}
	id, _ := identity.NewUUID()
	ocrStatus := "NOT_CONFIGURED"
	if s.ocrProvider != nil && receiptObjectKey != "" {
		ocrStatus = "PENDING"
	}
	if _, err = tx.ExecContext(r.Context(), `INSERT INTO claims(id,organization_id,membership_id,claim_type_id,attachment_id,title,amount,currency,incurred_on,notes,ocr_status) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(NULLIF(?,'')),?,?,?,?,NULLIF(?,''),?)`, id, p.OrganizationID, p.MembershipID, in.ClaimTypeID, in.AttachmentID, in.Title, in.Amount, in.Currency, incurred, in.Notes, ocrStatus); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = insertAudit(r.Context(), tx, p, "claim.request.create", "claim", id, map[string]any{"amount": in.Amount, "currency": in.Currency}); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	data := map[string]any{"id": id, "status": "PENDING", "ocrStatus": ocrStatus}
	if ocrStatus == "PENDING" {
		result, completedStatus := s.processClaimOCR(r.Context(), id, receiptObjectKey)
		data["ocrStatus"] = completedStatus
		if completedStatus == "COMPLETE" {
			data["ocrResult"] = result
		}
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"data": data, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) processClaimOCR(ctx context.Context, claimID, objectKey string) (ReceiptOCRResult, string) {
	fail := func() (ReceiptOCRResult, string) {
		_, _ = s.db.ExecContext(ctx, `UPDATE claims SET ocr_status='FAILED',ocr_provider=? WHERE id=UUID_TO_BIN(?)`, s.ocrProvider.Name(), claimID)
		return ReceiptOCRResult{}, "FAILED"
	}
	signed, err := s.objects.PresignedGetObject(ctx, s.objectBucket, objectKey, 5*time.Minute, url.Values{})
	if err != nil {
		return fail()
	}
	result, err := s.ocrProvider.ExtractReceipt(ctx, signed.String())
	if err != nil {
		return fail()
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return fail()
	}
	if _, err = s.db.ExecContext(ctx, `UPDATE claims SET ocr_status='COMPLETE',ocr_provider=?,ocr_result=? WHERE id=UUID_TO_BIN(?)`, s.ocrProvider.Name(), string(encoded), claimID); err != nil {
		return fail()
	}
	return result, "COMPLETE"
}

func (s *Server) myClaims(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	s.writeClaims(w, r, `c.organization_id=UUID_TO_BIN(?) AND c.membership_id=UUID_TO_BIN(?)`, p.OrganizationID, p.MembershipID)
}

func (s *Server) listClaims(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	status := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("status")))
	if status == "" {
		s.writeClaims(w, r, `c.organization_id=UUID_TO_BIN(?)`, p.OrganizationID)
		return
	}
	if status != "PENDING" && status != "APPROVED" && status != "REJECTED" && status != "WITHDRAWN" {
		writeValidation(w, r, "Status klaim tidak valid.")
		return
	}
	s.writeClaims(w, r, `c.organization_id=UUID_TO_BIN(?) AND c.status=?`, p.OrganizationID, status)
}

func (s *Server) writeClaims(w http.ResponseWriter, r *http.Request, where string, args ...any) {
	query := `SELECT BIN_TO_UUID(c.id),BIN_TO_UUID(c.membership_id),u.full_name,m.employee_number,BIN_TO_UUID(ct.id),ct.name,c.title,c.amount,c.currency,DATE_FORMAT(c.incurred_on,'%Y-%m-%d'),c.notes,BIN_TO_UUID(c.attachment_id),c.status,c.ocr_status,c.ocr_provider,c.ocr_result,c.requested_at,cd.reason,cd.decided_at FROM claims c JOIN organization_memberships m ON m.id=c.membership_id JOIN users u ON u.id=m.user_id JOIN claim_types ct ON ct.id=c.claim_type_id LEFT JOIN claim_decisions cd ON cd.id=(SELECT d.id FROM claim_decisions d WHERE d.claim_id=c.id ORDER BY d.decided_at DESC LIMIT 1) WHERE ` + where + ` ORDER BY c.requested_at DESC LIMIT 200`
	rows, err := s.db.QueryContext(r.Context(), query, args...)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer rows.Close()
	items := []claimItem{}
	for rows.Next() {
		var item claimItem
		var notes, attachmentID, ocrProvider, ocrResult, decisionReason sql.NullString
		var decidedAt sql.NullTime
		if err = rows.Scan(&item.ID, &item.MembershipID, &item.EmployeeName, &item.EmployeeNumber, &item.ClaimTypeID, &item.ClaimTypeName, &item.Title, &item.Amount, &item.Currency, &item.IncurredOn, &notes, &attachmentID, &item.Status, &item.OCRStatus, &ocrProvider, &ocrResult, &item.RequestedAt, &decisionReason, &decidedAt); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if notes.Valid {
			item.Notes = &notes.String
		}
		if attachmentID.Valid {
			item.AttachmentID = &attachmentID.String
		}
		if ocrProvider.Valid {
			item.OCRProvider = &ocrProvider.String
		}
		if ocrResult.Valid {
			var result ReceiptOCRResult
			if err = json.Unmarshal([]byte(ocrResult.String), &result); err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			item.OCRResult = &result
		}
		if decisionReason.Valid {
			item.DecisionReason = &decisionReason.String
		}
		if decidedAt.Valid {
			item.DecidedAt = &decidedAt.Time
		}
		items = append(items, item)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": items, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) withdrawClaim(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	claimID := chi.URLParam(r, "claimID")
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer tx.Rollback()
	var status string
	err = tx.QueryRowContext(r.Context(), `SELECT status FROM claims WHERE id=UUID_TO_BIN(?) AND organization_id=UUID_TO_BIN(?) AND membership_id=UUID_TO_BIN(?) FOR UPDATE`, claimID, p.OrganizationID, p.MembershipID).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, r, &httpx.Error{Status: 404, Code: "CLAIM_NOT_FOUND", Message: "Klaim tidak ditemukan."})
		return
	}
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if status != "PENDING" {
		httpx.WriteError(w, r, &httpx.Error{Status: 409, Code: "CLAIM_ALREADY_DECIDED", Message: "Klaim sudah diputuskan."})
		return
	}
	if _, err = tx.ExecContext(r.Context(), `UPDATE claims SET status='WITHDRAWN' WHERE id=UUID_TO_BIN(?)`, claimID); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = insertAudit(r.Context(), tx, p, "claim.request.withdraw", "claim", claimID, nil); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, 200, map[string]any{"data": map[string]string{"id": claimID, "status": "WITHDRAWN"}, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) decideClaim(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	claimID := chi.URLParam(r, "claimID")
	var in struct {
		Decision string `json:"decision"`
		Reason   string `json:"reason"`
	}
	if !httpx.DecodeJSON(w, r, &in) {
		return
	}
	in.Decision, in.Reason = strings.ToUpper(strings.TrimSpace(in.Decision)), strings.TrimSpace(in.Reason)
	if in.Decision != "APPROVED" && in.Decision != "REJECTED" {
		writeValidation(w, r, "Keputusan klaim tidak valid.")
		return
	}
	if in.Decision == "REJECTED" && in.Reason == "" {
		writeValidation(w, r, "Alasan wajib diisi saat menolak klaim.")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer tx.Rollback()
	var status string
	err = tx.QueryRowContext(r.Context(), `SELECT status FROM claims WHERE id=UUID_TO_BIN(?) AND organization_id=UUID_TO_BIN(?) FOR UPDATE`, claimID, p.OrganizationID).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, r, &httpx.Error{Status: 404, Code: "CLAIM_NOT_FOUND", Message: "Klaim tidak ditemukan."})
		return
	}
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if status != "PENDING" {
		httpx.WriteError(w, r, &httpx.Error{Status: 409, Code: "CLAIM_ALREADY_DECIDED", Message: "Klaim sudah diputuskan."})
		return
	}
	decisionID, _ := identity.NewUUID()
	if _, err = tx.ExecContext(r.Context(), `INSERT INTO claim_decisions(id,claim_id,decision,reason,decided_by) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),?,NULLIF(?,''),UUID_TO_BIN(?))`, decisionID, claimID, in.Decision, in.Reason, p.UserID); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if _, err = tx.ExecContext(r.Context(), `UPDATE claims SET status=? WHERE id=UUID_TO_BIN(?)`, in.Decision, claimID); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = insertAudit(r.Context(), tx, p, "claim.request.decide", "claim", claimID, map[string]any{"decision": in.Decision}); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, 200, map[string]any{"data": map[string]string{"id": claimID, "status": in.Decision}, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) claimReceiptURL(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	claimID := chi.URLParam(r, "claimID")
	where := `c.id=UUID_TO_BIN(?) AND c.organization_id=UUID_TO_BIN(?)`
	args := []any{claimID, p.OrganizationID}
	if !p.Can("claim.read") {
		where += ` AND c.membership_id=UUID_TO_BIN(?)`
		args = append(args, p.MembershipID)
	}
	var objectKey string
	err := s.db.QueryRowContext(r.Context(), `SELECT a.object_key FROM claims c JOIN attachments a ON a.id=c.attachment_id AND a.purpose='CLAIM_RECEIPT' AND a.finalized_at IS NOT NULL AND a.deleted_at IS NULL WHERE `+where, args...).Scan(&objectKey)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, r, &httpx.Error{Status: 404, Code: "CLAIM_RECEIPT_NOT_FOUND", Message: "Struk klaim tidak ditemukan."})
		return
	}
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	expiresAt := time.Now().UTC().Add(5 * time.Minute)
	signed, err := s.objects.PresignedGetObject(r.Context(), s.objectBucket, objectKey, 5*time.Minute, url.Values{})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, 200, map[string]any{"data": map[string]any{"url": signed.String(), "expiresAt": expiresAt}, "requestId": httpx.RequestID(r.Context())})
}

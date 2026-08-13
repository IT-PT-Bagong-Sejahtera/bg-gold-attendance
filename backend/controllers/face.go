package controllers

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/bg-gold/attendance-api/common"
	"github.com/bg-gold/attendance-api/helpers"
	"github.com/bg-gold/attendance-api/services/auth"
)

type FaceResult struct {
	Score             float64
	LivenessPassed    bool
	ProviderReference string
}
type FaceProvider interface {
	Name() string
	Enroll(context.Context, string) (string, error)
	Verify(context.Context, string, string) (FaceResult, error)
}

func (s *Server) SetFaceProvider(provider FaceProvider) { s.faceProvider = provider }

func (s *Server) uploadFaceImage(w http.ResponseWriter, r *http.Request) {
	s.uploadPrivateImage(w, r, "FACE_IMAGE", 30, "Foto wajah wajib disertakan.")
}

func (s *Server) enrollFace(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	var in struct {
		AttachmentID string `json:"attachmentId"`
	}
	if !httpx.DecodeJSON(w, r, &in) {
		return
	}
	if s.faceProvider == nil {
		httpx.WriteError(w, r, &httpx.Error{Status: 503, Code: "FACE_PROVIDER_UNAVAILABLE", Message: "Penyedia verifikasi wajah belum dikonfigurasi."})
		return
	}
	objectKey, err := s.ownedFaceObject(r.Context(), p, strings.TrimSpace(in.AttachmentID))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	subject, err := s.faceProvider.Enroll(r.Context(), objectKey)
	if err != nil {
		httpx.WriteError(w, r, &httpx.Error{Status: 502, Code: "FACE_PROVIDER_FAILED", Message: "Pendaftaran wajah belum berhasil.", Err: err})
		return
	}
	id, _ := identity.NewUUID()
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(r.Context(), `INSERT INTO face_enrollments(id,organization_id,membership_id,provider,provider_subject) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),?,?) ON DUPLICATE KEY UPDATE provider=VALUES(provider),provider_subject=VALUES(provider_subject),status='ACTIVE',enrolled_at=UTC_TIMESTAMP(6)`, id, p.OrganizationID, p.MembershipID, s.faceProvider.Name(), subject)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = tx.QueryRowContext(r.Context(), `SELECT BIN_TO_UUID(id) FROM face_enrollments WHERE membership_id=UUID_TO_BIN(?)`, p.MembershipID).Scan(&id); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = insertAudit(r.Context(), tx, p, "face.enroll", "face_enrollment", id, nil); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, 200, map[string]any{"data": map[string]string{"id": id, "status": "ACTIVE"}, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) verifyFace(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	var in struct {
		AttachmentID string `json:"attachmentId"`
	}
	if !httpx.DecodeJSON(w, r, &in) {
		return
	}
	if s.faceProvider == nil {
		httpx.WriteError(w, r, &httpx.Error{Status: 503, Code: "FACE_PROVIDER_UNAVAILABLE", Message: "Penyedia verifikasi wajah belum dikonfigurasi."})
		return
	}
	objectKey, err := s.ownedFaceObject(r.Context(), p, strings.TrimSpace(in.AttachmentID))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var enrollmentID, subject string
	err = s.db.QueryRowContext(r.Context(), `SELECT BIN_TO_UUID(id),provider_subject FROM face_enrollments WHERE organization_id=UUID_TO_BIN(?) AND membership_id=UUID_TO_BIN(?) AND status='ACTIVE'`, p.OrganizationID, p.MembershipID).Scan(&enrollmentID, &subject)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, r, &httpx.Error{Status: 409, Code: "FACE_NOT_ENROLLED", Message: "Wajah belum didaftarkan."})
		return
	} else if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	result, err := s.faceProvider.Verify(r.Context(), subject, objectKey)
	if err != nil {
		httpx.WriteError(w, r, &httpx.Error{Status: 502, Code: "FACE_PROVIDER_FAILED", Message: "Verifikasi wajah belum berhasil.", Err: err})
		return
	}
	verified := result.LivenessPassed && result.Score >= 0.8
	id, _ := identity.NewUUID()
	_, err = s.db.ExecContext(r.Context(), `INSERT INTO face_verifications(id,organization_id,membership_id,enrollment_id,attachment_id,provider,provider_reference,similarity_score,liveness_passed,verified,expires_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),?,?,?, ?,?,DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 5 MINUTE))`, id, p.OrganizationID, p.MembershipID, enrollmentID, in.AttachmentID, s.faceProvider.Name(), result.ProviderReference, result.Score, result.LivenessPassed, verified)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if !verified {
		httpx.WriteError(w, r, &httpx.Error{Status: 422, Code: "FACE_VERIFICATION_FAILED", Message: "Wajah atau liveness tidak dapat diverifikasi."})
		return
	}
	httpx.JSON(w, 201, map[string]any{"data": map[string]any{"id": id, "verified": true, "expiresAt": time.Now().UTC().Add(5 * time.Minute)}, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) ownedFaceObject(ctx context.Context, p auth.Principal, attachmentID string) (string, error) {
	var key string
	err := s.db.QueryRowContext(ctx, `SELECT object_key FROM attachments WHERE id=UUID_TO_BIN(?) AND organization_id=UUID_TO_BIN(?) AND owner_user_id=UUID_TO_BIN(?) AND purpose='FACE_IMAGE' AND finalized_at IS NOT NULL AND deleted_at IS NULL`, attachmentID, p.OrganizationID, p.UserID).Scan(&key)
	if errors.Is(err, sql.ErrNoRows) {
		return "", &httpx.Error{Status: 400, Code: "FACE_IMAGE_INVALID", Message: "Foto wajah tidak tersedia."}
	}
	return key, err
}

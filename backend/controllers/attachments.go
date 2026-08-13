package controllers

import (
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/bg-gold/attendance-api/common"
	"github.com/bg-gold/attendance-api/helpers"
	"github.com/bg-gold/attendance-api/services/auth"
	"github.com/minio/minio-go/v7"
)

const maximumEvidenceBytes = 8 << 20

type ObjectStore interface {
	PutObject(context.Context, string, string, io.Reader, int64, minio.PutObjectOptions) (minio.UploadInfo, error)
	RemoveObject(context.Context, string, string, minio.RemoveObjectOptions) error
	BucketExists(context.Context, string) (bool, error)
	MakeBucket(context.Context, string, minio.MakeBucketOptions) error
	PresignedGetObject(context.Context, string, string, time.Duration, url.Values) (*url.URL, error)
}

func (s *Server) SetObjectStore(store ObjectStore) { s.objects = store }

func (s *Server) uploadAttendanceSelfie(w http.ResponseWriter, r *http.Request) {
	s.uploadPrivateImage(w, r, "ATTENDANCE_SELFIE", 180, "Foto selfie wajib disertakan.")
}

func (s *Server) uploadClaimReceipt(w http.ResponseWriter, r *http.Request) {
	s.uploadPrivateImage(w, r, "CLAIM_RECEIPT", 2555, "Foto struk wajib disertakan.")
}

func (s *Server) uploadPrivateImage(w http.ResponseWriter, r *http.Request, purpose string, retentionDays int, requiredMessage string) {
	r.Body = http.MaxBytesReader(w, r.Body, maximumEvidenceBytes+(1<<20))
	if err := r.ParseMultipartForm(maximumEvidenceBytes); err != nil {
		httpx.WriteError(w, r, &httpx.Error{Status: http.StatusRequestEntityTooLarge, Code: "ATTACHMENT_TOO_LARGE", Message: "Ukuran foto maksimal 8 MB.", Err: err})
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		httpx.WriteError(w, r, &httpx.Error{Status: http.StatusBadRequest, Code: "ATTACHMENT_REQUIRED", Message: requiredMessage, Err: err})
		return
	}
	defer file.Close()
	contentType, extension, ok := supportedImage(header)
	if !ok {
		httpx.WriteError(w, r, &httpx.Error{Status: http.StatusBadRequest, Code: "ATTACHMENT_TYPE_NOT_ALLOWED", Message: "Gunakan foto JPEG, PNG, atau WebP."})
		return
	}
	principal, _ := auth.PrincipalFrom(r.Context())
	attachmentID, err := identity.NewUUID()
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	objectKey := fmt.Sprintf("%s/%s/%s/%s%s", principal.OrganizationID, strings.ToLower(purpose), time.Now().UTC().Format("2006/01/02"), attachmentID, extension)
	if err := s.ensureEvidenceBucket(r.Context()); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	info, err := s.objects.PutObject(r.Context(), s.objectBucket, objectKey, file, header.Size, minio.PutObjectOptions{ContentType: contentType})
	if err != nil {
		httpx.WriteError(w, r, fmt.Errorf("store private evidence: %w", err))
		return
	}
	query := fmt.Sprintf(`
		INSERT INTO attachments(id,organization_id,owner_user_id,purpose,object_key,content_type,size_bytes,finalized_at,retention_until)
		VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),?,?,?, ?,UTC_TIMESTAMP(6),DATE_ADD(UTC_TIMESTAMP(6),INTERVAL %d DAY))`, retentionDays)
	_, err = s.db.ExecContext(r.Context(), query, attachmentID, principal.OrganizationID, principal.UserID, purpose, objectKey, contentType, info.Size)
	if err != nil {
		_ = s.objects.RemoveObject(r.Context(), s.objectBucket, objectKey, minio.RemoveObjectOptions{})
		httpx.WriteError(w, r, fmt.Errorf("register private evidence: %w", err))
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]any{"data": map[string]any{"id": attachmentID, "contentType": contentType, "sizeBytes": info.Size}, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) RunAttachmentRetentionOnce(ctx context.Context, now time.Time) (int, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT BIN_TO_UUID(id),object_key FROM attachments WHERE deleted_at IS NULL AND retention_until IS NOT NULL AND retention_until<=? ORDER BY retention_until LIMIT 100`, now.UTC())
	if err != nil {
		return 0, fmt.Errorf("query expired attachments: %w", err)
	}
	defer rows.Close()
	type expired struct{ id, key string }
	items := []expired{}
	for rows.Next() {
		var item expired
		if err = rows.Scan(&item.id, &item.key); err != nil {
			return 0, err
		}
		items = append(items, item)
	}
	removed := 0
	for _, item := range items {
		if err = s.objects.RemoveObject(ctx, s.objectBucket, item.key, minio.RemoveObjectOptions{}); err != nil {
			return removed, fmt.Errorf("remove expired attachment: %w", err)
		}
		if _, err = s.db.ExecContext(ctx, `UPDATE attachments SET deleted_at=? WHERE id=UUID_TO_BIN(?) AND deleted_at IS NULL`, now.UTC(), item.id); err != nil {
			return removed, err
		}
		removed++
	}
	return removed, nil
}

func (s *Server) ensureEvidenceBucket(ctx context.Context) error {
	exists, err := s.objects.BucketExists(ctx, s.objectBucket)
	if err != nil {
		return fmt.Errorf("check evidence bucket: %w", err)
	}
	if exists {
		return nil
	}
	if err := s.objects.MakeBucket(ctx, s.objectBucket, minio.MakeBucketOptions{}); err != nil {
		exists, checkErr := s.objects.BucketExists(ctx, s.objectBucket)
		if checkErr == nil && exists {
			return nil
		}
		return fmt.Errorf("create evidence bucket: %w", err)
	}
	return nil
}

func supportedImage(header *multipart.FileHeader) (string, string, bool) {
	contentType := strings.ToLower(strings.TrimSpace(header.Header.Get("Content-Type")))
	switch contentType {
	case "image/jpeg":
		return contentType, ".jpg", true
	case "image/png":
		return contentType, ".png", true
	case "image/webp":
		return contentType, ".webp", true
	}
	extension := strings.ToLower(filepath.Ext(header.Filename))
	if extension == ".jpg" || extension == ".jpeg" {
		return "image/jpeg", ".jpg", true
	}
	if extension == ".png" {
		return "image/png", extension, true
	}
	if extension == ".webp" {
		return "image/webp", extension, true
	}
	return "", "", false
}

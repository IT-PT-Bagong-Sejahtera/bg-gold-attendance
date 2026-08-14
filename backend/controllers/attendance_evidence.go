package controllers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/bg-gold/attendance-api/common"
	"github.com/bg-gold/attendance-api/services/auth"
	"github.com/go-chi/chi/v5"
)

type attendanceEvidenceAttachment struct {
	ID          string    `json:"id"`
	ContentType string    `json:"contentType"`
	SizeBytes   int64     `json:"sizeBytes"`
	URL         string    `json:"url,omitempty"`
	ExpiresAt   time.Time `json:"expiresAt,omitempty"`
}

type attendanceEvidenceLocation struct {
	Latitude   float64    `json:"latitude"`
	Longitude  float64    `json:"longitude"`
	AccuracyM  *float64   `json:"accuracyM,omitempty"`
	CapturedAt *time.Time `json:"capturedAt,omitempty"`
}

type attendanceEvidenceSection struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Address string `json:"address,omitempty"`
}

type attendanceEvidenceDevice struct {
	ID       string `json:"id"`
	Platform string `json:"platform"`
	Label    string `json:"label,omitempty"`
}

type attendanceFaceVerification struct {
	Verified        bool    `json:"verified"`
	LivenessPassed  bool    `json:"livenessPassed"`
	SimilarityScore float64 `json:"similarityScore"`
	Provider        string  `json:"provider"`
}

type attendanceEvidenceDetail struct {
	EventID          string                        `json:"eventId"`
	ActionType       string                        `json:"actionType"`
	Decision         string                        `json:"decision"`
	Source           string                        `json:"source"`
	RecordedAt       time.Time                     `json:"recordedAt"`
	Reason           *string                       `json:"reason,omitempty"`
	Section          *attendanceEvidenceSection    `json:"section,omitempty"`
	Location         *attendanceEvidenceLocation   `json:"location,omitempty"`
	Attachment       *attendanceEvidenceAttachment `json:"attachment,omitempty"`
	Device           *attendanceEvidenceDevice     `json:"device,omitempty"`
	WiFiSSID         *string                       `json:"wifiSSID,omitempty"`
	IntegrityVerdict json.RawMessage               `json:"integrityVerdict,omitempty"`
	FaceVerification *attendanceFaceVerification   `json:"faceVerification,omitempty"`
	EvidenceSavedAt  *time.Time                    `json:"evidenceSavedAt,omitempty"`
}

func (s *Server) attendanceEventEvidence(w http.ResponseWriter, r *http.Request) {
	s.writeAttendanceEventEvidence(w, r, false)
}

func (s *Server) myAttendanceEventEvidence(w http.ResponseWriter, r *http.Request) {
	s.writeAttendanceEventEvidence(w, r, true)
}

func (s *Server) writeAttendanceEventEvidence(w http.ResponseWriter, r *http.Request, ownOnly bool) {
	p, _ := auth.PrincipalFrom(r.Context())
	eventID := strings.TrimSpace(chi.URLParam(r, "eventID"))
	var item attendanceEvidenceDetail
	var reason, sectionID, sectionName, sectionAddress sql.NullString
	var latitude, longitude, accuracy sql.NullFloat64
	var locationCapturedAt, evidenceSavedAt sql.NullTime
	var attachmentID, attachmentContentType, objectKey sql.NullString
	var attachmentSize sql.NullInt64
	var deviceID, devicePlatform, deviceLabel, wifiSSID sql.NullString
	var integrityVerdict []byte
	var faceProvider sql.NullString
	var faceVerified, faceLiveness sql.NullBool
	var faceSimilarity sql.NullFloat64

	query := `
		SELECT BIN_TO_UUID(e.id),e.action_type,e.decision,e.source,e.server_recorded_at,e.reason,
		       BIN_TO_UUID(sec.id),sec.name,sec.address,
		       ev.latitude,ev.longitude,ev.accuracy_meters,ev.location_captured_at,ev.created_at,
		       BIN_TO_UUID(a.id),a.content_type,a.size_bytes,a.object_key,
		       BIN_TO_UUID(d.id),d.platform,d.device_label,ev.wifi_ssid,ev.integrity_verdict,
		       fv.verified,fv.liveness_passed,fv.similarity_score,fv.provider
		FROM attendance_events e
		LEFT JOIN sections sec ON sec.id=e.section_id
		LEFT JOIN attendance_evidence ev ON ev.event_id=e.id
		LEFT JOIN attachments a ON a.id=ev.attachment_id AND a.purpose='ATTENDANCE_SELFIE' AND a.finalized_at IS NOT NULL AND a.deleted_at IS NULL
		LEFT JOIN device_registrations d ON d.id=ev.device_id
		LEFT JOIN face_verifications fv ON fv.id=ev.face_verification_id
		WHERE e.id=UUID_TO_BIN(?) AND e.organization_id=UUID_TO_BIN(?)`
	args := []any{eventID, p.OrganizationID}
	if ownOnly {
		query += ` AND e.membership_id=UUID_TO_BIN(?)`
		args = append(args, p.MembershipID)
	}
	err := s.db.QueryRowContext(r.Context(), query, args...).Scan(
		&item.EventID, &item.ActionType, &item.Decision, &item.Source, &item.RecordedAt, &reason,
		&sectionID, &sectionName, &sectionAddress,
		&latitude, &longitude, &accuracy, &locationCapturedAt, &evidenceSavedAt,
		&attachmentID, &attachmentContentType, &attachmentSize, &objectKey,
		&deviceID, &devicePlatform, &deviceLabel, &wifiSSID, &integrityVerdict,
		&faceVerified, &faceLiveness, &faceSimilarity, &faceProvider,
	)
	if errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, r, &httpx.Error{Status: http.StatusNotFound, Code: "ATTENDANCE_EVIDENCE_NOT_FOUND", Message: "Detail bukti absensi tidak ditemukan."})
		return
	}
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if reason.Valid {
		item.Reason = &reason.String
	}
	if sectionID.Valid {
		item.Section = &attendanceEvidenceSection{ID: sectionID.String, Name: sectionName.String, Address: sectionAddress.String}
	}
	if latitude.Valid && longitude.Valid {
		location := &attendanceEvidenceLocation{Latitude: latitude.Float64, Longitude: longitude.Float64}
		if accuracy.Valid {
			location.AccuracyM = &accuracy.Float64
		}
		if locationCapturedAt.Valid {
			location.CapturedAt = &locationCapturedAt.Time
		}
		item.Location = location
	}
	if evidenceSavedAt.Valid {
		item.EvidenceSavedAt = &evidenceSavedAt.Time
	}
	if attachmentID.Valid {
		attachment := &attendanceEvidenceAttachment{ID: attachmentID.String, ContentType: attachmentContentType.String, SizeBytes: attachmentSize.Int64}
		if objectKey.Valid && s.objects != nil {
			expiresAt := time.Now().UTC().Add(5 * time.Minute)
			signed, signErr := s.objects.PresignedGetObject(r.Context(), s.objectBucket, objectKey.String, 5*time.Minute, url.Values{})
			if signErr != nil {
				httpx.WriteError(w, r, signErr)
				return
			}
			attachment.URL, attachment.ExpiresAt = signed.String(), expiresAt
		}
		item.Attachment = attachment
	}
	if deviceID.Valid {
		item.Device = &attendanceEvidenceDevice{ID: deviceID.String, Platform: devicePlatform.String, Label: deviceLabel.String}
	}
	if wifiSSID.Valid {
		item.WiFiSSID = &wifiSSID.String
	}
	if len(integrityVerdict) > 0 && json.Valid(integrityVerdict) {
		item.IntegrityVerdict = integrityVerdict
	}
	if faceProvider.Valid {
		item.FaceVerification = &attendanceFaceVerification{
			Verified: faceVerified.Bool, LivenessPassed: faceLiveness.Bool,
			SimilarityScore: faceSimilarity.Float64, Provider: faceProvider.String,
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": item, "requestId": httpx.RequestID(r.Context())})
}

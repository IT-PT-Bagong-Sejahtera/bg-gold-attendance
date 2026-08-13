package controllers

import (
	"crypto/sha256"
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

type announcementAudienceInput struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

func (s *Server) createAnnouncement(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	var in struct {
		Title                  string                      `json:"title"`
		Body                   string                      `json:"body"`
		Priority               string                      `json:"priority"`
		RequiresAcknowledgment bool                        `json:"requiresAcknowledgment"`
		ExpiresAt              *time.Time                  `json:"expiresAt"`
		Audiences              []announcementAudienceInput `json:"audiences"`
		Publish                bool                        `json:"publish"`
	}
	if !httpx.DecodeJSON(w, r, &in) {
		return
	}
	in.Title, in.Body, in.Priority = strings.TrimSpace(in.Title), strings.TrimSpace(in.Body), strings.ToUpper(strings.TrimSpace(in.Priority))
	if in.Priority == "" {
		in.Priority = "NORMAL"
	}
	if in.Title == "" || len(in.Title) > 180 || in.Body == "" || len(in.Body) > 10000 || (in.Priority != "NORMAL" && in.Priority != "IMPORTANT" && in.Priority != "URGENT") {
		writeValidation(w, r, "Judul, isi, atau prioritas pengumuman tidak valid.")
		return
	}
	if len(in.Audiences) == 0 {
		in.Audiences = []announcementAudienceInput{{Type: "ALL"}}
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer tx.Rollback()
	id, _ := identity.NewUUID()
	status := "DRAFT"
	var publishAt any
	if in.Publish {
		status = "PUBLISHED"
		publishAt = time.Now().UTC()
	}
	if _, err = tx.ExecContext(r.Context(), `INSERT INTO announcements(id,organization_id,title,body,priority,requires_acknowledgment,status,publish_at,expires_at,created_by) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),?,?,?,?,?, ?,?,UUID_TO_BIN(?))`, id, p.OrganizationID, in.Title, in.Body, in.Priority, in.RequiresAcknowledgment, status, publishAt, in.ExpiresAt, p.UserID); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	for _, raw := range in.Audiences {
		typeName, value := strings.ToUpper(strings.TrimSpace(raw.Type)), strings.TrimSpace(raw.Value)
		if typeName != "ALL" && typeName != "ROLE" && typeName != "SECTION" {
			writeValidation(w, r, "Audiens pengumuman tidak valid.")
			return
		}
		if typeName == "ALL" {
			value = ""
		}
		if typeName == "ROLE" {
			var exists int
			if value == "" || tx.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM roles WHERE organization_id=UUID_TO_BIN(?) AND code=?)`, p.OrganizationID, strings.ToUpper(value)).Scan(&exists) != nil || exists != 1 {
				writeValidation(w, r, "Peran audiens tidak valid.")
				return
			}
			value = strings.ToUpper(value)
		}
		if typeName == "SECTION" {
			var exists int
			if value == "" || tx.QueryRowContext(r.Context(), `SELECT EXISTS(SELECT 1 FROM sections WHERE id=UUID_TO_BIN(?) AND organization_id=UUID_TO_BIN(?) AND status='ACTIVE')`, value, p.OrganizationID).Scan(&exists) != nil || exists != 1 {
				writeValidation(w, r, "Lokasi audiens tidak valid.")
				return
			}
		}
		audienceID, _ := identity.NewUUID()
		if _, err = tx.ExecContext(r.Context(), `INSERT INTO announcement_audiences(id,announcement_id,audience_type,role_code,section_id) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),?,NULLIF(?,''),UUID_TO_BIN(NULLIF(?,'')))`, audienceID, id, typeName, func() string {
			if typeName == "ROLE" {
				return value
			}
			return ""
		}(), func() string {
			if typeName == "SECTION" {
				return value
			}
			return ""
		}()); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
	}
	if in.Publish {
		if err = s.enqueueAnnouncementTx(r, tx, p.OrganizationID, id, in.Title, in.Body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
	}
	if err = insertAudit(r.Context(), tx, p, "announcement.create", "announcement", id, map[string]any{"status": status}); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = tx.Commit(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, 201, map[string]any{"data": map[string]string{"id": id, "status": status}, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) enqueueAnnouncementTx(r *http.Request, tx *sql.Tx, organizationID, announcementID, title, body string) error {
	rows, err := tx.QueryContext(r.Context(), `SELECT DISTINCT BIN_TO_UUID(m.id) FROM organization_memberships m WHERE m.organization_id=UUID_TO_BIN(?) AND m.status='ACTIVE' AND EXISTS(SELECT 1 FROM announcement_audiences aa WHERE aa.announcement_id=UUID_TO_BIN(?) AND (aa.audience_type='ALL' OR (aa.audience_type='ROLE' AND EXISTS(SELECT 1 FROM membership_roles mr JOIN roles ro ON ro.id=mr.role_id WHERE mr.membership_id=m.id AND ro.code=aa.role_code)) OR (aa.audience_type='SECTION' AND EXISTS(SELECT 1 FROM shift_assignments sa JOIN shifts sh ON sh.id=sa.shift_id WHERE sa.membership_id=m.id AND sh.section_id=aa.section_id))))`, organizationID, announcementID)
	if err != nil {
		return err
	}
	defer rows.Close()
	recipients := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			return err
		}
		recipients = append(recipients, id)
	}
	for _, membershipID := range recipients {
		if _, err = tx.ExecContext(r.Context(), `INSERT IGNORE INTO announcement_receipts(announcement_id,membership_id) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?))`, announcementID, membershipID); err != nil {
			return err
		}
		notificationID, _ := identity.NewUUID()
		outboxID, _ := identity.NewUUID()
		pushBody := body
		if len(pushBody) > 500 {
			pushBody = pushBody[:500]
		}
		if _, err = tx.ExecContext(r.Context(), `INSERT INTO notifications(id,organization_id,membership_id,kind,title,body,resource_type,resource_id) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),'ANNOUNCEMENT',?,?,'announcement',UUID_TO_BIN(?))`, notificationID, organizationID, membershipID, title, pushBody, announcementID); err != nil {
			return err
		}
		if _, err = tx.ExecContext(r.Context(), `INSERT INTO notification_outbox(id,notification_id) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?))`, outboxID, notificationID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) myAnnouncements(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	rows, err := s.db.QueryContext(r.Context(), `SELECT BIN_TO_UUID(a.id),a.title,a.body,a.priority,a.requires_acknowledgment,a.publish_at,a.expires_at,ar.read_at,ar.acknowledged_at FROM announcement_receipts ar JOIN announcements a ON a.id=ar.announcement_id WHERE ar.membership_id=UUID_TO_BIN(?) AND a.organization_id=UUID_TO_BIN(?) AND a.status='PUBLISHED' AND a.publish_at<=UTC_TIMESTAMP(6) AND (a.expires_at IS NULL OR a.expires_at>UTC_TIMESTAMP(6)) ORDER BY FIELD(a.priority,'URGENT','IMPORTANT','NORMAL'),a.publish_at DESC`, p.MembershipID, p.OrganizationID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, title, body, priority string
		var required bool
		var published time.Time
		var expires, readAt, ackAt sql.NullTime
		if err = rows.Scan(&id, &title, &body, &priority, &required, &published, &expires, &readAt, &ackAt); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		item := map[string]any{"id": id, "title": title, "body": body, "priority": priority, "requiresAcknowledgment": required, "publishedAt": published, "read": readAt.Valid, "acknowledged": ackAt.Valid}
		if expires.Valid {
			item["expiresAt"] = expires.Time
		}
		items = append(items, item)
	}
	httpx.JSON(w, 200, map[string]any{"data": items, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) updateAnnouncementReceipt(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	id := chi.URLParam(r, "announcementID")
	var in struct {
		Action string `json:"action"`
	}
	if !httpx.DecodeJSON(w, r, &in) {
		return
	}
	in.Action = strings.ToUpper(strings.TrimSpace(in.Action))
	if in.Action != "READ" && in.Action != "ACKNOWLEDGE" {
		writeValidation(w, r, "Tindakan pengumuman tidak valid.")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer tx.Rollback()
	var required bool
	if err = tx.QueryRowContext(r.Context(), `SELECT a.requires_acknowledgment FROM announcement_receipts ar JOIN announcements a ON a.id=ar.announcement_id WHERE ar.announcement_id=UUID_TO_BIN(?) AND ar.membership_id=UUID_TO_BIN(?) AND a.organization_id=UUID_TO_BIN(?) FOR UPDATE`, id, p.MembershipID, p.OrganizationID).Scan(&required); errors.Is(err, sql.ErrNoRows) {
		httpx.WriteError(w, r, &httpx.Error{Status: 404, Code: "ANNOUNCEMENT_NOT_FOUND", Message: "Pengumuman tidak ditemukan."})
		return
	} else if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if in.Action == "ACKNOWLEDGE" && !required {
		writeValidation(w, r, "Pengumuman ini tidak memerlukan konfirmasi.")
		return
	}
	query := `UPDATE announcement_receipts SET read_at=COALESCE(read_at,UTC_TIMESTAMP(6)) WHERE announcement_id=UUID_TO_BIN(?) AND membership_id=UUID_TO_BIN(?)`
	if in.Action == "ACKNOWLEDGE" {
		query = `UPDATE announcement_receipts SET read_at=COALESCE(read_at,UTC_TIMESTAMP(6)),acknowledged_at=COALESCE(acknowledged_at,UTC_TIMESTAMP(6)) WHERE announcement_id=UUID_TO_BIN(?) AND membership_id=UUID_TO_BIN(?)`
	}
	if _, err = tx.ExecContext(r.Context(), query, id, p.MembershipID); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if in.Action == "ACKNOWLEDGE" {
		if err = insertAudit(r.Context(), tx, p, "announcement.acknowledge", "announcement", id, nil); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
	}
	if err = tx.Commit(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, 200, map[string]any{"data": map[string]string{"id": id, "action": in.Action}, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) myNotifications(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	rows, err := s.db.QueryContext(r.Context(), `SELECT BIN_TO_UUID(id),kind,title,body,resource_type,BIN_TO_UUID(resource_id),read_at,created_at FROM notifications WHERE organization_id=UUID_TO_BIN(?) AND membership_id=UUID_TO_BIN(?) ORDER BY created_at DESC LIMIT 100`, p.OrganizationID, p.MembershipID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, kind, title, body string
		var resourceType, resourceID sql.NullString
		var readAt sql.NullTime
		var created time.Time
		if err = rows.Scan(&id, &kind, &title, &body, &resourceType, &resourceID, &readAt, &created); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		item := map[string]any{"id": id, "kind": kind, "title": title, "body": body, "read": readAt.Valid, "createdAt": created}
		if resourceType.Valid {
			item["resourceType"] = resourceType.String
		}
		if resourceID.Valid {
			item["resourceId"] = resourceID.String
		}
		items = append(items, item)
	}
	httpx.JSON(w, 200, map[string]any{"data": items, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) notificationUnreadCount(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	var count int
	if err := s.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM notifications WHERE organization_id=UUID_TO_BIN(?) AND membership_id=UUID_TO_BIN(?) AND read_at IS NULL`, p.OrganizationID, p.MembershipID).Scan(&count); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, 200, map[string]any{"data": map[string]int{"count": count}, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) readNotification(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	id := chi.URLParam(r, "notificationID")
	result, err := s.db.ExecContext(r.Context(), `UPDATE notifications SET read_at=COALESCE(read_at,UTC_TIMESTAMP(6)) WHERE id=UUID_TO_BIN(?) AND organization_id=UUID_TO_BIN(?) AND membership_id=UUID_TO_BIN(?)`, id, p.OrganizationID, p.MembershipID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		httpx.WriteError(w, r, &httpx.Error{Status: 404, Code: "NOTIFICATION_NOT_FOUND", Message: "Notifikasi tidak ditemukan."})
		return
	}
	httpx.JSON(w, 200, map[string]any{"data": map[string]any{"id": id, "read": true}, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) registerDevice(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	var in struct {
		Platform       string `json:"platform"`
		InstallationID string `json:"installationId"`
		PushToken      string `json:"pushToken"`
		DeviceLabel    string `json:"deviceLabel"`
	}
	if !httpx.DecodeJSON(w, r, &in) {
		return
	}
	in.Platform = strings.ToUpper(strings.TrimSpace(in.Platform))
	in.InstallationID = strings.TrimSpace(in.InstallationID)
	in.PushToken = strings.TrimSpace(in.PushToken)
	in.DeviceLabel = strings.TrimSpace(in.DeviceLabel)
	if (in.Platform != "ANDROID" && in.Platform != "IOS" && in.Platform != "WEB") ||
		(in.InstallationID == "" && in.PushToken == "") || len(in.InstallationID) > 160 ||
		len(in.PushToken) > 500 || len(in.DeviceLabel) > 160 {
		writeValidation(w, r, "Platform atau token push tidak valid.")
		return
	}
	var installationHash, pushHash []byte
	if in.InstallationID != "" {
		hash := sha256.Sum256([]byte(in.InstallationID))
		installationHash = hash[:]
	}
	if in.PushToken != "" {
		hash := sha256.Sum256([]byte(in.PushToken))
		pushHash = hash[:]
	}
	id, _ := identity.NewUUID()
	_, err := s.db.ExecContext(r.Context(), `INSERT INTO device_registrations(id,organization_id,user_id,installation_id_hash,platform,push_token,push_token_hash,device_label) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),?,?,NULLIF(?,''),?,NULLIF(?,'')) ON DUPLICATE KEY UPDATE installation_id_hash=COALESCE(VALUES(installation_id_hash),installation_id_hash),platform=VALUES(platform),push_token=COALESCE(VALUES(push_token),push_token),push_token_hash=COALESCE(VALUES(push_token_hash),push_token_hash),device_label=VALUES(device_label),revoked_at=NULL,last_seen_at=UTC_TIMESTAMP(6)`, id, p.OrganizationID, p.UserID, installationHash, in.Platform, in.PushToken, pushHash, in.DeviceLabel)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err = s.db.QueryRowContext(r.Context(), `SELECT BIN_TO_UUID(id) FROM device_registrations WHERE organization_id=UUID_TO_BIN(?) AND user_id=UUID_TO_BIN(?) AND ((? IS NOT NULL AND installation_id_hash=?) OR (? IS NOT NULL AND push_token_hash=?)) ORDER BY installation_id_hash IS NOT NULL DESC LIMIT 1`, p.OrganizationID, p.UserID, installationHash, installationHash, pushHash, pushHash).Scan(&id); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, 200, map[string]any{"data": map[string]string{"id": id, "status": "ACTIVE"}, "requestId": httpx.RequestID(r.Context())})
}

func (s *Server) revokeDevice(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	id := chi.URLParam(r, "deviceID")
	result, err := s.db.ExecContext(r.Context(), `UPDATE device_registrations SET revoked_at=UTC_TIMESTAMP(6),push_token=NULL,push_token_hash=NULL WHERE id=UUID_TO_BIN(?) AND organization_id=UUID_TO_BIN(?) AND user_id=UUID_TO_BIN(?) AND revoked_at IS NULL`, id, p.OrganizationID, p.UserID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	count, _ := result.RowsAffected()
	if count == 0 {
		httpx.WriteError(w, r, &httpx.Error{Status: 404, Code: "DEVICE_NOT_FOUND", Message: "Perangkat tidak ditemukan."})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

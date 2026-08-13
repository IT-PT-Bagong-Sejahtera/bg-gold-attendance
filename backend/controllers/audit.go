package controllers

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/bg-gold/attendance-api/common"
	"github.com/bg-gold/attendance-api/services/auth"
)

type auditItem struct {
	ID           string          `json:"id"`
	Action       string          `json:"action"`
	ResourceType string          `json:"resourceType"`
	ResourceID   *string         `json:"resourceId,omitempty"`
	ActorUserID  string          `json:"actorUserId"`
	ActorName    string          `json:"actorName"`
	ActorEmail   string          `json:"actorEmail"`
	Metadata     json.RawMessage `json:"metadata,omitempty"`
	RequestID    *string         `json:"requestId,omitempty"`
	CreatedAt    time.Time       `json:"createdAt"`
}

type auditCursor struct {
	CreatedAt time.Time `json:"createdAt"`
	ID        string    `json:"id"`
}

func (s *Server) listAuditLogs(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.PrincipalFrom(r.Context())
	now := time.Now().UTC()
	from, err := parseTimeQuery(r, "from", now.AddDate(0, 0, -31))
	if err != nil {
		writeValidation(w, r, "Tanggal awal audit tidak valid.")
		return
	}
	to, err := parseTimeQuery(r, "to", now.AddDate(0, 0, 1))
	if err != nil || !to.After(from) || to.Sub(from) > 366*24*time.Hour {
		writeValidation(w, r, "Rentang audit wajib valid dan maksimal 366 hari.")
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	query := `SELECT BIN_TO_UUID(a.id),a.action,a.resource_type,BIN_TO_UUID(a.resource_id),BIN_TO_UUID(a.actor_user_id),u.full_name,u.email,CAST(a.metadata AS CHAR),a.request_id,a.created_at
		FROM audit_logs a JOIN users u ON u.id=a.actor_user_id
		WHERE a.organization_id=UUID_TO_BIN(?) AND a.created_at>=? AND a.created_at<?`
	args := []any{p.OrganizationID, from.UTC(), to.UTC()}
	if action := strings.TrimSpace(r.URL.Query().Get("action")); action != "" {
		query += ` AND a.action=?`
		args = append(args, action)
	}
	if resourceType := strings.TrimSpace(r.URL.Query().Get("resourceType")); resourceType != "" {
		query += ` AND a.resource_type=?`
		args = append(args, resourceType)
	}
	if actorUserID := strings.TrimSpace(r.URL.Query().Get("actorUserId")); actorUserID != "" {
		query += ` AND a.actor_user_id=UUID_TO_BIN(?)`
		args = append(args, actorUserID)
	}
	if rawCursor := strings.TrimSpace(r.URL.Query().Get("cursor")); rawCursor != "" {
		decoded, decodeErr := base64.RawURLEncoding.DecodeString(rawCursor)
		var cursor auditCursor
		if decodeErr != nil || json.Unmarshal(decoded, &cursor) != nil || cursor.CreatedAt.IsZero() || strings.TrimSpace(cursor.ID) == "" {
			httpx.WriteError(w, r, &httpx.Error{Status: http.StatusBadRequest, Code: "INVALID_CURSOR", Message: "Cursor audit tidak valid."})
			return
		}
		query += ` AND (a.created_at<? OR (a.created_at=? AND a.id<UUID_TO_BIN(?)))`
		args = append(args, cursor.CreatedAt.UTC(), cursor.CreatedAt.UTC(), cursor.ID)
	}
	query += ` ORDER BY a.created_at DESC,a.id DESC LIMIT ?`
	args = append(args, limit+1)
	rows, err := s.db.QueryContext(r.Context(), query, args...)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	defer rows.Close()
	items := []auditItem{}
	for rows.Next() {
		var item auditItem
		var resourceID, metadata, requestID sql.NullString
		if err = rows.Scan(&item.ID, &item.Action, &item.ResourceType, &resourceID, &item.ActorUserID, &item.ActorName, &item.ActorEmail, &metadata, &requestID, &item.CreatedAt); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if resourceID.Valid {
			item.ResourceID = &resourceID.String
		}
		if metadata.Valid {
			item.Metadata = json.RawMessage(metadata.String)
		}
		if requestID.Valid {
			item.RequestID = &requestID.String
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	nextCursor := ""
	if len(items) > limit {
		items = items[:limit]
		last := items[len(items)-1]
		encoded, _ := json.Marshal(auditCursor{CreatedAt: last.CreatedAt.UTC(), ID: last.ID})
		nextCursor = base64.RawURLEncoding.EncodeToString(encoded)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"data": items, "nextCursor": nextCursor, "requestId": httpx.RequestID(r.Context())})
}

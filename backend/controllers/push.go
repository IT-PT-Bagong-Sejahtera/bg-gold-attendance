package controllers

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/bg-gold/attendance-api/config"
	"golang.org/x/oauth2/google"
)

type PushMessage struct {
	Title string
	Body  string
	Data  map[string]string
}

type PushSender interface {
	Send(context.Context, string, PushMessage) error
}

type fcmSender struct {
	projectID string
	client    *http.Client
}

func newFCMSender(ctx context.Context, cfg config.FCMConfig) (PushSender, error) {
	credentialsJSON, err := os.ReadFile(cfg.ServiceAccountFile)
	if err != nil {
		return nil, fmt.Errorf("read FCM service account: %w", err)
	}
	jwt, err := google.JWTConfigFromJSON(credentialsJSON, "https://www.googleapis.com/auth/firebase.messaging")
	if err != nil {
		return nil, fmt.Errorf("parse FCM service account: %w", err)
	}
	return &fcmSender{projectID: cfg.ProjectID, client: jwt.Client(ctx)}, nil
}

func (s *fcmSender) Send(ctx context.Context, token string, message PushMessage) error {
	payload := map[string]any{"message": map[string]any{"token": token, "notification": map[string]string{"title": message.Title, "body": message.Body}, "data": message.Data, "android": map[string]any{"priority": "high"}}}
	encoded, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://fcm.googleapis.com/v1/projects/"+s.projectID+"/messages:send", bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return nil
	}
	body, _ := io.ReadAll(io.LimitReader(response.Body, 1000))
	return fmt.Errorf("FCM status %d: %s", response.StatusCode, string(body))
}

func (s *Server) SetPushSender(sender PushSender) { s.pushSender = sender }

func (s *Server) RunNotificationOutboxOnce(ctx context.Context, _ time.Time) (int, error) {
	if s.pushSender == nil {
		return 0, nil
	}
	rows, err := s.db.QueryContext(ctx, `SELECT BIN_TO_UUID(id) FROM notification_outbox WHERE status IN ('PENDING','FAILED') AND attempts<10 AND available_at<=CURRENT_TIMESTAMP(6) ORDER BY available_at,id LIMIT 50`)
	if err != nil {
		return 0, fmt.Errorf("query notification outbox: %w", err)
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	sent := 0
	for _, id := range ids {
		ok, err := s.deliverOutbox(ctx, id)
		if err != nil {
			return sent, err
		}
		if ok {
			sent++
		}
	}
	return sent, nil
}

func (s *Server) deliverOutbox(ctx context.Context, outboxID string) (bool, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	var notificationID, membershipID, title, body, resourceType, resourceID, status string
	var attempts int
	err = tx.QueryRowContext(ctx, `SELECT BIN_TO_UUID(o.notification_id),BIN_TO_UUID(n.membership_id),n.title,n.body,COALESCE(n.resource_type,''),COALESCE(BIN_TO_UUID(n.resource_id),''),o.status,o.attempts FROM notification_outbox o JOIN notifications n ON n.id=o.notification_id WHERE o.id=UUID_TO_BIN(?) FOR UPDATE`, outboxID).Scan(&notificationID, &membershipID, &title, &body, &resourceType, &resourceID, &status, &attempts)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if status != "PENDING" && status != "FAILED" {
		return false, nil
	}
	if _, err = tx.ExecContext(ctx, `UPDATE notification_outbox SET status='PROCESSING',locked_at=CURRENT_TIMESTAMP(6) WHERE id=UUID_TO_BIN(?)`, outboxID); err != nil {
		return false, err
	}
	if err = tx.Commit(); err != nil {
		return false, err
	}
	deviceRows, err := s.db.QueryContext(ctx, `SELECT push_token FROM device_registrations d JOIN organization_memberships m ON m.user_id=d.user_id AND m.organization_id=d.organization_id WHERE m.id=UUID_TO_BIN(?) AND d.revoked_at IS NULL AND d.push_token IS NOT NULL`, membershipID)
	if err != nil {
		return false, err
	}
	tokens := []string{}
	for deviceRows.Next() {
		var token string
		if err = deviceRows.Scan(&token); err != nil {
			deviceRows.Close()
			return false, err
		}
		tokens = append(tokens, token)
	}
	deviceRows.Close()
	message := PushMessage{Title: title, Body: body, Data: map[string]string{"notificationId": notificationID, "resourceType": resourceType, "resourceId": resourceID}}
	for _, token := range tokens {
		if err = s.pushSender.Send(ctx, token, message); err != nil {
			attempts++
			backoffMinutes := 1 << min(attempts, 8)
			_, updateErr := s.db.ExecContext(ctx, `UPDATE notification_outbox SET status='FAILED',attempts=?,available_at=DATE_ADD(CURRENT_TIMESTAMP(6),INTERVAL ? MINUTE),locked_at=NULL,last_error=? WHERE id=UUID_TO_BIN(?)`, attempts, backoffMinutes, truncateError(err), outboxID)
			if updateErr != nil {
				return false, updateErr
			}
			return false, nil
		}
	}
	_, err = s.db.ExecContext(ctx, `UPDATE notification_outbox SET status='SENT',attempts=attempts+1,sent_at=CURRENT_TIMESTAMP(6),locked_at=NULL,last_error=NULL WHERE id=UUID_TO_BIN(?)`, outboxID)
	return err == nil, err
}

func truncateError(err error) string {
	value := err.Error()
	if len(value) > 500 {
		return value[:500]
	}
	return value
}

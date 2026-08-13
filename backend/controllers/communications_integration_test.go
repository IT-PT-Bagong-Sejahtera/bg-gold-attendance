package controllers_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bg-gold/attendance-api/config"
	"github.com/bg-gold/attendance-api/controllers"
	"github.com/bg-gold/attendance-api/database"
	"github.com/bg-gold/attendance-api/helpers"
	"golang.org/x/crypto/bcrypt"
)

func TestAnnouncementAudienceAcknowledgmentNotificationsAndDevice(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	if !strings.Contains(strings.ToLower(dsn), "_test") {
		t.Fatal("integration test refuses a DSN without _test")
	}
	adminEmail, adminPassword := os.Getenv("TEST_ADMIN_EMAIL"), os.Getenv("TEST_ADMIN_PASSWORD")
	db, err := database.Open(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = database.Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	var orgID string
	if err = db.QueryRow(`SELECT BIN_TO_UUID(m.organization_id) FROM organization_memberships m JOIN users u ON u.id=m.user_id WHERE u.email=?`, adminEmail).Scan(&orgID); err != nil {
		t.Fatal(err)
	}
	userID, _ := identity.NewUUID()
	membershipID, _ := identity.NewUUID()
	employeeEmail := "announce." + time.Now().Format("150405.000000") + "@bggold.local"
	password := "Announcement-Test-2026!"
	hash, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if _, err = db.Exec(`INSERT INTO users(id,email,password_hash,full_name) VALUES(UUID_TO_BIN(?),?,?,?)`, userID, employeeEmail, hash, "Announcement Employee"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO organization_memberships(id,organization_id,user_id,employee_number) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),?)`, membershipID, orgID, userID, "NEWS-"+time.Now().Format("150405")); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO membership_roles(membership_id,role_id) SELECT UUID_TO_BIN(?),id FROM roles WHERE organization_id=UUID_TO_BIN(?) AND code='EMPLOYEE'`, membershipID, orgID); err != nil {
		t.Fatal(err)
	}
	announcementID := ""
	defer func() {
		if announcementID != "" {
			_, _ = db.Exec(`DELETE FROM notification_outbox WHERE notification_id IN (SELECT id FROM notifications WHERE resource_id=UUID_TO_BIN(?))`, announcementID)
			_, _ = db.Exec(`DELETE FROM notifications WHERE resource_id=UUID_TO_BIN(?)`, announcementID)
			_, _ = db.Exec(`DELETE FROM announcement_receipts WHERE announcement_id=UUID_TO_BIN(?)`, announcementID)
			_, _ = db.Exec(`DELETE FROM announcement_audiences WHERE announcement_id=UUID_TO_BIN(?)`, announcementID)
			_, _ = db.Exec(`DELETE FROM audit_logs WHERE resource_id=UUID_TO_BIN(?)`, announcementID)
			_, _ = db.Exec(`DELETE FROM announcements WHERE id=UUID_TO_BIN(?)`, announcementID)
		}
		_, _ = db.Exec(`DELETE FROM attendance_requests WHERE membership_id=UUID_TO_BIN(?)`, membershipID)
		_, _ = db.Exec(`DELETE FROM attendance_evidence WHERE event_id IN (SELECT id FROM attendance_events WHERE membership_id=UUID_TO_BIN(?))`, membershipID)
		_, _ = db.Exec(`DELETE FROM audit_logs WHERE resource_type='attendance_event' AND resource_id IN (SELECT id FROM attendance_events WHERE membership_id=UUID_TO_BIN(?))`, membershipID)
		_, _ = db.Exec(`DELETE FROM attendance_state WHERE membership_id=UUID_TO_BIN(?)`, membershipID)
		_, _ = db.Exec(`DELETE FROM attendance_events WHERE membership_id=UUID_TO_BIN(?)`, membershipID)
		_, _ = db.Exec(`DELETE FROM device_registrations WHERE user_id=UUID_TO_BIN(?)`, userID)
		_, _ = db.Exec(`DELETE FROM refresh_sessions WHERE user_id=UUID_TO_BIN(?)`, userID)
		_, _ = db.Exec(`DELETE FROM membership_roles WHERE membership_id=UUID_TO_BIN(?)`, membershipID)
		_, _ = db.Exec(`DELETE FROM organization_memberships WHERE id=UUID_TO_BIN(?)`, membershipID)
		_, _ = db.Exec(`DELETE FROM users WHERE id=UUID_TO_BIN(?)`, userID)
	}()
	cfg := config.Config{Environment: "test", AccessTokenSecret: "integration-test-access-secret-at-least-32-bytes", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, CORSAllowedOrigins: []string{"http://localhost"}, MinIO: config.MinIOConfig{Endpoint: "localhost:19000", AccessKey: "test", SecretKey: "test", Bucket: "test-evidence"}}
	api, err := controllers.New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(api.Handler())
	defer host.Close()
	adminToken, employeeToken := login(t, host.URL, adminEmail, adminPassword), login(t, host.URL, employeeEmail, password)
	status, body := authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/announcements", employeeToken, map[string]any{"title": "Tidak boleh"})
	if status != 403 {
		t.Fatalf("employee create announcement: %d %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/announcements", adminToken, map[string]any{"title": "Perubahan jadwal toko", "body": "Mulai Senin, briefing dimulai 15 menit lebih awal.", "priority": "IMPORTANT", "requiresAcknowledgment": true, "audiences": []map[string]string{{"type": "ROLE", "value": "EMPLOYEE"}}, "publish": true})
	if status != 201 {
		t.Fatalf("create announcement: %d %s", status, body)
	}
	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(body, &created)
	announcementID = created.Data.ID
	status, body = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/me/announcements", adminToken, nil)
	if status != 200 || bytes.Contains(body, []byte("Perubahan jadwal toko")) {
		t.Fatalf("role audience leaked to admin: %d %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/me/announcements", employeeToken, nil)
	if status != 200 || !bytes.Contains(body, []byte("Perubahan jadwal toko")) || !bytes.Contains(body, []byte(`"requiresAcknowledgment":true`)) {
		t.Fatalf("employee announcement feed: %d %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/me/notifications/unread-count", employeeToken, nil)
	if status != 200 || !bytes.Contains(body, []byte(`"count":1`)) {
		t.Fatalf("notification count: %d %s", status, body)
	}
	var notificationID string
	if err = db.QueryRow(`SELECT BIN_TO_UUID(id) FROM notifications WHERE membership_id=UUID_TO_BIN(?) AND resource_id=UUID_TO_BIN(?)`, membershipID, announcementID).Scan(&notificationID); err != nil {
		t.Fatal(err)
	}
	var outbox int
	_ = db.QueryRow(`SELECT COUNT(*) FROM notification_outbox o JOIN notifications n ON n.id=o.notification_id WHERE n.id=UUID_TO_BIN(?) AND o.status='PENDING'`, notificationID).Scan(&outbox)
	if outbox != 1 {
		t.Fatalf("expected transactional outbox row, got %d", outbox)
	}
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/me/announcements/"+announcementID+"/receipt", employeeToken, map[string]string{"action": "ACKNOWLEDGE"})
	if status != 200 {
		t.Fatalf("acknowledge announcement: %d %s", status, body)
	}
	var acknowledged int
	_ = db.QueryRow(`SELECT COUNT(*) FROM announcement_receipts WHERE announcement_id=UUID_TO_BIN(?) AND membership_id=UUID_TO_BIN(?) AND read_at IS NOT NULL AND acknowledged_at IS NOT NULL`, announcementID, membershipID).Scan(&acknowledged)
	if acknowledged != 1 {
		t.Fatal("announcement acknowledgment was not persisted")
	}
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/me/notifications/"+notificationID+"/read", employeeToken, map[string]any{})
	if status != 200 {
		t.Fatalf("read notification: %d %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/me/notifications/unread-count", employeeToken, nil)
	if !bytes.Contains(body, []byte(`"count":0`)) {
		t.Fatalf("notification count after read: %s", body)
	}
	installationID := "android-installation-test-uuid"
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/me/devices", employeeToken, map[string]string{"platform": "ANDROID", "installationId": installationID, "pushToken": "fcm-test-token", "deviceLabel": "Pixel Test"})
	if status != 200 {
		t.Fatalf("register device: %d %s", status, body)
	}
	var device struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(body, &device)
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/me/devices", employeeToken, map[string]string{"platform": "ANDROID", "installationId": installationID, "deviceLabel": "Pixel Test Updated"})
	if status != 200 || !bytes.Contains(body, []byte(device.Data.ID)) {
		t.Fatalf("idempotent device register: %d %s", status, body)
	}
	installationHash := fmt.Sprintf("%x", sha256.Sum256([]byte(installationID)))
	var storedHash, storedToken string
	if err = db.QueryRow(`SELECT LOWER(HEX(installation_id_hash)),push_token FROM device_registrations WHERE id=UUID_TO_BIN(?)`, device.Data.ID).Scan(&storedHash, &storedToken); err != nil {
		t.Fatal(err)
	}
	if storedHash != installationHash || storedToken != "fcm-test-token" {
		t.Fatalf("device identity was not safely upserted: hash=%q token=%q", storedHash, storedToken)
	}
	var deviceRows int
	if err = db.QueryRow(`SELECT COUNT(*) FROM device_registrations WHERE organization_id=UUID_TO_BIN(?) AND user_id=UUID_TO_BIN(?)`, orgID, userID).Scan(&deviceRows); err != nil || deviceRows != 1 {
		t.Fatalf("installation registration rows=%d err=%v", deviceRows, err)
	}
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/me/devices", adminToken, map[string]string{"platform": "ANDROID", "installationId": "foreign-admin-installation"})
	if status != http.StatusOK {
		t.Fatalf("register foreign owner device: %d %s", status, body)
	}
	var foreignDevice struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(body, &foreignDevice)
	defer db.Exec(`DELETE FROM device_registrations WHERE id=UUID_TO_BIN(?)`, foreignDevice.Data.ID)

	foreignAttendanceBody, _ := json.Marshal(map[string]any{
		"type": "CLOCK_IN",
		"evidence": map[string]any{
			"deviceId": foreignDevice.Data.ID,
			"location": map[string]any{"latitude": -6.2, "longitude": 106.8, "accuracyMeters": 10, "capturedAt": time.Now().UTC()},
		},
	})
	foreignAttendanceRequest, _ := http.NewRequest(http.MethodPost, host.URL+"/api/v1/attendance/actions", bytes.NewReader(foreignAttendanceBody))
	foreignAttendanceRequest.Header.Set("Authorization", "Bearer "+employeeToken)
	foreignAttendanceRequest.Header.Set("Content-Type", "application/json")
	foreignAttendanceRequest.Header.Set("Idempotency-Key", "foreign-device-"+time.Now().Format("150405.000000"))
	foreignAttendanceResponse, err := http.DefaultClient.Do(foreignAttendanceRequest)
	if err != nil {
		t.Fatal(err)
	}
	var foreignAttendanceResponseBody json.RawMessage
	_ = json.NewDecoder(foreignAttendanceResponse.Body).Decode(&foreignAttendanceResponseBody)
	_ = foreignAttendanceResponse.Body.Close()
	if foreignAttendanceResponse.StatusCode != http.StatusUnprocessableEntity || !bytes.Contains(foreignAttendanceResponseBody, []byte(`"code":"DEVICE_INVALID"`)) {
		t.Fatalf("foreign device evidence was not rejected: %d %s", foreignAttendanceResponse.StatusCode, foreignAttendanceResponseBody)
	}

	attendanceBody, _ := json.Marshal(map[string]any{
		"type": "CLOCK_IN",
		"evidence": map[string]any{
			"deviceId": device.Data.ID,
			"location": map[string]any{"latitude": -6.2, "longitude": 106.8, "accuracyMeters": 10, "capturedAt": time.Now().UTC()},
		},
	})
	attendanceRequest, _ := http.NewRequest(http.MethodPost, host.URL+"/api/v1/attendance/actions", bytes.NewReader(attendanceBody))
	attendanceRequest.Header.Set("Authorization", "Bearer "+employeeToken)
	attendanceRequest.Header.Set("Content-Type", "application/json")
	attendanceRequest.Header.Set("Idempotency-Key", "device-evidence-"+time.Now().Format("150405.000000"))
	attendanceResponse, err := http.DefaultClient.Do(attendanceRequest)
	if err != nil {
		t.Fatal(err)
	}
	var attendanceResponseBody json.RawMessage
	_ = json.NewDecoder(attendanceResponse.Body).Decode(&attendanceResponseBody)
	_ = attendanceResponse.Body.Close()
	if attendanceResponse.StatusCode != http.StatusCreated {
		t.Fatalf("attendance with owned device: %d %s", attendanceResponse.StatusCode, attendanceResponseBody)
	}
	var linkedEvidence int
	if err = db.QueryRow(`SELECT COUNT(*) FROM attendance_evidence ae JOIN attendance_events e ON e.id=ae.event_id WHERE e.membership_id=UUID_TO_BIN(?) AND ae.device_id=UUID_TO_BIN(?)`, membershipID, device.Data.ID).Scan(&linkedEvidence); err != nil || linkedEvidence != 1 {
		t.Fatalf("linked attendance device evidence=%d err=%v", linkedEvidence, err)
	}

	push := &capturePush{}
	api.SetPushSender(push)
	workerNow := time.Now().UTC()
	var eligible int
	if err = db.QueryRow(`SELECT COUNT(*) FROM notification_outbox WHERE status IN ('PENDING','FAILED') AND attempts<10 AND available_at<=CURRENT_TIMESTAMP(6)`).Scan(&eligible); err != nil || eligible != 1 {
		t.Fatalf("eligible outbox rows = %d err=%v", eligible, err)
	}
	delivered, err := api.RunNotificationOutboxOnce(context.Background(), workerNow)
	if err != nil || delivered != 1 || push.token != "fcm-test-token" || push.message.Title != "Perubahan jadwal toko" {
		t.Fatalf("notification dispatch = %d token=%q message=%+v err=%v", delivered, push.token, push.message, err)
	}
	status, body = authorizedJSON(t, http.MethodDelete, host.URL+"/api/v1/me/devices/"+device.Data.ID, employeeToken, nil)
	if status != 204 {
		t.Fatalf("revoke device: %d %s", status, body)
	}
	var audits int
	_ = db.QueryRow(`SELECT COUNT(*) FROM audit_logs WHERE resource_id=UUID_TO_BIN(?) AND action IN ('announcement.create','announcement.acknowledge')`, announcementID).Scan(&audits)
	if audits != 2 {
		t.Fatalf("announcement audit count %d", audits)
	}
}

type capturePush struct {
	token   string
	message controllers.PushMessage
}

func (p *capturePush) Send(_ context.Context, token string, message controllers.PushMessage) error {
	p.token, p.message = token, message
	return nil
}

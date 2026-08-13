package controllers_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bg-gold/attendance-api/config"
	"github.com/bg-gold/attendance-api/controllers"
	"github.com/bg-gold/attendance-api/database"
)

func TestPolicyUpdatePreservesSensitiveSettingsAndArchiveClosesAssignment(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	if !strings.Contains(strings.ToLower(dsn), "_test") {
		t.Fatal("integration test refuses a DSN without _test")
	}
	email, password := os.Getenv("TEST_ADMIN_EMAIL"), os.Getenv("TEST_ADMIN_PASSWORD")
	db, err := database.Open(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var membershipID string
	if err = db.QueryRow(`SELECT BIN_TO_UUID(m.id) FROM organization_memberships m JOIN users u ON u.id=m.user_id WHERE u.email=?`, email).Scan(&membershipID); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{Environment: "test", AccessTokenSecret: "integration-test-access-secret-at-least-32-bytes", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, CORSAllowedOrigins: []string{"http://localhost"}, MinIO: config.MinIOConfig{Endpoint: "localhost:19000", AccessKey: "test", SecretKey: "test", Bucket: "test-evidence"}}
	api, err := controllers.New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(api.Handler())
	defer host.Close()
	token := login(t, host.URL, email, password)
	status, body := authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/policies", token, map[string]any{"name": "Lifecycle Policy " + time.Now().UTC().Format("150405.000000"), "modes": []string{"GEOFENCE"}, "geofenceRadiusMeters": 125, "membershipId": membershipID})
	if status != http.StatusCreated {
		t.Fatalf("create policy: %d %s", status, body)
	}
	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(body, &created)
	policyID := created.Data.ID
	var assignmentID string
	_ = db.QueryRow(`SELECT BIN_TO_UUID(id) FROM policy_assignments WHERE policy_id=UUID_TO_BIN(?)`, policyID).Scan(&assignmentID)
	defer func() {
		_, _ = db.Exec(`DELETE FROM audit_logs WHERE resource_id=UUID_TO_BIN(?)`, policyID)
		_, _ = db.Exec(`DELETE FROM policy_assignments WHERE id=UUID_TO_BIN(?)`, assignmentID)
		_, _ = db.Exec(`DELETE FROM attendance_policy_modes WHERE policy_id=UUID_TO_BIN(?)`, policyID)
		_, _ = db.Exec(`DELETE FROM attendance_policies WHERE id=UUID_TO_BIN(?)`, policyID)
	}()
	updatedName := "Lifecycle Policy Updated " + time.Now().UTC().Format("150405.000000")
	status, body = authorizedJSON(t, http.MethodPatch, host.URL+"/api/v1/policies/"+policyID, token, map[string]any{"name": updatedName, "earlyClockInMinutes": 45, "preventEarlyClockIn": true, "modes": []string{"GEOFENCE", "SELFIE"}})
	if status != http.StatusOK {
		t.Fatalf("update policy: %d %s", status, body)
	}
	var name, geofenceSettings string
	var version, earlyMinutes int
	var preventEarly bool
	if err = db.QueryRow(`SELECT name,version,early_clock_in_minutes,prevent_early_clock_in FROM attendance_policies WHERE id=UUID_TO_BIN(?)`, policyID).Scan(&name, &version, &earlyMinutes, &preventEarly); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT CAST(settings AS CHAR) FROM attendance_policy_modes WHERE policy_id=UUID_TO_BIN(?) AND mode='GEOFENCE'`, policyID).Scan(&geofenceSettings); err != nil {
		t.Fatal(err)
	}
	if name != updatedName || version != 2 || earlyMinutes != 45 || !preventEarly || !strings.Contains(geofenceSettings, "125") {
		t.Fatalf("unexpected updated policy name=%s version=%d early=%d prevent=%v settings=%s", name, version, earlyMinutes, preventEarly, geofenceSettings)
	}
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/policies/"+policyID+"/archive", token, map[string]any{})
	if status != http.StatusOK {
		t.Fatalf("archive policy: %d %s", status, body)
	}
	var policyStatus string
	var closed bool
	if err = db.QueryRow(`SELECT p.status,pa.valid_until IS NOT NULL FROM attendance_policies p JOIN policy_assignments pa ON pa.policy_id=p.id WHERE p.id=UUID_TO_BIN(?)`, policyID).Scan(&policyStatus, &closed); err != nil {
		t.Fatal(err)
	}
	if policyStatus != "ARCHIVED" || !closed {
		t.Fatalf("archive status=%s closed=%v", policyStatus, closed)
	}
	status, body = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/me/attendance-policy", token, nil)
	if status != http.StatusOK || strings.Contains(string(body), policyID) {
		t.Fatalf("archived policy must fall back to another active scope: %d %s", status, body)
	}
	var auditCount int
	if err = db.QueryRow(`SELECT COUNT(*) FROM audit_logs WHERE resource_id=UUID_TO_BIN(?) AND action IN ('policy.update','policy.archive')`, policyID).Scan(&auditCount); err != nil || auditCount != 2 {
		t.Fatalf("audit count=%d err=%v", auditCount, err)
	}
}

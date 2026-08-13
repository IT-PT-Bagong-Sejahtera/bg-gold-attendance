package controllers_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bg-gold/attendance-api/config"
	"github.com/bg-gold/attendance-api/controllers"
	"github.com/bg-gold/attendance-api/database"
	"github.com/bg-gold/attendance-api/helpers"
)

func TestAttendanceHistoryCursorPaginationHasNoDuplicates(t *testing.T) {
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
	resetAttendance(t, db, email)
	defer resetAttendance(t, db, email)
	var organizationID, membershipID, userID, policyID string
	if err = db.QueryRow(`SELECT BIN_TO_UUID(m.organization_id),BIN_TO_UUID(m.id),BIN_TO_UUID(m.user_id) FROM organization_memberships m JOIN users u ON u.id=m.user_id WHERE u.email=?`, email).Scan(&organizationID, &membershipID, &userID); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT BIN_TO_UUID(p.id) FROM attendance_policies p JOIN policy_assignments pa ON pa.policy_id=p.id WHERE pa.organization_id=UUID_TO_BIN(?) AND p.status='ACTIVE' ORDER BY pa.created_at DESC LIMIT 1`, organizationID).Scan(&policyID); err != nil {
		t.Fatal(err)
	}
	recordedAt := time.Now().UTC().Add(-time.Hour).Truncate(time.Microsecond)
	for _, action := range []string{"CLOCK_IN", "START_BREAK", "END_BREAK"} {
		id, _ := identity.NewUUID()
		if _, err = db.Exec(`INSERT INTO attendance_events(id,organization_id,membership_id,policy_id,action_type,decision,server_recorded_at,policy_snapshot,source,created_by) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),?,'APPROVED',?,'{}','SYSTEM',UUID_TO_BIN(?))`, id, organizationID, membershipID, policyID, action, recordedAt, userID); err != nil {
			t.Fatal(err)
		}
	}
	cfg := config.Config{Environment: "test", AccessTokenSecret: "integration-test-access-secret-at-least-32-bytes", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, CORSAllowedOrigins: []string{"http://localhost"}, MinIO: config.MinIOConfig{Endpoint: "localhost:19000", AccessKey: "test", SecretKey: "test", Bucket: "test-evidence"}}
	api, err := controllers.New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(api.Handler())
	defer host.Close()
	token := login(t, host.URL, email, password)
	status, _, body := authorizedRaw(t, host.URL+"/api/v1/me/attendance/history?limit=2", token)
	if status != http.StatusOK {
		t.Fatalf("first page: %d %s", status, body)
	}
	var first struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
		NextCursor string `json:"nextCursor"`
	}
	if json.Unmarshal(body, &first) != nil || len(first.Data) != 2 || first.NextCursor == "" {
		t.Fatalf("unexpected first page: %s", body)
	}
	status, _, body = authorizedRaw(t, host.URL+"/api/v1/me/attendance/history?limit=2&cursor="+url.QueryEscape(first.NextCursor), token)
	if status != http.StatusOK {
		t.Fatalf("second page: %d %s", status, body)
	}
	var second struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
		NextCursor string `json:"nextCursor"`
	}
	if json.Unmarshal(body, &second) != nil || len(second.Data) != 1 || second.NextCursor != "" {
		t.Fatalf("unexpected second page: %s", body)
	}
	seen := map[string]bool{}
	for _, item := range append(first.Data, second.Data...) {
		if seen[item.ID] {
			t.Fatalf("duplicate history item %s", item.ID)
		}
		seen[item.ID] = true
	}
	status, _, body = authorizedRaw(t, host.URL+"/api/v1/me/attendance/history?cursor=not-base64", token)
	if status != http.StatusBadRequest || !strings.Contains(string(body), "INVALID_CURSOR") {
		t.Fatalf("invalid cursor: %d %s", status, body)
	}
}

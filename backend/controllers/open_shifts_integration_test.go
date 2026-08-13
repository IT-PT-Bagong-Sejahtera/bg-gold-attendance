package controllers_test

import (
	"bytes"
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
	"github.com/bg-gold/attendance-api/helpers"
	"golang.org/x/crypto/bcrypt"
)

func TestOpenShiftRequestApprovalCreatesAssignment(t *testing.T) {
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
	if err = database.Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	var orgID, sectionID string
	if err = db.QueryRow(`SELECT BIN_TO_UUID(m.organization_id),BIN_TO_UUID(s.id) FROM organization_memberships m JOIN users u ON u.id=m.user_id JOIN sections s ON s.organization_id=m.organization_id AND s.status='ACTIVE' WHERE u.email=? LIMIT 1`, email).Scan(&orgID, &sectionID); err != nil {
		t.Fatal(err)
	}
	userID, _ := identity.NewUUID()
	membershipID, _ := identity.NewUUID()
	employeeEmail := "open.shift." + time.Now().Format("150405.000000") + "@bggold.local"
	employeePassword := "OpenShift-Test-2026!"
	hash, _ := bcrypt.GenerateFromPassword([]byte(employeePassword), bcrypt.MinCost)
	if _, err = db.Exec(`INSERT INTO users(id,email,password_hash,full_name) VALUES(UUID_TO_BIN(?),?,?,?)`, userID, employeeEmail, hash, "Open Shift Employee"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO organization_memberships(id,organization_id,user_id,employee_number) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),?)`, membershipID, orgID, userID, "OPEN-"+time.Now().Format("150405")); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO membership_roles(membership_id,role_id) SELECT UUID_TO_BIN(?),id FROM roles WHERE organization_id=UUID_TO_BIN(?) AND code='EMPLOYEE'`, membershipID, orgID); err != nil {
		t.Fatal(err)
	}
	shiftID := ""
	defer func() {
		if shiftID != "" {
			_, _ = db.Exec(`DELETE FROM audit_logs WHERE resource_id IN (SELECT id FROM shift_requests WHERE shift_id=UUID_TO_BIN(?)) OR resource_id=UUID_TO_BIN(?)`, shiftID, shiftID)
			_, _ = db.Exec(`DELETE FROM shift_assignments WHERE shift_id=UUID_TO_BIN(?)`, shiftID)
			_, _ = db.Exec(`DELETE FROM shift_requests WHERE shift_id=UUID_TO_BIN(?)`, shiftID)
			_, _ = db.Exec(`DELETE FROM shifts WHERE id=UUID_TO_BIN(?)`, shiftID)
		}
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
	adminToken := login(t, host.URL, email, password)
	employeeToken := login(t, host.URL, employeeEmail, employeePassword)
	starts := time.Now().UTC().Add(48 * time.Hour)
	ends := starts.Add(8 * time.Hour)
	status, body := authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/shifts", adminToken, map[string]any{"sectionId": sectionID, "title": "Open Shift Weekend", "startsAt": starts, "endsAt": ends, "publish": true, "open": true, "membershipIds": []string{}})
	if status != 201 {
		t.Fatalf("create open shift: %d %s", status, body)
	}
	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err = json.Unmarshal(body, &created); err != nil {
		t.Fatal(err)
	}
	shiftID = created.Data.ID
	from, to := time.Now().UTC().Format(time.RFC3339), time.Now().UTC().Add(7*24*time.Hour).Format(time.RFC3339)
	status, body = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/me/open-shifts?from="+from+"&to="+to, employeeToken, nil)
	if status != 200 || !bytes.Contains(body, []byte("Open Shift Weekend")) {
		t.Fatalf("open shift not visible: %d %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/shifts/"+shiftID+"/requests", employeeToken, map[string]string{"reason": "Saya tersedia akhir pekan"})
	if status != 201 {
		t.Fatalf("request shift: %d %s", status, body)
	}
	var requested struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(body, &requested)
	status, body = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/shift-requests?status=PENDING", adminToken, nil)
	if status != 200 || !bytes.Contains(body, []byte("Open Shift Employee")) {
		t.Fatalf("request queue: %d %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/shift-requests/"+requested.Data.ID+"/decision", adminToken, map[string]string{"decision": "APPROVED"})
	if status != 200 {
		t.Fatalf("approve shift: %d %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/me/shifts?from="+from+"&to="+to, employeeToken, nil)
	if status != 200 || !bytes.Contains(body, []byte("Open Shift Weekend")) {
		t.Fatalf("approved shift not assigned: %d %s", status, body)
	}
	var assignments, audits int
	_ = db.QueryRow(`SELECT COUNT(*) FROM shift_assignments WHERE shift_id=UUID_TO_BIN(?) AND membership_id=UUID_TO_BIN(?)`, shiftID, membershipID).Scan(&assignments)
	_ = db.QueryRow(`SELECT COUNT(*) FROM audit_logs WHERE action IN ('shift.request','shift.request.decide') AND resource_id=UUID_TO_BIN(?)`, requested.Data.ID).Scan(&audits)
	if assignments != 1 || audits != 2 {
		t.Fatalf("assignment/audit mismatch: %d/%d", assignments, audits)
	}
}

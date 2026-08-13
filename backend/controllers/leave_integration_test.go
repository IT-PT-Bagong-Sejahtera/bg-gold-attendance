package controllers_test

import (
	"bytes"
	"context"
	"database/sql"
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

func TestLeaveRequestDecisionWithdrawalAndBalances(t *testing.T) {
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
	var orgID string
	if err = db.QueryRow(`SELECT BIN_TO_UUID(m.organization_id) FROM organization_memberships m JOIN users u ON u.id=m.user_id WHERE u.email=?`, email).Scan(&orgID); err != nil {
		t.Fatal(err)
	}
	userID, _ := identity.NewUUID()
	membershipID, _ := identity.NewUUID()
	employeeEmail := "leave." + time.Now().Format("150405.000000") + "@bggold.local"
	employeePassword := "Leave-Test-2026!"
	hash, _ := bcrypt.GenerateFromPassword([]byte(employeePassword), bcrypt.MinCost)
	if _, err = db.Exec(`INSERT INTO users(id,email,password_hash,full_name) VALUES(UUID_TO_BIN(?),?,?,?)`, userID, employeeEmail, hash, "Leave Employee"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO organization_memberships(id,organization_id,user_id,employee_number) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),?)`, membershipID, orgID, userID, "LEAVE-"+time.Now().Format("150405")); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO membership_roles(membership_id,role_id) SELECT UUID_TO_BIN(?),id FROM roles WHERE organization_id=UUID_TO_BIN(?) AND code='EMPLOYEE'`, membershipID, orgID); err != nil {
		t.Fatal(err)
	}
	typeID := ""
	requestIDs := []string{}
	defer func() {
		for _, id := range requestIDs {
			_, _ = db.Exec(`DELETE FROM audit_logs WHERE resource_id=UUID_TO_BIN(?)`, id)
		}
		if typeID != "" {
			_, _ = db.Exec(`DELETE FROM leave_decisions WHERE request_id IN (SELECT id FROM leave_requests WHERE membership_id=UUID_TO_BIN(?))`, membershipID)
			_, _ = db.Exec(`DELETE FROM leave_request_allocations WHERE request_id IN (SELECT id FROM leave_requests WHERE membership_id=UUID_TO_BIN(?))`, membershipID)
			_, _ = db.Exec(`DELETE FROM leave_requests WHERE membership_id=UUID_TO_BIN(?)`, membershipID)
			_, _ = db.Exec(`DELETE FROM leave_balances WHERE membership_id=UUID_TO_BIN(?)`, membershipID)
			_, _ = db.Exec(`DELETE FROM audit_logs WHERE resource_id=UUID_TO_BIN(?)`, typeID)
			_, _ = db.Exec(`DELETE FROM leave_types WHERE id=UUID_TO_BIN(?)`, typeID)
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
	status, body := authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/leave-types", adminToken, map[string]any{"code": "ANNUAL-" + time.Now().Format("150405"), "name": "Cuti Tahunan", "paid": true})
	if status != 201 {
		t.Fatalf("create leave type: %d %s", status, body)
	}
	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(body, &created)
	typeID = created.Data.ID
	base := nextWeekdayBlock(time.Now().UTC().AddDate(0, 1, 0))
	year := base.Year()
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/leave-balances", adminToken, map[string]any{"membershipId": membershipID, "leaveTypeId": typeID, "year": year, "entitlementDays": 12})
	if status != 200 {
		t.Fatalf("set leave balance: %d %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/leave-balances", adminToken, map[string]any{"membershipId": membershipID, "leaveTypeId": typeID, "year": year, "entitlementDays": 12})
	if status != 200 {
		t.Fatalf("idempotent leave balance update: %d %s", status, body)
	}
	createRequest := func(offset int, days int, reason string) string {
		start := base.AddDate(0, 0, offset)
		end := start.AddDate(0, 0, days-1)
		status, body := authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/me/leave-requests", employeeToken, map[string]any{"leaveTypeId": typeID, "startsOn": start.Format("2006-01-02"), "endsOn": end.Format("2006-01-02"), "reason": reason})
		if status != 201 {
			t.Fatalf("create leave request: %d %s", status, body)
		}
		var value struct {
			Data struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		_ = json.Unmarshal(body, &value)
		requestIDs = append(requestIDs, value.Data.ID)
		return value.Data.ID
	}
	first := createRequest(0, 3, "Keperluan keluarga")
	assertLeaveBalance(t, db, membershipID, 12, 0, 3)
	status, body = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/leave-requests?status=PENDING", employeeToken, nil)
	if status != 403 {
		t.Fatalf("employee manager queue status %d: %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/leave-requests?status=PENDING", adminToken, nil)
	if status != 200 || !bytes.Contains(body, []byte("Leave Employee")) {
		t.Fatalf("manager leave queue: %d %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/leave-requests/"+first+"/decision", adminToken, map[string]string{"decision": "REJECTED", "reason": "Kebutuhan operasional"})
	if status != 200 {
		t.Fatalf("reject leave: %d %s", status, body)
	}
	assertLeaveBalance(t, db, membershipID, 12, 0, 0)
	second := createRequest(7, 2, "Acara keluarga")
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/leave-requests/"+second+"/decision", adminToken, map[string]string{"decision": "APPROVED"})
	if status != 200 {
		t.Fatalf("approve leave: %d %s", status, body)
	}
	assertLeaveBalance(t, db, membershipID, 12, 2, 0)
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/leave-balances", adminToken, map[string]any{"membershipId": membershipID, "leaveTypeId": typeID, "year": year, "entitlementDays": 1})
	if status != 400 {
		t.Fatalf("balance below used days should fail: %d %s", status, body)
	}
	assertLeaveBalance(t, db, membershipID, 12, 2, 0)
	third := createRequest(14, 1, "Urusan pribadi")
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/me/leave-requests/"+third+"/withdraw", employeeToken, map[string]any{})
	if status != 200 || !bytes.Contains(body, []byte("WITHDRAWN")) {
		t.Fatalf("withdraw leave: %d %s", status, body)
	}
	assertLeaveBalance(t, db, membershipID, 12, 2, 0)
	var decisions, audits int
	_ = db.QueryRow(`SELECT COUNT(*) FROM leave_decisions ld JOIN leave_requests lr ON lr.id=ld.request_id WHERE lr.membership_id=UUID_TO_BIN(?)`, membershipID).Scan(&decisions)
	_ = db.QueryRow(`SELECT COUNT(*) FROM audit_logs WHERE action LIKE 'leave.%' AND resource_id IN (UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?))`, first, second, third).Scan(&audits)
	if decisions != 2 || audits != 6 {
		t.Fatalf("leave decision/audit mismatch %d/%d", decisions, audits)
	}
}

func nextWeekdayBlock(value time.Time) time.Time {
	value = time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, time.UTC)
	for value.Weekday() != time.Monday {
		value = value.AddDate(0, 0, 1)
	}
	return value
}
func assertLeaveBalance(t *testing.T, db interface{ QueryRow(string, ...any) *sql.Row }, membershipID string, entitlement, used, pending float64) {
	t.Helper()
	var actualEntitlement, actualUsed, actualPending float64
	if err := db.QueryRow(`SELECT entitlement_days,used_days,pending_days FROM leave_balances WHERE membership_id=UUID_TO_BIN(?)`, membershipID).Scan(&actualEntitlement, &actualUsed, &actualPending); err != nil {
		t.Fatal(err)
	}
	if actualEntitlement != entitlement || actualUsed != used || actualPending != pending {
		t.Fatalf("leave balance = %s", fmt.Sprintf("%.2f/%.2f/%.2f", actualEntitlement, actualUsed, actualPending))
	}
}

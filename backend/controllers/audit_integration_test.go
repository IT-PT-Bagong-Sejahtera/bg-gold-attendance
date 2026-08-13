package controllers_test

import (
	"context"
	"database/sql"
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
	"golang.org/x/crypto/bcrypt"
)

func TestAuditLogScopeCursorAndRBAC(t *testing.T) {
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
	var organizationID, adminUserID string
	if err = db.QueryRow(`SELECT BIN_TO_UUID(m.organization_id),BIN_TO_UUID(m.user_id) FROM organization_memberships m JOIN users u ON u.id=m.user_id WHERE u.email=?`, adminEmail).Scan(&organizationID, &adminUserID); err != nil {
		t.Fatal(err)
	}
	employeeUserID, _ := identity.NewUUID()
	employeeMembershipID, _ := identity.NewUUID()
	employeeEmail := "audit-employee-" + time.Now().UTC().Format("150405.000000") + "@bggold.test"
	employeePassword := "Audit-Test-Only-2026!"
	hash, _ := bcrypt.GenerateFromPassword([]byte(employeePassword), bcrypt.MinCost)
	if _, err = db.Exec(`INSERT INTO users(id,email,password_hash,full_name) VALUES(UUID_TO_BIN(?),?,?,'Audit Employee')`, employeeUserID, employeeEmail, string(hash)); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO organization_memberships(id,organization_id,user_id,employee_number,job_title) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),?,'Audit Test')`, employeeMembershipID, organizationID, employeeUserID, "AUD-"+time.Now().UTC().Format("150405")); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO membership_roles(membership_id,role_id) SELECT UUID_TO_BIN(?),id FROM roles WHERE organization_id=UUID_TO_BIN(?) AND code='EMPLOYEE'`, employeeMembershipID, organizationID); err != nil {
		t.Fatal(err)
	}
	auditIDs := []string{}
	createdAt := time.Now().UTC().Truncate(time.Microsecond)
	for index := 0; index < 2; index++ {
		id, _ := identity.NewUUID()
		auditIDs = append(auditIDs, id)
		if _, err = db.Exec(`INSERT INTO audit_logs(id,organization_id,actor_user_id,action,resource_type,metadata,created_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),'audit.integration','test_resource',JSON_OBJECT('index',?),?)`, id, organizationID, adminUserID, index, createdAt); err != nil {
			t.Fatal(err)
		}
	}
	defer func() {
		_, _ = db.Exec(`DELETE FROM refresh_sessions WHERE user_id=UUID_TO_BIN(?)`, employeeUserID)
		_, _ = db.Exec(`DELETE FROM membership_roles WHERE membership_id=UUID_TO_BIN(?)`, employeeMembershipID)
		_, _ = db.Exec(`DELETE FROM organization_memberships WHERE id=UUID_TO_BIN(?)`, employeeMembershipID)
		_, _ = db.Exec(`DELETE FROM users WHERE id=UUID_TO_BIN(?)`, employeeUserID)
		for _, id := range auditIDs {
			_, _ = db.Exec(`DELETE FROM audit_logs WHERE id=UUID_TO_BIN(?)`, id)
		}
	}()
	cfg := config.Config{Environment: "test", AccessTokenSecret: "integration-test-access-secret-at-least-32-bytes", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, CORSAllowedOrigins: []string{"http://localhost"}, MinIO: config.MinIOConfig{Endpoint: "localhost:19000", AccessKey: "test", SecretKey: "test", Bucket: "test-evidence"}}
	api, err := controllers.New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(api.Handler())
	defer host.Close()
	adminToken := login(t, host.URL, adminEmail, adminPassword)
	employeeToken := login(t, host.URL, employeeEmail, employeePassword)
	endpoint := host.URL + "/api/v1/audit-logs?action=audit.integration&limit=1"
	status, _, body := authorizedRaw(t, endpoint, adminToken)
	if status != http.StatusOK {
		t.Fatalf("admin audit list: %d %s", status, body)
	}
	var first struct {
		Data []struct {
			ID       string          `json:"id"`
			Metadata json.RawMessage `json:"metadata"`
		} `json:"data"`
		NextCursor string `json:"nextCursor"`
	}
	if json.Unmarshal(body, &first) != nil || len(first.Data) != 1 || first.NextCursor == "" {
		t.Fatalf("unexpected first audit page: %s", body)
	}
	status, _, body = authorizedRaw(t, endpoint+"&cursor="+url.QueryEscape(first.NextCursor), adminToken)
	if status != http.StatusOK {
		t.Fatalf("second audit page: %d %s", status, body)
	}
	var second struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
		NextCursor string `json:"nextCursor"`
	}
	if json.Unmarshal(body, &second) != nil || len(second.Data) != 1 || second.NextCursor != "" || second.Data[0].ID == first.Data[0].ID {
		t.Fatalf("unexpected second audit page: %s", body)
	}
	status, _, body = authorizedRaw(t, host.URL+"/api/v1/audit-logs", employeeToken)
	if status != http.StatusForbidden {
		t.Fatalf("employee audit access: %d %s", status, body)
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM audit_logs WHERE organization_id=UUID_TO_BIN(?) AND action='audit.integration'`, organizationID).Scan(&count); err != nil && err != sql.ErrNoRows {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("expected two scoped audit rows, got %d", count)
	}
}

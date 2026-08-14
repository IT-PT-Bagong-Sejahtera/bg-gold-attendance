package controllers_test

import (
	"context"
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

func TestRoleEndpointAuthorizationMatrix(t *testing.T) {
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
	var organizationID string
	if err = db.QueryRow(`SELECT BIN_TO_UUID(m.organization_id) FROM organization_memberships m JOIN users u ON u.id=m.user_id WHERE u.email=?`, adminEmail).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	type identityRecord struct{ userID, membershipID string }
	created := []identityRecord{}
	credentials := map[string]struct{ email, password string }{"OWNER": {adminEmail, adminPassword}}
	stamp := time.Now().UTC().Format("150405.000000")
	for _, role := range []string{"ADMIN", "HR", "SUPERVISOR", "EMPLOYEE"} {
		userID, _ := identity.NewUUID()
		membershipID, _ := identity.NewUUID()
		email := strings.ToLower(role) + "-rbac-" + stamp + "@bggold.test"
		password := "RBAC-Test-Only-2026!"
		hash, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
		if _, err = db.Exec(`INSERT INTO users(id,email,password_hash,full_name) VALUES(UUID_TO_BIN(?),?,?,?)`, userID, email, string(hash), role+" RBAC"); err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(`INSERT INTO organization_memberships(id,organization_id,user_id,employee_number,job_title) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),?,?)`, membershipID, organizationID, userID, "RBAC-"+role+"-"+stamp, "RBAC Test"); err != nil {
			t.Fatal(err)
		}
		result, roleErr := db.Exec(`INSERT INTO membership_roles(membership_id,role_id) SELECT UUID_TO_BIN(?),id FROM roles WHERE organization_id=UUID_TO_BIN(?) AND code=?`, membershipID, organizationID, role)
		if roleErr != nil {
			t.Fatal(roleErr)
		}
		if count, _ := result.RowsAffected(); count != 1 {
			t.Fatalf("seed role %s is unavailable", role)
		}
		created = append(created, identityRecord{userID, membershipID})
		credentials[role] = struct{ email, password string }{email, password}
	}
	defer func() {
		for _, record := range created {
			_, _ = db.Exec(`DELETE FROM refresh_sessions WHERE user_id=UUID_TO_BIN(?)`, record.userID)
			_, _ = db.Exec(`DELETE FROM membership_roles WHERE membership_id=UUID_TO_BIN(?)`, record.membershipID)
			_, _ = db.Exec(`DELETE FROM organization_memberships WHERE id=UUID_TO_BIN(?)`, record.membershipID)
			_, _ = db.Exec(`DELETE FROM users WHERE id=UUID_TO_BIN(?)`, record.userID)
		}
	}()
	cfg := config.Config{Environment: "test", AccessTokenSecret: "integration-test-access-secret-at-least-32-bytes", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, CORSAllowedOrigins: []string{"http://localhost"}, MinIO: config.MinIOConfig{Endpoint: "localhost:19000", AccessKey: "test", SecretKey: "test", Bucket: "test-evidence"}}
	api, err := controllers.New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(api.Handler())
	defer host.Close()
	tokens := map[string]string{}
	for role, credential := range credentials {
		tokens[role] = login(t, host.URL, credential.email, credential.password)
	}
	all := []string{"OWNER", "ADMIN", "HR", "SUPERVISOR", "EMPLOYEE"}
	managers := []string{"OWNER", "ADMIN", "HR", "SUPERVISOR"}
	adminHR := []string{"OWNER", "ADMIN", "HR"}
	adminOnly := []string{"OWNER", "ADMIN"}
	tests := []struct {
		method, path string
		allowed      []string
	}{
		{http.MethodGet, "/me/attendance/today", all},
		{http.MethodGet, "/me/attendance/events/00000000-0000-0000-0000-000000000000/evidence", all},
		{http.MethodGet, "/sections", all},
		{http.MethodGet, "/policies", all},
		{http.MethodGet, "/employees", managers},
		{http.MethodPost, "/employees", managers},
		{http.MethodPost, "/sections", adminOnly},
		{http.MethodPost, "/policies", adminHR},
		{http.MethodPost, "/shifts", managers},
		{http.MethodPatch, "/shifts/00000000-0000-0000-0000-000000000000/participants", managers},
		{http.MethodGet, "/attendance/records", managers},
		{http.MethodGet, "/attendance/events/00000000-0000-0000-0000-000000000000/evidence", managers},
		{http.MethodPost, "/attendance/corrections", adminHR},
		{http.MethodGet, "/reports/attendance.csv", managers},
		{http.MethodGet, "/audit-logs", adminHR},
		{http.MethodPost, "/leave-types", adminHR},
		{http.MethodGet, "/leave-requests", managers},
		{http.MethodPost, "/claim-types", adminHR},
		{http.MethodGet, "/claims", managers},
		{http.MethodPost, "/announcements", managers},
	}
	contains := func(values []string, wanted string) bool {
		for _, value := range values {
			if value == wanted {
				return true
			}
		}
		return false
	}
	for _, test := range tests {
		for _, role := range all {
			t.Run(fmt.Sprintf("%s_%s_%s", role, test.method, strings.ReplaceAll(test.path, "/", "_")), func(t *testing.T) {
				var status int
				if test.method == http.MethodGet {
					status, _, _ = authorizedRaw(t, host.URL+"/api/v1"+test.path, tokens[role])
				} else {
					status, _ = authorizedJSON(t, test.method, host.URL+"/api/v1"+test.path, tokens[role], map[string]any{})
				}
				if contains(test.allowed, role) {
					if status == http.StatusForbidden || status == http.StatusUnauthorized {
						t.Fatalf("%s should pass permission gate, got %d", role, status)
					}
				} else if status != http.StatusForbidden {
					t.Fatalf("%s should be forbidden, got %d", role, status)
				}
			})
		}
	}

	createAccount := func(actorToken, role, suffix string) (int, []byte, string, string) {
		email := strings.ToLower(role) + "-created-" + stamp + suffix + "@bggold.test"
		status, body := authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/employees", actorToken, map[string]any{
			"email": email, "fullName": role + " Created", "employeeNumber": "CREATED-" + role + "-" + stamp + suffix,
			"jobTitle": role + " Test", "password": "Created-Account-2026!", "roles": []string{role},
		})
		if status != http.StatusCreated {
			return status, body, email, ""
		}
		var envelope struct {
			Data struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		if err := json.Unmarshal(body, &envelope); err != nil {
			t.Fatal(err)
		}
		var createdUserID string
		if err := db.QueryRow(`SELECT BIN_TO_UUID(user_id) FROM organization_memberships WHERE id=UUID_TO_BIN(?)`, envelope.Data.ID).Scan(&createdUserID); err != nil {
			t.Fatal(err)
		}
		created = append(created, identityRecord{createdUserID, envelope.Data.ID})
		return status, body, email, envelope.Data.ID
	}

	status, body, supervisorEmail, _ := createAccount(tokens["OWNER"], "SUPERVISOR", "-owner")
	if status != http.StatusCreated {
		t.Fatalf("superadmin could not create supervisor: %d %s", status, body)
	}
	supervisorCreatedToken := login(t, host.URL, supervisorEmail, "Created-Account-2026!")
	status, body, employeeEmail, _ := createAccount(supervisorCreatedToken, "EMPLOYEE", "-supervisor")
	if status != http.StatusCreated {
		t.Fatalf("supervisor could not create employee: %d %s", status, body)
	}
	_ = login(t, host.URL, employeeEmail, "Created-Account-2026!")

	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/employees", supervisorCreatedToken, map[string]any{
		"email": "forbidden-supervisor-" + stamp + "@bggold.test", "fullName": "Forbidden Supervisor", "employeeNumber": "FORBIDDEN-SUP-" + stamp,
		"password": "Created-Account-2026!", "roles": []string{"SUPERVISOR"},
	})
	if status != http.StatusForbidden || !strings.Contains(string(body), "ROLE_ASSIGNMENT_FORBIDDEN") {
		t.Fatalf("supervisor role escalation was not blocked: %d %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/employees", tokens["OWNER"], map[string]any{
		"email": "forbidden-owner-" + stamp + "@bggold.test", "fullName": "Forbidden Owner", "employeeNumber": "FORBIDDEN-OWNER-" + stamp,
		"password": "Created-Account-2026!", "roles": []string{"OWNER"},
	})
	if status != http.StatusForbidden || !strings.Contains(string(body), "ROLE_ASSIGNMENT_FORBIDDEN") {
		t.Fatalf("second superadmin creation was not blocked: %d %s", status, body)
	}
}

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

func TestDynamicQRIsSignedExpiringAndSingleUse(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	if !strings.Contains(strings.ToLower(dsn), "_test") {
		t.Fatal("integration test refuses a DSN without _test in its database name")
	}
	email, password := os.Getenv("TEST_ADMIN_EMAIL"), os.Getenv("TEST_ADMIN_PASSWORD")
	db, err := database.Open(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := database.Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	resetAttendance(t, db, email)
	var membershipID, organizationID, sectionID string
	if err := db.QueryRow(`SELECT BIN_TO_UUID(m.id),BIN_TO_UUID(m.organization_id),BIN_TO_UUID(s.id) FROM organization_memberships m JOIN users u ON u.id=m.user_id JOIN sections s ON s.organization_id=m.organization_id AND s.status='ACTIVE' WHERE u.email=? LIMIT 1`, email).Scan(&membershipID, &organizationID, &sectionID); err != nil {
		t.Fatal(err)
	}
	policyID, err := identity.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	assignmentID, err := identity.NewUUID()
	if err != nil {
		t.Fatal(err)
	}
	secondUserID, _ := identity.NewUUID()
	secondMembershipID, _ := identity.NewUUID()
	secondEmail := "qr.employee." + time.Now().Format("150405.000000") + "@bggold.local"
	secondPassword := "DynamicQR-Test-2026!"
	secondHash, err := bcrypt.GenerateFromPassword([]byte(secondPassword), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO users(id,email,password_hash,full_name) VALUES(UUID_TO_BIN(?),?,?,?)`, secondUserID, secondEmail, secondHash, "QR Employee Test"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO organization_memberships(id,organization_id,user_id,employee_number) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),?)`, secondMembershipID, organizationID, secondUserID, "QR-"+time.Now().Format("150405")); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO membership_roles(membership_id,role_id) SELECT UUID_TO_BIN(?),id FROM roles WHERE organization_id=UUID_TO_BIN(?) AND code='EMPLOYEE'`, secondMembershipID, organizationID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = db.Exec(`DELETE c FROM dynamic_qr_consumptions c JOIN dynamic_qr_nonces n ON n.id=c.nonce_id WHERE n.organization_id=UUID_TO_BIN(?)`, organizationID)
		_, _ = db.Exec(`DELETE FROM dynamic_qr_nonces WHERE organization_id=UUID_TO_BIN(?)`, organizationID)
		resetAttendance(t, db, secondEmail)
		_, _ = db.Exec(`DELETE FROM refresh_sessions WHERE user_id=UUID_TO_BIN(?)`, secondUserID)
		_, _ = db.Exec(`DELETE FROM membership_roles WHERE membership_id=UUID_TO_BIN(?)`, secondMembershipID)
		_, _ = db.Exec(`DELETE FROM organization_memberships WHERE id=UUID_TO_BIN(?)`, secondMembershipID)
		_, _ = db.Exec(`DELETE FROM users WHERE id=UUID_TO_BIN(?)`, secondUserID)
		_, _ = db.Exec(`DELETE FROM policy_assignments WHERE id=UUID_TO_BIN(?)`, assignmentID)
		_, _ = db.Exec(`DELETE FROM attendance_policy_modes WHERE policy_id=UUID_TO_BIN(?)`, policyID)
		_, _ = db.Exec(`DELETE FROM attendance_policies WHERE id=UUID_TO_BIN(?)`, policyID)
	}()
	if _, err := db.Exec(`INSERT INTO attendance_policies(id,organization_id,name,version,status) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),?,1,'ACTIVE')`, policyID, organizationID, "Dynamic QR Integration "+time.Now().Format("150405")); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO attendance_policy_modes(policy_id,mode) VALUES(UUID_TO_BIN(?),'DYNAMIC_QR')`, policyID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO policy_assignments(id,organization_id,policy_id,section_id) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?))`, assignmentID, organizationID, policyID, sectionID); err != nil {
		t.Fatal(err)
	}

	cfg := config.Config{Environment: "test", AccessTokenSecret: "integration-test-access-secret-at-least-32-bytes", DynamicQRSecret: "integration-test-dynamic-qr-secret-at-least-32-bytes", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, CORSAllowedOrigins: []string{"http://localhost"}, MinIO: config.MinIOConfig{Endpoint: "localhost:19000", AccessKey: "test", SecretKey: "test", Bucket: "test-evidence"}}
	api, err := controllers.New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(api.Handler())
	defer host.Close()
	token := login(t, host.URL, email, password)
	secondToken := login(t, host.URL, secondEmail, secondPassword)
	deniedStatus, deniedBody := authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/attendance/requests?status=PENDING", secondToken, nil)
	if deniedStatus != http.StatusForbidden || !bytes.Contains(deniedBody, []byte(`"FORBIDDEN"`)) {
		t.Fatalf("employee could access manager approval queue: %d %s", deniedStatus, deniedBody)
	}
	status, body := authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/sections/"+sectionID+"/dynamic-qr", token, map[string]any{})
	if status != http.StatusCreated {
		t.Fatalf("issue QR status %d: %s", status, body)
	}
	var issued struct {
		Data struct {
			Token     string    `json:"token"`
			SectionID string    `json:"sectionId"`
			ExpiresAt time.Time `json:"expiresAt"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &issued); err != nil {
		t.Fatal(err)
	}
	if issued.Data.Token == "" || issued.Data.SectionID != sectionID || time.Until(issued.Data.ExpiresAt) > time.Minute {
		t.Fatalf("unexpected QR envelope: %+v", issued.Data)
	}
	postQRAction := func(accessToken, key, qrToken string) (int, []byte) {
		payload, _ := json.Marshal(map[string]any{"type": "CLOCK_IN", "sectionId": sectionID, "evidence": map[string]any{"dynamicQrToken": qrToken}})
		request, _ := http.NewRequest(http.MethodPost, host.URL+"/api/v1/attendance/actions", bytes.NewReader(payload))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Authorization", "Bearer "+accessToken)
		request.Header.Set("Idempotency-Key", key)
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var responseBody json.RawMessage
		if err := json.NewDecoder(response.Body).Decode(&responseBody); err != nil {
			t.Fatal(err)
		}
		return response.StatusCode, responseBody
	}
	status, body = postQRAction(token, "dynamic-qr-first", issued.Data.Token)
	if status != http.StatusCreated || !bytes.Contains(body, []byte(`"attendanceState":"WORKING"`)) {
		t.Fatalf("valid QR action status %d: %s", status, body)
	}
	status, body = postQRAction(token, "dynamic-qr-first", issued.Data.Token)
	if status != http.StatusOK || !bytes.Contains(body, []byte(`"idempotentReplay":true`)) {
		t.Fatalf("idempotent QR replay status %d: %s", status, body)
	}
	status, body = postQRAction(secondToken, "dynamic-qr-second-employee", issued.Data.Token)
	if status != http.StatusCreated || !bytes.Contains(body, []byte(`"attendanceState":"WORKING"`)) {
		t.Fatalf("same outlet QR was not available to a second employee: %d %s", status, body)
	}
	resetAttendance(t, db, email)
	status, body = postQRAction(token, "dynamic-qr-reused", issued.Data.Token)
	if status != http.StatusUnprocessableEntity || !bytes.Contains(body, []byte(`"QR_ALREADY_USED"`)) {
		t.Fatalf("consumed QR status %d: %s", status, body)
	}
	status, body = postQRAction(token, "dynamic-qr-tampered", issued.Data.Token+"x")
	if status != http.StatusUnprocessableEntity || !bytes.Contains(body, []byte(`"QR_INVALID"`)) {
		t.Fatalf("tampered QR status %d: %s", status, body)
	}
	status, body = postQRAction(token, "dynamic-qr-missing", "")
	if status != http.StatusUnprocessableEntity || !bytes.Contains(body, []byte(`"QR_REQUIRED"`)) {
		t.Fatalf("missing QR status %d: %s", status, body)
	}
}

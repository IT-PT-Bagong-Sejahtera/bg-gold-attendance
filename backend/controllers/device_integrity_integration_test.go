package controllers_test

import (
	"bytes"
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
	"github.com/bg-gold/attendance-api/services/attendance"
)

type fakeIntegrityVerifier struct {
	principalHashPrefix string
}

func (f fakeIntegrityVerifier) Verify(_ context.Context, token, expectedHash string) (attendance.IntegrityVerdict, error) {
	if token == "provider-error" {
		return attendance.IntegrityVerdict{}, fmt.Errorf("provider unavailable")
	}
	if token == "high-risk" {
		return attendance.IntegrityVerdict{AppRecognized: false, Licensed: false}, nil
	}
	if len(expectedHash) != 64 || (f.principalHashPrefix != "" && !strings.HasPrefix(expectedHash, f.principalHashPrefix)) {
		return attendance.IntegrityVerdict{}, fmt.Errorf("bad request hash")
	}
	return attendance.IntegrityVerdict{AppRecognized: true, Licensed: true, DeviceLabels: []string{"MEETS_DEVICE_INTEGRITY"}, ProviderReference: "integrity-1"}, nil
}

func TestDeviceIntegrityPolicyRejectsRiskAndPersistsVerdict(t *testing.T) {
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
	resetAttendance(t, db, email)
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
	status, body := authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/policies", token, map[string]any{"name": "Integrity Integration " + time.Now().Format("150405.000000"), "modes": []string{"DEVICE_INTEGRITY"}, "integrityFailClosed": true, "maxRiskScore": 30, "membershipId": membershipID})
	if status != http.StatusCreated {
		t.Fatalf("create integrity policy: %d %s", status, body)
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
		resetAttendance(t, db, email)
		_, _ = db.Exec(`DELETE FROM policy_assignments WHERE id=UUID_TO_BIN(?)`, assignmentID)
		_, _ = db.Exec(`DELETE FROM attendance_policy_modes WHERE policy_id=UUID_TO_BIN(?)`, policyID)
		_, _ = db.Exec(`DELETE FROM audit_logs WHERE resource_id=UUID_TO_BIN(?)`, policyID)
		_, _ = db.Exec(`DELETE FROM attendance_policies WHERE id=UUID_TO_BIN(?)`, policyID)
	}()

	post := func(key, integrityToken string) (int, []byte) {
		payload, _ := json.Marshal(map[string]any{"type": "CLOCK_IN", "evidence": map[string]any{"integrityToken": integrityToken}})
		request, _ := http.NewRequest(http.MethodPost, host.URL+"/api/v1/attendance/actions", bytes.NewReader(payload))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Authorization", "Bearer "+token)
		request.Header.Set("Idempotency-Key", key)
		response, requestErr := http.DefaultClient.Do(request)
		if requestErr != nil {
			t.Fatal(requestErr)
		}
		defer response.Body.Close()
		var result json.RawMessage
		_ = json.NewDecoder(response.Body).Decode(&result)
		return response.StatusCode, result
	}
	status, body = post("integrity-missing", "")
	if status != 422 || !bytes.Contains(body, []byte("DEVICE_INTEGRITY_REQUIRED")) {
		t.Fatalf("missing token: %d %s", status, body)
	}
	status, body = post("integrity-provider-missing", "signed")
	if status != 503 || !bytes.Contains(body, []byte("DEVICE_INTEGRITY_UNAVAILABLE")) {
		t.Fatalf("missing provider: %d %s", status, body)
	}
	api.SetIntegrityVerifier(fakeIntegrityVerifier{})
	status, body = post("integrity-risk", "high-risk")
	if status != 422 || !bytes.Contains(body, []byte("DEVICE_INTEGRITY_FAILED")) {
		t.Fatalf("high risk: %d %s", status, body)
	}
	status, body = post("integrity-valid", "trusted-token")
	if status != http.StatusCreated {
		t.Fatalf("valid integrity: %d %s", status, body)
	}
	var stored string
	if err = db.QueryRow(`SELECT CAST(ev.integrity_verdict AS CHAR) FROM attendance_evidence ev JOIN attendance_events e ON e.id=ev.event_id WHERE e.membership_id=UUID_TO_BIN(?) ORDER BY e.created_at DESC LIMIT 1`, membershipID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(stored, `"riskScore": 0`) && !strings.Contains(stored, `"riskScore":0`) {
		t.Fatalf("unexpected integrity verdict %s", stored)
	}
	if strings.Contains(stored, "trusted-token") {
		t.Fatal("raw integrity token must never be persisted")
	}
}

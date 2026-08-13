package controllers_test

import (
	"bytes"
	"context"
	"crypto/sha256"
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

func TestWiFiPolicyMatchesAndStoresHashedBSSID(t *testing.T) {
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
	status, body := authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/policies", token, map[string]any{"name": "WiFi Integration " + time.Now().Format("150405"), "modes": []string{"WIFI"}, "wifiNetworks": []map[string]string{{"ssid": "BG GOLD HQ", "bssid": "AA:BB:CC:DD:EE:FF"}}, "membershipId": membershipID})
	if status != 201 {
		t.Fatalf("create wifi policy: %d %s", status, body)
	}
	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(body, &created)
	policyID := created.Data.ID
	var assignmentID string
	if err = db.QueryRow(`SELECT BIN_TO_UUID(id) FROM policy_assignments WHERE policy_id=UUID_TO_BIN(?)`, policyID).Scan(&assignmentID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		resetAttendance(t, db, email)
		_, _ = db.Exec(`DELETE FROM policy_assignments WHERE id=UUID_TO_BIN(?)`, assignmentID)
		_, _ = db.Exec(`DELETE FROM attendance_policy_modes WHERE policy_id=UUID_TO_BIN(?)`, policyID)
		_, _ = db.Exec(`DELETE FROM audit_logs WHERE resource_id=UUID_TO_BIN(?)`, policyID)
		_, _ = db.Exec(`DELETE FROM attendance_policies WHERE id=UUID_TO_BIN(?)`, policyID)
	}()
	post := func(key string, wifi any) (int, []byte) {
		payload, _ := json.Marshal(map[string]any{"type": "CLOCK_IN", "evidence": map[string]any{"wifi": wifi}})
		request, _ := http.NewRequest(http.MethodPost, host.URL+"/api/v1/attendance/actions", bytes.NewReader(payload))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Authorization", "Bearer "+token)
		request.Header.Set("Idempotency-Key", key)
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var result json.RawMessage
		_ = json.NewDecoder(response.Body).Decode(&result)
		return response.StatusCode, result
	}
	status, body = post("wifi-missing", nil)
	if status != 422 || !bytes.Contains(body, []byte("WIFI_REQUIRED")) {
		t.Fatalf("missing wifi: %d %s", status, body)
	}
	status, body = post("wifi-wrong", map[string]string{"ssid": "Guest", "bssid": "AA:BB:CC:DD:EE:FF"})
	if status != 422 || !bytes.Contains(body, []byte("WIFI_MISMATCH")) {
		t.Fatalf("wrong wifi: %d %s", status, body)
	}
	status, body = post("wifi-valid", map[string]string{"ssid": "BG GOLD HQ", "bssid": "AA-BB-CC-DD-EE-FF"})
	if status != 201 {
		t.Fatalf("valid wifi: %d %s", status, body)
	}
	var ssid string
	var storedHash []byte
	if err = db.QueryRow(`SELECT ev.wifi_ssid,ev.wifi_bssid_hash FROM attendance_evidence ev JOIN attendance_events e ON e.id=ev.event_id WHERE e.membership_id=UUID_TO_BIN(?) ORDER BY e.created_at DESC LIMIT 1`, membershipID).Scan(&ssid, &storedHash); err != nil {
		t.Fatal(err)
	}
	expected := sha256.Sum256([]byte("aabbccddeeff"))
	if ssid != "BG GOLD HQ" || !bytes.Equal(storedHash, expected[:]) {
		t.Fatalf("unexpected stored wifi evidence %q %x", ssid, storedHash)
	}
}

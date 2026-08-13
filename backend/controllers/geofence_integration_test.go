package controllers_test

import (
	"bytes"
	"context"
	"database/sql"
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

func TestGeofencePolicyRejectsOutsideAndPersistsInsideEvidence(t *testing.T) {
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
	resetAttendance(t, db, email)
	var membershipID, organizationID, sectionID string
	var originalLatitude, originalLongitude sql.NullFloat64
	if err := db.QueryRow(`SELECT BIN_TO_UUID(m.id),BIN_TO_UUID(m.organization_id),BIN_TO_UUID(s.id),s.latitude,s.longitude FROM organization_memberships m JOIN users u ON u.id=m.user_id JOIN sections s ON s.organization_id=m.organization_id AND s.status='ACTIVE' WHERE u.email=? LIMIT 1`, email).Scan(&membershipID, &organizationID, &sectionID, &originalLatitude, &originalLongitude); err != nil {
		t.Fatal(err)
	}
	latitude, longitude := -7.2575, 112.7521
	if _, err := db.Exec(`UPDATE sections SET latitude=?,longitude=? WHERE id=UUID_TO_BIN(?)`, latitude, longitude, sectionID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = db.Exec(`UPDATE sections SET latitude=?,longitude=? WHERE id=UUID_TO_BIN(?)`, nullableFloat(originalLatitude), nullableFloat(originalLongitude), sectionID)
	}()
	cfg := config.Config{Environment: "test", AccessTokenSecret: "integration-test-access-secret-at-least-32-bytes", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, CORSAllowedOrigins: []string{"http://localhost"}, MinIO: config.MinIOConfig{Endpoint: "localhost:19000", AccessKey: "test", SecretKey: "test", Bucket: "test-evidence"}}
	api, err := controllers.New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(api.Handler())
	defer host.Close()
	token := login(t, host.URL, email, password)
	status, body := authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/policies", token, map[string]any{
		"name": "Geofence Integration " + time.Now().Format("150405"), "modes": []string{"GEOFENCE"},
		"geofenceRadiusMeters": 100, "minimumLocationAccuracyMeters": 50, "membershipId": membershipID,
	})
	if status != http.StatusCreated {
		t.Fatalf("create geofence policy status %d: %s", status, body)
	}
	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &created); err != nil {
		t.Fatal(err)
	}
	policyID := created.Data.ID
	var assignmentID string
	var storedRadius float64
	if err := db.QueryRow(`SELECT BIN_TO_UUID(pa.id),JSON_EXTRACT(pm.settings,'$.radiusMeters') FROM policy_assignments pa JOIN attendance_policy_modes pm ON pm.policy_id=pa.policy_id AND pm.mode='GEOFENCE' WHERE pa.policy_id=UUID_TO_BIN(?)`, policyID).Scan(&assignmentID, &storedRadius); err != nil {
		t.Fatal(err)
	}
	if storedRadius != 100 {
		t.Fatalf("geofence radius not stored: %f", storedRadius)
	}
	defer func() {
		resetAttendance(t, db, email)
		_, _ = db.Exec(`DELETE FROM policy_assignments WHERE id=UUID_TO_BIN(?)`, assignmentID)
		_, _ = db.Exec(`DELETE FROM attendance_policy_modes WHERE policy_id=UUID_TO_BIN(?)`, policyID)
		_, _ = db.Exec(`DELETE FROM audit_logs WHERE resource_id=UUID_TO_BIN(?)`, policyID)
		_, _ = db.Exec(`DELETE FROM attendance_policies WHERE id=UUID_TO_BIN(?)`, policyID)
	}()
	post := func(key string, lat, lon, accuracy float64) (int, []byte) {
		payload, _ := json.Marshal(map[string]any{"type": "CLOCK_IN", "sectionId": sectionID, "evidence": map[string]any{"location": map[string]any{"latitude": lat, "longitude": lon, "accuracyMeters": accuracy, "capturedAt": time.Now().UTC()}}})
		request, _ := http.NewRequest(http.MethodPost, host.URL+"/api/v1/attendance/actions", bytes.NewReader(payload))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Authorization", "Bearer "+token)
		request.Header.Set("Idempotency-Key", key)
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var body json.RawMessage
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		return response.StatusCode, body
	}
	status, body = post("geofence-outside", latitude+0.01, longitude, 10)
	if status != http.StatusUnprocessableEntity || !bytes.Contains(body, []byte(`"OUTSIDE_GEOFENCE"`)) {
		t.Fatalf("outside geofence status %d: %s", status, body)
	}
	status, body = post("geofence-inaccurate", latitude, longitude, 75)
	if status != http.StatusUnprocessableEntity || !bytes.Contains(body, []byte(`"LOCATION_ACCURACY_TOO_LOW"`)) {
		t.Fatalf("inaccurate location status %d: %s", status, body)
	}
	status, body = post("geofence-inside", latitude, longitude, 8)
	if status != http.StatusCreated || !bytes.Contains(body, []byte(`"attendanceState":"WORKING"`)) {
		t.Fatalf("inside geofence status %d: %s", status, body)
	}
	var storedLatitude, storedLongitude, storedAccuracy float64
	if err := db.QueryRow(`SELECT ev.latitude,ev.longitude,ev.accuracy_meters FROM attendance_evidence ev JOIN attendance_events e ON e.id=ev.event_id WHERE e.membership_id=UUID_TO_BIN(?) AND e.action_type='CLOCK_IN' ORDER BY e.created_at DESC LIMIT 1`, membershipID).Scan(&storedLatitude, &storedLongitude, &storedAccuracy); err != nil {
		t.Fatal(err)
	}
	if storedLatitude != latitude || storedLongitude != longitude || storedAccuracy != 8 {
		t.Fatalf("unexpected stored evidence: %f,%f ±%f", storedLatitude, storedLongitude, storedAccuracy)
	}
}

func nullableFloat(value sql.NullFloat64) any {
	if value.Valid {
		return value.Float64
	}
	return nil
}

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
)

func TestFaceAdapterEnrollmentVerificationAndAttendance(t *testing.T) {
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
	var membershipID, orgID, userID string
	if err = db.QueryRow(`SELECT BIN_TO_UUID(m.id),BIN_TO_UUID(m.organization_id),BIN_TO_UUID(m.user_id) FROM organization_memberships m JOIN users u ON u.id=m.user_id WHERE u.email=?`, email).Scan(&membershipID, &orgID, &userID); err != nil {
		t.Fatal(err)
	}
	attachmentID, _ := identity.NewUUID()
	if _, err = db.Exec(`INSERT INTO attachments(id,organization_id,owner_user_id,purpose,object_key,content_type,size_bytes,finalized_at,retention_until) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),'FACE_IMAGE',?,'image/jpeg',1200,UTC_TIMESTAMP(6),DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 30 DAY))`, attachmentID, orgID, userID, "face/"+attachmentID+".jpg"); err != nil {
		t.Fatal(err)
	}
	policyID, assignmentID, enrollmentID := "", "", ""
	defer func() {
		resetAttendance(t, db, email)
		_, _ = db.Exec(`DELETE FROM face_verifications WHERE membership_id=UUID_TO_BIN(?)`, membershipID)
		if enrollmentID != "" {
			_, _ = db.Exec(`DELETE FROM audit_logs WHERE resource_id=UUID_TO_BIN(?)`, enrollmentID)
		}
		_, _ = db.Exec(`DELETE FROM face_enrollments WHERE membership_id=UUID_TO_BIN(?)`, membershipID)
		_, _ = db.Exec(`DELETE FROM attachments WHERE id=UUID_TO_BIN(?)`, attachmentID)
		if assignmentID != "" {
			_, _ = db.Exec(`DELETE FROM policy_assignments WHERE id=UUID_TO_BIN(?)`, assignmentID)
		}
		if policyID != "" {
			_, _ = db.Exec(`DELETE FROM attendance_policy_modes WHERE policy_id=UUID_TO_BIN(?)`, policyID)
			_, _ = db.Exec(`DELETE FROM audit_logs WHERE resource_id=UUID_TO_BIN(?)`, policyID)
			_, _ = db.Exec(`DELETE FROM attendance_policies WHERE id=UUID_TO_BIN(?)`, policyID)
		}
	}()
	cfg := config.Config{Environment: "test", AccessTokenSecret: "integration-test-access-secret-at-least-32-bytes", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, CORSAllowedOrigins: []string{"http://localhost"}, MinIO: config.MinIOConfig{Endpoint: "localhost:19000", AccessKey: "test", SecretKey: "test", Bucket: "test-evidence"}}
	api, err := controllers.New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(api.Handler())
	defer host.Close()
	token := login(t, host.URL, email, password)
	status, body := authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/me/face/enroll", token, map[string]string{"attachmentId": attachmentID})
	if status != 503 || !bytes.Contains(body, []byte("FACE_PROVIDER_UNAVAILABLE")) {
		t.Fatalf("missing provider fallback: %d %s", status, body)
	}
	api.SetFaceProvider(fakeFaceProvider{})
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/me/face/enroll", token, map[string]string{"attachmentId": attachmentID})
	if status != 200 {
		t.Fatalf("enroll: %d %s", status, body)
	}
	var enrollment struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(body, &enrollment)
	enrollmentID = enrollment.Data.ID
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/me/face/verify", token, map[string]string{"attachmentId": attachmentID})
	if status != 201 {
		t.Fatalf("verify: %d %s", status, body)
	}
	var verification struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(body, &verification)
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/policies", token, map[string]any{"name": "Face Integration " + time.Now().Format("150405"), "modes": []string{"FACE_VERIFICATION"}, "faceFailClosed": true, "membershipId": membershipID})
	if status != 201 {
		t.Fatalf("create face policy: %d %s", status, body)
	}
	var policy struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(body, &policy)
	policyID = policy.Data.ID
	_ = db.QueryRow(`SELECT BIN_TO_UUID(id) FROM policy_assignments WHERE policy_id=UUID_TO_BIN(?)`, policyID).Scan(&assignmentID)
	post := func(key, verificationID string) (int, []byte) {
		payload, _ := json.Marshal(map[string]any{"type": "CLOCK_IN", "evidence": map[string]any{"faceVerificationId": verificationID}})
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
	status, body = post("face-valid", verification.Data.ID)
	if status != 201 {
		t.Fatalf("face attendance: %d %s", status, body)
	}
	var linked string
	if err = db.QueryRow(`SELECT BIN_TO_UUID(ev.face_verification_id) FROM attendance_evidence ev JOIN attendance_events e ON e.id=ev.event_id WHERE e.membership_id=UUID_TO_BIN(?) ORDER BY e.created_at DESC LIMIT 1`, membershipID).Scan(&linked); err != nil || linked != verification.Data.ID {
		t.Fatalf("linked verification=%q err=%v", linked, err)
	}
}

type fakeFaceProvider struct{}

func (fakeFaceProvider) Name() string                                   { return "FAKE_FACE" }
func (fakeFaceProvider) Enroll(context.Context, string) (string, error) { return "subject-1", nil }
func (fakeFaceProvider) Verify(context.Context, string, string) (controllers.FaceResult, error) {
	return controllers.FaceResult{Score: .93, LivenessPassed: true, ProviderReference: "verify-1"}, nil
}

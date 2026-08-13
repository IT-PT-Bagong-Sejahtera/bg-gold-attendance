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

func TestClaimSubmissionAttachmentDecisionAndWithdrawal(t *testing.T) {
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
	if err = database.Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	var orgID string
	if err = db.QueryRow(`SELECT BIN_TO_UUID(m.organization_id) FROM organization_memberships m JOIN users u ON u.id=m.user_id WHERE u.email=?`, adminEmail).Scan(&orgID); err != nil {
		t.Fatal(err)
	}
	userID, _ := identity.NewUUID()
	membershipID, _ := identity.NewUUID()
	employeeEmail := "claim." + time.Now().Format("150405.000000") + "@bggold.local"
	employeePassword := "Claim-Test-2026!"
	hash, _ := bcrypt.GenerateFromPassword([]byte(employeePassword), bcrypt.MinCost)
	if _, err = db.Exec(`INSERT INTO users(id,email,password_hash,full_name) VALUES(UUID_TO_BIN(?),?,?,?)`, userID, employeeEmail, hash, "Claim Employee"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO organization_memberships(id,organization_id,user_id,employee_number) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),?)`, membershipID, orgID, userID, "CLAIM-"+time.Now().Format("150405")); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO membership_roles(membership_id,role_id) SELECT UUID_TO_BIN(?),id FROM roles WHERE organization_id=UUID_TO_BIN(?) AND code='EMPLOYEE'`, membershipID, orgID); err != nil {
		t.Fatal(err)
	}
	typeID := ""
	claimIDs := []string{}
	attachmentIDs := []string{}
	defer func() {
		_, _ = db.Exec(`DELETE FROM claim_decisions WHERE claim_id IN (SELECT id FROM claims WHERE membership_id=UUID_TO_BIN(?))`, membershipID)
		_, _ = db.Exec(`DELETE FROM claims WHERE membership_id=UUID_TO_BIN(?)`, membershipID)
		for _, id := range append(claimIDs, typeID) {
			if id != "" {
				_, _ = db.Exec(`DELETE FROM audit_logs WHERE resource_id=UUID_TO_BIN(?)`, id)
			}
		}
		for _, id := range attachmentIDs {
			_, _ = db.Exec(`DELETE FROM attachments WHERE id=UUID_TO_BIN(?)`, id)
		}
		if typeID != "" {
			_, _ = db.Exec(`DELETE FROM claim_types WHERE id=UUID_TO_BIN(?)`, typeID)
		}
		_, _ = db.Exec(`DELETE FROM refresh_sessions WHERE user_id=UUID_TO_BIN(?)`, userID)
		_, _ = db.Exec(`DELETE FROM membership_roles WHERE membership_id=UUID_TO_BIN(?)`, membershipID)
		_, _ = db.Exec(`DELETE FROM organization_memberships WHERE id=UUID_TO_BIN(?)`, membershipID)
		_, _ = db.Exec(`DELETE FROM users WHERE id=UUID_TO_BIN(?)`, userID)
	}()
	ocrURLs := []string{}
	ocrHost := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer integration-ocr-key" {
			http.Error(w, "missing OCR authorization", http.StatusUnauthorized)
			return
		}
		var input struct {
			ImageURL string `json:"imageUrl"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		ocrURLs = append(ocrURLs, input.ImageURL)
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"merchant": "BG Partner Store", "total": 175000, "currency": "IDR", "transactionDate": "2026-08-11", "confidence": 0.94, "reference": "integration-ocr-1"}})
	}))
	defer ocrHost.Close()
	cfg := config.Config{Environment: "test", AccessTokenSecret: "integration-test-access-secret-at-least-32-bytes", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, CORSAllowedOrigins: []string{"http://localhost"}, MinIO: config.MinIOConfig{Endpoint: "localhost:19000", AccessKey: "test", SecretKey: "test", Bucket: "test-evidence"}, OCR: config.OCRConfig{Endpoint: ocrHost.URL, APIKey: "integration-ocr-key", Timeout: time.Second}}
	api, err := controllers.New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	api.SetObjectStore(&memoryObjectStore{})
	host := httptest.NewServer(api.Handler())
	defer host.Close()
	adminToken, employeeToken := login(t, host.URL, adminEmail, adminPassword), login(t, host.URL, employeeEmail, employeePassword)
	status, body := authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/claim-types", adminToken, map[string]any{"code": "TRAVEL-" + time.Now().Format("150405"), "name": "Perjalanan Dinas", "receiptRequired": true})
	if status != 201 {
		t.Fatalf("create claim type: %d %s", status, body)
	}
	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(body, &created)
	typeID = created.Data.ID
	newAttachment := func(ownerID string) string {
		id, _ := identity.NewUUID()
		attachmentIDs = append(attachmentIDs, id)
		if _, err := db.Exec(`INSERT INTO attachments(id,organization_id,owner_user_id,purpose,object_key,content_type,size_bytes,finalized_at,retention_until) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),'CLAIM_RECEIPT',?,'image/jpeg',1200,UTC_TIMESTAMP(6),DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 2555 DAY))`, id, orgID, ownerID, "test/"+id+".jpg"); err != nil {
			t.Fatal(err)
		}
		return id
	}
	createClaim := func(attachmentID, title string) (int, []byte, string) {
		status, body := authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/me/claims", employeeToken, map[string]any{"claimTypeId": typeID, "title": title, "amount": 175000, "currency": "IDR", "incurredOn": time.Now().Format("2006-01-02"), "notes": "Transportasi outlet", "attachmentId": attachmentID})
		var result struct {
			Data struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		_ = json.Unmarshal(body, &result)
		if result.Data.ID != "" {
			claimIDs = append(claimIDs, result.Data.ID)
		}
		return status, body, result.Data.ID
	}
	status, body, _ = createClaim("", "Tanpa struk")
	if status != 400 {
		t.Fatalf("receipt-required claim should fail: %d %s", status, body)
	}
	adminAttachment := newAttachment("00000000-0000-4000-8000-000000000002")
	status, body, _ = createClaim(adminAttachment, "Struk milik orang lain")
	if status != 400 {
		t.Fatalf("foreign receipt should fail: %d %s", status, body)
	}
	firstAttachment := newAttachment(userID)
	status, body, first := createClaim(firstAttachment, "Taksi ke outlet")
	if status != 201 || !bytes.Contains(body, []byte(`"status":"PENDING"`)) || !bytes.Contains(body, []byte(`"ocrStatus":"COMPLETE"`)) {
		t.Fatalf("create claim: %d %s", status, body)
	}
	var ocrStatus, ocrProvider, ocrResult string
	if err = db.QueryRow(`SELECT ocr_status,ocr_provider,CAST(ocr_result AS CHAR) FROM claims WHERE id=UUID_TO_BIN(?)`, first).Scan(&ocrStatus, &ocrProvider, &ocrResult); err != nil {
		t.Fatal(err)
	}
	if ocrStatus != "COMPLETE" || ocrProvider != "HTTP_RECEIPT_OCR" || !strings.Contains(ocrResult, "BG Partner Store") || len(ocrURLs) != 1 || !strings.HasPrefix(ocrURLs[0], "https://private.test/") {
		t.Fatalf("unexpected OCR persistence status=%s provider=%s result=%s urls=%v", ocrStatus, ocrProvider, ocrResult, ocrURLs)
	}
	status, body = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/claims?status=PENDING", employeeToken, nil)
	if status != 403 {
		t.Fatalf("employee claim queue should be forbidden: %d %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/claims?status=PENDING", adminToken, nil)
	if status != 200 || !bytes.Contains(body, []byte("Claim Employee")) || !bytes.Contains(body, []byte("Taksi ke outlet")) {
		t.Fatalf("manager claim queue: %d %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/claims/"+first+"/decision", adminToken, map[string]string{"decision": "APPROVED"})
	if status != 200 {
		t.Fatalf("approve claim: %d %s", status, body)
	}
	secondAttachment := newAttachment(userID)
	status, body, second := createClaim(secondAttachment, "Parkir outlet")
	if status != 201 {
		t.Fatalf("create withdrawable claim: %d %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/me/claims/"+second+"/withdraw", employeeToken, map[string]any{})
	if status != 200 || !bytes.Contains(body, []byte("WITHDRAWN")) {
		t.Fatalf("withdraw claim: %d %s", status, body)
	}
	thirdAttachment := newAttachment(userID)
	status, body, third := createClaim(thirdAttachment, "Hotel")
	if status != 201 {
		t.Fatalf("create rejectable claim: %d %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/claims/"+third+"/decision", adminToken, map[string]string{"decision": "REJECTED"})
	if status != 400 {
		t.Fatalf("rejection without reason should fail: %d %s", status, body)
	}
	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/claims/"+third+"/decision", adminToken, map[string]string{"decision": "REJECTED", "reason": "Nominal tidak sesuai struk"})
	if status != 200 {
		t.Fatalf("reject claim: %d %s", status, body)
	}
	var decisions, audits int
	if err = db.QueryRow(`SELECT COUNT(*) FROM claim_decisions d JOIN claims c ON c.id=d.claim_id WHERE c.membership_id=UUID_TO_BIN(?)`, membershipID).Scan(&decisions); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM audit_logs WHERE action LIKE 'claim.%' AND organization_id=UUID_TO_BIN(?) AND resource_id IN (UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?))`, orgID, typeID, first, second, third).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if decisions != 2 || audits != 7 {
		t.Fatalf("claim decision/audit mismatch %d/%d", decisions, audits)
	}
}

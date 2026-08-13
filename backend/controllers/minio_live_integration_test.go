package controllers_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
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

func TestLiveMinIOClaimReceiptUploadAuthorizedDownloadAndCleanup(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	endpoint := os.Getenv("TEST_MINIO_ENDPOINT")
	if dsn == "" || endpoint == "" {
		t.Skip("TEST_MYSQL_DSN and TEST_MINIO_ENDPOINT are required")
	}
	if !strings.Contains(strings.ToLower(dsn), "_test") {
		t.Fatal("integration test refuses a DSN without _test")
	}
	db, err := database.Open(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err = database.Migrate(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{
		Environment: "test", AccessTokenSecret: "integration-test-access-secret-at-least-32-bytes",
		AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour,
		CORSAllowedOrigins: []string{"http://localhost"},
		MinIO: config.MinIOConfig{
			Endpoint: endpoint, AccessKey: os.Getenv("TEST_MINIO_ACCESS_KEY"),
			SecretKey: os.Getenv("TEST_MINIO_SECRET_KEY"), Bucket: "bg-gold-claim-smoke", UseSSL: false,
		},
	}
	api, err := controllers.New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	host := httptest.NewServer(api.Handler())
	defer host.Close()
	token := login(t, host.URL, os.Getenv("TEST_ADMIN_EMAIL"), os.Getenv("TEST_ADMIN_PASSWORD"))

	typeID, attachmentID, claimID := "", "", ""
	defer func() {
		if claimID != "" {
			_, _ = db.Exec(`DELETE FROM audit_logs WHERE resource_id=UUID_TO_BIN(?)`, claimID)
			_, _ = db.Exec(`DELETE FROM claims WHERE id=UUID_TO_BIN(?)`, claimID)
		}
		if typeID != "" {
			_, _ = db.Exec(`DELETE FROM audit_logs WHERE resource_id=UUID_TO_BIN(?)`, typeID)
			_, _ = db.Exec(`DELETE FROM claim_types WHERE id=UUID_TO_BIN(?)`, typeID)
		}
		if attachmentID != "" {
			_, _ = db.Exec(`UPDATE attachments SET retention_until=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 DAY) WHERE id=UUID_TO_BIN(?)`, attachmentID)
			_, _ = api.RunAttachmentRetentionOnce(context.Background(), time.Now().UTC())
			_, _ = db.Exec(`DELETE FROM attachments WHERE id=UUID_TO_BIN(?)`, attachmentID)
		}
	}()

	status, body := authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/claim-types", token, map[string]any{"code": "MINIO-" + time.Now().Format("150405.000000"), "name": "MinIO smoke", "receiptRequired": true})
	if status != http.StatusCreated {
		t.Fatalf("create claim type: %d %s", status, body)
	}
	var createdType struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(body, &createdType)
	typeID = createdType.Data.ID

	receiptBytes := []byte("BG GOLD private claim receipt smoke evidence")
	var upload bytes.Buffer
	writer := multipart.NewWriter(&upload)
	part, _ := writer.CreateFormFile("file", "receipt.jpg")
	_, _ = part.Write(receiptBytes)
	_ = writer.Close()
	request, _ := http.NewRequest(http.MethodPost, host.URL+"/api/v1/attachments/claim-receipt", &upload)
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	var uploaded struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.NewDecoder(response.Body).Decode(&uploaded)
	_ = response.Body.Close()
	if response.StatusCode != http.StatusCreated || uploaded.Data.ID == "" {
		t.Fatalf("live MinIO upload: %d id=%q", response.StatusCode, uploaded.Data.ID)
	}
	attachmentID = uploaded.Data.ID

	status, body = authorizedJSON(t, http.MethodPost, host.URL+"/api/v1/me/claims", token, map[string]any{"claimTypeId": typeID, "title": "Live MinIO claim", "amount": 125000, "currency": "IDR", "incurredOn": time.Now().Format("2006-01-02"), "attachmentId": attachmentID})
	if status != http.StatusCreated {
		t.Fatalf("create MinIO claim: %d %s", status, body)
	}
	var createdClaim struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.Unmarshal(body, &createdClaim)
	claimID = createdClaim.Data.ID

	status, body = authorizedJSON(t, http.MethodGet, host.URL+"/api/v1/claims/"+claimID+"/receipt-url", token, nil)
	if status != http.StatusOK {
		t.Fatalf("authorized receipt URL: %d %s", status, body)
	}
	var signed struct {
		Data struct {
			URL string `json:"url"`
		} `json:"data"`
	}
	_ = json.Unmarshal(body, &signed)
	download, err := http.Get(signed.Data.URL)
	if err != nil {
		t.Fatal(err)
	}
	downloaded, _ := io.ReadAll(download.Body)
	_ = download.Body.Close()
	if download.StatusCode != http.StatusOK || !bytes.Equal(downloaded, receiptBytes) {
		t.Fatalf("signed MinIO download status=%d body=%q", download.StatusCode, downloaded)
	}
	status, _ = publicJSON(t, http.MethodGet, host.URL+"/api/v1/claims/"+claimID+"/receipt-url", nil)
	if status != http.StatusUnauthorized {
		t.Fatalf("unauthenticated receipt URL should be denied, got %d", status)
	}
}

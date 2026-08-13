package controllers_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
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
	"github.com/minio/minio-go/v7"
)

func TestPrivateAttachmentUploadAndRetentionCleanup(t *testing.T) {
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
	cfg := config.Config{Environment: "test", AccessTokenSecret: "integration-test-access-secret-at-least-32-bytes", AccessTokenTTL: 15 * time.Minute, RefreshTokenTTL: time.Hour, CORSAllowedOrigins: []string{"http://localhost"}, MinIO: config.MinIOConfig{Endpoint: "localhost:19000", AccessKey: "test", SecretKey: "test", Bucket: "test-evidence"}}
	api, err := controllers.New(cfg, db)
	if err != nil {
		t.Fatal(err)
	}
	store := &memoryObjectStore{}
	api.SetObjectStore(store)
	host := httptest.NewServer(api.Handler())
	defer host.Close()
	token := login(t, host.URL, email, password)
	var payload bytes.Buffer
	writer := multipart.NewWriter(&payload)
	part, _ := writer.CreateFormFile("file", "selfie.jpg")
	_, _ = part.Write([]byte("safe-test-image"))
	_ = writer.Close()
	request, _ := http.NewRequest(http.MethodPost, host.URL+"/api/v1/attachments/attendance-selfie", &payload)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var body struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.NewDecoder(response.Body).Decode(&body)
	if response.StatusCode != 201 || body.Data.ID == "" {
		t.Fatalf("upload status %d id=%q", response.StatusCode, body.Data.ID)
	}
	defer db.Exec(`DELETE FROM attachments WHERE id=UUID_TO_BIN(?)`, body.Data.ID)
	var purpose, key string
	var retention time.Time
	if err = db.QueryRow(`SELECT purpose,object_key,retention_until FROM attachments WHERE id=UUID_TO_BIN(?)`, body.Data.ID).Scan(&purpose, &key, &retention); err != nil {
		t.Fatal(err)
	}
	if purpose != "ATTENDANCE_SELFIE" || !retention.After(time.Now()) {
		t.Fatalf("attachment metadata %s %v", purpose, retention)
	}
	if _, err = db.Exec(`UPDATE attachments SET retention_until=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 DAY) WHERE id=UUID_TO_BIN(?)`, body.Data.ID); err != nil {
		t.Fatal(err)
	}
	removed, err := api.RunAttachmentRetentionOnce(context.Background(), time.Now().UTC())
	if err != nil || removed != 1 || store.removed != key {
		t.Fatalf("cleanup removed=%d key=%q err=%v", removed, store.removed, err)
	}
	var deletedAt *time.Time
	if err = db.QueryRow(`SELECT deleted_at FROM attachments WHERE id=UUID_TO_BIN(?)`, body.Data.ID).Scan(&deletedAt); err != nil || deletedAt == nil {
		t.Fatalf("deleted_at=%v err=%v", deletedAt, err)
	}
}

type memoryObjectStore struct{ removed string }

func (*memoryObjectStore) BucketExists(context.Context, string) (bool, error) { return true, nil }
func (*memoryObjectStore) MakeBucket(context.Context, string, minio.MakeBucketOptions) error {
	return nil
}
func (*memoryObjectStore) PutObject(_ context.Context, _, key string, reader io.Reader, size int64, _ minio.PutObjectOptions) (minio.UploadInfo, error) {
	_, _ = io.ReadAll(reader)
	return minio.UploadInfo{Key: key, Size: size}, nil
}
func (s *memoryObjectStore) RemoveObject(_ context.Context, _, key string, _ minio.RemoveObjectOptions) error {
	s.removed = key
	return nil
}
func (*memoryObjectStore) PresignedGetObject(context.Context, string, string, time.Duration, url.Values) (*url.URL, error) {
	return url.Parse("https://private.test/signed")
}

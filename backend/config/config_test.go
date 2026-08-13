package config

import (
	"strings"
	"testing"
)

func TestProductionRequiresPasswordEmailConfiguration(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("MYSQL_DSN", "user:password@tcp(localhost:3306)/database")
	t.Setenv("ACCESS_TOKEN_SECRET", "production-test-secret-at-least-32-bytes")
	t.Setenv("DYNAMIC_QR_SECRET", "production-dynamic-qr-secret-at-least-32-bytes")
	t.Setenv("MINIO_ACCESS_KEY", "minio")
	t.Setenv("MINIO_SECRET_KEY", "minio-secret")
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://admin.bggold.test")
	t.Setenv("SMTP_HOST", "")
	t.Setenv("SMTP_FROM_EMAIL", "")
	t.Setenv("PASSWORD_RESET_URL", "")
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "production email configuration") {
		t.Fatalf("expected production email configuration failure, got %v", err)
	}
}

func TestProductionRejectsDeploymentPlaceholders(t *testing.T) {
	t.Setenv("APP_ENV", "production")
	t.Setenv("MYSQL_DSN", "user:CHANGE_ME@tcp(mysql:3306)/database")
	t.Setenv("ACCESS_TOKEN_SECRET", "production-test-secret-at-least-32-bytes")
	t.Setenv("DYNAMIC_QR_SECRET", "production-dynamic-qr-secret-at-least-32-bytes")
	t.Setenv("MINIO_ACCESS_KEY", "minio")
	t.Setenv("MINIO_SECRET_KEY", "minio-secret")
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://admin.bggold.test")
	t.Setenv("SMTP_HOST", "smtp.bggold.test")
	t.Setenv("SMTP_FROM_EMAIL", "attendance@bggold.test")
	t.Setenv("PASSWORD_RESET_URL", "bggold-attendance://reset-password")
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "placeholder") {
		t.Fatalf("expected deployment placeholder failure, got %v", err)
	}
}

func TestProductionRequiresSeparateDynamicQRSecret(t *testing.T) {
	secret := "production-test-secret-at-least-32-bytes"
	t.Setenv("APP_ENV", "production")
	t.Setenv("MYSQL_DSN", "user:password@tcp(mysql:3306)/database")
	t.Setenv("ACCESS_TOKEN_SECRET", secret)
	t.Setenv("DYNAMIC_QR_SECRET", secret)
	t.Setenv("MINIO_ACCESS_KEY", "minio")
	t.Setenv("MINIO_SECRET_KEY", "minio-secret")
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://admin.bggold.test")
	t.Setenv("SMTP_HOST", "smtp.bggold.test")
	t.Setenv("SMTP_FROM_EMAIL", "attendance@bggold.test")
	t.Setenv("PASSWORD_RESET_URL", "bggold-attendance://reset-password")
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "must differ") {
		t.Fatalf("expected separate signing secret failure, got %v", err)
	}
}

func TestDevelopmentUsesMobilePasswordResetDeepLink(t *testing.T) {
	t.Setenv("APP_ENV", "development")
	t.Setenv("MYSQL_DSN", "user:password@tcp(localhost:3306)/database")
	t.Setenv("ACCESS_TOKEN_SECRET", "development-test-secret-at-least-32-bytes")
	t.Setenv("MINIO_ACCESS_KEY", "minio")
	t.Setenv("MINIO_SECRET_KEY", "minio-secret")
	t.Setenv("PASSWORD_RESET_URL", "")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Mail.ResetURL != "bggold-attendance://reset-password" {
		t.Fatalf("unexpected reset URL: %s", cfg.Mail.ResetURL)
	}
}

func TestPlayIntegrityConfigurationMustBePaired(t *testing.T) {
	t.Setenv("APP_ENV", "development")
	t.Setenv("MYSQL_DSN", "user:password@tcp(localhost:3306)/database")
	t.Setenv("ACCESS_TOKEN_SECRET", "development-test-secret-at-least-32-bytes")
	t.Setenv("MINIO_ACCESS_KEY", "minio")
	t.Setenv("MINIO_SECRET_KEY", "minio-secret")
	t.Setenv("PLAY_INTEGRITY_PACKAGE_NAME", "com.bggold.attendance")
	t.Setenv("PLAY_INTEGRITY_SERVICE_ACCOUNT_FILE", "")
	_, err := Load()
	if err == nil || !strings.Contains(err.Error(), "PLAY_INTEGRITY") {
		t.Fatalf("expected paired Play Integrity configuration failure, got %v", err)
	}
}

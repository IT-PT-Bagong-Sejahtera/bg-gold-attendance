package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Environment        string
	HTTPAddr           string
	MySQLDSN           string
	AccessTokenSecret  string
	DynamicQRSecret    string
	AccessTokenTTL     time.Duration
	RefreshTokenTTL    time.Duration
	CORSAllowedOrigins []string
	MinIO              MinIOConfig
	Mail               MailConfig
	FCM                FCMConfig
	PlayIntegrity      PlayIntegrityConfig
	OCR                OCRConfig
}

type MinIOConfig struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	Bucket    string
	UseSSL    bool
}

type MailConfig struct {
	Host       string
	Port       int
	Username   string
	Password   string
	FromEmail  string
	FromName   string
	ResetURL   string
	RequireTLS bool
}

type FCMConfig struct {
	ProjectID          string
	ServiceAccountFile string
}

type PlayIntegrityConfig struct {
	PackageName        string
	ServiceAccountFile string
}

type OCRConfig struct {
	Endpoint string
	APIKey   string
	Timeout  time.Duration
}

func Load() (Config, error) {
	accessTTL, err := duration("ACCESS_TOKEN_TTL", 15*time.Minute)
	if err != nil {
		return Config{}, err
	}
	refreshTTL, err := duration("REFRESH_TOKEN_TTL", 30*24*time.Hour)
	if err != nil {
		return Config{}, err
	}
	useSSL, err := boolean("MINIO_USE_SSL", false)
	if err != nil {
		return Config{}, err
	}
	smtpPort, err := integer("SMTP_PORT", 1025)
	if err != nil {
		return Config{}, err
	}
	requireTLS, err := boolean("SMTP_REQUIRE_TLS", false)
	if err != nil {
		return Config{}, err
	}
	ocrTimeout, err := duration("OCR_TIMEOUT", 10*time.Second)
	if err != nil {
		return Config{}, err
	}

	cfg := Config{
		Environment:        value("APP_ENV", "development"),
		HTTPAddr:           value("HTTP_ADDR", ":8080"),
		MySQLDSN:           strings.TrimSpace(os.Getenv("MYSQL_DSN")),
		AccessTokenSecret:  os.Getenv("ACCESS_TOKEN_SECRET"),
		DynamicQRSecret:    value("DYNAMIC_QR_SECRET", os.Getenv("ACCESS_TOKEN_SECRET")),
		AccessTokenTTL:     accessTTL,
		RefreshTokenTTL:    refreshTTL,
		CORSAllowedOrigins: csv(value("CORS_ALLOWED_ORIGINS", "http://localhost:5173")),
		MinIO: MinIOConfig{
			Endpoint:  value("MINIO_ENDPOINT", "localhost:9000"),
			AccessKey: os.Getenv("MINIO_ACCESS_KEY"),
			SecretKey: os.Getenv("MINIO_SECRET_KEY"),
			Bucket:    value("MINIO_BUCKET", "attendance-evidence"),
			UseSSL:    useSSL,
		},
		Mail: MailConfig{
			Host:       strings.TrimSpace(os.Getenv("SMTP_HOST")),
			Port:       smtpPort,
			Username:   os.Getenv("SMTP_USERNAME"),
			Password:   os.Getenv("SMTP_PASSWORD"),
			FromEmail:  strings.TrimSpace(os.Getenv("SMTP_FROM_EMAIL")),
			FromName:   value("SMTP_FROM_NAME", "BG GOLD Attendance"),
			ResetURL:   strings.TrimSpace(os.Getenv("PASSWORD_RESET_URL")),
			RequireTLS: requireTLS,
		},
		FCM: FCMConfig{
			ProjectID:          strings.TrimSpace(os.Getenv("FCM_PROJECT_ID")),
			ServiceAccountFile: strings.TrimSpace(os.Getenv("FCM_SERVICE_ACCOUNT_FILE")),
		},
		PlayIntegrity: PlayIntegrityConfig{
			PackageName:        strings.TrimSpace(os.Getenv("PLAY_INTEGRITY_PACKAGE_NAME")),
			ServiceAccountFile: strings.TrimSpace(os.Getenv("PLAY_INTEGRITY_SERVICE_ACCOUNT_FILE")),
		},
		OCR: OCRConfig{
			Endpoint: strings.TrimSpace(os.Getenv("OCR_ENDPOINT")),
			APIKey:   os.Getenv("OCR_API_KEY"),
			Timeout:  ocrTimeout,
		},
	}
	if (cfg.FCM.ProjectID == "") != (cfg.FCM.ServiceAccountFile == "") {
		return Config{}, errors.New("FCM_PROJECT_ID and FCM_SERVICE_ACCOUNT_FILE must be configured together")
	}
	if (cfg.PlayIntegrity.PackageName == "") != (cfg.PlayIntegrity.ServiceAccountFile == "") {
		return Config{}, errors.New("PLAY_INTEGRITY_PACKAGE_NAME and PLAY_INTEGRITY_SERVICE_ACCOUNT_FILE must be configured together")
	}

	var missing []string
	for key, actual := range map[string]string{
		"MYSQL_DSN":           cfg.MySQLDSN,
		"ACCESS_TOKEN_SECRET": cfg.AccessTokenSecret,
		"MINIO_ACCESS_KEY":    cfg.MinIO.AccessKey,
		"MINIO_SECRET_KEY":    cfg.MinIO.SecretKey,
	} {
		if strings.TrimSpace(actual) == "" {
			missing = append(missing, key)
		}
	}
	if len(cfg.AccessTokenSecret) > 0 && len(cfg.AccessTokenSecret) < 32 {
		return Config{}, errors.New("ACCESS_TOKEN_SECRET must contain at least 32 bytes")
	}
	if len(missing) > 0 {
		return Config{}, fmt.Errorf("missing required environment variables: %s", strings.Join(missing, ", "))
	}
	if strings.EqualFold(cfg.Environment, "production") {
		for key, actual := range map[string]string{
			"MYSQL_DSN":           cfg.MySQLDSN,
			"ACCESS_TOKEN_SECRET": cfg.AccessTokenSecret,
			"DYNAMIC_QR_SECRET":   cfg.DynamicQRSecret,
			"MINIO_ACCESS_KEY":    cfg.MinIO.AccessKey,
			"MINIO_SECRET_KEY":    cfg.MinIO.SecretKey,
			"SMTP_HOST":           cfg.Mail.Host,
			"SMTP_USERNAME":       cfg.Mail.Username,
			"SMTP_PASSWORD":       cfg.Mail.Password,
			"SMTP_FROM_EMAIL":     cfg.Mail.FromEmail,
		} {
			if isPlaceholder(actual) {
				return Config{}, fmt.Errorf("%s still contains a deployment placeholder", key)
			}
		}
		if len(cfg.DynamicQRSecret) < 32 {
			return Config{}, errors.New("DYNAMIC_QR_SECRET must contain at least 32 bytes in production")
		}
		if cfg.DynamicQRSecret == cfg.AccessTokenSecret {
			return Config{}, errors.New("DYNAMIC_QR_SECRET must differ from ACCESS_TOKEN_SECRET in production")
		}
		for _, origin := range cfg.CORSAllowedOrigins {
			if isPlaceholder(origin) || origin == "*" || strings.Contains(strings.ToLower(origin), "localhost") {
				return Config{}, errors.New("CORS_ALLOWED_ORIGINS must contain explicit non-localhost origins in production")
			}
		}
		var productionMissing []string
		for key, actual := range map[string]string{
			"SMTP_HOST": cfg.Mail.Host, "SMTP_FROM_EMAIL": cfg.Mail.FromEmail, "PASSWORD_RESET_URL": cfg.Mail.ResetURL,
		} {
			if strings.TrimSpace(actual) == "" {
				productionMissing = append(productionMissing, key)
			}
		}
		if len(productionMissing) > 0 {
			return Config{}, fmt.Errorf("missing production email configuration: %s", strings.Join(productionMissing, ", "))
		}
	} else if cfg.Mail.ResetURL == "" {
		cfg.Mail.ResetURL = "bggold-attendance://reset-password"
	}
	return cfg, nil
}

func isPlaceholder(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	for _, marker := range []string{"change_me", "change-me", "replace-with", "example.com", "your-domain", "your_domain"} {
		if strings.Contains(normalized, marker) {
			return true
		}
	}
	return false
}

func value(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func duration(key string, fallback time.Duration) (time.Duration, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}
	value, err := time.ParseDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	return value, nil
}

func boolean(key string, fallback bool) (bool, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.ParseBool(raw)
	if err != nil {
		return false, fmt.Errorf("%s: %w", key, err)
	}
	return value, nil
}

func integer(key string, fallback int) (int, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed < 1 || parsed > 65535 {
		return 0, fmt.Errorf("%s must be a valid TCP port", key)
	}
	return parsed, nil
}

func csv(raw string) []string {
	values := strings.Split(raw, ",")
	out := make([]string, 0, len(values))
	for _, item := range values {
		if clean := strings.TrimSpace(item); clean != "" {
			out = append(out, clean)
		}
	}
	return out
}

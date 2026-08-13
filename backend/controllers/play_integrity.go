package controllers

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/bg-gold/attendance-api/config"
	"github.com/bg-gold/attendance-api/services/attendance"
	"golang.org/x/oauth2/google"
)

const playIntegrityScope = "https://www.googleapis.com/auth/playintegrity"

type playIntegrityVerifier struct {
	packageName string
	client      *http.Client
	endpoint    string
}

func newPlayIntegrityVerifier(ctx context.Context, cfg config.PlayIntegrityConfig) (attendance.IntegrityVerifier, error) {
	credentialsJSON, err := os.ReadFile(cfg.ServiceAccountFile)
	if err != nil {
		return nil, fmt.Errorf("read Play Integrity service account: %w", err)
	}
	jwt, err := google.JWTConfigFromJSON(credentialsJSON, playIntegrityScope)
	if err != nil {
		return nil, fmt.Errorf("parse Play Integrity service account: %w", err)
	}
	return &playIntegrityVerifier{
		packageName: cfg.PackageName,
		client:      jwt.Client(ctx),
		endpoint:    "https://playintegrity.googleapis.com/v1/" + url.PathEscape(cfg.PackageName) + ":decodeIntegrityToken",
	}, nil
}

func (v *playIntegrityVerifier) Verify(ctx context.Context, token, expectedHash string) (attendance.IntegrityVerdict, error) {
	encoded, _ := json.Marshal(map[string]string{"integrity_token": token})
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, v.endpoint, bytes.NewReader(encoded))
	if err != nil {
		return attendance.IntegrityVerdict{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := v.client.Do(request)
	if err != nil {
		return attendance.IntegrityVerdict{}, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 1000))
		return attendance.IntegrityVerdict{}, fmt.Errorf("Play Integrity status %d: %s", response.StatusCode, string(body))
	}
	var decoded struct {
		TokenPayloadExternal struct {
			RequestDetails struct {
				RequestPackageName string `json:"requestPackageName"`
				RequestHash        string `json:"requestHash"`
				TimestampMillis    string `json:"timestampMillis"`
			} `json:"requestDetails"`
			AppIntegrity struct {
				AppRecognitionVerdict string `json:"appRecognitionVerdict"`
			} `json:"appIntegrity"`
			AccountDetails struct {
				AppLicensingVerdict string `json:"appLicensingVerdict"`
			} `json:"accountDetails"`
			DeviceIntegrity struct {
				DeviceRecognitionVerdict []string `json:"deviceRecognitionVerdict"`
				RecentDeviceActivity     struct {
					DeviceActivityLevel string `json:"deviceActivityLevel"`
				} `json:"recentDeviceActivity"`
			} `json:"deviceIntegrity"`
		} `json:"tokenPayloadExternal"`
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&decoded); err != nil {
		return attendance.IntegrityVerdict{}, fmt.Errorf("decode Play Integrity verdict: %w", err)
	}
	details := decoded.TokenPayloadExternal.RequestDetails
	if details.RequestPackageName != v.packageName || subtle.ConstantTimeCompare([]byte(details.RequestHash), []byte(expectedHash)) != 1 {
		return attendance.IntegrityVerdict{}, fmt.Errorf("Play Integrity request binding mismatch")
	}
	device := decoded.TokenPayloadExternal.DeviceIntegrity
	return attendance.IntegrityVerdict{
		AppRecognized:      decoded.TokenPayloadExternal.AppIntegrity.AppRecognitionVerdict == "PLAY_RECOGNIZED",
		Licensed:           decoded.TokenPayloadExternal.AccountDetails.AppLicensingVerdict == "LICENSED",
		DeviceLabels:       device.DeviceRecognitionVerdict,
		HighRecentActivity: strings.EqualFold(device.RecentDeviceActivity.DeviceActivityLevel, "LEVEL_4"),
		ProviderReference:  details.TimestampMillis,
	}, nil
}

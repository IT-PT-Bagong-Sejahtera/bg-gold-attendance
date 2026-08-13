package controllers

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bg-gold/attendance-api/config"
)

// These tests are intentionally opt-in. They call real vendor APIs and must
// only run with short-lived test-device evidence stored outside the repository.
func TestLiveFCMDeliveryAcceptedByFirebase(t *testing.T) {
	projectID := strings.TrimSpace(os.Getenv("TEST_FCM_PROJECT_ID"))
	serviceAccount := strings.TrimSpace(os.Getenv("TEST_FCM_SERVICE_ACCOUNT_FILE"))
	deviceToken := strings.TrimSpace(os.Getenv("TEST_FCM_DEVICE_TOKEN"))
	if projectID == "" || serviceAccount == "" || deviceToken == "" {
		t.Skip("TEST_FCM_PROJECT_ID, TEST_FCM_SERVICE_ACCOUNT_FILE, and TEST_FCM_DEVICE_TOKEN are required")
	}
	if _, err := os.Stat(serviceAccount); err != nil {
		t.Fatalf("FCM service-account file is unavailable: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	sender, err := newFCMSender(ctx, config.FCMConfig{ProjectID: projectID, ServiceAccountFile: serviceAccount})
	if err != nil {
		t.Fatal(err)
	}
	marker := time.Now().UTC().Format("20060102T150405Z")
	if err = sender.Send(ctx, deviceToken, PushMessage{
		Title: "BG GOLD verification",
		Body:  "FCM device smoke " + marker,
		Data:  map[string]string{"verification": "fcm-device-smoke", "marker": marker},
	}); err != nil {
		t.Fatal(err)
	}
	t.Logf("Firebase accepted marker %s; confirm foreground/background receipt on the physical device", marker)
}

func TestLivePlayIntegrityTokenDecode(t *testing.T) {
	packageName := strings.TrimSpace(os.Getenv("TEST_PLAY_INTEGRITY_PACKAGE_NAME"))
	serviceAccount := strings.TrimSpace(os.Getenv("TEST_PLAY_INTEGRITY_SERVICE_ACCOUNT_FILE"))
	token := strings.TrimSpace(os.Getenv("TEST_PLAY_INTEGRITY_TOKEN"))
	expectedHash := strings.TrimSpace(os.Getenv("TEST_PLAY_INTEGRITY_REQUEST_HASH"))
	if packageName == "" || serviceAccount == "" || token == "" || expectedHash == "" {
		t.Skip("TEST_PLAY_INTEGRITY_PACKAGE_NAME, TEST_PLAY_INTEGRITY_SERVICE_ACCOUNT_FILE, TEST_PLAY_INTEGRITY_TOKEN, and TEST_PLAY_INTEGRITY_REQUEST_HASH are required")
	}
	if _, err := os.Stat(serviceAccount); err != nil {
		t.Fatalf("Play Integrity service-account file is unavailable: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	verifier, err := newPlayIntegrityVerifier(ctx, config.PlayIntegrityConfig{PackageName: packageName, ServiceAccountFile: serviceAccount})
	if err != nil {
		t.Fatal(err)
	}
	verdict, err := verifier.Verify(ctx, token, expectedHash)
	if err != nil {
		t.Fatal(err)
	}
	if !verdict.AppRecognized || !verdict.Licensed || len(verdict.DeviceLabels) == 0 {
		t.Fatalf("release/device verdict is not acceptable: recognized=%t licensed=%t labels=%v highRecentActivity=%t", verdict.AppRecognized, verdict.Licensed, verdict.DeviceLabels, verdict.HighRecentActivity)
	}
	t.Logf("Play Integrity accepted a bound request: labels=%v highRecentActivity=%t providerTimestamp=%s", verdict.DeviceLabels, verdict.HighRecentActivity, verdict.ProviderReference)
}

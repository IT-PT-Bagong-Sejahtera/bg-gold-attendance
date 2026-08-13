package controllers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPlayIntegrityVerifierBindsHashAndMapsVerdict(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"tokenPayloadExternal":{"requestDetails":{"requestPackageName":"com.bggold.attendance","requestHash":"bound-hash","timestampMillis":"1786435200000"},"appIntegrity":{"appRecognitionVerdict":"PLAY_RECOGNIZED"},"accountDetails":{"appLicensingVerdict":"LICENSED"},"deviceIntegrity":{"deviceRecognitionVerdict":["MEETS_DEVICE_INTEGRITY"],"recentDeviceActivity":{"deviceActivityLevel":"LEVEL_1"}}}}`))
	}))
	defer provider.Close()
	verifier := &playIntegrityVerifier{packageName: "com.bggold.attendance", client: provider.Client(), endpoint: provider.URL}
	verdict, err := verifier.Verify(context.Background(), "encrypted-token", "bound-hash")
	if err != nil {
		t.Fatal(err)
	}
	if !verdict.AppRecognized || !verdict.Licensed || len(verdict.DeviceLabels) != 1 || verdict.HighRecentActivity {
		t.Fatalf("unexpected verdict: %+v", verdict)
	}
	if _, err = verifier.Verify(context.Background(), "encrypted-token", "different-hash"); err == nil {
		t.Fatal("expected request binding mismatch")
	}
}

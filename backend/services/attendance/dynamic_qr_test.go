package attendance

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestDynamicQRSignatureExpiryAndTampering(t *testing.T) {
	now := time.Date(2026, 8, 11, 4, 0, 0, 0, time.UTC)
	service := &Service{now: func() time.Time { return now }, dynamicQRSecret: []byte("dynamic-qr-test-secret-at-least-32-bytes")}
	claims := dynamicQRClaims{Version: 1, NonceID: "nonce-1", OrganizationID: "org-1", SectionID: "section-1", ExpiresAt: now.Add(45 * time.Second).Unix()}
	token, err := service.signDynamicQR(claims)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := service.decodeDynamicQR(token, now)
	if err != nil || decoded.NonceID != claims.NonceID {
		t.Fatalf("valid token did not decode: claims=%+v err=%v", decoded, err)
	}
	parts := strings.Split(token, ".")
	tampered := parts[0][:len(parts[0])-1] + "A." + parts[1]
	if _, err := service.decodeDynamicQR(tampered, now); !errors.Is(err, ErrQRInvalid) {
		t.Fatalf("tampered token error = %v", err)
	}
	if _, err := service.decodeDynamicQR(token, now.Add(45*time.Second)); !errors.Is(err, ErrQRExpired) {
		t.Fatalf("expired token error = %v", err)
	}
}

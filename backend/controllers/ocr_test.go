package controllers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/bg-gold/attendance-api/config"
)

func TestHTTPReceiptOCRMapsStructuredResultWithoutRawReceiptText(t *testing.T) {
	var imageURL, authorization string
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization = r.Header.Get("Authorization")
		var input struct {
			ImageURL string `json:"imageUrl"`
		}
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Fatal(err)
		}
		imageURL = input.ImageURL
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{
			"merchant": "BG Partner Store", "total": 175000, "currency": "idr",
			"transactionDate": "2026-08-11", "confidence": 0.94, "reference": "ocr-ref-1",
		}})
	}))
	defer host.Close()

	provider := newHTTPReceiptOCR(config.OCRConfig{Endpoint: host.URL, APIKey: "private-key", Timeout: time.Second})
	result, err := provider.ExtractReceipt(context.Background(), "https://objects.example/receipt.jpg?signature=short-lived")
	if err != nil {
		t.Fatal(err)
	}
	if imageURL == "" || authorization != "Bearer private-key" || result.Currency != "IDR" || result.Total != 175000 || result.Confidence != 0.94 {
		t.Fatalf("unexpected OCR request/result: url=%q auth=%q result=%+v", imageURL, authorization, result)
	}
}

func TestHTTPReceiptOCRRejectsMalformedProviderEvidence(t *testing.T) {
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"confidence": 1.4}})
	}))
	defer host.Close()
	provider := newHTTPReceiptOCR(config.OCRConfig{Endpoint: host.URL, Timeout: time.Second})
	if _, err := provider.ExtractReceipt(context.Background(), "https://objects.example/receipt.jpg"); err == nil {
		t.Fatal("invalid OCR evidence was accepted")
	}
}

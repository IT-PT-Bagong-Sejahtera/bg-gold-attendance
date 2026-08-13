package controllers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/bg-gold/attendance-api/config"
)

type ReceiptOCRResult struct {
	Merchant        string  `json:"merchant,omitempty"`
	Total           float64 `json:"total,omitempty"`
	Currency        string  `json:"currency,omitempty"`
	TransactionDate string  `json:"transactionDate,omitempty"`
	Confidence      float64 `json:"confidence"`
	Reference       string  `json:"reference,omitempty"`
}

type OCRProvider interface {
	Name() string
	ExtractReceipt(context.Context, string) (ReceiptOCRResult, error)
}

type httpReceiptOCR struct {
	endpoint string
	apiKey   string
	client   *http.Client
}

func newHTTPReceiptOCR(cfg config.OCRConfig) OCRProvider {
	if strings.TrimSpace(cfg.Endpoint) == "" {
		return nil
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	return &httpReceiptOCR{
		endpoint: strings.TrimSpace(cfg.Endpoint),
		apiKey:   cfg.APIKey,
		client:   &http.Client{Timeout: timeout},
	}
}

func (p *httpReceiptOCR) Name() string { return "HTTP_RECEIPT_OCR" }

func (p *httpReceiptOCR) ExtractReceipt(ctx context.Context, imageURL string) (ReceiptOCRResult, error) {
	payload, _ := json.Marshal(map[string]string{"imageUrl": imageURL})
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint, bytes.NewReader(payload))
	if err != nil {
		return ReceiptOCRResult{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	if p.apiKey != "" {
		request.Header.Set("Authorization", "Bearer "+p.apiKey)
	}
	response, err := p.client.Do(request)
	if err != nil {
		return ReceiptOCRResult{}, fmt.Errorf("request receipt OCR: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return ReceiptOCRResult{}, fmt.Errorf("receipt OCR returned HTTP %d", response.StatusCode)
	}
	var envelope struct {
		Data ReceiptOCRResult `json:"data"`
	}
	if err = json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		return ReceiptOCRResult{}, fmt.Errorf("decode receipt OCR: %w", err)
	}
	result := envelope.Data
	result.Merchant = strings.TrimSpace(result.Merchant)
	result.Currency = strings.ToUpper(strings.TrimSpace(result.Currency))
	result.TransactionDate = strings.TrimSpace(result.TransactionDate)
	result.Reference = strings.TrimSpace(result.Reference)
	if result.Total < 0 || result.Confidence < 0 || result.Confidence > 1 {
		return ReceiptOCRResult{}, errors.New("receipt OCR returned invalid amount or confidence")
	}
	if result.Currency != "" && len(result.Currency) != 3 {
		return ReceiptOCRResult{}, errors.New("receipt OCR returned invalid currency")
	}
	if result.TransactionDate != "" {
		if _, err = time.Parse("2006-01-02", result.TransactionDate); err != nil {
			return ReceiptOCRResult{}, errors.New("receipt OCR returned invalid transaction date")
		}
	}
	return result, nil
}

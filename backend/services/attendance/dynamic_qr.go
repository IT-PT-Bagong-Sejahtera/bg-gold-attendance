package attendance

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/bg-gold/attendance-api/helpers"
	"github.com/bg-gold/attendance-api/services/auth"
)

type dynamicQRClaims struct {
	Version        int    `json:"v"`
	NonceID        string `json:"nonceId"`
	OrganizationID string `json:"organizationId"`
	SectionID      string `json:"sectionId"`
	ExpiresAt      int64  `json:"expiresAt"`
}

func (s *Service) IssueDynamicQR(ctx context.Context, principal auth.Principal, sectionID, requestID string) (DynamicQR, error) {
	sectionID = strings.TrimSpace(sectionID)
	if sectionID == "" {
		return DynamicQR{}, ErrQRInvalid
	}
	if len(s.dynamicQRSecret) < 32 {
		return DynamicQR{}, errors.New("dynamic QR secret is not configured")
	}
	now := s.now().UTC()
	expiresAt := now.Add(45 * time.Second)
	nonceID, err := identity.NewUUID()
	if err != nil {
		return DynamicQR{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return DynamicQR{}, fmt.Errorf("begin dynamic QR transaction: %w", err)
	}
	defer tx.Rollback()
	var sectionExists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM sections WHERE id=UUID_TO_BIN(?) AND organization_id=UUID_TO_BIN(?) AND status='ACTIVE')`, sectionID, principal.OrganizationID).Scan(&sectionExists); err != nil {
		return DynamicQR{}, fmt.Errorf("validate dynamic QR section: %w", err)
	}
	if !sectionExists {
		return DynamicQR{}, ErrQRInvalid
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO dynamic_qr_nonces(id,organization_id,section_id,created_by,expires_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),?)`, nonceID, principal.OrganizationID, sectionID, principal.UserID, expiresAt); err != nil {
		return DynamicQR{}, fmt.Errorf("store dynamic QR nonce: %w", err)
	}
	auditID, err := identity.NewUUID()
	if err != nil {
		return DynamicQR{}, err
	}
	metadata, _ := json.Marshal(map[string]any{"expiresAt": expiresAt})
	if _, err := tx.ExecContext(ctx, `INSERT INTO audit_logs(id,organization_id,actor_user_id,action,resource_type,resource_id,metadata,request_id) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),UUID_TO_BIN(?),'attendance.dynamic_qr.issue','section',UUID_TO_BIN(?),?,?)`, auditID, principal.OrganizationID, principal.UserID, sectionID, metadata, requestID); err != nil {
		return DynamicQR{}, fmt.Errorf("audit dynamic QR issue: %w", err)
	}
	claims := dynamicQRClaims{Version: 1, NonceID: nonceID, OrganizationID: principal.OrganizationID, SectionID: sectionID, ExpiresAt: expiresAt.Unix()}
	token, err := s.signDynamicQR(claims)
	if err != nil {
		return DynamicQR{}, err
	}
	if err := tx.Commit(); err != nil {
		return DynamicQR{}, fmt.Errorf("commit dynamic QR: %w", err)
	}
	return DynamicQR{Token: token, SectionID: sectionID, ExpiresAt: expiresAt}, nil
}

func (s *Service) signDynamicQR(claims dynamicQRClaims) (string, error) {
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", fmt.Errorf("encode dynamic QR: %w", err)
	}
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, s.dynamicQRSecret)
	_, _ = mac.Write([]byte(encoded))
	return encoded + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func (s *Service) decodeDynamicQR(token string, now time.Time) (dynamicQRClaims, error) {
	if len(s.dynamicQRSecret) < 32 {
		return dynamicQRClaims{}, ErrQRInvalid
	}
	payloadPart, signaturePart, ok := strings.Cut(strings.TrimSpace(token), ".")
	if !ok || payloadPart == "" || signaturePart == "" {
		return dynamicQRClaims{}, ErrQRInvalid
	}
	signature, err := base64.RawURLEncoding.DecodeString(signaturePart)
	if err != nil {
		return dynamicQRClaims{}, ErrQRInvalid
	}
	mac := hmac.New(sha256.New, s.dynamicQRSecret)
	_, _ = mac.Write([]byte(payloadPart))
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return dynamicQRClaims{}, ErrQRInvalid
	}
	payload, err := base64.RawURLEncoding.DecodeString(payloadPart)
	if err != nil {
		return dynamicQRClaims{}, ErrQRInvalid
	}
	var claims dynamicQRClaims
	if json.Unmarshal(payload, &claims) != nil || claims.Version != 1 || claims.NonceID == "" || claims.OrganizationID == "" || claims.SectionID == "" {
		return dynamicQRClaims{}, ErrQRInvalid
	}
	if !time.Unix(claims.ExpiresAt, 0).After(now) {
		return dynamicQRClaims{}, ErrQRExpired
	}
	return claims, nil
}

func (s *Service) consumeDynamicQR(ctx context.Context, tx *sql.Tx, principal auth.Principal, sectionID, token string, now time.Time) error {
	claims, err := s.decodeDynamicQR(token, now)
	if err != nil {
		return err
	}
	if claims.OrganizationID != principal.OrganizationID || claims.SectionID != sectionID {
		return ErrQRInvalid
	}
	var expiresAt time.Time
	err = tx.QueryRowContext(ctx, `SELECT expires_at FROM dynamic_qr_nonces WHERE id=UUID_TO_BIN(?) AND organization_id=UUID_TO_BIN(?) AND section_id=UUID_TO_BIN(?)`, claims.NonceID, principal.OrganizationID, sectionID).Scan(&expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrQRInvalid
	}
	if err != nil {
		return fmt.Errorf("lock dynamic QR nonce: %w", err)
	}
	if !expiresAt.After(now) {
		return ErrQRExpired
	}
	result, err := tx.ExecContext(ctx, `INSERT IGNORE INTO dynamic_qr_consumptions(nonce_id,membership_id,consumed_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),?)`, claims.NonceID, principal.MembershipID, now)
	if err != nil {
		return fmt.Errorf("consume dynamic QR nonce: %w", err)
	}
	inserted, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("inspect dynamic QR consumption: %w", err)
	}
	if inserted == 0 {
		return ErrQRAlreadyUsed
	}
	return nil
}

package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrInvalidAccessToken  = errors.New("invalid access token")
	ErrInvalidRefreshToken = errors.New("invalid refresh token")
)

type Claims struct {
	Issuer         string `json:"iss"`
	Subject        string `json:"sub"`
	OrganizationID string `json:"org"`
	SessionID      string `json:"sid"`
	IssuedAt       int64  `json:"iat"`
	ExpiresAt      int64  `json:"exp"`
}

type TokenService struct {
	secret     []byte
	accessTTL  time.Duration
	refreshTTL time.Duration
	now        func() time.Time
}

func NewTokenService(secret string, accessTTL, refreshTTL time.Duration) *TokenService {
	return &TokenService{
		secret:     []byte(secret),
		accessTTL:  accessTTL,
		refreshTTL: refreshTTL,
		now:        time.Now,
	}
}

func (s *TokenService) SignAccess(userID, organizationID, sessionID string) (string, time.Time, error) {
	now := s.now().UTC()
	expires := now.Add(s.accessTTL)
	header, _ := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT"})
	payload, err := json.Marshal(Claims{
		Issuer:         "bg-gold-attendance",
		Subject:        userID,
		OrganizationID: organizationID,
		SessionID:      sessionID,
		IssuedAt:       now.Unix(),
		ExpiresAt:      expires.Unix(),
	})
	if err != nil {
		return "", time.Time{}, fmt.Errorf("marshal token claims: %w", err)
	}
	unsigned := encode(header) + "." + encode(payload)
	signature := s.sign(unsigned)
	return unsigned + "." + encode(signature), expires, nil
}

func (s *TokenService) ParseAccess(raw string) (Claims, error) {
	parts := strings.Split(raw, ".")
	if len(parts) != 3 {
		return Claims{}, ErrInvalidAccessToken
	}
	unsigned := parts[0] + "." + parts[1]
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || !hmac.Equal(signature, s.sign(unsigned)) {
		return Claims{}, ErrInvalidAccessToken
	}
	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return Claims{}, ErrInvalidAccessToken
	}
	var header map[string]string
	if json.Unmarshal(headerBytes, &header) != nil || header["alg"] != "HS256" || header["typ"] != "JWT" {
		return Claims{}, ErrInvalidAccessToken
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return Claims{}, ErrInvalidAccessToken
	}
	var claims Claims
	if json.Unmarshal(payload, &claims) != nil || claims.Issuer != "bg-gold-attendance" || claims.Subject == "" || claims.OrganizationID == "" || claims.SessionID == "" {
		return Claims{}, ErrInvalidAccessToken
	}
	now := s.now().UTC().Unix()
	if claims.ExpiresAt <= now || claims.IssuedAt > now+60 {
		return Claims{}, ErrInvalidAccessToken
	}
	return claims, nil
}

func (s *TokenService) NewRefresh(sessionID string) (plain string, hash [32]byte, expires time.Time, err error) {
	secret := make([]byte, 32)
	if _, err = rand.Read(secret); err != nil {
		return "", hash, time.Time{}, fmt.Errorf("random refresh token: %w", err)
	}
	plain = sessionID + "." + hex.EncodeToString(secret)
	hash = sha256.Sum256([]byte(plain))
	expires = s.now().UTC().Add(s.refreshTTL)
	return plain, hash, expires, nil
}

func ParseRefresh(raw string) (sessionID string, hash [32]byte, err error) {
	parts := strings.Split(raw, ".")
	if len(parts) != 2 || len(parts[1]) != 64 {
		return "", hash, ErrInvalidRefreshToken
	}
	if _, err := hex.DecodeString(parts[1]); err != nil {
		return "", hash, ErrInvalidRefreshToken
	}
	hash = sha256.Sum256([]byte(raw))
	return parts[0], hash, nil
}

func (s *TokenService) sign(value string) []byte {
	mac := hmac.New(sha256.New, s.secret)
	_, _ = mac.Write([]byte(value))
	return mac.Sum(nil)
}

func encode(value []byte) string { return base64.RawURLEncoding.EncodeToString(value) }

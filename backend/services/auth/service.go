package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/bg-gold/attendance-api/helpers"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrInvalidCredentials   = errors.New("invalid credentials")
	ErrInvalidPasswordReset = errors.New("invalid or expired password reset token")
)

type Service struct {
	db     *sql.DB
	tokens *TokenService
	now    func() time.Time
}

type LoginInput struct {
	Email          string
	Password       string
	OrganizationID string
	UserAgent      string
}

type TokenPair struct {
	AccessToken      string    `json:"accessToken"`
	AccessExpiresAt  time.Time `json:"accessExpiresAt"`
	RefreshToken     string    `json:"refreshToken"`
	RefreshExpiresAt time.Time `json:"refreshExpiresAt"`
}

func NewService(db *sql.DB, tokens *TokenService) *Service {
	return &Service{db: db, tokens: tokens, now: time.Now}
}

func (s *Service) Login(ctx context.Context, input LoginInput) (TokenPair, error) {
	var userID, passwordHash, userStatus string
	err := s.db.QueryRowContext(ctx, `
		SELECT BIN_TO_UUID(id), password_hash, status
		FROM users WHERE email = ?`, strings.ToLower(strings.TrimSpace(input.Email))).Scan(&userID, &passwordHash, &userStatus)
	if errors.Is(err, sql.ErrNoRows) {
		return TokenPair{}, ErrInvalidCredentials
	}
	if err != nil {
		return TokenPair{}, fmt.Errorf("find login user: %w", err)
	}
	if userStatus != "ACTIVE" || bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(input.Password)) != nil {
		return TokenPair{}, ErrInvalidCredentials
	}

	organizationID, err := s.resolveOrganization(ctx, userID, input.OrganizationID)
	if err != nil {
		return TokenPair{}, err
	}
	sessionID, err := identity.NewUUID()
	if err != nil {
		return TokenPair{}, err
	}
	refresh, refreshHash, refreshExpiry, err := s.tokens.NewRefresh(sessionID)
	if err != nil {
		return TokenPair{}, err
	}
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO refresh_sessions(id, user_id, active_organization_id, token_hash, user_agent, expires_at)
		VALUES(UUID_TO_BIN(?), UUID_TO_BIN(?), UUID_TO_BIN(?), ?, ?, ?)`,
		sessionID, userID, organizationID, refreshHash[:], nullable(input.UserAgent), refreshExpiry); err != nil {
		return TokenPair{}, fmt.Errorf("create refresh session: %w", err)
	}
	access, accessExpiry, err := s.tokens.SignAccess(userID, organizationID, sessionID)
	if err != nil {
		return TokenPair{}, err
	}
	return TokenPair{AccessToken: access, AccessExpiresAt: accessExpiry, RefreshToken: refresh, RefreshExpiresAt: refreshExpiry}, nil
}

func (s *Service) Refresh(ctx context.Context, raw string) (TokenPair, error) {
	sessionID, presentedHash, err := ParseRefresh(raw)
	if err != nil {
		return TokenPair{}, ErrInvalidCredentials
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return TokenPair{}, fmt.Errorf("begin refresh: %w", err)
	}
	defer tx.Rollback()

	var userID, organizationID string
	var storedHash []byte
	var expires time.Time
	var revokedAt sql.NullTime
	err = tx.QueryRowContext(ctx, `
		SELECT BIN_TO_UUID(user_id), BIN_TO_UUID(active_organization_id), token_hash, expires_at, revoked_at
		FROM refresh_sessions WHERE id = UUID_TO_BIN(?) FOR UPDATE`, sessionID).
		Scan(&userID, &organizationID, &storedHash, &expires, &revokedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return TokenPair{}, ErrInvalidCredentials
	}
	if err != nil {
		return TokenPair{}, fmt.Errorf("lock refresh session: %w", err)
	}
	now := s.now().UTC()
	if revokedAt.Valid || !expires.After(now) {
		return TokenPair{}, ErrInvalidCredentials
	}
	if len(storedHash) != len(presentedHash) || subtle.ConstantTimeCompare(storedHash, presentedHash[:]) != 1 {
		if _, updateErr := tx.ExecContext(ctx, "UPDATE refresh_sessions SET revoked_at = ? WHERE id = UUID_TO_BIN(?)", now, sessionID); updateErr != nil {
			return TokenPair{}, fmt.Errorf("revoke reused refresh session: %w", updateErr)
		}
		if commitErr := tx.Commit(); commitErr != nil {
			return TokenPair{}, fmt.Errorf("commit reused refresh revocation: %w", commitErr)
		}
		return TokenPair{}, ErrInvalidCredentials
	}

	refresh, nextHash, refreshExpiry, err := s.tokens.NewRefresh(sessionID)
	if err != nil {
		return TokenPair{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE refresh_sessions SET token_hash = ?, expires_at = ?, rotated_at = ?
		WHERE id = UUID_TO_BIN(?)`, nextHash[:], refreshExpiry, now, sessionID); err != nil {
		return TokenPair{}, fmt.Errorf("rotate refresh token: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return TokenPair{}, fmt.Errorf("commit refresh rotation: %w", err)
	}
	access, accessExpiry, err := s.tokens.SignAccess(userID, organizationID, sessionID)
	if err != nil {
		return TokenPair{}, err
	}
	return TokenPair{AccessToken: access, AccessExpiresAt: accessExpiry, RefreshToken: refresh, RefreshExpiresAt: refreshExpiry}, nil
}

func (s *Service) Logout(ctx context.Context, sessionID string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(6)) WHERE id = UUID_TO_BIN(?)`, sessionID)
	if err != nil {
		return fmt.Errorf("revoke refresh session: %w", err)
	}
	return nil
}

func (s *Service) SwitchOrganization(ctx context.Context, sessionID, userID, organizationID string) (TokenPair, error) {
	organizationID = strings.TrimSpace(organizationID)
	if organizationID == "" {
		return TokenPair{}, ErrInvalidCredentials
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return TokenPair{}, fmt.Errorf("begin organization switch: %w", err)
	}
	defer tx.Rollback()
	var membershipID string
	err = tx.QueryRowContext(ctx, `SELECT BIN_TO_UUID(m.id) FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=UUID_TO_BIN(?) AND m.organization_id=UUID_TO_BIN(?) AND m.status='ACTIVE' AND o.status='ACTIVE'`, userID, organizationID).Scan(&membershipID)
	if errors.Is(err, sql.ErrNoRows) {
		return TokenPair{}, ErrInvalidCredentials
	}
	if err != nil {
		return TokenPair{}, fmt.Errorf("validate organization membership: %w", err)
	}
	var expiresAt time.Time
	err = tx.QueryRowContext(ctx, `SELECT expires_at FROM refresh_sessions WHERE id=UUID_TO_BIN(?) AND user_id=UUID_TO_BIN(?) AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP(6) FOR UPDATE`, sessionID, userID).Scan(&expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return TokenPair{}, ErrInvalidCredentials
	}
	if err != nil {
		return TokenPair{}, fmt.Errorf("lock organization switch session: %w", err)
	}
	refresh, nextHash, refreshExpiry, err := s.tokens.NewRefresh(sessionID)
	if err != nil {
		return TokenPair{}, err
	}
	now := s.now().UTC()
	if _, err = tx.ExecContext(ctx, `UPDATE refresh_sessions SET active_organization_id=UUID_TO_BIN(?),token_hash=?,expires_at=?,rotated_at=? WHERE id=UUID_TO_BIN(?)`, organizationID, nextHash[:], refreshExpiry, now, sessionID); err != nil {
		return TokenPair{}, fmt.Errorf("switch active organization: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return TokenPair{}, fmt.Errorf("commit organization switch: %w", err)
	}
	access, accessExpiry, err := s.tokens.SignAccess(userID, organizationID, sessionID)
	if err != nil {
		return TokenPair{}, err
	}
	return TokenPair{AccessToken: access, AccessExpiresAt: accessExpiry, RefreshToken: refresh, RefreshExpiresAt: refreshExpiry}, nil
}

func (s *Service) RequestPasswordReset(ctx context.Context, email string) (string, error) {
	var userID string
	err := s.db.QueryRowContext(ctx, `SELECT BIN_TO_UUID(id) FROM users WHERE email=? AND status='ACTIVE'`, strings.ToLower(strings.TrimSpace(email))).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("find password reset user: %w", err)
	}
	secret := make([]byte, 32)
	if _, err = rand.Read(secret); err != nil {
		return "", fmt.Errorf("generate password reset token: %w", err)
	}
	raw := base64.RawURLEncoding.EncodeToString(secret)
	hash := sha256.Sum256([]byte(raw))
	tokenID, err := identity.NewUUID()
	if err != nil {
		return "", err
	}
	now := s.now().UTC()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("begin password reset request: %w", err)
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `UPDATE password_reset_tokens SET used_at=? WHERE user_id=UUID_TO_BIN(?) AND used_at IS NULL`, now, userID); err != nil {
		return "", fmt.Errorf("invalidate previous password reset tokens: %w", err)
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO password_reset_tokens(id,user_id,token_hash,expires_at) VALUES(UUID_TO_BIN(?),UUID_TO_BIN(?),?,?)`, tokenID, userID, hash[:], now.Add(30*time.Minute)); err != nil {
		return "", fmt.Errorf("store password reset token: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return "", fmt.Errorf("commit password reset request: %w", err)
	}
	return raw, nil
}

func (s *Service) ResetPassword(ctx context.Context, rawToken, password string) error {
	rawToken = strings.TrimSpace(rawToken)
	if len(rawToken) < 40 || len(password) < 12 {
		return ErrInvalidPasswordReset
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash new password: %w", err)
	}
	presentedHash := sha256.Sum256([]byte(rawToken))
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin password reset: %w", err)
	}
	defer tx.Rollback()
	var userID string
	var expiresAt time.Time
	var usedAt sql.NullTime
	err = tx.QueryRowContext(ctx, `SELECT BIN_TO_UUID(user_id),expires_at,used_at FROM password_reset_tokens WHERE token_hash=? FOR UPDATE`, presentedHash[:]).Scan(&userID, &expiresAt, &usedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrInvalidPasswordReset
	}
	if err != nil {
		return fmt.Errorf("lock password reset token: %w", err)
	}
	now := s.now().UTC()
	if usedAt.Valid || !expiresAt.After(now) {
		return ErrInvalidPasswordReset
	}
	if _, err = tx.ExecContext(ctx, `UPDATE users SET password_hash=? WHERE id=UUID_TO_BIN(?) AND status='ACTIVE'`, string(passwordHash), userID); err != nil {
		return fmt.Errorf("update password: %w", err)
	}
	if _, err = tx.ExecContext(ctx, `UPDATE organization_memberships SET status='ACTIVE',ended_at=NULL WHERE user_id=UUID_TO_BIN(?) AND status='INVITED'`, userID); err != nil {
		return fmt.Errorf("activate invited memberships: %w", err)
	}
	if _, err = tx.ExecContext(ctx, `UPDATE password_reset_tokens SET used_at=? WHERE user_id=UUID_TO_BIN(?) AND used_at IS NULL`, now, userID); err != nil {
		return fmt.Errorf("consume password reset tokens: %w", err)
	}
	if _, err = tx.ExecContext(ctx, `UPDATE refresh_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=UUID_TO_BIN(?)`, now, userID); err != nil {
		return fmt.Errorf("revoke sessions after password reset: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit password reset: %w", err)
	}
	return nil
}

func (s *Service) resolveOrganization(ctx context.Context, userID, requested string) (string, error) {
	query := `SELECT BIN_TO_UUID(organization_id) FROM organization_memberships WHERE user_id = UUID_TO_BIN(?) AND status = 'ACTIVE'`
	args := []any{userID}
	if strings.TrimSpace(requested) != "" {
		query += " AND organization_id = UUID_TO_BIN(?)"
		args = append(args, requested)
	}
	query += " ORDER BY created_at LIMIT 1"
	var organizationID string
	if err := s.db.QueryRowContext(ctx, query, args...).Scan(&organizationID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", ErrInvalidCredentials
		}
		return "", fmt.Errorf("resolve login organization: %w", err)
	}
	return organizationID, nil
}

func nullable(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

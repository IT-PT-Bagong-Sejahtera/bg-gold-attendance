package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

type Resolver struct{ db *sql.DB }

func NewResolver(db *sql.DB) *Resolver { return &Resolver{db: db} }

func (r *Resolver) Resolve(ctx context.Context, claims Claims) (Principal, error) {
	var principal Principal
	err := r.db.QueryRowContext(ctx, `
		SELECT BIN_TO_UUID(s.user_id), BIN_TO_UUID(s.active_organization_id), BIN_TO_UUID(m.id), BIN_TO_UUID(s.id)
		FROM refresh_sessions s
		JOIN organization_memberships m
		  ON m.user_id = s.user_id AND m.organization_id = s.active_organization_id AND m.status = 'ACTIVE'
		JOIN users u ON u.id = s.user_id AND u.status = 'ACTIVE'
		JOIN organizations o ON o.id = s.active_organization_id AND o.status = 'ACTIVE'
		WHERE s.id = UUID_TO_BIN(?)
		  AND s.user_id = UUID_TO_BIN(?)
		  AND s.active_organization_id = UUID_TO_BIN(?)
		  AND s.revoked_at IS NULL
		  AND s.expires_at > UTC_TIMESTAMP(6)`, claims.SessionID, claims.Subject, claims.OrganizationID).
		Scan(&principal.UserID, &principal.OrganizationID, &principal.MembershipID, &principal.SessionID)
	if errors.Is(err, sql.ErrNoRows) {
		return Principal{}, ErrUnauthenticated
	}
	if err != nil {
		return Principal{}, fmt.Errorf("resolve principal: %w", err)
	}
	principal.Permissions = make(map[string]bool)
	rows, err := r.db.QueryContext(ctx, `
		SELECT DISTINCT rp.permission_code
		FROM membership_roles mr
		JOIN role_permissions rp ON rp.role_id = mr.role_id
		WHERE mr.membership_id = UUID_TO_BIN(?)`, principal.MembershipID)
	if err != nil {
		return Principal{}, fmt.Errorf("load principal permissions: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var permission string
		if err := rows.Scan(&permission); err != nil {
			return Principal{}, fmt.Errorf("scan principal permission: %w", err)
		}
		principal.Permissions[permission] = true
	}
	if err := rows.Err(); err != nil {
		return Principal{}, fmt.Errorf("iterate principal permissions: %w", err)
	}
	return principal, nil
}

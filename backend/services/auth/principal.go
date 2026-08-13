package auth

import (
	"context"
	"errors"
)

var ErrUnauthenticated = errors.New("unauthenticated")

type Principal struct {
	UserID         string
	OrganizationID string
	MembershipID   string
	SessionID      string
	Permissions    map[string]bool
}

func (p Principal) Can(permission string) bool { return p.Permissions[permission] }

type principalKey struct{}

func WithPrincipal(ctx context.Context, principal Principal) context.Context {
	return context.WithValue(ctx, principalKey{}, principal)
}

func PrincipalFrom(ctx context.Context) (Principal, error) {
	principal, ok := ctx.Value(principalKey{}).(Principal)
	if !ok {
		return Principal{}, ErrUnauthenticated
	}
	return principal, nil
}

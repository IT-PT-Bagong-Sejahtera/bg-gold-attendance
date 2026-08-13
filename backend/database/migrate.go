package database

import (
	"context"
	"database/sql"

	"github.com/bg-gold/attendance-api/migrations"
)

// Migrate keeps database startup simple while migration files live in their
// own top-level package.
func Migrate(ctx context.Context, db *sql.DB) error {
	return migrations.Migrate(ctx, db)
}

package migrations

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"
)

//go:embed *.sql
var migrationFiles embed.FS

func Migrate(ctx context.Context, db *sql.DB) error {
	lockConnection, err := db.Conn(ctx)
	if err != nil {
		return fmt.Errorf("reserve migration lock connection: %w", err)
	}
	defer lockConnection.Close()

	var lockAcquired int
	if err := lockConnection.QueryRowContext(ctx, "SELECT GET_LOCK('bg_gold_schema_migrations', 60)").Scan(&lockAcquired); err != nil {
		return fmt.Errorf("acquire migration lock: %w", err)
	}
	if lockAcquired != 1 {
		return fmt.Errorf("acquire migration lock: timed out")
	}
	defer lockConnection.ExecContext(context.Background(), "SELECT RELEASE_LOCK('bg_gold_schema_migrations')")

	if _, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version BIGINT UNSIGNED PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
		) ENGINE=InnoDB`); err != nil {
		return fmt.Errorf("create schema migrations: %w", err)
	}

	entries, err := fs.ReadDir(migrationFiles, ".")
	if err != nil {
		return fmt.Errorf("read embedded migrations: %w", err)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		versionText, _, ok := strings.Cut(entry.Name(), "_")
		if !ok {
			return fmt.Errorf("invalid migration filename %q", entry.Name())
		}
		version, err := strconv.ParseUint(versionText, 10, 64)
		if err != nil {
			return fmt.Errorf("parse migration %q: %w", entry.Name(), err)
		}
		var applied bool
		if err := db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = ?)", version).Scan(&applied); err != nil {
			return fmt.Errorf("check migration %d: %w", version, err)
		}
		if applied {
			continue
		}
		body, err := migrationFiles.ReadFile(entry.Name())
		if err != nil {
			return fmt.Errorf("read migration %q: %w", entry.Name(), err)
		}
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin migration %d: %w", version, err)
		}
		if _, err := tx.ExecContext(ctx, string(body)); err != nil {
			tx.Rollback()
			return fmt.Errorf("apply migration %d: %w", version, err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_migrations(version, name) VALUES (?, ?)", version, entry.Name()); err != nil {
			tx.Rollback()
			return fmt.Errorf("record migration %d: %w", version, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %d: %w", version, err)
		}
	}
	return nil
}

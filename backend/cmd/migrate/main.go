package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"

	"github.com/bg-gold/attendance-api/database"
)

func main() {
	dsn := strings.TrimSpace(os.Getenv("MYSQL_DSN"))
	if dsn == "" {
		slog.Error("migration requires MYSQL_DSN")
		os.Exit(1)
	}

	ctx := context.Background()
	db, err := database.Open(ctx, dsn)
	if err != nil {
		fail("connect database", err)
	}
	defer db.Close()

	if err := database.Migrate(ctx, db); err != nil {
		fail("apply migrations", err)
	}

	var count uint64
	var latest uint64
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*), COALESCE(MAX(version), 0) FROM schema_migrations").Scan(&count, &latest); err != nil {
		fail("read migration status", err)
	}
	slog.Info("migration complete", "appliedVersions", count, "latestVersion", latest)
}

func fail(stage string, err error) {
	fmt.Fprintln(os.Stderr, stage+":", err)
	os.Exit(1)
}

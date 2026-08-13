package database

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/go-sql-driver/mysql"
)

func TestNormalizeDSNForUTC(t *testing.T) {
	normalized, err := normalizeDSN("user:password@tcp(localhost:3306)/attendance?parseTime=true&loc=Asia%2FJakarta")
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := mysql.ParseDSN(normalized)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Loc.String() != "UTC" {
		t.Fatalf("location = %s, want UTC", cfg.Loc)
	}
	if cfg.Params["time_zone"] != "'+00:00'" {
		t.Fatalf("time_zone = %q, want +00:00 session setting", cfg.Params["time_zone"])
	}
}

func TestOpenSetsUTCMySQLSession(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN is not configured")
	}
	if !strings.Contains(strings.ToLower(dsn), "_test") {
		t.Fatal("integration test refuses a DSN without _test in its database name")
	}
	db, err := Open(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var sessionTimezone string
	if err = db.QueryRow(`SELECT @@session.time_zone`).Scan(&sessionTimezone); err != nil {
		t.Fatal(err)
	}
	if sessionTimezone != "+00:00" {
		t.Fatalf("session time_zone = %q, want +00:00", sessionTimezone)
	}
}

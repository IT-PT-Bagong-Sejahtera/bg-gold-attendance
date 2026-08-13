package migrations

import (
	"io/fs"
	"strconv"
	"strings"
	"testing"
)

func TestEmbeddedMigrationsAreSequentialAndNonEmpty(t *testing.T) {
	entries, err := fs.ReadDir(migrationFiles, ".")
	if err != nil {
		t.Fatal(err)
	}

	expected := uint64(1)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		versionText, _, ok := strings.Cut(entry.Name(), "_")
		if !ok {
			t.Fatalf("invalid migration filename %q", entry.Name())
		}
		version, err := strconv.ParseUint(versionText, 10, 64)
		if err != nil {
			t.Fatalf("parse migration %q: %v", entry.Name(), err)
		}
		if version != expected {
			t.Fatalf("migration sequence gap: expected %d, found %d in %s", expected, version, entry.Name())
		}
		body, err := migrationFiles.ReadFile(entry.Name())
		if err != nil {
			t.Fatal(err)
		}
		if len(strings.TrimSpace(string(body))) == 0 {
			t.Fatalf("migration %s is empty", entry.Name())
		}
		expected++
	}
	if expected == 1 {
		t.Fatal("no SQL migrations embedded")
	}
}

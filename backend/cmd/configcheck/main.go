package main

import (
	"log/slog"
	"os"

	"github.com/bg-gold/attendance-api/config"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("environment validation failed", "error", err)
		os.Exit(1)
	}
	slog.Info("environment validation passed", "environment", cfg.Environment, "httpAddress", cfg.HTTPAddr)
}

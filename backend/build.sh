#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"
go test ./...
mkdir -p bin
CGO_ENABLED=0 go build -trimpath -o bin/absen-bg-api .

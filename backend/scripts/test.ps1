$ErrorActionPreference = "Stop"

Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    go test ./...
    go build ./...
} finally {
    Pop-Location
}

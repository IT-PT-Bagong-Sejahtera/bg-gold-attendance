$ErrorActionPreference = "Stop"

Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    docker compose --profile tools run --rm --no-deps config-check
} finally {
    Pop-Location
}

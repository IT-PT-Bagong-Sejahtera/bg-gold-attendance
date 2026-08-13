$ErrorActionPreference = "Stop"

Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    docker compose --profile tools run --rm migrate
} finally {
    Pop-Location
}

$ErrorActionPreference = "Stop"

Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    if (-not (Test-Path -LiteralPath ".env")) {
        throw "File .env belum ada. Salin .env.example lalu isi konfigurasi server."
    }

    $raw = Get-Content -Raw -LiteralPath ".env"
    if ($raw -match "(?i)CHANGE_ME|replace-with|example\.com|your-domain") {
        throw "Deployment dihentikan: masih ada placeholder di .env."
    }

    docker compose config --quiet
    docker compose --profile tools run --rm --no-deps config-check
    docker compose up -d mysql minio
    docker compose --profile tools run --rm migrate
    docker compose up -d --build api
    Write-Host "Backend aktif. Periksa endpoint /health pada API_HOST_PORT."
} finally {
    Pop-Location
}

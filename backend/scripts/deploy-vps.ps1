[CmdletBinding()]
param(
    [string]$VpsHost = "93.127.136.190",
    [string]$SshUser = "administrator",
    [int]$SshPort = 22,
    [string]$RemotePath = "/var/www/html/attendanceapi",
    [string]$ServiceName = "attendanceapi",
    [string]$PublicHealthUrl = "https://attendanceapi.bggold.cloud/health",
    [switch]$CheckOnly,
    [switch]$Force,
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$backendRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$backendPrefix = $backendRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$sshTarget = "$SshUser@$VpsHost"

function Assert-LastExitCode {
    param([string]$Action)
    if ($LASTEXITCODE -ne 0) {
        throw "$Action failed with exit code $LASTEXITCODE."
    }
}

function ConvertTo-ShellLiteral {
    param([Parameter(Mandatory)][string]$Value)
    return "'" + $Value.Replace("'", "'`"'`"'") + "'"
}

function Get-FileSetHash {
    param([Parameter(Mandatory)][IO.FileInfo[]]$Files)

    $entries = foreach ($file in ($Files | Sort-Object FullName -Unique)) {
        $fullPath = [IO.Path]::GetFullPath($file.FullName)
        if (-not $fullPath.StartsWith($backendPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Hash input is outside backend root: $fullPath"
        }
        $relativePath = $fullPath.Substring($backendPrefix.Length).Replace("\", "/")
        $fileHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $fullPath).Hash.ToLowerInvariant()
        "$relativePath`t$fileHash`n"
    }

    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes(($entries -join ""))
        $digest = $sha256.ComputeHash($bytes)
        return ([BitConverter]::ToString($digest)).Replace("-", "").ToLowerInvariant()
    } finally {
        $sha256.Dispose()
    }
}

function Invoke-External {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$Action
    )
    & $FilePath @Arguments
    Assert-LastExitCode $Action
}

foreach ($command in "go", "ssh", "scp") {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Required command is unavailable: $command"
    }
}
if ($RemotePath -notmatch '^/var/www/html/[^/]+$') {
    throw "RemotePath must be one direct child of /var/www/html."
}
if ($ServiceName -notmatch '^[A-Za-z0-9_.@-]+$') {
    throw "ServiceName contains unsupported characters."
}

Push-Location $backendRoot
$buildDirectory = $null
$remoteStage = $null
$remoteStageCreated = $false
try {
    $runtimeFiles = @(
        Get-ChildItem -LiteralPath $backendRoot -Recurse -File -Filter "*.go" |
            Where-Object { $_.Name -notlike "*_test.go" -and $_.FullName -notlike (Join-Path $backendRoot "bin*") }
        Get-Item -LiteralPath (Join-Path $backendRoot "go.mod"), (Join-Path $backendRoot "go.sum")
        Get-ChildItem -LiteralPath (Join-Path $backendRoot "migrations") -File -Filter "*.sql"
    )
    $migrationFiles = @(
        Get-ChildItem -LiteralPath (Join-Path $backendRoot "migrations") -File |
            Where-Object { $_.Extension -in ".go", ".sql" -and $_.Name -notlike "*_test.go" }
    )
    $sourceHash = Get-FileSetHash -Files $runtimeFiles
    $migrationHash = Get-FileSetHash -Files $migrationFiles

    $sshArguments = @(
        "-p", $SshPort,
        "-o", "ConnectTimeout=15",
        "-o", "StrictHostKeyChecking=accept-new",
        $sshTarget
    )
    $remotePathLiteral = ConvertTo-ShellLiteral $RemotePath
    $probeBody = @"
set -e
target=$remotePathLiteral
test -d "`$target"
sudo -n true
source_hash=""
migration_hash=""
if sudo -n test -r "`$target/.deploy-source.sha256"; then source_hash="`$(sudo -n cat "`$target/.deploy-source.sha256")"; fi
if sudo -n test -r "`$target/.deploy-migrations.sha256"; then migration_hash="`$(sudo -n cat "`$target/.deploy-migrations.sha256")"; fi
printf 'SOURCE=%s\nMIGRATIONS=%s\n' "`$source_hash" "`$migration_hash"
"@
    $probeCommand = "printf %s " + (ConvertTo-ShellLiteral $probeBody) + " | tr -d '\r' | bash -s"
    $probeOutput = (& ssh @sshArguments $probeCommand | Out-String)
    Assert-LastExitCode "Remote deployment probe"
    $remoteSourceHash = [regex]::Match($probeOutput, '(?m)^SOURCE=([0-9a-f]*)\s*$').Groups[1].Value
    $remoteMigrationHash = [regex]::Match($probeOutput, '(?m)^MIGRATIONS=([0-9a-f]*)\s*$').Groups[1].Value

    $sourceChanged = $Force -or $remoteSourceHash -ne $sourceHash
    $migrationChanged = $Force -or $remoteMigrationHash -ne $migrationHash
    Write-Host "Backend changed:   $sourceChanged"
    Write-Host "Migrations changed: $migrationChanged"

    if ($CheckOnly) {
        Write-Host "Check-only mode; no files were uploaded and no service was restarted."
        return
    }
    if (-not $sourceChanged -and -not $migrationChanged) {
        Write-Host "VPS already matches the current backend. Nothing to deploy."
        return
    }

    if (-not $SkipTests) {
        Invoke-External -FilePath "go" -Arguments @("test", "./...", "-count=1") -Action "Go test suite"
    }

    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $buildDirectory = Join-Path $tempRoot ("bg-gold-attendance-deploy-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $buildDirectory | Out-Null
    $apiBinary = Join-Path $buildDirectory "attendance-api"
    $migrateBinary = Join-Path $buildDirectory "attendanceapi-migrate"

    $previousGoOs = $env:GOOS
    $previousGoArch = $env:GOARCH
    try {
        $env:GOOS = "linux"
        $env:GOARCH = "amd64"
        Invoke-External -FilePath "go" -Arguments @("build", "-trimpath", "-ldflags=-s -w -buildid=", "-o", $apiBinary, ".") -Action "Linux API build"
        Invoke-External -FilePath "go" -Arguments @("build", "-trimpath", "-ldflags=-s -w -buildid=", "-o", $migrateBinary, "./cmd/migrate") -Action "Linux migration build"
    } finally {
        if ($null -eq $previousGoOs) { Remove-Item Env:GOOS -ErrorAction SilentlyContinue } else { $env:GOOS = $previousGoOs }
        if ($null -eq $previousGoArch) { Remove-Item Env:GOARCH -ErrorAction SilentlyContinue } else { $env:GOARCH = $previousGoArch }
    }

    $apiHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $apiBinary).Hash.ToLowerInvariant()
    $migrateHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $migrateBinary).Hash.ToLowerInvariant()
    $deploymentId = (Get-Date -Format "yyyyMMddHHmmss") + "-" + [guid]::NewGuid().ToString("N").Substring(0, 8)
    $remoteStage = "/tmp/attendanceapi-deploy-$deploymentId"
    Invoke-External -FilePath "ssh" -Arguments ($sshArguments + @("install -d -m 0700 " + (ConvertTo-ShellLiteral $remoteStage))) -Action "Create remote staging directory"
    $remoteStageCreated = $true

    $scpArguments = @(
        "-P", $SshPort,
        "-o", "ConnectTimeout=15",
        "-o", "StrictHostKeyChecking=accept-new",
        $apiBinary,
        $migrateBinary,
        "${sshTarget}:$remoteStage/"
    )
    Invoke-External -FilePath "scp" -Arguments $scpArguments -Action "Upload deployment artifacts"

    $migrationFlag = if ($migrationChanged) { "1" } else { "0" }
    $remoteDeployScript = @'
set -euo pipefail
TARGET="$1"
SERVICE="$2"
STAGE="$3"
SOURCE_HASH="$4"
MIGRATION_HASH="$5"
API_HASH="$6"
MIGRATE_HASH="$7"
MIGRATION_CHANGED="$8"
DEPLOYMENT_ID="$9"

case "$TARGET" in /var/www/html/*) ;; *) echo "Unsafe target path" >&2; exit 1 ;; esac
case "$STAGE" in /tmp/attendanceapi-deploy-*) ;; *) echo "Unsafe staging path" >&2; exit 1 ;; esac
test -d "$TARGET"
test -d "$STAGE"

cleanup() {
    rm -f -- "$TARGET/attendance-api.new" "$TARGET/attendanceapi-migrate.new"
    if [ -d "$STAGE" ]; then rm -rf -- "$STAGE"; fi
}
trap cleanup EXIT

test "$(sha256sum "$STAGE/attendance-api" | cut -d' ' -f1)" = "$API_HASH"
test "$(sha256sum "$STAGE/attendanceapi-migrate" | cut -d' ' -f1)" = "$MIGRATE_HASH"

BACKUP="$TARGET/releases/$DEPLOYMENT_ID"
install -d -m 0750 -o root -g attendanceapi "$TARGET/releases" "$BACKUP"
if [ -f "$TARGET/attendance-api" ]; then install -m 0755 -o root -g attendanceapi "$TARGET/attendance-api" "$BACKUP/attendance-api"; fi
if [ -f "$TARGET/attendanceapi-migrate" ]; then install -m 0755 -o root -g attendanceapi "$TARGET/attendanceapi-migrate" "$BACKUP/attendanceapi-migrate"; fi

install -m 0755 -o root -g attendanceapi "$STAGE/attendance-api" "$TARGET/attendance-api.new"
install -m 0755 -o root -g attendanceapi "$STAGE/attendanceapi-migrate" "$TARGET/attendanceapi-migrate.new"

if [ "$MIGRATION_CHANGED" = "1" ]; then
    echo "Running versioned database migrations..."
    sudo -u attendanceapi sh -c 'set -a; . /etc/attendanceapi/attendanceapi.env; set +a; exec "$1"' _ "$TARGET/attendanceapi-migrate.new"
else
    echo "No migration changes detected; explicit migration skipped."
fi

mv -f -- "$TARGET/attendance-api.new" "$TARGET/attendance-api"
mv -f -- "$TARGET/attendanceapi-migrate.new" "$TARGET/attendanceapi-migrate"

rollback_binary() {
    echo "Health check failed; restoring previous binaries." >&2
    if [ -f "$BACKUP/attendance-api" ]; then install -m 0755 -o root -g attendanceapi "$BACKUP/attendance-api" "$TARGET/attendance-api"; fi
    if [ -f "$BACKUP/attendanceapi-migrate" ]; then install -m 0755 -o root -g attendanceapi "$BACKUP/attendanceapi-migrate" "$TARGET/attendanceapi-migrate"; fi
    systemctl restart "$SERVICE.service" || true
}

if ! systemctl restart "$SERVICE.service"; then
    rollback_binary
    exit 1
fi

healthy=0
for attempt in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:8082/health >/dev/null; then healthy=1; break; fi
    sleep 1
done
if [ "$healthy" != "1" ]; then
    journalctl -u "$SERVICE.service" -n 80 --no-pager >&2 || true
    rollback_binary
    exit 1
fi

printf '%s\n' "$SOURCE_HASH" > "$TARGET/.deploy-source.sha256.new"
printf '%s\n' "$MIGRATION_HASH" > "$TARGET/.deploy-migrations.sha256.new"
chown root:attendanceapi "$TARGET/.deploy-source.sha256.new" "$TARGET/.deploy-migrations.sha256.new"
chmod 0640 "$TARGET/.deploy-source.sha256.new" "$TARGET/.deploy-migrations.sha256.new"
mv -f -- "$TARGET/.deploy-source.sha256.new" "$TARGET/.deploy-source.sha256"
mv -f -- "$TARGET/.deploy-migrations.sha256.new" "$TARGET/.deploy-migrations.sha256"

echo "DEPLOYMENT=$DEPLOYMENT_ID"
echo "MIGRATIONS_RAN=$MIGRATION_CHANGED"
echo "SERVICE=$(systemctl is-active "$SERVICE.service")"
'@
    $remoteArguments = @(
        (ConvertTo-ShellLiteral $RemotePath)
        (ConvertTo-ShellLiteral $ServiceName)
        (ConvertTo-ShellLiteral $remoteStage)
        (ConvertTo-ShellLiteral $sourceHash)
        (ConvertTo-ShellLiteral $migrationHash)
        (ConvertTo-ShellLiteral $apiHash)
        (ConvertTo-ShellLiteral $migrateHash)
        (ConvertTo-ShellLiteral $migrationFlag)
        (ConvertTo-ShellLiteral $deploymentId)
    ) -join " "
    $deployCommand = "tr -d '\r' | sudo -n bash -s -- $remoteArguments"
    $remoteDeployScript | & ssh @sshArguments $deployCommand
    Assert-LastExitCode "Remote deployment"
    $remoteStageCreated = $false

    $health = Invoke-RestMethod -Method Get -Uri $PublicHealthUrl -TimeoutSec 20
    if ($health.status -ne "ok") {
        throw "Public health endpoint did not return status=ok."
    }
    Write-Host "Deployment complete: $PublicHealthUrl"
} finally {
    if ($remoteStageCreated -and $remoteStage -match '^/tmp/attendanceapi-deploy-[A-Za-z0-9-]+$') {
        $cleanupCommand = "stage=" + (ConvertTo-ShellLiteral $remoteStage) + "; case `"`$stage`" in /tmp/attendanceapi-deploy-*) rm -rf -- `"`$stage`" ;; esac"
        & ssh @sshArguments $cleanupCommand 2>$null | Out-Null
    }
    if ($buildDirectory -and (Test-Path -LiteralPath $buildDirectory)) {
        $resolvedBuildDirectory = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $buildDirectory))
        $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
        if ($resolvedBuildDirectory.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -and
            (Split-Path -Leaf $resolvedBuildDirectory) -like "bg-gold-attendance-deploy-*") {
            Remove-Item -LiteralPath $resolvedBuildDirectory -Recurse -Force
        }
    }
    Pop-Location
}

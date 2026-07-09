[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$BackupPath,

  [string]$HostName = "localhost",
  [int]$Port = 5432,
  [string]$Database = "engineering_archive",
  [string]$UserName = "engineering_archive_app",
  [string]$Password = "",
  [switch]$CreatePreRestoreBackup,
  [string]$PreRestoreLabel = "pre-restore",
  [switch]$DropConnections,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found on this machine."
  }
}

if (-not $Force) {
  throw "Restore is destructive. Re-run with -Force after verifying the backup file and target database."
}

$resolvedBackupPath = (Resolve-Path $BackupPath).Path
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$backupScriptPath = Join-Path $PSScriptRoot "backup-postgres.ps1"

$backupIsDirectory = Test-Path $resolvedBackupPath -PathType Container
$backupExtension = [System.IO.Path]::GetExtension($resolvedBackupPath).ToLowerInvariant()
$usePlainSqlRestore = (-not $backupIsDirectory) -and ($backupExtension -eq ".sql")

if ($usePlainSqlRestore) {
  Require-Command "psql"
} else {
  Require-Command "pg_restore"
}

if ($CreatePreRestoreBackup) {
  if (-not (Test-Path $backupScriptPath -PathType Leaf)) {
    throw "Pre-restore backup script not found at '$backupScriptPath'."
  }

  Write-Host "Creating a pre-restore backup first..."
  & $backupScriptPath `
    -HostName $HostName `
    -Port $Port `
    -Database $Database `
    -UserName $UserName `
    -Password $Password `
    -Label $PreRestoreLabel

  if ($LASTEXITCODE -ne 0) {
    throw "Pre-restore backup failed."
  }
}

$originalPassword = $env:PGPASSWORD
try {
  if ($Password) {
    $env:PGPASSWORD = $Password
  }

  if ($DropConnections) {
    Require-Command "psql"
    $terminateSql = "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$Database' AND pid <> pg_backend_pid();"
    Write-Host "Dropping active connections to '$Database'..."
    & psql `
      "--host=$HostName" `
      "--port=$Port" `
      "--username=$UserName" `
      "--dbname=postgres" `
      "--command=$terminateSql"

    if ($LASTEXITCODE -ne 0) {
      throw "Failed to terminate active PostgreSQL connections."
    }
  }

  Write-Host "Restoring PostgreSQL backup..."
  Write-Host "Database : $Database"
  Write-Host "Host     : $HostName`:$Port"
  Write-Host "Backup   : $resolvedBackupPath"

  if ($usePlainSqlRestore) {
    & psql `
      "--set=ON_ERROR_STOP=1" `
      "--host=$HostName" `
      "--port=$Port" `
      "--username=$UserName" `
      "--dbname=$Database" `
      "--file=$resolvedBackupPath"

    if ($LASTEXITCODE -ne 0) {
      throw "psql restore failed with exit code $LASTEXITCODE."
    }
  } else {
    $restoreArgs = @(
      "--host=$HostName",
      "--port=$Port",
      "--username=$UserName",
      "--dbname=$Database",
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "--verbose",
      $resolvedBackupPath
    )

    & pg_restore @restoreArgs
    if ($LASTEXITCODE -ne 0) {
      throw "pg_restore failed with exit code $LASTEXITCODE."
    }
  }

  Write-Host ""
  Write-Host "Restore completed successfully."
  Write-Host "Recommended next step: run deployment/post-deploy-checklist.md critical checks."
} finally {
  if ($Password) {
    if ($null -eq $originalPassword) {
      Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    } else {
      $env:PGPASSWORD = $originalPassword
    }
  }
}

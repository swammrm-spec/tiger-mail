[CmdletBinding()]
param(
  [string]$HostName = "localhost",
  [int]$Port = 5432,
  [string]$Database = "engineering_archive",
  [string]$UserName = "engineering_archive_app",
  [string]$Password = "",
  [string]$OutputDir = "",
  [ValidateSet("custom", "plain", "tar", "directory")]
  [string]$Format = "custom",
  [string]$Label = "manual",
  [switch]$IncludeBlobs
)

$ErrorActionPreference = "Stop"

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found on this machine."
  }
}

function Convert-ToSlug {
  param([string]$Value)
  $normalized = ($Value -replace "[^a-zA-Z0-9\-_]+", "-").Trim("-")
  if ([string]::IsNullOrWhiteSpace($normalized)) {
    return "manual"
  }
  return $normalized.ToLowerInvariant()
}

Require-Command "pg_dump"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $OutputDir) {
  $OutputDir = Join-Path $projectRoot ".deploy\postgres-backups"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$labelSlug = Convert-ToSlug $Label

switch ($Format) {
  "custom" {
    $pgFormat = "c"
    $targetPath = Join-Path $OutputDir "$Database-$timestamp-$labelSlug.dump"
  }
  "plain" {
    $pgFormat = "p"
    $targetPath = Join-Path $OutputDir "$Database-$timestamp-$labelSlug.sql"
  }
  "tar" {
    $pgFormat = "t"
    $targetPath = Join-Path $OutputDir "$Database-$timestamp-$labelSlug.tar"
  }
  "directory" {
    $pgFormat = "d"
    $targetPath = Join-Path $OutputDir "$Database-$timestamp-$labelSlug"
    New-Item -ItemType Directory -Force -Path $targetPath | Out-Null
  }
  default {
    throw "Unsupported backup format: $Format"
  }
}

$originalPassword = $env:PGPASSWORD
try {
  if ($Password) {
    $env:PGPASSWORD = $Password
  }

  $arguments = @(
    "--host=$HostName",
    "--port=$Port",
    "--username=$UserName",
    "--dbname=$Database",
    "--format=$pgFormat",
    "--file=$targetPath",
    "--verbose"
  )

  if ($Format -ne "plain") {
    $arguments += @("--no-owner", "--no-privileges")
  }
  if ($IncludeBlobs) {
    $arguments += "--blobs"
  }

  Write-Host "Creating PostgreSQL backup..."
  Write-Host "Database : $Database"
  Write-Host "Host     : $HostName`:$Port"
  Write-Host "Format   : $Format"
  Write-Host "Output   : $targetPath"

  & pg_dump @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "pg_dump failed with exit code $LASTEXITCODE."
  }

  Write-Host ""
  Write-Host "Backup created successfully:"
  Write-Host $targetPath
} finally {
  if ($Password) {
    if ($null -eq $originalPassword) {
      Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    } else {
      $env:PGPASSWORD = $originalPassword
    }
  }
}

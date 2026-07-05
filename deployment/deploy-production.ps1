[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$HostName,

  [Parameter(Mandatory = $true)]
  [string]$UserName,

  [Parameter(Mandatory = $true)]
  [string]$RemotePath,

  [ValidateSet("pm2", "systemd", "node")]
  [string]$RestartMode = "pm2",

  [string]$Pm2Process = "emailarray-outlook",
  [string]$SystemdService = "emailarray-outlook",
  [string]$SshKeyPath = "",
  [string]$AppUrl = "https://techno-grp--com.w.emailarray.com",

  [switch]$SkipNpmInstall,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found on this machine."
  }
}

function New-ReleaseArchive {
  param(
    [string]$ProjectRoot,
    [string]$ArchivePath
  )

  $excludeRegex = '^(node_modules|dist|runtime|\.git|\.deploy|\.dbg|\.tmp-e2e-data[^\\/]*)([\\/]|$)'
  $excludeFiles = @(
    ".env",
    "server.log",
    "dev.log"
  )

  Push-Location $ProjectRoot
  try {
    $relativePaths = Get-ChildItem -Path . -Recurse -File | ForEach-Object {
      $relativePath = $_.FullName.Substring($ProjectRoot.Length + 1)
      if ($relativePath -match $excludeRegex) {
        return
      }
      if ($excludeFiles -contains $relativePath) {
        return
      }
      return $relativePath
    } | Where-Object { $_ }

    if (-not $relativePaths.Count) {
      throw "No files were collected for deployment archive."
    }

    Compress-Archive -Path $relativePaths -DestinationPath $ArchivePath -Force
  } finally {
    Pop-Location
  }
}

Require-Command "ssh"
Require-Command "scp"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$deployRoot = Join-Path $projectRoot ".deploy"
$releaseId = Get-Date -Format "yyyyMMdd-HHmmss"
$archiveName = "emailarray-outlook-$releaseId.zip"
$archivePath = Join-Path $deployRoot $archiveName
$remoteScriptLocal = Join-Path $deployRoot "remote-deploy-$releaseId.sh"
$remoteArchivePath = "/tmp/$archiveName"
$remoteScriptPath = "/tmp/emailarray-remote-deploy-$releaseId.sh"

New-Item -ItemType Directory -Force -Path $deployRoot | Out-Null

Write-Host "Creating deployment archive..."
New-ReleaseArchive -ProjectRoot $projectRoot -ArchivePath $archivePath

$npmInstallCommand = if ($SkipNpmInstall) { "echo 'Skipping npm install'" } else { "npm install" }
$buildCommand = if ($SkipBuild) { "echo 'Skipping npm run build'" } else { "npm run build" }

$remoteScript = @"
#!/usr/bin/env bash
set -euo pipefail

REMOTE_PATH='$RemotePath'
RELEASE_ID='$releaseId'
RESTART_MODE='$RestartMode'
PM2_PROCESS='$Pm2Process'
SYSTEMD_SERVICE='$SystemdService'
APP_URL='$AppUrl'
REMOTE_ARCHIVE='$remoteArchivePath'

RELEASES_DIR="\$REMOTE_PATH/releases"
RELEASE_DIR="\$RELEASES_DIR/\$RELEASE_ID"
SHARED_DIR="\$REMOTE_PATH/shared"
CURRENT_LINK="\$REMOTE_PATH/current"

mkdir -p "\$RELEASES_DIR"
mkdir -p "\$SHARED_DIR/runtime"
mkdir -p "\$RELEASE_DIR"

if [[ ! -f "\$SHARED_DIR/.env" ]]; then
  echo "ERROR: Missing production env file at \$SHARED_DIR/.env"
  echo "Create it from deployment/.env.production.example before running this script."
  exit 1
fi

if command -v unzip >/dev/null 2>&1; then
  unzip -oq "\$REMOTE_ARCHIVE" -d "\$RELEASE_DIR"
else
  python3 - "\$REMOTE_ARCHIVE" "\$RELEASE_DIR" <<'PY'
import sys, zipfile
zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])
PY
fi

ln -sfn "\$SHARED_DIR/.env" "\$RELEASE_DIR/.env"
rm -rf "\$RELEASE_DIR/runtime"
ln -sfn "\$SHARED_DIR/runtime" "\$RELEASE_DIR/runtime"

cd "\$RELEASE_DIR"
$npmInstallCommand
$buildCommand

ln -sfn "\$RELEASE_DIR" "\$CURRENT_LINK"
cd "\$CURRENT_LINK"

case "\$RESTART_MODE" in
  pm2)
    if pm2 describe "\$PM2_PROCESS" >/dev/null 2>&1; then
      pm2 restart "\$PM2_PROCESS" --update-env
    else
      pm2 start server/index.js --name "\$PM2_PROCESS"
    fi
    pm2 save || true
    ;;
  systemd)
    sudo systemctl restart "\$SYSTEMD_SERVICE"
    sudo systemctl status "\$SYSTEMD_SERVICE" --no-pager -l || true
    ;;
  node)
    pkill -f "node server/index.js" || true
    nohup npm start > app.log 2>&1 &
    sleep 3
    ;;
  *)
    echo "Unsupported restart mode: \$RESTART_MODE"
    exit 1
    ;;
esac

echo ""
echo "Deployment finished."
echo "Current release: \$RELEASE_DIR"
echo "Current symlink: \$CURRENT_LINK"

if command -v curl >/dev/null 2>&1; then
  echo ""
  echo "Post-deploy HTTP check:"
  curl -fsS "\${APP_URL%/}/api/public/company-info" || true
  echo ""
fi
"@

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($remoteScriptLocal, $remoteScript, $utf8NoBom)

$sshArgs = @()
if ($SshKeyPath) {
  $sshArgs += @("-i", $SshKeyPath)
}

$remoteTarget = "$UserName@$HostName"

Write-Host "Uploading archive to $remoteTarget ..."
& scp @sshArgs $archivePath "${remoteTarget}:$remoteArchivePath"
& scp @sshArgs $remoteScriptLocal "${remoteTarget}:$remoteScriptPath"

Write-Host "Running remote deployment..."
& ssh @sshArgs $remoteTarget "chmod +x $remoteScriptPath && bash $remoteScriptPath"

Write-Host ""
Write-Host "Suggested manual checks:"
Write-Host "1. Open $AppUrl"
Write-Host "2. Login as admin and verify Direct Manager assignments."
Write-Host "3. Send a test message from employee and confirm it lands in Pending Approvals."
Write-Host "4. Login as manager and open Pending."
